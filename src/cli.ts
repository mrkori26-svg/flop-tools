#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FlopAgent } from "./agent.js";
import { technocoreSignerStatus } from "./technocore.js";
import { loadConfig, newWorkId, validateWorkRequest } from "./core.js";
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
  const discoveryKind = value("--discovery", "local") as "local" | "technocore";
  if (!["local","technocore"].includes(discoveryKind)) throw new Error("INVALID_DISCOVERY_KIND");
  const signerCommand = value("--signer-command");
  const signerArgs = value("--signer-args");
  const config: AgentConfig = {
    id: value("--id", "local-agent")!,
    name: value("--name", "Local FLOP Agent")!,
    capabilities: (value("--capabilities", "general") ?? "general").split(",").map(x => x.trim()).filter(Boolean),
    registryPath: resolve(value("--registry", ".flop/registry.json")!),
    stateDir: resolve(value("--state", ".flop/state")!),
    advertiseEndpoint: value("--endpoint", "http://127.0.0.1:8787/work"),
    auth: value("--token-env") ? { tokenEnv: value("--token-env") } : undefined,
    discovery: discoveryKind === "technocore" ? {
      kind: "technocore",
      room: value("--room", "d-flop-infra"),
      baseUrl: value("--technocore-url", "https://technocore.chat"),
      signer: signerCommand ? { command: signerCommand, args: signerArgs ? JSON.parse(signerArgs) : [] } : undefined,
    } : { kind: "local" },
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
  const port = Number(value("--port", "8787"));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("INVALID_PORT");
  const host = value("--host", "127.0.0.1")!;
  if (value("--endpoint")) config.advertiseEndpoint = value("--endpoint");
  else if (!config.advertiseEndpoint || config.advertiseEndpoint === "http://127.0.0.1:8787/work") {
    config.advertiseEndpoint = `http://127.0.0.1:${port}/work`;
  }
  const agent = new FlopAgent(config);
  await agent.publish();
  const server = createServer(async (req,res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, {"content-type":"application/json"});
      return res.end(JSON.stringify({ok:true,agentId:config.id,capabilities:config.capabilities}));
    }
    if (req.method !== "POST" || req.url !== "/work") { res.writeHead(404); return res.end(); }
    if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      res.writeHead(415, {"content-type":"application/json"});
      return res.end(JSON.stringify({error:"CONTENT_TYPE_REQUIRED"}));
    }
    const tokenEnv = config.auth?.tokenEnv;
    if (tokenEnv) {
      const expected = process.env[tokenEnv];
      if (!expected) {
        res.writeHead(503, {"content-type":"application/json"});
        return res.end(JSON.stringify({error:"AUTH_TOKEN_UNAVAILABLE"}));
      }
      if (req.headers.authorization !== `Bearer ${expected}`) {
        res.writeHead(401, {"content-type":"application/json"});
        return res.end(JSON.stringify({error:"UNAUTHORIZED"}));
      }
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      for await (const chunk of req) {
        const part = Buffer.from(chunk);
        bytes += part.length;
        if (bytes > 1024 * 1024) throw new Error("REQUEST_TOO_LARGE");
        chunks.push(part);
      }
      const request = validateWorkRequest(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (!config.capabilities.includes(request.capability)) throw new Error("CAPABILITY_NOT_ADVERTISED");
      const bundle = await agent.executeIncoming(request);
      const verified = bundle.independentVerification?.result === "PASS";
      res.writeHead(verified ? 200 : 500, {"content-type":"application/json"});
      res.end(JSON.stringify(bundle));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(message === "REQUEST_TOO_LARGE" ? 413 : 400, {"content-type":"application/json"});
      res.end(JSON.stringify({error:message}));
    }
  });
  server.listen(port, host, () => console.log(`flop-agent ${config.id} listening on http://${host}:${port}`));
}

async function demo() {
  if (cmd === "demo" && !args.includes("--config")) await init();
  await publish();
  await run();
}

async function doctor() {
  const config = await loadConfig(configPath);
  const agent = new FlopAgent(config);
  const checks: Record<string, unknown> = {
    config: "PASS",
    agentId: config.id,
    capabilities: config.capabilities,
    discovery: config.discovery?.kind ?? "local",
  };
  if (!config.capabilities.length) checks.config = "FAIL:NO_CAPABILITIES";
  if (config.discovery?.kind === "technocore") {
    const signer = await technocoreSignerStatus(config);
    checks.signer = signer;
    try {
      const candidates = await agent.candidates();
      checks.discoveryRead = {ok:true,candidates:candidates.length};
    } catch (error) {
      checks.discoveryRead = {ok:false,error:error instanceof Error?error.message:String(error)};
    }
  } else {
    checks.discoveryRead = {ok:true,candidates:(await agent.candidates()).length};
  }
  const failed = Object.values(checks).some(value =>
    typeof value === "string" ? value.startsWith("FAIL") :
    value && typeof value === "object" && "ok" in value && (value as {ok?:boolean}).ok === false
  );
  console.log(JSON.stringify({schema:"flop-agent-doctor/v1",status:failed?"FAIL":"PASS",checks}, null, 2));
  if (failed) process.exitCode = 1;
}

async function main() {
  if (cmd === "init") return init();
  if (cmd === "publish") return publish();
  if (cmd === "run") return run();
  if (cmd === "serve") return serve();
  if (cmd === "demo") return demo();
  if (cmd === "doctor") return doctor();
  console.log("flop-agent <init|publish|run|serve|demo|doctor> [--config flop-agent.json]");
  console.log("init options: --discovery local|technocore --room <room> --signer-command <path> --signer-args '[\"script.py\"]'");
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
