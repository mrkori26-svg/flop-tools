import { createPublicKey, verify as verifySignature } from "node:crypto";
import { spawn } from "node:child_process";
import type { AgentAdvertisement, AgentConfig, Candidate } from "./types.js";
import { assertPublicAgentEndpoint } from "./endpoint-policy.js";

const PREFIX = "FLOP_AGENT_V1:";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAX_ROOM_BYTES = 5 * 1024 * 1024;

interface TechnocoreMessage {
  from?: unknown;
  text?: unknown;
  nonce?: unknown;
  sig?: unknown;
  ts?: unknown;
}

function decodeBase58(value: string): Buffer {
  let n = 0n;
  for (const ch of value) {
    const digit = BASE58.indexOf(ch);
    if (digit < 0) throw new Error("INVALID_BASE58");
    n = n * 58n + BigInt(digit);
  }
  const hex = n.toString(16).padStart(n === 0n ? 0 : Math.ceil(n.toString(16).length / 2) * 2, "0");
  const body = hex ? Buffer.from(hex, "hex") : Buffer.alloc(0);
  let leading = 0;
  while (value[leading] === "1") leading++;
  return Buffer.concat([Buffer.alloc(leading), body]);
}

function publicKeyFromDid(did: string) {
  if (!did.startsWith("did:key:z")) throw new Error("UNSUPPORTED_DID");
  const decoded = decodeBase58(did.slice("did:key:z".length));
  if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error("UNSUPPORTED_DID_KEY");
  }
  const raw = decoded.subarray(2);
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  return createPublicKey({ key: Buffer.concat([prefix, raw]), format: "der", type: "spki" });
}

export function verifyRoomMessage(room: string, message: TechnocoreMessage): boolean {
  if (typeof message.from !== "string" || typeof message.text !== "string" ||
      typeof message.sig !== "string" ||
      (typeof message.nonce !== "string" && typeof message.nonce !== "number")) return false;
  try {
    const payload = Buffer.from(`${room}|${String(message.nonce)}|${message.text}`, "utf8");
    const signature = Buffer.from(message.sig, "base64url");
    return signature.length === 64 && verifySignature(null, payload, publicKeyFromDid(message.from), signature);
  } catch {
    return false;
  }
}

function encodeAdvertisement(item: AgentAdvertisement): string {
  const payload = Buffer.from(JSON.stringify({
    schema: item.schema,
    capabilities: item.capabilities,
    runtimeKind: item.runtimeKind,
    endpoint: item.endpoint,
  }), "utf8").toString("base64url");
  return PREFIX + payload;
}

function parseAdvertisement(room: string, message: TechnocoreMessage): Candidate | undefined {
  if (!verifyRoomMessage(room, message) || typeof message.text !== "string" ||
      typeof message.from !== "string" || !message.text.startsWith(PREFIX)) return undefined;
  try {
    const value = JSON.parse(Buffer.from(message.text.slice(PREFIX.length), "base64url").toString("utf8")) as Partial<AgentAdvertisement>;
    if (value.schema !== "flop.agent-advertisement/v1" ||
        !Array.isArray(value.capabilities) ||
        !value.capabilities.every(x => typeof x === "string" && x.length > 0) ||
        (value.runtimeKind !== "shell" && value.runtimeKind !== "http") ||
        (value.endpoint !== undefined && typeof value.endpoint !== "string")) return undefined;
    return {
      agentId: message.from,
      capabilities: [...new Set(value.capabilities)].sort(),
      runtimeKind: value.runtimeKind,
      endpoint: value.endpoint,
      observedAt: typeof message.ts === "string" ? message.ts : new Date(0).toISOString(),
    };
  } catch {
    return undefined;
  }
}

function baseUrl(config: AgentConfig): string {
  const selected = config.discovery?.baseUrl ?? "https://technocore.chat";
  const url = new URL(selected);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1","localhost","::1"].includes(url.hostname))) {
    throw new Error("UNSAFE_TECHNOCORE_BASE_URL");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function signerRequest(config: AgentConfig, request: unknown): Promise<any> {
  const signer = config.discovery?.signer;
  if (!signer?.command) throw new Error("TECHNOCORE_SIGNER_NOT_CONFIGURED");
  return await new Promise((resolve, reject) => {
    const child = spawn(signer.command, signer.args ?? [], { stdio: ["pipe","pipe","pipe"], windowsHide: true });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) return reject(new Error(`TECHNOCORE_SIGNER_FAILED:${Buffer.concat(stderr).toString("utf8").trim()}`));
      try { resolve(JSON.parse(Buffer.concat(stdout).toString("utf8"))); }
      catch { reject(new Error("TECHNOCORE_SIGNER_INVALID_RESPONSE")); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

export async function discoverTechnocore(config: AgentConfig): Promise<Candidate[]> {
  const room = config.discovery?.room;
  if (!room || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(room)) throw new Error("TECHNOCORE_ROOM_INVALID");
  const response = await fetch(`${baseUrl(config)}/r/${room}?format=json&since=0&limit=200`);
  if (!response.ok) throw new Error(`TECHNOCORE_HTTP_${response.status}`);
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.length > MAX_ROOM_BYTES) throw new Error("TECHNOCORE_RESPONSE_TOO_LARGE");
  const value = JSON.parse(raw.toString("utf8")) as { messages?: TechnocoreMessage[] };
  if (!Array.isArray(value.messages)) throw new Error("TECHNOCORE_ROOM_INVALID_RESPONSE");
  const latest = new Map<string, Candidate>();
  const endpointChecks = new Map<string, Promise<URL>>();
  for (const message of value.messages) {
    const candidate = parseAdvertisement(room, message);
    if (!candidate) continue;
    if (candidate.endpoint) {
      try {
        let check = endpointChecks.get(candidate.endpoint);
        if (!check) {
          check = assertPublicAgentEndpoint(candidate.endpoint);
          endpointChecks.set(candidate.endpoint, check);
        }
        await check;
      } catch {
        continue;
      }
    }
    latest.set(candidate.agentId, candidate);
  }
  return [...latest.values()].sort((a,b) => a.agentId.localeCompare(b.agentId));
}

export async function publishTechnocore(config: AgentConfig, item: AgentAdvertisement): Promise<AgentAdvertisement> {
  const room = config.discovery?.room;
  if (!room || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(room)) throw new Error("TECHNOCORE_ROOM_INVALID");
  if (!item.endpoint) throw new Error("TECHNOCORE_PUBLIC_ENDPOINT_REQUIRED");
  await assertPublicAgentEndpoint(item.endpoint);
  const text = encodeAdvertisement(item);
  const signedResponse = await signerRequest(config, { operation:"sign_technocore_room_message", room, text });
  const signed = signedResponse?.ok === true ? signedResponse.signed : undefined;
  if (!signed || typeof signed.did !== "string" || typeof signed.signature !== "string" ||
      typeof signed.nonce !== "string" || signed.text !== text) throw new Error("TECHNOCORE_SIGNER_REJECTED");
  if (signed.did !== config.id) throw new Error("TECHNOCORE_IDENTITY_MISMATCH");
  if (!verifyRoomMessage(room, { from:signed.did, text, nonce:signed.nonce, sig:signed.signature })) {
    throw new Error("TECHNOCORE_SIGNER_SIGNATURE_INVALID");
  }
  const response = await fetch(`${baseUrl(config)}/r/${room}?format=json`, {
    method:"POST",
    headers:{ "content-type":"application/json", "accept":"application/json" },
    body:JSON.stringify({ did:signed.did, sig:signed.signature, nonce:signed.nonce, text }),
  });
  if (!response.ok) throw new Error(`TECHNOCORE_PUBLISH_HTTP_${response.status}`);
  const discovered = await discoverTechnocore(config);
  const readback = discovered.find(x => x.agentId === signed.did && x.endpoint === item.endpoint &&
    JSON.stringify(x.capabilities) === JSON.stringify([...item.capabilities].sort()));
  if (!readback) throw new Error("TECHNOCORE_ADVERTISEMENT_READBACK_FAILED");
  return { ...item, agentId:signed.did, observedAt:readback.observedAt };
}

export async function technocoreSignerStatus(config: AgentConfig): Promise<{ok:boolean; did?:string; error?:string}> {
  if (config.discovery?.kind !== "technocore") return {ok:true};
  try {
    const result = await signerRequest(config, { operation:"status" });
    if (result?.ok !== true || result?.signer_available !== true || typeof result?.did !== "string") {
      return {ok:false,error:"SIGNER_UNAVAILABLE"};
    }
    if (result.did !== config.id) return {ok:false,did:result.did,error:"IDENTITY_MISMATCH"};
    return {ok:true,did:result.did};
  } catch (error) {
    return {ok:false,error:error instanceof Error ? error.message : String(error)};
  }
}
