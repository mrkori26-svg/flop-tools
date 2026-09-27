import { testnetObservationDigest, type TestnetFinality, type TestnetRailObservation } from "@flop-tools/economic-runtime";

type RpcTx={hash:string;from:string;to:string|null;value:string;blockNumber:string|null};
type RpcReceipt={transactionHash:string;status:string;blockNumber:string;blockHash:string};
type RpcBlock={number:string}|null;

const hex=(v:string)=>BigInt(v);

async function rpc<T>(url:string,method:string,params:unknown[]):Promise<T>{
  const u=new URL(url);
  if(u.protocol!=="https:" && !(u.protocol==="http:"&&["127.0.0.1","localhost","::1"].includes(u.hostname))) throw new Error("UNSAFE_RPC_URL");
  const res=await fetch(u,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(20000)});
  if(!res.ok) throw new Error(`RPC_HTTP_${res.status}`);
  const j:any=await res.json();
  if(j.error) throw new Error(`RPC_${j.error.code}:${j.error.message}`);
  return j.result as T;
}

export type EvmSettlementObservationRequest={
  rpcUrl:string;
  railId:string;
  network:string;
  chainId:string;
  reservationId:string;
  asset:string;
  assetKind?:"NATIVE";
  lock:{txHash:string;lockRef:string;amount:string;to?:string;from?:string};
  settlement:{txHash:string;lockRef:string;amount:string;to?:string;from?:string};
  observerId:string;
};

function eqAddr(actual?:string|null,expected?:string|null){
  if(expected===undefined||expected===null) return true;
  if(actual===undefined||actual===null) return false;
  return actual.toLowerCase()===expected.toLowerCase();
}

function blockNumber(block:RpcBlock):number|null{
  if(!block) return null;
  const n=Number(hex(block.number));
  return Number.isSafeInteger(n)&&n>=0?n:null;
}

async function finalityHeads(url:string):Promise<{safe:number|null;finalized:number|null}>{
  const read=async(tag:"safe"|"finalized")=>{
    try{return blockNumber(await rpc<RpcBlock>(url,"eth_getBlockByNumber",[tag,false]));}
    catch{return null;}
  };
  const [safe,finalized]=await Promise.all([read("safe"),read("finalized")]);
  return {safe,finalized};
}

async function one(
  req:EvmSettlementObservationRequest,
  kind:"LOCKED"|"SETTLED",
  latest:number,
  heads:{safe:number|null;finalized:number|null},
):Promise<TestnetRailObservation>{
  const part=kind==="LOCKED"?req.lock:req.settlement;
  const [tx,receipt]=await Promise.all([
    rpc<RpcTx>(req.rpcUrl,"eth_getTransactionByHash",[part.txHash]),
    rpc<RpcReceipt>(req.rpcUrl,"eth_getTransactionReceipt",[part.txHash]),
  ]);
  if(!tx||!receipt) throw new Error(`${kind}_TX_NOT_FOUND`);
  if(tx.hash.toLowerCase()!==part.txHash.toLowerCase()||receipt.transactionHash.toLowerCase()!==part.txHash.toLowerCase()) throw new Error(`${kind}_TX_HASH_MISMATCH`);
  if(tx.blockNumber===null||tx.blockNumber.toLowerCase()!==receipt.blockNumber.toLowerCase()) throw new Error(`${kind}_BLOCK_BINDING_MISMATCH`);
  if(receipt.status!=="0x1") throw new Error(`${kind}_TX_REVERTED`);
  if(!eqAddr(tx.to,part.to)||!eqAddr(tx.from,part.from)) throw new Error(`${kind}_PARTY_MISMATCH`);
  if(req.assetKind!=="NATIVE") throw new Error("EVM_ASSET_KIND_UNSUPPORTED");
  if(!/^[0-9]+$/.test(part.amount)) throw new Error(`${kind}_AMOUNT_INVALID`);
  if(hex(tx.value)!==BigInt(part.amount)) throw new Error(`${kind}_AMOUNT_MISMATCH`);
  const block=Number(hex(receipt.blockNumber));
  if(!Number.isSafeInteger(block)||block<0||!Number.isSafeInteger(latest)||latest<block) throw new Error(`${kind}_BLOCK_HEIGHT_INVALID`);
  const confirmations=latest-block+1;
  const finality:TestnetFinality =
    heads.finalized!==null && block<=heads.finalized ? "FINALIZED" :
    heads.safe!==null && block<=heads.safe ? "SAFE" :
    "CONFIRMED";
  const body={
    schema:"flop.testnet-rail-observation/v1" as const,
    mode:"TESTNET" as const,
    railId:req.railId,
    network:req.network,
    chainId:req.chainId,
    reservationId:req.reservationId,
    state:kind,
    lockRef:part.lockRef,
    txRef:part.txHash,
    asset:req.asset,
    amount:BigInt(part.amount).toString(),
    blockRef:receipt.blockHash,
    confirmations,
    finality,
    observedAt:new Date().toISOString(),
    externalObserver:true as const,
    observerId:req.observerId,
  };
  return {...body,evidenceDigest:testnetObservationDigest(body)};
}

export async function observeEvmTestnetSettlement(req:EvmSettlementObservationRequest):Promise<TestnetRailObservation[]>{
  if(!req.observerId.trim()) throw new Error("EVM_OBSERVER_ID_REQUIRED");
  if(req.assetKind!=="NATIVE") throw new Error("EVM_ASSET_KIND_UNSUPPORTED");
  const actualChain=await rpc<string>(req.rpcUrl,"eth_chainId",[]);
  if(BigInt(actualChain).toString()!==BigInt(req.chainId).toString()) throw new Error("CHAIN_ID_MISMATCH");
  const latest=Number(hex(await rpc<string>(req.rpcUrl,"eth_blockNumber",[])));
  if(!Number.isSafeInteger(latest)||latest<0) throw new Error("LATEST_BLOCK_INVALID");
  const heads=await finalityHeads(req.rpcUrl);
  const lock=await one(req,"LOCKED",latest,heads);
  const settled=await one(req,"SETTLED",latest,heads);
  if(lock.lockRef!==settled.lockRef) throw new Error("LOCK_REF_MISMATCH");
  return [lock,settled];
}
