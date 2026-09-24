import type { WorkExecutionReceipt as PortableWorkExecutionReceipt } from "@flop-tools/work-execution-receipt";

export type RuntimeKind = "shell" | "http";

export interface AgentConfig {
  id: string;
  name: string;
  capabilities: string[];
  registryPath: string;
  stateDir: string;
  advertiseEndpoint?: string;
  runtime: {
    kind: RuntimeKind;
    command?: string;
    args?: string[];
    url?: string;
    timeoutMs: number;
    maxAttempts: number;
  };
}

export interface AgentAdvertisement {
  schema: "flop.agent-advertisement/v1";
  agentId: string;
  capabilities: string[];
  runtimeKind: RuntimeKind;
  endpoint?: string;
  observedAt: string;
}

export interface WorkRequest {
  id: string;
  capability: string;
  input: unknown;
  budget?: { amount: string; asset: string };
  idempotencyKey?: string;
}

export interface Candidate {
  agentId: string;
  capabilities: string[];
  runtimeKind: RuntimeKind;
  endpoint?: string;
  observedAt: string;
}

export interface RouteDecision {
  schema: "flop.agent-route/v1";
  requestId: string;
  selectedAgentId: string;
  candidates: string[];
  decidedAt: string;
  rationale: "capability_match_then_lexicographic" | "session_router";
  sessionRouter?: {
    decisionId: string;
    snapshotHash: string;
    configHash: string;
  };
}

export interface ExecutionResult {
  status: "completed" | "failed";
  output?: unknown;
  error?: string;
  startedAt: string;
  finishedAt: string;
  attempts: number;
}

export interface WorkReceipt {
  schema: "flop.work-execution-receipt/v1";
  receiptId: string;
  workId: string;
  executor: string;
  capability: string;
  route: RouteDecision;
  result: ExecutionResult;
  outputDigest?: string;
  observationTime: string;
}

export interface EvidenceBundle {
  schema: "flop.evidence-bundle/v1";
  bundleId: string;
  receipt: WorkReceipt;
  portableReceipt: PortableWorkExecutionReceipt;
  verification: {
    status: "PASS" | "FAIL";
    checks: Record<string, boolean>;
  };
  createdAt: string;
}
