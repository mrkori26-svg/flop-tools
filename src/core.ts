import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReceipt, RECEIPT_VERSION } from "@flop-tools/work-execution-receipt";
import { dirname } from "node:path";
import type { AgentAdvertisement, AgentConfig, Candidate, EvidenceBundle, ExecutionResult, RouteDecision, WorkReceipt, WorkRequest } from "./types.js";

export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

export const digest = (value: unknown): string =>
  "sha256:" + createHash("sha256").update(canonical(value)).digest("hex");

export async function loadConfig(path: string): Promise<AgentConfig> {
  return JSON.parse(await readFile(path, "utf8")) as AgentConfig;
}

export async function saveJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function advertise(config: AgentConfig): AgentAdvertisement {
  return {
    schema: "flop.agent-advertisement/v1",
    agentId: config.id,
    capabilities: [...config.capabilities].sort(),
    runtimeKind: config.runtime.kind,
    endpoint: config.advertiseEndpoint,
    observedAt: new Date().toISOString(),
  };
}

export async function discover(registryPath: string): Promise<Candidate[]> {
  try {
    const raw = JSON.parse(await readFile(registryPath, "utf8")) as AgentAdvertisement[];
    return raw.map(x => ({ agentId: x.agentId, capabilities: x.capabilities, runtimeKind: x.runtimeKind, endpoint: x.endpoint, observedAt: x.observedAt }));
  } catch {
    return [];
  }
}

export function route(request: WorkRequest, candidates: Candidate[]): RouteDecision {
  const eligible = candidates.filter(c => c.capabilities.includes(request.capability)).sort((a,b) => a.agentId.localeCompare(b.agentId));
  if (!eligible.length) throw new Error("NO_ELIGIBLE_AGENT");
  return {
    schema: "flop.agent-route/v1",
    requestId: request.id,
    selectedAgentId: eligible[0]!.agentId,
    candidates: eligible.map(x => x.agentId),
    decidedAt: new Date().toISOString(),
    rationale: "capability_match_then_lexicographic",
  };
}

export function buildReceipt(request: WorkRequest, decision: RouteDecision, result: ExecutionResult): WorkReceipt {
  const body = {
    schema: "flop.work-execution-receipt/v1" as const,
    workId: request.id,
    executor: decision.selectedAgentId,
    capability: request.capability,
    route: decision,
    result,
    outputDigest: result.output === undefined ? undefined : digest(result.output),
    observationTime: new Date().toISOString(),
  };
  return { ...body, receiptId: "receipt_" + digest(body).slice(7, 39) };
}

export function buildEvidence(receipt: WorkReceipt): EvidenceBundle {
  const portableReceipt = createReceipt({
    receipt_version: RECEIPT_VERSION,
    work_id: receipt.workId,
    deal_id: receipt.route.sessionRouter?.decisionId,
    participants: [{
      identifier: receipt.executor,
      identifier_type: receipt.executor.startsWith("did:") ? "did" : "agent-id",
      role: "runtime-executor",
    }],
    agreement_ref: receipt.route.sessionRouter ? `router:${receipt.route.sessionRouter.decisionId}` : undefined,
    agreement_digest: receipt.route.sessionRouter ? `sha256:${receipt.route.sessionRouter.snapshotHash.replace(/^sha256:/,"")}` : undefined,
    execution_evidence: receipt.outputDigest ? [{
      evidence_type: "runtime-output",
      artifact_digest: receipt.outputDigest,
      verification_state: receipt.result.status === "completed" ? "UNVERIFIED" : "INVALID",
      event_time: receipt.result.finishedAt,
      source_ref: `flop-agent:${receipt.receiptId}`,
    }] : [],
    coverage: {
      state: receipt.result.status === "completed" ? "PARTIAL" : "UNKNOWN",
      gaps: ["independent verification and settlement evidence are not inferred by RUN"],
    },
    event_time: receipt.result.finishedAt,
    observation_time: receipt.observationTime,
    assurance_class: "CROSS_REFERENCED",
    evidence_refs: [`flop-agent-receipt:${receipt.receiptId}`],
  });
  const checks = {
    route_selected_executor: receipt.route.selectedAgentId === receipt.executor,
    completed_has_output_digest: receipt.result.status !== "completed" || !!receipt.outputDigest,
    attempts_positive: receipt.result.attempts > 0,
    timestamps_present: !!receipt.result.startedAt && !!receipt.result.finishedAt,
  };
  const verification = { status: Object.values(checks).every(Boolean) ? "PASS" as const : "FAIL" as const, checks };
  const body = { schema: "flop.evidence-bundle/v1" as const, receipt, portableReceipt, verification, createdAt: new Date().toISOString() };
  return { ...body, bundleId: "bundle_" + digest(body).slice(7, 39) };
}

export const newWorkId = (): string => "work_" + randomUUID();
