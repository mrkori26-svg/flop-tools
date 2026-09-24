import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  RouterRepository,
  SessionRouter,
  StaticCandidateProvider,
  type MinerCandidate,
  type RouteDecision as SessionRouteDecision,
} from "@flop-tools/session-router";
import type { Candidate, RouteDecision, WorkRequest } from "./types.js";

const asMiner = (candidate: Candidate, capability: string): MinerCandidate => ({
  id: candidate.agentId,
  identity: candidate.agentId.startsWith("did:") ? { did: candidate.agentId } : { account: candidate.agentId },
  enabled: true,
  endpoint: candidate.endpoint ? { url: candidate.endpoint, protocol: "flop-agent-http/v1" } : undefined,
  capabilities: [{
    modelId: capability,
    assurance: "SOFT",
    observedAt: candidate.observedAt,
    provenance: {
      source: "flop-agent-registry",
      verificationState: "OBSERVED",
      coverage: "PARTIAL",
      observedAt: candidate.observedAt,
    },
  }],
  telemetry: {
    availability: 1,
    successEwma: 0.5,
    observedAt: candidate.observedAt,
  },
});

export async function routeWithSessionRouter(
  request: WorkRequest,
  candidates: Candidate[],
  stateDir: string,
): Promise<{ decision: RouteDecision; sessionDecision: SessionRouteDecision }> {
  await mkdir(stateDir, { recursive: true });
  const repo = new RouterRepository(join(stateDir, "router.db"));
  try {
    const router = new SessionRouter(
      new StaticCandidateProvider(candidates.map(x => asMiner(x, request.capability))),
      repo,
    );
    const sessionDecision = await router.route({
      requestId: request.id,
      constraints: { modelId: request.capability, minimumAssurance: "SOFT" },
      preflight: false,
      maxAttempts: 3,
    });
    if (sessionDecision.status !== "SELECTED" || !sessionDecision.selectedMinerId) {
      throw new Error(sessionDecision.status === "NO_ELIGIBLE_MINER" ? "NO_ELIGIBLE_AGENT" : sessionDecision.status);
    }
    return {
      decision: {
        schema: "flop.agent-route/v1",
        requestId: request.id,
        selectedAgentId: sessionDecision.selectedMinerId,
        candidates: sessionDecision.ranking,
        decidedAt: sessionDecision.snapshot.capturedAt,
        rationale: "session_router",
        sessionRouter: {
          decisionId: sessionDecision.decisionId,
          snapshotHash: sessionDecision.snapshotHash,
          configHash: sessionDecision.configHash,
        },
      },
      sessionDecision,
    };
  } finally {
    repo.close();
  }
}
