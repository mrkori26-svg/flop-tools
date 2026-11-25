import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probe,EXPECTED_GENESIS,assertHash,parseRpcResponse } from '../tools/testnet-rpc-readonly.mjs';
class MockWebSocket {
  constructor(){this.handlers={};this.closed=false; queueMicrotask(()=>this.emit('open',{}));}
  addEventListener(name,fn){(this.handlers[name]??=[]).push(fn);}
  emit(name,event){for(const fn of this.handlers[name]??[])fn(event);}
  send(text){const q=JSON.parse(text);let result;
    if(q.method==='chain_getBlockHash') result=MockWebSocket.genesis;
    if(q.method==='chain_getFinalizedHead') result='0x'+'a'.repeat(64);
    if(q.method==='chain_getHeader')result={number:'0x12'};
    queueMicrotask(()=>this.emit('message',{data:JSON.stringify({jsonrpc:'2.0',id:q.id,result})}));
  }
  close(){this.closed=true;}
}
MockWebSocket.genesis=EXPECTED_GENESIS;
test('parses canonical hashes',()=>{assert.equal(assertHash(EXPECTED_GENESIS,'x'),EXPECTED_GENESIS);assert.throws(()=>assertHash('0x1','x'));});
test('accepts valid RPC responses',()=>{assert.equal(parseRpcResponse(JSON.stringify({jsonrpc:'2.0',id:1,result:42}),1),42);});
test('rejects mismatched RPC response id',()=>{assert.equal(parseRpcResponse(JSON.stringify({jsonrpc:'2.0',id:2,result:42}),1),null);});
test('verifies genesis and finalized block without signing',async()=>{const v=await probe(undefined,{WebSocketImpl:MockWebSocket,timeoutMs:200});assert.equal(v.verified,true);assert.equal(v.finalizedHeight,'0x12');});
test('fails closed on wrong genesis',async()=>{MockWebSocket.genesis='0x'+'b'.repeat(64);await assert.rejects(probe(undefined,{WebSocketImpl:MockWebSocket,timeoutMs:200}),/Genesis mismatch/);MockWebSocket.genesis=EXPECTED_GENESIS;});
test('refuses nonofficial RPC',async()=>await assert.rejects(probe('wss://example.com',{WebSocketImpl:MockWebSocket}),/Only the exact/));
