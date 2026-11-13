import test from "node:test";
import assert from "node:assert/strict";
import { createMcpServer } from "../src/mcp.js";
import type { AgentConfig } from "../src/types.js";

test("MCP surface exposes the canonical RUN tools", () => {
  const config: AgentConfig = {
    id: "agent-a",
    name: "Agent A",
    capabilities: ["research"],
    registryPath: ".flop/registry.json",
    stateDir: ".flop/state",
    discovery: { kind: "local" },
    runtime: {
      kind: "shell",
      command: process.execPath,
      args: ["-e", "console.log('{}')"],
      timeoutMs: 1000,
      maxAttempts: 1,
    },
  };
  const server = createMcpServer(config);
  for (const name of [
    "flop_agent_run",
    "flop_agent_publish",
    "flop_agent_candidates",
    "flop_agent_doctor",
    "flop_receipt_recheck",
  ]) {
    assert.ok(server.toolInputSchemaJson(name), `missing MCP tool ${name}`);
  }
});
