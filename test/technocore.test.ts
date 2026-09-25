import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";
import { discoverTechnocore } from "../src/technocore.js";
import type { AgentConfig } from "../src/types.js";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(data: Buffer): string {
  let n = BigInt("0x" + data.toString("hex"));
  let out = "";
  while (n > 0n) {
    const rem = Number(n % 58n);
    out = ALPHABET[rem] + out;
    n /= 58n;
  }
  let zeroes = 0;
  while (data[zeroes] === 0) zeroes++;
  return "1".repeat(zeroes) + out;
}

function fixtureMessage(room: string, mutate = false, endpoint = "https://8.8.8.8/work") {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({format:"der",type:"spki"}) as Buffer;
  const raw = der.subarray(-32);
  const did = "did:key:z" + base58(Buffer.concat([Buffer.from([0xed,0x01]), raw]));
  const advertisement = {
    schema:"flop.agent-advertisement/v1",
    capabilities:["research"],
    runtimeKind:"http",
    endpoint,
  };
  const text = "FLOP_AGENT_V1:" + Buffer.from(JSON.stringify(advertisement)).toString("base64url");
  const nonce = "123456789";
  const signature = sign(null, Buffer.from(`${room}|${nonce}|${text}`), privateKey).toString("base64url");
  return {
    from: did,
    text: mutate ? text + "x" : text,
    nonce,
    sig: signature,
    ts: "2026-09-24T00:00:00Z",
  };
}

async function withServer(messages: unknown[], fn: (url:string)=>Promise<void>) {
  const server = createServer((_req,res) => {
    const body = JSON.stringify({room:"d-test",generation:1,messages});
    res.writeHead(200, {"content-type":"application/json","content-length":Buffer.byteLength(body)});
    res.end(body);
  });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("NO_TEST_ADDRESS");
  try { await fn(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>(resolve => server.close(()=>resolve())); }
}

function config(baseUrl:string): AgentConfig {
  return {
    id:"did:key:z6Mktest",
    name:"test",
    capabilities:["research"],
    registryPath:"unused",
    stateDir:"unused",
    discovery:{kind:"technocore",room:"d-test",baseUrl},
    runtime:{kind:"http",url:"http://127.0.0.1:9999/work",timeoutMs:1000,maxAttempts:1},
  };
}

test("Technocore discovery accepts only cryptographically bound advertisements", async () => {
  const valid = fixtureMessage("d-test");
  const invalid = fixtureMessage("d-test", true);
  await withServer([invalid, valid], async url => {
    const candidates = await discoverTechnocore(config(url));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.agentId, valid.from);
    assert.deepEqual(candidates[0]?.capabilities, ["research"]);
    assert.equal(candidates[0]?.endpoint, "https://8.8.8.8/work");
  });
});

test("Technocore discovery rejects an unverified advertisement", async () => {
  await withServer([fixtureMessage("d-test", true)], async url => {
    assert.deepEqual(await discoverTechnocore(config(url)), []);
  });
});

test("Technocore discovery rejects signed private endpoints", async () => {
  const privateEndpoint = fixtureMessage("d-test", false, "http://127.0.0.1:9999/work");
  await withServer([privateEndpoint], async url => {
    assert.deepEqual(await discoverTechnocore(config(url)), []);
  });
});
