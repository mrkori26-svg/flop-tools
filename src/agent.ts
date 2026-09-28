import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { verifyExternalProfile } from "@flop-tools/conformance-lab";
import { advertise, buildEvidence, buildReceipt, digest, discover, saveJson } from "./core.js";
import { publishArtifacts, publishDelegatedObservation } from "./interop.js";
import { executeRoutedWork, routeWithSessionRouter } from "./router-adapter.js";
import { executeWork } from "./runtime.js";
import { discoverTechnocore, publishTechnocore } from "./technocore.js";
import { assertPublicAgentEndpoint } from "./endpoint-policy.js";
import type { AgentAdvertisement, AgentConfig, EvidenceBundle, WorkRequest } from "./types.js";

async function upsertAdvertisement(path: string, item: AgentAdvertisement): Promise<void> {
  let items: AgentAdvertisement[] = [];
  try { items = JSON.parse(await readFile(path, "utf8")) as AgentAdvertisement[]; } catch {}
  const next = [...items.filter(x => x.agentId !== item.agentId), item].sort((a,b) => a.agentId.localeCompare(b.agentId));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2) + "\n", "utf8");
}

export const delegatedArtifactName = (requestId: string): string => digest(requestId).slice(7) + ".json";

export class FlopAgent {
  private static readonly incomingInflight = new Map<string,{requestDigest:string;promise:Promise<EvidenceBundle>}>();
  constructor(readonly config: AgentConfig) {}

  async publish(): Promise<AgentAdvertisement> {
    const item = advertise(this.config);
    const published = this.config.discovery?.kind === "technocore"
      ? await publishTechnocore(this.config, item)
      : item;
    if (this.config.discovery?.kind !== "technocore") await upsertAdvertisement(this.config.registryPath, published);
    await saveJson(join(this.config.stateDir, "advertisement.json"), published);
    return published;
  }

  async candidates() {
    return this.config.discovery?.kind === "technocore"
      ? discoverTechnocore(this.config)
      : discover(this.config.registryPath);
  }

  async run(request: WorkRequest): Promise<EvidenceBundle> {
    if (request.budget) throw new Error("BUDGET_ENFORCEMENT_UNAVAILABLE");
    const candidates = await this.candidates();
    const routed = await executeRoutedWork(
      request,
      candidates,
      this.config.stateDir,
      this.config.runtime.maxAttempts,
      this.config.runtime.timeoutMs,
      async (candidate, signal) => {
        if (candidate.agentId === this.config.id) {
          return { kind: "local" as const, result: await executeWork(this.config, request) };
        }
        if (!candidate.endpoint) throw new Error(`REMOTE_ENDPOINT_MISSING:${candidate.agentId}`);
        if (this.config.discovery?.kind === "technocore") {
          await assertPublicAgentEndpoint(candidate.endpoint);
        }
        const response = await fetch(candidate.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": request.idempotencyKey ?? request.id },
          body: JSON.stringify(request),
          signal,
        });
        if (!response.ok) throw new Error(`REMOTE_AGENT_${response.status}`);
        const remoteBundle = await response.json() as EvidenceBundle;
        if (remoteBundle.receipt?.executor !== candidate.agentId ||
            remoteBundle.receipt?.route?.selectedAgentId !== candidate.agentId) {
          throw new Error("REMOTE_IDENTITY_BINDING_FAILED");
        }
        const delegatorVerification = verifyExternalProfile("flop-agent", remoteBundle);
        if (delegatorVerification.result === "FAIL") throw new Error("REMOTE_EVIDENCE_VERIFICATION_FAILED");
        return { kind: "remote" as const, bundle: { ...remoteBundle, delegatorVerification } };
      },
    );

    if (routed.value.kind === "remote") {
      await saveJson(join(this.config.stateDir, "delegated", delegatedArtifactName(request.id)), { requestId: request.id, decision: routed.decision, bundle: routed.value.bundle });
      await publishDelegatedObservation(this.config.stateDir, request, routed.decision, routed.value.bundle);
      return routed.value.bundle;
    }
    const receipt = buildReceipt(request, routed.decision, routed.value.result);
    const selfChecked = buildEvidence(receipt);
    const bundle = { ...selfChecked, independentVerification: verifyExternalProfile("flop-agent", selfChecked) };
    await publishArtifacts(this.config.stateDir, receipt, bundle);
    return bundle;
  }

  async executeIncoming(request: WorkRequest): Promise<EvidenceBundle> {
    if (request.budget) throw new Error("BUDGET_ENFORCEMENT_UNAVAILABLE");
    const idempotencyKey = request.idempotencyKey ?? request.id;
    const requestDigest = digest({ id:request.id, capability:request.capability, input:request.input, budget:request.budget });
    const cacheBase = join(this.config.stateDir, "idempotency", digest(idempotencyKey).slice(7));
    const cachePath = cacheBase + ".json";
    const bindingPath = cacheBase + ".binding.json";
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf8")) as EvidenceBundle;
      try {
        const binding = JSON.parse(await readFile(bindingPath, "utf8")) as { schema?:string; requestDigest?:string };
        if (binding.schema === "flop.idempotency-binding/v1" && binding.requestDigest !== requestDigest) {
          throw new Error("IDEMPOTENCY_KEY_REUSE_CONFLICT");
        }
      } catch (error) {
        if (error instanceof Error && error.message === "IDEMPOTENCY_KEY_REUSE_CONFLICT") throw error;
        if (cached.receipt?.workId !== request.id) throw new Error("IDEMPOTENCY_KEY_REUSE_CONFLICT");
      }
      return cached;
    } catch (error) {
      if (error instanceof Error && error.message === "IDEMPOTENCY_KEY_REUSE_CONFLICT") throw error;
    }

    const existing=FlopAgent.incomingInflight.get(cacheBase);
    if(existing){
      if(existing.requestDigest!==requestDigest) throw new Error("IDEMPOTENCY_KEY_REUSE_CONFLICT");
      return existing.promise;
    }

    const promise=this.executeIncomingFresh(request,cachePath,bindingPath,requestDigest);
    FlopAgent.incomingInflight.set(cacheBase,{requestDigest,promise});
    try {
      return await promise;
    } finally {
      if(FlopAgent.incomingInflight.get(cacheBase)?.promise===promise) FlopAgent.incomingInflight.delete(cacheBase);
    }
  }

  private async executeIncomingFresh(
    request:WorkRequest,
    cachePath:string,
    bindingPath:string,
    requestDigest:string,
  ):Promise<EvidenceBundle>{
    const self = advertise(this.config);
    const { decision } = await routeWithSessionRouter(request, [{
      agentId: self.agentId,
      capabilities: self.capabilities,
      runtimeKind: self.runtimeKind,
      endpoint: self.endpoint,
      observedAt: self.observedAt,
    }], this.config.stateDir);
    const result = await executeWork(this.config, request);
    const receipt = buildReceipt(request, decision, result);
    const selfChecked = buildEvidence(receipt);
    const bundle = { ...selfChecked, independentVerification: verifyExternalProfile("flop-agent", selfChecked) };
    await publishArtifacts(this.config.stateDir, receipt, bundle);
    await saveJson(bindingPath, { schema:"flop.idempotency-binding/v1", requestDigest });
    await saveJson(cachePath, bundle);
    return bundle;
  }
}
