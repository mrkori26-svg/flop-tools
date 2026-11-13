import test from "node:test";
import assert from "node:assert/strict";
import { executeWorker } from "../src/workers.js";
import { createReceipt, RECEIPT_VERSION } from "@flop-tools/work-execution-receipt";
test("agent offers deterministic receipt recheck and retains independent verification boundary",async()=>{
 const receipt=createReceipt({receipt_version:RECEIPT_VERSION,work_id:"w",participants:[{identifier:"a",identifier_type:"agent-id"}],coverage:{state:"UNKNOWN"},observation_time:"2026-11-13T00:00:00Z",assurance_class:"SELF_ASSERTED"});
 const e=await executeWorker("execution-proof",{operation:"verify-retained",receipt,artifacts:[],expected:{workId:"w"}});
 assert.equal(e.status,"COMPLETED");assert.equal((e.output as any).execution,"UNKNOWN");
 assert.equal((e.output as any).result,"PARTIAL");assert.equal(e.metadata.verdict,"PARTIAL");
});
test("a conformance evaluation keeps FAIL separate from worker completion",async()=>{
 const e=await executeWorker("conformance",{profile:"technocore-agent",artifact:{}});
 assert.equal(e.status,"COMPLETED");assert.equal(e.metadata.verdict,"FAIL");
});
