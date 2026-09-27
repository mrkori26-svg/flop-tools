import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OperationalMemory } from "../src/memory.js";
import { buildReputation } from "../src/reputation.js";

test("reputation counts terminal outcomes per work, not per event",()=>{
  const records:any[]=[
    {schema:"flop.operational-memory/v1",at:"2026-09-27T00:00:00Z",counterparty:"did:a",capability:"conformance",workId:"w1",outcome:"ACCEPTED"},
    {schema:"flop.operational-memory/v1",at:"2026-09-27T00:00:01Z",counterparty:"did:a",capability:"conformance",workId:"w1",outcome:"COMPLETED",latencyMs:100},
    {schema:"flop.operational-memory/v1",at:"2026-09-27T00:00:02Z",counterparty:"did:a",capability:"conformance",workId:"w1",outcome:"VALIDATED",evidenceRef:"sha256:x"},
    {schema:"flop.operational-memory/v1",at:"2026-09-27T00:00:03Z",counterparty:"did:a",capability:"research",workId:"w2",outcome:"SELECTED"},
    {schema:"flop.operational-memory/v1",at:"2026-09-27T00:00:04Z",counterparty:"did:a",capability:"research",workId:"w2",outcome:"FAILED"},
  ];
  const rep=buildReputation("did:a",records);
  assert.equal(rep.observations,2);
  assert.equal(rep.accepted,1);
  assert.equal(rep.completed,1);
  assert.equal(rep.validated,1);
  assert.equal(rep.failed,1);
  assert.equal(rep.successRate,0.5);
  assert.equal(rep.validationRate,1);
  assert.equal(rep.capabilities.conformance?.observations,1);
  assert.equal(rep.capabilities.research?.observations,1);
});

test("operational summary counts unique works while retaining raw event count",async()=>{
  const root=await mkdtemp(join(tmpdir(),"flop-memory-summary-"));
  const mem=new OperationalMemory(join(root,"memory.ndjson"));
  await mem.append({schema:"flop.operational-memory/v1",at:new Date().toISOString(),counterparty:"did:a",capability:"conformance",workId:"w1",outcome:"SELECTED"});
  await mem.append({schema:"flop.operational-memory/v1",at:new Date().toISOString(),counterparty:"did:a",capability:"conformance",workId:"w1",outcome:"COMPLETED"});
  const summary=await mem.summary(1);
  assert.equal(summary.records,2);
  assert.equal(summary.byCounterparty["did:a"]?.jobs,1);
  assert.equal(summary.byCounterparty["did:a"]?.completed,1);
});

test("operational memory fails closed on malformed persisted history",async()=>{
  const root=await mkdtemp(join(tmpdir(),"flop-memory-corrupt-"));
  const path=join(root,"memory.ndjson");
  await writeFile(path,'{"schema":"flop.operational-memory/v1","at":"2026-09-27T00:00:00Z","counterparty":"did:a","capability":"x","workId":"w","outcome":"COMPLETED"}\n{bad-json}\n',"utf8");
  const mem=new OperationalMemory(path);
  await assert.rejects(mem.read(),/OPERATIONAL_MEMORY_CORRUPT_LINE_2/);
});
