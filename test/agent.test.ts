import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlopAgent } from "../src/agent.js";
import type { AgentConfig } from "../src/types.js";

test("incoming work is idempotent and routed by Session Router", async () => {
  const root = await mkdtemp(join(tmpdir(), "flop-agent-"));
  try {
    const config: AgentConfig = {
      id: "agent-a",
      name: "Agent A",
      capabilities: ["research"],
      registryPath: join(root, "registry.json"),
      stateDir: join(root, "state"),
      runtime: {
        kind: "shell",
        command: process.execPath,
        args: ["-e", "const x=JSON.parse(process.argv[1]); console.log(JSON.stringify({ok:true,input:x}))"],
        timeoutMs: 5000,
        maxAttempts: 2,
      },
    };
    const agent = new FlopAgent(config);
    const request = { id:"work-1", capability:"research", input:{q:"x"}, idempotencyKey:"stable-key" };
    const first = await agent.executeIncoming(request);
    const second = await agent.executeIncoming(request);
    assert.equal(first.bundleId, second.bundleId);
    assert.equal(first.verification.status, "PASS");
    assert.equal(first.receipt.route.rationale, "session_router");
    assert.ok(first.receipt.route.sessionRouter?.decisionId);
    assert.equal(first.portableReceipt.work_id, "work-1");
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});
