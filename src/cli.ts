#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FlopAgent } from "./agent.js";
import { loadConfig, newWorkId } from "./core.js";
import type { AgentConfig, WorkRequest } from "./types.js";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";
const value = (name:string, fallback?:string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i+1] : fallback;
};
const configPath = resolve(value("--config", "flop-agent.json")!);

async function init() {
  const cwd = process.cwd();
  const config: AgentConfig = {
    id: value("--id", "local-agent")!,
    name: value("--name", "Local FLOP Agent")!,
    capabilities: (value("--capabilities", "general") ?? "general").split(",").map(x => x.trim()).filter(Boolean),
    registryPath: resolve(value("--registry", ".flop/registry.json")!),
    stateDir: resolve(value("--state", ".flop/state")!),
    advertiseEndpoint: value("--endpoint", "http://127.0.0.1:8787/work"),
    runtime: {
      kind: "shell",
      command: process.execPath,
      args: ["-e", "const x=JSON.parse(process.argv[1]); console.log(JSON.stringify({ok:true,input:x}))"],
      timeoutMs: 10000,
      maxAttempts: 2,
    },
  };
  await mkdir(resolve(cwd, ".flop"), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  console.log(configPath);
}

async function publish() {
  const agent = new FlopAgent(await loadConfig(configPath));
  console.log(JSON.stringify(await agent.publish(), null, 2));
}

async function run() {
  const config = await loadConfig(configPath);
  const capability = value("--capability", config.capabilities[0]);
  if (!capability) throw new Error("CAPABILITY_REQUIRED");
  const raw = value("--input", "{}")!;
  let input: unknown;
  try { input = JSON.parse(raw); } catch { input = raw; }
  const request: WorkRequest = {
    id: value("--id", newWorkId())!,
    capability,
    input,
    idempotencyKey: value("--idempotency-key"),
  };
  const bundle = await new FlopAgent(config).run(request);
  console.log(JSON.stringify(bundle, null, 2));
  if (bundle.verification.status !== "PASS" || bundle.receipt.result.status !== "completed") process.exitCode = 1;
}

async function serve() {
  const config = await loadConfig(configPath);
  const agent = new FlopAgent(config);
  await agent.publish();
  const port = Number(value("--port", "8787"));
  const server = createServer(async (req,res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, {"content-type":"application/json"});
      return res.end(JSON.stringify({ok:true,agentId:config.id,capabilities:config.capabilities}));
    }
    if (req.method !== "POST" || req.url !== "/work") { res.writeHead(404); return res.end(); }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    try {
      const request = JSON.parse(Buffer.concat(chunks).toString("utf8")) as WorkRequest;
      const bundle = await agent.executeIncoming(request);
      res.writeHead(bundle.verification.status === "PASS" ? 200 : 500, {"content-type":"application/json"});
      res.end(JSON.stringify(bundle));
    } catch (error) {
      res.writeHead(400, {"content-type":"application/json"});
      res.end(JSON.stringify({error:error instanceof Error?error.message:String(error)}));
    }
  });
  server.listen(port, "127.0.0.1", () => console.log(`flop-agent ${config.id} listening on http://127.0.0.1:${port}`));
}

async function demo() {
  if (cmd === "demo" && !args.includes("--config")) await init();
  await publish();
  await run();
}

async function main() {
  if (cmd === "init") return init();
  if (cmd === "publish") return publish();
  if (cmd === "run") return run();
  if (cmd === "serve") return serve();
  if (cmd === "demo") return demo();
  console.log("flop-agent <init|publish|run|serve|demo> [--config flop-agent.json]");
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
