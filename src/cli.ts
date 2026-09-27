#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FlopAgent } from "./agent.js";
import { diagnoseAgent } from "./diagnostics.js";
import { serveMcp } from "./mcp.js";
import { loadConfig, newWorkId, validateAgentConfig, validateWorkRequest } from "./core.js";
import { EconomicWorkLayer, readPrepared } from "./economic-work.js";
import { capabilityRegistry } from "./capabilities.js";
import { buildReputation } from "./reputation.js";
import { discoverObservedCapabilities } from "./ecosystem-capabilities.js";
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
  const endpoint = value("--endpoint");
  const runtimeKind = value("--runtime", "shell") as "shell" | "http";
  if (!["shell","http"].includes(runtimeKind)) throw new Error("INVALID_RUNTIME");
  if (discoveryKind === "technocore" && !endpoint) throw new Error("TECHNOCORE_PUBLIC_ENDPOINT_REQUIRED");
  if (discoveryKind === "technocore" && !signerCommand) throw new Error("TECHNOCORE_SIGNER_NOT_CONFIGURED");
  const runtimeCommand = value("--runtime-command", process.execPath);
  const runtimeArgs = value("--runtime-args");
  const runtimeUrl = value("--runtime-url");
  if (runtimeKind === "http" && !runtimeUrl) throw new Error("HTTP_URL_MISSING");
  const timeoutMs = Number(value("--timeout-ms", "10000"));
  const maxAttempts = Number(value("--max-attempts", "2"));
  const config: AgentConfig = {
    id: value("--id", "local-agent")!,
    name: value("--name", "Local FLOP Agent")!,
    capabilities: (value("--capabilities", "general") ?? "general").split(",").map(x => x.trim()).filter(Boolean),
    registryPath: resolve(value("--registry", ".flop/registry.json")!),
    stateDir: resolve(value("--state", ".flop/state")!),
    advertiseEndpoint: endpoint ?? "http://127.0.0.1:8787/work",
    auth: value("--token-env") ? { tokenEnv: value("--token-env") } : undefined,
    discovery: discoveryKind === "technocore" ? {
      kind: "technocore",
      room: value("--room", "d-flop-infra"),
      baseUrl: value("--technocore-url", "https://technocore.chat"),
      signer: signerCommand ? { command: signerCommand, args: signerArgs ? JSON.parse(signerArgs) : [] } : undefined,
    } : { kind: "local" },
    runtime: runtimeKind === "http" ? {
      kind: "http",
      url: runtimeUrl,
      timeoutMs,
      maxAttempts,
    } : {
      kind: "shell",
      command: runtimeCommand,
      args: runtimeArgs ? JSON.parse(runtimeArgs) : ["-e", "const x=JSON.parse(process.argv[1]); console.log(JSON.stringify({ok:true,input:x}))"],
      timeoutMs,
      maxAttempts,
    },
  };
  const validated = validateAgentConfig(config);
  await mkdir(resolve(cwd, ".flop"), { recursive: true });
  await writeFile(configPath, JSON.stringify(validated, null, 2) + "\n", "utf8");
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
  const report = await diagnoseAgent(await loadConfig(configPath));
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "FAIL") process.exitCode = 1;
}

async function economicLayer() {
  const stateDir = resolve(value("--state", ".flop/economic-work")!);
  return new EconomicWorkLayer({
    stateDir,
    marketFeed: value("--market-feed", "https://flop-market.pages.dev/open.json"),
    minReward: Number(value("--min-reward", "0")),
    allowedAssets: (value("--assets", "") ?? "").split(",").map(x=>x.trim()).filter(Boolean),
    allowUnfunded: args.includes("--allow-unfunded"),
  });
}

async function economicScan() {
  const layer = await economicLayer();
  console.log(JSON.stringify(await layer.plans(), null, 2));
}

async function economicRun() {
  const layer = await economicLayer();
  const plans = await layer.plans();
  const offer = value("--offer");
  const selected = offer ? plans.find(x=>x.offer.offerId===offer) : plans[0];
  if (!selected) throw new Error("NO_ELIGIBLE_MARKET_WORK");
  console.log(JSON.stringify(await layer.executePlan(selected), null, 2));
}

async function economicCapabilities() {
  let external:any[]=[];
  try { external=await new FlopAgent(await loadConfig(configPath)).candidates(); } catch {}
  console.log(JSON.stringify(capabilityRegistry(external), null, 2));
}

async function economicReputation() {
  const layer = await economicLayer();
  const records = await layer.memory.read();
  const subject = value("--subject");
  if (subject) return console.log(JSON.stringify(buildReputation(subject,records), null, 2));
  const ids=[...new Set(records.map(x=>x.counterparty))];
  console.log(JSON.stringify(ids.map(id=>buildReputation(id,records)).sort((a,b)=>b.score-a.score), null, 2));
}

async function economicMemory() {
  const layer = await economicLayer();
  console.log(JSON.stringify(await layer.memory.longitudinal(), null, 2));
}

async function economicFinalize() {
  const preparedPath=value("--prepared");
  if(!preparedPath) throw new Error("PREPARED_PATH_REQUIRED");
  const layer=await economicLayer();
  const prepared=await readPrepared(resolve(preparedPath));
  const evidencePath=value("--evidence");
  const evidence=evidencePath ? JSON.parse(await readFile(resolve(evidencePath),"utf8")) : undefined;
  console.log(JSON.stringify(await layer.finalize(prepared,evidence),null,2));
}

async function economicDiscoverCapabilities() {
  const registry=await discoverObservedCapabilities(value("--room","blockrewards")!,value("--technocore-url","https://technocore.chat")!);
  const stateDir=resolve(value("--state",".flop/economic-work")!); await mkdir(stateDir,{recursive:true});
  await writeFile(resolve(stateDir,"observed-capabilities.json"),JSON.stringify(registry,null,2)+"\n","utf8");
  console.log(JSON.stringify(registry,null,2));
}

async function main() {
  if (cmd === "init") return init();
  if (cmd === "publish") return publish();
  if (cmd === "run") return run();
  if (cmd === "serve") return serve();
  if (cmd === "demo") return demo();
  if (cmd === "doctor") return doctor();
  if (cmd === "mcp") return serveMcp(configPath);
  if (cmd === "economic-scan") return economicScan();
  if (cmd === "economic-run") return economicRun();
  if (cmd === "economic-capabilities") return economicCapabilities();
  if (cmd === "economic-reputation") return economicReputation();
  if (cmd === "economic-memory") return economicMemory();
  if (cmd === "economic-finalize") return economicFinalize();
  if (cmd === "economic-discover-capabilities") return economicDiscoverCapabilities();
  console.log("flop-agent <init|publish|run|serve|demo|doctor|mcp|economic-scan|economic-run|economic-capabilities|economic-reputation|economic-memory|economic-finalize|economic-discover-capabilities> [--config flop-agent.json]");
  console.log("init options: --discovery local|technocore --endpoint <https-url> --room <room> --signer-command <path> --signer-args '[\"script.py\"]'");
  console.log("runtime options: --runtime shell|http --runtime-command <path> --runtime-args '[\"arg\"]' --runtime-url <url> --timeout-ms <ms> --max-attempts <n>");
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
