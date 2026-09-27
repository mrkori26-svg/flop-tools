import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlopAgent } from "../src/agent.js";
import { executeRoutedWork } from "../src/router-adapter.js";
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

test("Session Router fails over to the next eligible agent", async () => {
  const root = await mkdtemp(join(tmpdir(), "flop-agent-failover-"));
  try {
    const candidates = [
      {agentId:"agent-a",capabilities:["research"],runtimeKind:"http" as const,endpoint:"http://a.invalid/work",observedAt:new Date().toISOString()},
      {agentId:"agent-b",capabilities:["research"],runtimeKind:"http" as const,endpoint:"http://b.invalid/work",observedAt:new Date().toISOString()},
    ];
    const routed = await executeRoutedWork(
      {id:"work-failover",capability:"research",input:{}},
      candidates,
      join(root,"state"),
      2,
      2000,
      async candidate => {
        if (candidate.agentId === "agent-a") throw new Error("simulated-unavailable");
        return { ok:true, agentId:candidate.agentId };
      },
    );
    assert.equal(routed.decision.sessionRouter?.initialSelectedAgentId, "agent-a");
    assert.equal(routed.decision.selectedAgentId, "agent-b");
    assert.deepEqual(routed.value, {ok:true,agentId:"agent-b"});
  } finally {
    await rm(root, {recursive:true,force:true});
  }
});

test("one FLOP Agent delegates real HTTP work and independently re-verifies the remote bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "flop-agent-remote-"));
  const registryPath = join(root, "registry.json");
  const remoteConfig: AgentConfig = {
    id:"a-remote", name:"Remote", capabilities:["research"], registryPath,
    stateDir:join(root,"remote-state"),
    runtime:{
      kind:"shell", command:process.execPath,
      args:["-e","const x=JSON.parse(process.argv[1]); console.log(JSON.stringify({remote:true,input:x}))"],
      timeoutMs:3000,maxAttempts:1,
    },
  };
  const remote = new FlopAgent(remoteConfig);
  const server = createServer(async (req,res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    try {
      const incoming = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const bundle = await remote.executeIncoming(incoming);
      if (incoming.id === "work-bad-binding") {
        bundle.receipt.executor = "spoofed-agent";
      }
      res.writeHead(200,{"content-type":"application/json"});
      res.end(JSON.stringify(bundle));
    } catch (error) {
      res.writeHead(500,{"content-type":"application/json"});
      res.end(JSON.stringify({error:error instanceof Error?error.message:String(error)}));
    }
  });

  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("NO_REMOTE_ADDRESS");
    remoteConfig.advertiseEndpoint = `http://127.0.0.1:${address.port}/work`;
    await remote.publish();

    const clientConfig: AgentConfig = {
      id:"z-client", name:"Client", capabilities:["research"], registryPath,
      stateDir:join(root,"client-state"),
      runtime:{kind:"shell",command:process.execPath,args:["-e","console.log('{}')"],timeoutMs:3000,maxAttempts:1},
    };
    const bundle = await new FlopAgent(clientConfig).run({
      id:"work-remote",capability:"research",input:{task:"ping"},idempotencyKey:"remote-once",
    });
    assert.equal(bundle.receipt.executor, "a-remote");
    assert.equal(bundle.receipt.result.status, "completed");
    assert.equal(bundle.independentVerification?.result, "PASS");
    assert.equal(bundle.delegatorVerification?.result, "PASS");
    const observationPath = join(root,"client-state","observations","raw","runtime.ndjson");
    const observations = (await readFile(observationPath,"utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.equal(observations.length, 2);
    assert.ok(observations.every(item => item.dimensions?.role === "delegator"));
    assert.ok(observations.every(item => item.outcome === "PASS"));

    await assert.rejects(
      new FlopAgent(clientConfig).run({
        id:"work-bad-binding",capability:"research",input:{task:"spoof"},idempotencyKey:"remote-spoof",
      }),
      /REMOTE_IDENTITY_BINDING_FAILED/,
    );
  } finally {
    await new Promise<void>(resolve => server.close(()=>resolve()));
    await rm(root,{recursive:true,force:true});
  }
});

test("budgeted work fails closed until comparable pricing exists", async () => {
  const config: AgentConfig = {
    id:"agent-budget", name:"Budget Agent", capabilities:["research"],
    registryPath:"unused", stateDir:"unused",
    discovery:{kind:"local"},
    runtime:{kind:"shell",command:process.execPath,args:["-e","console.log('{}')"],timeoutMs:1000,maxAttempts:1},
  };
  await assert.rejects(
    new FlopAgent(config).executeIncoming({
      id:"budget-work",
      capability:"research",
      input:{},
      budget:{amount:"10",asset:"USDC"},
    }),
    /BUDGET_ENFORCEMENT_UNAVAILABLE/,
  );
});


test("idempotency key reuse with different request content fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "flop-agent-idem-conflict-"));
  try {
    const config: AgentConfig = {
      id:"agent-a", name:"Agent A", capabilities:["research"],
      registryPath:join(root,"registry.json"), stateDir:join(root,"state"),
      runtime:{kind:"shell",command:process.execPath,args:["-e","const x=JSON.parse(process.argv[1]); console.log(JSON.stringify({ok:true,input:x}))"],timeoutMs:5000,maxAttempts:1},
    };
    const agent=new FlopAgent(config);
    await agent.executeIncoming({id:"work-1",capability:"research",input:{q:"a"},idempotencyKey:"same"});
    await assert.rejects(
      agent.executeIncoming({id:"work-1",capability:"research",input:{q:"b"},idempotencyKey:"same"}),
      /IDEMPOTENCY_KEY_REUSE_CONFLICT/,
    );
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});

test("Session Router cannot select a candidate that did not advertise the requested capability", async () => {
  const root=await mkdtemp(join(tmpdir(),"flop-agent-capability-"));
  try {
    await assert.rejects(
      executeRoutedWork(
        {id:"cap-work",capability:"research",input:{}},
        [{agentId:"agent-code",capabilities:["code"],runtimeKind:"http" as const,endpoint:"http://invalid/work",observedAt:new Date().toISOString()}],
        join(root,"state"),1,1000,async()=>({ok:true}),
      ),
      /NO_ELIGIBLE_AGENT/,
    );
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});


test("concurrent identical idempotency requests execute only once", async () => {
  const root=await mkdtemp(join(tmpdir(),"flop-agent-idem-concurrent-"));
  try {
    const countPath=join(root,"count.txt");
    const script='const fs=require("fs"); fs.appendFileSync(process.argv[1],"x\\n"); setTimeout(()=>console.log(JSON.stringify({ok:true})),150);';
    const config: AgentConfig = {
      id:"agent-a", name:"Agent A", capabilities:["research"],
      registryPath:join(root,"registry.json"), stateDir:join(root,"state"),
      runtime:{kind:"shell",command:process.execPath,args:["-e",script,countPath],timeoutMs:5000,maxAttempts:1},
    };
    const agent=new FlopAgent(config);
    const request={id:"work-concurrent",capability:"research",input:{q:"same"},idempotencyKey:"same-key"};
    const [a,b]=await Promise.all([agent.executeIncoming(request),agent.executeIncoming(request)]);
    assert.equal(a.bundleId,b.bundleId);
    const lines=(await readFile(countPath,"utf8")).trim().split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length,1);
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});

test("concurrent idempotency key reuse with different payload fails closed", async () => {
  const root=await mkdtemp(join(tmpdir(),"flop-agent-idem-race-"));
  try {
    const config: AgentConfig = {
      id:"agent-a", name:"Agent A", capabilities:["research"],
      registryPath:join(root,"registry.json"), stateDir:join(root,"state"),
      runtime:{kind:"shell",command:process.execPath,args:["-e",'setTimeout(()=>console.log(JSON.stringify({ok:true})),150)'],timeoutMs:5000,maxAttempts:1},
    };
    const agent=new FlopAgent(config);
    const first=agent.executeIncoming({id:"work-race",capability:"research",input:{q:"a"},idempotencyKey:"race-key"});
    await assert.rejects(
      agent.executeIncoming({id:"work-race",capability:"research",input:{q:"b"},idempotencyKey:"race-key"}),
      /IDEMPOTENCY_KEY_REUSE_CONFLICT/,
    );
    await first;
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});
