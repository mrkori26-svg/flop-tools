import test from "node:test";
import assert from "node:assert/strict";
import { observeEvmTestnetSettlement } from "../src/evm-observer.js";
import { verifyTestnetSettlement } from "@flop-tools/economic-runtime";

const lockHash="0xaaa";
const settleHash="0xbbb";
const from="0x1111111111111111111111111111111111111111";
const to="0x2222222222222222222222222222222222222222";

function installRpc(overrides: Record<string,unknown>={}) {
  const original=globalThis.fetch;
  globalThis.fetch=async (_input:any,init:any)=>{
    const body=JSON.parse(String(init.body));
    let result:unknown;
    if(body.method==="eth_chainId") result="0xaa36a7";
    else if(body.method==="eth_blockNumber") result="0x80";
    else if(body.method==="eth_getBlockByNumber"){
      const tag=body.params[0];
      if(tag==="safe") result={number:"0x70"};
      else if(tag==="finalized") result={number:"0x6f"};
      else result=null;
    } else if(body.method==="eth_getTransactionByHash"){
      const h=body.params[0];
      const block=h===lockHash?"0x64":"0x65";
      const value=h===lockHash?"0x64":"0x3c";
      result={hash:h,from,to,value,blockNumber:block,...(overrides[`tx:${h}`] as object??{})};
    } else if(body.method==="eth_getTransactionReceipt"){
      const h=body.params[0];
      const block=h===lockHash?"0x64":"0x65";
      result={transactionHash:h,status:"0x1",blockNumber:block,blockHash:h===lockHash?"0xblock1":"0xblock2",...(overrides[`receipt:${h}`] as object??{})};
    } else throw new Error("unexpected rpc method");
    return new Response(JSON.stringify({jsonrpc:"2.0",id:1,result}),{status:200,headers:{"content-type":"application/json"}});
  };
  return ()=>{globalThis.fetch=original;};
}

const request=()=>({
  rpcUrl:"http://127.0.0.1:8545",
  railId:"evm-testnet",
  network:"sepolia",
  chainId:"11155111",
  reservationId:"r1",
  asset:"ETH",
  assetKind:"NATIVE" as const,
  lock:{txHash:lockHash,lockRef:"lock-1",amount:"100",to,from},
  settlement:{txHash:settleHash,lockRef:"lock-1",amount:"60",to,from},
  observerId:"test:rpc-observer",
});

test("EVM observer emits canonical observations accepted by settlement verifier",async()=>{
  const restore=installRpc();
  try{
    const observations=await observeEvmTestnetSettlement(request());
    assert.equal(observations.length,2);
    assert.ok(observations.every(x=>x.observerId==="test:rpc-observer"));
    assert.ok(observations.every(x=>x.finality==="FINALIZED"));
    const verified=verifyTestnetSettlement(observations,{reservationId:"r1",asset:"ETH",lockedAmount:"100",settledAmount:"60",minConfirmations:12,allowedNetworks:["sepolia"]});
    assert.equal(verified.status,"VERIFIED");
  }finally{restore();}
});

test("EVM observer rejects declared party when RPC transaction omits it",async()=>{
  const restore=installRpc({[`tx:${lockHash}`]:{to:null}});
  try{
    await assert.rejects(observeEvmTestnetSettlement(request()),/LOCKED_PARTY_MISMATCH/);
  }finally{restore();}
});

test("EVM observer rejects receipt not bound to requested transaction",async()=>{
  const restore=installRpc({[`receipt:${settleHash}`]:{transactionHash:"0xwrong"}});
  try{
    await assert.rejects(observeEvmTestnetSettlement(request()),/SETTLED_TX_HASH_MISMATCH/);
  }finally{restore();}
});

test("EVM observer fails closed for non-native asset semantics",async()=>{
  const restore=installRpc();
  try{
    const input:any=request();
    delete input.assetKind;
    await assert.rejects(observeEvmTestnetSettlement(input),/EVM_ASSET_KIND_UNSUPPORTED/);
  }finally{restore();}
});

test("EVM observer does not infer SAFE or FINALIZED when RPC finality heads are unavailable",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async (_input:any,init:any)=>{
    const body=JSON.parse(String(init.body));
    if(body.method==="eth_getBlockByNumber"){
      return new Response(JSON.stringify({jsonrpc:"2.0",id:1,error:{code:-32602,message:"unsupported tag"}}),{status:200,headers:{"content-type":"application/json"}});
    }
    let result:unknown;
    if(body.method==="eth_chainId") result="0xaa36a7";
    else if(body.method==="eth_blockNumber") result="0x80";
    else if(body.method==="eth_getTransactionByHash"){
      const h=body.params[0];
      const block=h===lockHash?"0x64":"0x65";
      const value=h===lockHash?"0x64":"0x3c";
      result={hash:h,from,to,value,blockNumber:block};
    } else if(body.method==="eth_getTransactionReceipt"){
      const h=body.params[0];
      const block=h===lockHash?"0x64":"0x65";
      result={transactionHash:h,status:"0x1",blockNumber:block,blockHash:h===lockHash?"0xblock1":"0xblock2"};
    } else throw new Error("unexpected rpc method");
    return new Response(JSON.stringify({jsonrpc:"2.0",id:1,result}),{status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const observations=await observeEvmTestnetSettlement(request());
    assert.ok(observations.every(x=>x.finality==="CONFIRMED"));
    const verified=verifyTestnetSettlement(observations,{reservationId:"r1",asset:"ETH",lockedAmount:"100",settledAmount:"60",minConfirmations:12,allowedNetworks:["sepolia"]});
    assert.equal(verified.status,"UNVERIFIED");
  }finally{globalThis.fetch=original;}
});

test("EVM observer rejects native value overshoot relative to the declared amount",async()=>{
  const restore=installRpc({[`tx:${settleHash}`]:{value:"0x64"}});
  try{
    await assert.rejects(observeEvmTestnetSettlement(request()),/SETTLED_AMOUNT_MISMATCH/);
  }finally{restore();}
});
