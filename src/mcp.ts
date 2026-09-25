import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { FlopAgent } from "./agent.js";
import { diagnoseAgent } from "./diagnostics.js";
import { loadConfig, newWorkId, validateWorkRequest } from "./core.js";
import type { AgentConfig, WorkRequest } from "./types.js";

const jsonText = (value: unknown) => JSON.stringify(value, null, 2);

export function createMcpServer(config: AgentConfig): McpServer {
  const agent = new FlopAgent(config);
  const server = new McpServer({
    name: "flop-agent",
    version: "0.1.0",
  });

  server.registerTool(
    "flop_agent_run",
    {
      title: "Run FLOP agent work",
      description: "Discover, route and execute bounded agent work, returning receipt and verification evidence.",
      inputSchema: z.object({
        capability: z.string().min(1).max(128),
        input: z.unknown(),
        id: z.string().min(1).max(200).optional(),
        idempotencyKey: z.string().min(1).max(256).optional(),
        budget: z.object({
          amount: z.string().regex(/^\d+$/),
          asset: z.string().min(1).max(64),
        }).optional(),
      }),
    },
    async args => {
      const request = validateWorkRequest({
        id: args.id ?? newWorkId(),
        capability: args.capability,
        input: args.input,
        idempotencyKey: args.idempotencyKey,
        budget: args.budget,
      } satisfies WorkRequest);
      try {
        const bundle = await agent.run(request);
        const ok = bundle.independentVerification?.result === "PASS";
        return {
          isError: !ok,
          content: [{ type: "text", text: jsonText(bundle) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: jsonText({ error: error instanceof Error ? error.message : String(error) }),
          }],
        };
      }
    },
  );

  server.registerTool(
    "flop_agent_publish",
    {
      title: "Publish FLOP agent capabilities",
      description: "Publish the configured capability advertisement through the configured discovery surface.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const advertisement = await agent.publish();
        return { content: [{ type: "text", text: jsonText(advertisement) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: jsonText({ error: error instanceof Error ? error.message : String(error) }),
          }],
        };
      }
    },
  );

  server.registerTool(
    "flop_agent_candidates",
    {
      title: "List FLOP agent candidates",
      description: "Read currently discoverable candidates without executing work.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const candidates = await agent.candidates();
        return { content: [{ type: "text", text: jsonText(candidates) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: jsonText({ error: error instanceof Error ? error.message : String(error) }),
          }],
        };
      }
    },
  );

  server.registerTool(
    "flop_agent_doctor",
    {
      title: "Diagnose FLOP agent",
      description: "Check configuration, discovery and signer readiness without executing work.",
      inputSchema: z.object({}),
    },
    async () => {
      const report = await diagnoseAgent(config);
      return {
        isError: report.status === "FAIL",
        content: [{ type: "text", text: jsonText(report) }],
      };
    },
  );
  return server;
}

export async function serveMcp(configPath: string): Promise<void> {
  const config = await loadConfig(configPath);
  serveStdio(
    () => createMcpServer(config),
    {
      onerror: error => {
        console.error(`flop-agent MCP error: ${error.message}`);
      },
    },
  );
  console.error("flop-agent MCP server running on stdio");
}
