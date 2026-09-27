import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { executeWork } from "../src/runtime.js";
import type { AgentConfig } from "../src/types.js";

const request={id:"retry-test",capability:"research",input:{x:1},idempotencyKey:"retry-test"};

async function close(server:ReturnType<typeof createServer>){
  await new Promise<void>(resolve=>server.close(()=>resolve()));
}

test("deterministic HTTP 4xx does not consume retry budget",async()=>{
  let calls=0;
  const server=createServer((_req,res)=>{calls++;res.writeHead(422).end("invalid");});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    const address=server.address();
    if(!address||typeof address==="string")throw new Error("NO_ADDRESS");
    const config:AgentConfig={id:"a",name:"a",capabilities:["research"],registryPath:"unused",stateDir:"unused",
      runtime:{kind:"http",url:`http://127.0.0.1:${address.port}/work`,timeoutMs:1000,maxAttempts:3}};
    const result=await executeWork(config,request);
    assert.equal(result.status,"failed");
    assert.equal(result.attempts,1);
    assert.equal(result.error,"HTTP_RUNTIME_422");
    assert.equal(calls,1);
  }finally{await close(server);}
});

test("transient HTTP 5xx still retries with the same idempotency key",async()=>{
  let calls=0;
  let seenKey="";
  const server=createServer((req,res)=>{
    calls++;
    seenKey=String(req.headers["idempotency-key"]??"");
    if(calls===1){res.writeHead(503).end("busy");return;}
    res.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({ok:true}));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    const address=server.address();
    if(!address||typeof address==="string")throw new Error("NO_ADDRESS");
    const config:AgentConfig={id:"a",name:"a",capabilities:["research"],registryPath:"unused",stateDir:"unused",
      runtime:{kind:"http",url:`http://127.0.0.1:${address.port}/work`,timeoutMs:1000,maxAttempts:2}};
    const result=await executeWork(config,request);
    assert.equal(result.status,"completed");
    assert.equal(result.attempts,2);
    assert.equal(calls,2);
    assert.equal(seenKey,"retry-test");
  }finally{await close(server);}
});
