import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { verifyExternalProfile } from "@flop-tools/conformance-lab";
import { advertise, buildEvidence, buildReceipt, digest, discover, saveJson } from "./core.js";
import { publishArtifacts } from "./interop.js";
import { routeWithSessionRouter } from "./router-adapter.js";
import { executeWork } from "./runtime.js";
import type { AgentAdvertisement, AgentConfig, EvidenceBundle, WorkRequest } from "./types.js";

async function upsertAdvertisement(path: string, item: AgentAdvertisement): Promise<void> {
  let items: AgentAdvertisement[] = [];
  try { items = JSON.parse(await readFile(path, "utf8")) as AgentAdvertisement[]; } catch {}
  const next = [...items.filter(x => x.agentId !== item.agentId), item].sort((a,b) => a.agentId.localeCompare(b.agentId));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2) + "\n", "utf8");
}

export class FlopAgent {
  constructor(readonly config: AgentConfig) {}

  async publish(): Promise<AgentAdvertisement> {
    const item = advertise(this.config);
    await upsertAdvertisement(this.config.registryPath, item);
    await saveJson(join(this.config.stateDir, "advertisement.json"), item);
    return item;
  }

  async run(request: WorkRequest): Promise<EvidenceBundle> {
    const candidates = await discover(this.config.registryPath);
    const { decision } = await routeWithSessionRouter(request, candidates, this.config.stateDir);
    if (decision.selectedAgentId !== this.config.id) {
      const selected = candidates.find(x => x.agentId === decision.selectedAgentId);
      if (!selected?.endpoint) throw new Error(`REMOTE_ENDPOINT_MISSING:${decision.selectedAgentId}`);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.config.runtime.timeoutMs);
      try {
        const response = await fetch(selected.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": request.idempotencyKey ?? request.id },
          body: JSON.stringify(request),
          signal: ctl.signal,
        });
        if (!response.ok) throw new Error(`REMOTE_AGENT_${response.status}`);
        const bundle = await response.json() as EvidenceBundle;
        await saveJson(join(this.config.stateDir, "delegated", `${request.id}.json`), { decision, bundle });
        return bundle;
      } finally { clearTimeout(timer); }
    }
    const result = await executeWork(this.config, request);
    const receipt = buildReceipt(request, decision, result);
    const bundle = buildEvidence(receipt);
    await publishArtifacts(this.config.stateDir, receipt, bundle);
    return bundle;
  }

  async executeIncoming(request: WorkRequest): Promise<EvidenceBundle> {
    const idempotencyKey = request.idempotencyKey ?? request.id;
    const cachePath = join(this.config.stateDir, "idempotency", `${digest(idempotencyKey).slice(7)}.json`);
    try {
      return JSON.parse(await readFile(cachePath, "utf8")) as EvidenceBundle;
    } catch {}
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
    const bundle = buildEvidence(receipt);
    await publishArtifacts(this.config.stateDir, receipt, bundle);
    await saveJson(cachePath, bundle);
    return bundle;
  }
}
