import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidence, buildReceipt, digest, route, validateAgentConfig, validateWorkRequest } from "../src/core.js";

test("digest is deterministic across object key order", () => {
  assert.equal(digest({a:1,b:2}), digest({b:2,a:1}));
});

test("routing is deterministic and capability scoped", () => {
  const decision = route(
    { id:"w1", capability:"research", input:{} },
    [
      {agentId:"z",capabilities:["research"],runtimeKind:"shell",observedAt:"2026-01-01T00:00:00Z"},
      {agentId:"a",capabilities:["research"],runtimeKind:"shell",observedAt:"2026-01-01T00:00:00Z"},
      {agentId:"b",capabilities:["code"],runtimeKind:"shell",observedAt:"2026-01-01T00:00:00Z"},
    ],
  );
  assert.equal(decision.selectedAgentId, "a");
  assert.deepEqual(decision.candidates, ["a","z"]);
});

test("receipt automatically becomes verified evidence", () => {
  const routeDecision = {
    schema:"flop.agent-route/v1" as const, requestId:"w1", selectedAgentId:"a",
    candidates:["a"], decidedAt:"2026-01-01T00:00:00Z",
    rationale:"capability_match_then_lexicographic" as const,
  };
  const receipt = buildReceipt(
    {id:"w1",capability:"research",input:{}},
    routeDecision,
    {status:"completed",output:{ok:true},startedAt:"2026-01-01T00:00:00Z",finishedAt:"2026-01-01T00:00:01Z",attempts:1},
  );
  const evidence = buildEvidence(receipt);
  assert.equal(evidence.verification.status, "PASS");
  assert.match(receipt.outputDigest!, /^sha256:/);
});

test("work request validation rejects malformed capabilities and budgets", () => {
  assert.throws(() => validateWorkRequest({id:"x",capability:"bad capability",input:{}}), /INVALID_WORK_CAPABILITY/);
  assert.throws(() => validateWorkRequest({id:"x",capability:"research",input:{},budget:{amount:"1.2",asset:"USDC"}}), /INVALID_WORK_BUDGET/);
  assert.equal(validateWorkRequest({id:"x",capability:"research",input:{}}).capability, "research");
});

test("agent config validation fails closed on unsafe runtime settings", () => {
  const base = {
    id:"agent-a", name:"Agent A", capabilities:["research"],
    registryPath:".flop/registry.json", stateDir:".flop/state",
    discovery:{kind:"local"},
    runtime:{kind:"shell",command:process.execPath,timeoutMs:1000,maxAttempts:1},
  };
  assert.equal(validateAgentConfig(base).id, "agent-a");
  assert.throws(
    () => validateAgentConfig({...base,runtime:{...base.runtime,maxAttempts:0}}),
    /INVALID_RUNTIME_ATTEMPTS/,
  );
  assert.throws(
    () => validateAgentConfig({...base,capabilities:["bad capability"]}),
    /INVALID_AGENT_CAPABILITIES/,
  );
});
