import { createHash } from "node:crypto";
import type { TestnetRailObservation } from "@flop-tools/economic-runtime";

type RpcTx={hash:string;from:string;to:string|null;value:string;blockNumber:string|null};
type RpcReceipt={transactionHash:string;status:string;blockNumber:string;blockHash:string};

const hex=(v:string)=>BigInt(v);
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");

async function rpc<T>(url:string,method:string,params:unknown[]):Promise<T>{
  const u=new URL(url);
  if(u.protocol!=="https:" && !(u.protocol==="http:"&&["127.0.0.1","localhost","::1"].includes(u.hostname))) throw new Error("UNSAFE_RPC_URL");
  const res=await fetch(u,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(20000)});
  if(!res.ok) throw new Error(`RPC_HTTP_${res.status}`);
  const j:any=await res.json(); if(j.error) throw new Error(`RPC_${j.error.code}:${j.error.message}`); return j.result as T;
}

export type EvmSettlementObservationRequest={
  rpcUrl:string;
  railId:string;
  network:string;
  chainId:string;
  reservationId:string;
  asset:string;
  lock:{txHash:string;lockRef:string;amount:string;to?:string;from?:string};
  settlement:{txHash:string;lockRef:string;amount:string;to?:string;from?:string};
};

function eqAddr(a?:string|null,b?:string|null){return !a||!b||a.toLowerCase()===b.toLowerCase();}

async function one(req:EvmSettlementObservationRequest,kind:"LOCKED"|"SETTLED",latest:number):Promise<TestnetRailObservation>{
  const part=kind==="LOCKED"?req.lock:req.settlement;
  const [tx,receipt]=await Promise.all([
    rpc<RpcTx>(req.rpcUrl,"eth_getTransactionByHash",[part.txHash]),
    rpc<RpcReceipt>(req.rpcUrl,"eth_getTransactionReceipt",[part.txHash]),
  ]);
  if(!tx||!receipt) throw new Error(`${kind}_TX_NOT_FOUND`);
  if(receipt.status!=="0x1") throw new Error(`${kind}_TX_REVERTED`);
  if(!eqAddr(tx.to,part.to)||!eqAddr(tx.from,part.from)) throw new Error(`${kind}_PARTY_MISMATCH`);
  if(hex(tx.value)<BigInt(part.amount)) throw new Error(`${kind}_AMOUNT_UNDERSHOOT`);
  const block=Number(hex(receipt.blockNumber)); const confirmations=Math.max(0,latest-block+1);
  const finality=confirmations>=64?"FINALIZED":confirmations>=12?"SAFE":"CONFIRMED";
  const raw={tx,receipt,latest,kind};
  return {
    schema:"flop.testnet-rail-observation/v1",mode:"TESTNET",railId:req.railId,network:req.network,chainId:req.chainId,
    reservationId:req.reservationId,state:kind,lockRef:part.lockRef,txRef:part.txHash,asset:req.asset,amount:BigInt(part.amount).toString(),
    blockRef:receipt.blockHash,confirmations,finality,observedAt:new Date().toISOString(),evidenceDigest:digest(raw),externalObserver:true
  };
}

export async function observeEvmTestnetSettlement(req:EvmSettlementObservationRequest):Promise<TestnetRailObservation[]>{
  const actualChain=await rpc<string>(req.rpcUrl,"eth_chainId",[]);
  if(BigInt(actualChain).toString()!==BigInt(req.chainId).toString()) throw new Error("CHAIN_ID_MISMATCH");
  const latest=Number(hex(await rpc<string>(req.rpcUrl,"eth_blockNumber",[])));
  const lock=await one(req,"LOCKED",latest); const settled=await one(req,"SETTLED",latest);
  if(lock.lockRef!==settled.lockRef) throw new Error("LOCK_REF_MISMATCH");
  return [lock,settled];
}
