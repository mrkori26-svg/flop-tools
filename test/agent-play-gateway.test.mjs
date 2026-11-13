import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import {createGateway} from '../tools/agent-play-api.mjs';
test('gateway exposes configured profiles, authenticates and retains independent verdict',async()=>{
 const stateDir=mkdtempSync(join(tmpdir(),'flop-offline-'));const calls=[];
 const executeWorker=async(kind,input)=>{calls.push({kind,input});return{status:'COMPLETED',output:input.operation==='verify-retained'?{result:'FAIL',execution:'UNKNOWN',settlement:'UNKNOWN'}:{receipt:{synthetic:true}},metadata:{verdict:'FAIL'}};};
 const s=createGateway({stateDir,token:'synthetic-test-token',executeWorker,conformanceProfiles:['router-evidence']});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+s.address().port;
 try{
 const health=await(await fetch(url+'/healthz')).json();assert.ok(health.workflows.includes('receipt.verify'));assert.deepEqual(health.conformanceProfiles,['router-evidence']);
 assert.equal((await fetch(url+'/v1/workflows',{method:'POST'})).status,401);
 const request={request_id:'offline',workflow:'receipt.verify',input:{receipt:{synthetic:true}}};
 const post=()=>fetch(url+'/v1/workflows',{method:'POST',headers:{authorization:'Bearer synthetic-test-token','content-type':'application/json'},body:JSON.stringify(request)});
 assert.equal((await post()).status,202);
 let job;for(let i=0;i<30;i++){job=await(await fetch(url+'/v1/jobs/offline',{headers:{authorization:'Bearer synthetic-test-token'}})).json();if(job.status!=='RUNNING')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(job.status,'COMPLETED');assert.equal(job.execution.output.result,'FAIL');assert.equal(job.payment.valueMoved,false);
 assert.equal(calls[0].input.operation,'verify-retained');
 assert.equal((await post()).status,200);assert.equal(calls.length,2);
 request.input.receipt={changed:true};assert.equal((await post()).status,409);
 }finally{await new Promise(r=>s.close(r));rmSync(stateDir,{recursive:true,force:true});}
});
