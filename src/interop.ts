import { join } from "node:path";
import {
  appendObservations,
  detectGitRevision,
  makeObservation,
  type ObservationRecord,
} from "@flop-tools/conformance-lab";
import type { EvidenceBundle, RouteDecision, WorkReceipt, WorkRequest } from "./types.js";
import { saveJson } from "./core.js";

export async function publishArtifacts(
  stateDir: string,
  receipt: WorkReceipt,
  bundle: EvidenceBundle,
): Promise<{receiptPath:string; bundlePath:string; observationPath:string}> {
  const receiptPath = join(stateDir, "receipts", `${receipt.receiptId}.json`);
  const bundlePath = join(stateDir, "evidence", `${bundle.bundleId}.json`);
  const observationRoot = join(stateDir, "observations");
  const observationPath = join(observationRoot, "raw", "runtime.ndjson");
  await saveJson(receiptPath, receipt);
  await saveJson(bundlePath, bundle);

  const observerRevision = detectGitRevision();
  const dimensions = {
    kind: "agent-work",
    workId: receipt.workId,
    executor: receipt.executor,
    receiptId: receipt.receiptId,
    routeDecisionId: receipt.route.sessionRouter?.decisionId ?? "not-available",
  };
  const evidenceRefs = [
    bundle.bundleId,
    receipt.receiptId,
    bundle.portableReceipt.receipt_id,
  ].filter((value): value is string => typeof value === "string");

  const runtimeOk = receipt.result.status === "completed";
  const runtimeObservation = makeObservation({
    observedAt: bundle.createdAt,
    source: "runtime",
    metric: "runtime_availability",
    outcome: runtimeOk ? "PASS" : "FAIL",
    numerator: runtimeOk ? 1 : 0,
    denominator: 1,
    dimensions,
    failure: runtimeOk ? null : {
      scope: "TARGET_FAILURE",
      class: "TARGET_PROTOCOL_ERROR",
      detail: receipt.result.error ?? "work execution failed",
    },
    evidenceRefs,
    observerRevision,
    sourceRevision: null,
    targetFingerprint: receipt.route.sessionRouter?.snapshotHash ?? null,
  });

  const independent = bundle.independentVerification?.result;
  const conformanceObservation = makeObservation({
    observedAt: bundle.createdAt,
    source: "runtime",
    metric: "conformance_drift",
    outcome: independent === "PASS" ? "PASS" : independent === "FAIL" ? "FAIL" : "UNKNOWN",
    numerator: independent === "PASS" ? 1 : independent === "FAIL" ? 0 : 0,
    denominator: independent === undefined ? 0 : 1,
    dimensions: {
      ...dimensions,
      profile: bundle.independentVerification?.profile ?? "flop-agent",
      verification: independent ?? "UNKNOWN",
    },
    failure: independent === "FAIL"
      ? { scope:"TARGET_FAILURE", class:"CONFORMANCE_FAIL", detail:"independent FLOP Agent verification failed" }
      : independent === undefined
        ? { scope:"INDETERMINATE", class:"COVERAGE_LOST", detail:"independent verification unavailable" }
        : null,
    evidenceRefs,
    observerRevision,
    sourceRevision: bundle.independentVerification?.labVersion ?? null,
    targetFingerprint: receipt.route.sessionRouter?.snapshotHash ?? null,
  });

  const observations: ObservationRecord[] = [runtimeObservation, conformanceObservation];
  appendObservations(observationRoot, observations);
  await saveJson(join(stateDir, "latest.json"), {
    receipt,
    evidence: bundle,
    observations,
  });
  return { receiptPath, bundlePath, observationPath };
}

export async function publishDelegatedObservation(
  stateDir: string,
  request: WorkRequest,
  decision: RouteDecision,
  bundle: EvidenceBundle,
): Promise<string> {
  const observationRoot = join(stateDir, "observations");
  const observationPath = join(observationRoot, "raw", "runtime.ndjson");
  const remoteOk = bundle.receipt.result.status === "completed";
  const verification = bundle.delegatorVerification?.result;
  const evidenceRefs = [
    bundle.bundleId,
    bundle.receipt.receiptId,
    bundle.portableReceipt.receipt_id,
  ].filter((value): value is string => typeof value === "string");
  const dimensions = {
    kind: "agent-work",
    role: "delegator",
    workId: request.id,
    executor: bundle.receipt.executor,
    routeDecisionId: decision.sessionRouter?.decisionId ?? "not-available",
    remoteReceiptId: bundle.receipt.receiptId,
  };
  const runtimeObservation = makeObservation({
    observedAt: new Date().toISOString(),
    source: "runtime",
    metric: "runtime_availability",
    outcome: remoteOk ? "PASS" : "FAIL",
    numerator: remoteOk ? 1 : 0,
    denominator: 1,
    dimensions,
    failure: remoteOk ? null : {
      scope: "TARGET_FAILURE",
      class: "TARGET_PROTOCOL_ERROR",
      detail: bundle.receipt.result.error ?? "delegated work failed",
    },
    evidenceRefs,
    observerRevision: detectGitRevision(),
    sourceRevision: null,
    targetFingerprint: decision.sessionRouter?.snapshotHash ?? null,
  });
  const conformanceObservation = makeObservation({
    observedAt: runtimeObservation.observedAt,
    source: "runtime",
    metric: "conformance_drift",
    outcome: verification === "PASS" ? "PASS" : verification === "FAIL" ? "FAIL" : "UNKNOWN",
    numerator: verification === "PASS" ? 1 : 0,
    denominator: verification === undefined ? 0 : 1,
    dimensions: {
      ...dimensions,
      profile: bundle.delegatorVerification?.profile ?? "flop-agent",
      verification: verification ?? "UNKNOWN",
    },
    failure: verification === "FAIL"
      ? { scope:"TARGET_FAILURE", class:"CONFORMANCE_FAIL", detail:"delegator verification failed" }
      : verification === undefined
        ? { scope:"INDETERMINATE", class:"COVERAGE_LOST", detail:"delegator verification unavailable" }
        : null,
    evidenceRefs,
    observerRevision: detectGitRevision(),
    sourceRevision: bundle.delegatorVerification?.labVersion ?? null,
    targetFingerprint: decision.sessionRouter?.snapshotHash ?? null,
  });
  appendObservations(observationRoot, [runtimeObservation, conformanceObservation]);
  return observationPath;
}
