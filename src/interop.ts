import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EvidenceBundle, WorkReceipt } from "./types.js";
import { saveJson } from "./core.js";

export interface ObservationRecord {
  schema: "flop.observation-record/v1";
  source: "flop-agent";
  subject: string;
  status: "PASS" | "FAIL";
  observedAt: string;
  evidenceRef: string;
  dimensions: {
    route: boolean;
    execution: boolean;
    receipt: boolean;
    verification: boolean;
  };
}

export async function publishArtifacts(stateDir: string, receipt: WorkReceipt, bundle: EvidenceBundle): Promise<{receiptPath:string; bundlePath:string; observationPath:string}> {
  const receiptPath = join(stateDir, "receipts", `${receipt.receiptId}.json`);
  const bundlePath = join(stateDir, "evidence", `${bundle.bundleId}.json`);
  const observationPath = join(stateDir, "observations", "index.ndjson");
  await saveJson(receiptPath, receipt);
  await saveJson(bundlePath, bundle);
  await mkdir(dirname(observationPath), { recursive: true });
  const observation: ObservationRecord = {
    schema: "flop.observation-record/v1",
    source: "flop-agent",
    subject: receipt.workId,
    status: bundle.independentVerification?.result === "FAIL"
      ? "FAIL"
      : bundle.independentVerification?.result === "PASS"
        ? "PASS"
        : bundle.verification.status,
    observedAt: bundle.createdAt,
    evidenceRef: bundlePath,
    dimensions: {
      route: !!receipt.route.selectedAgentId,
      execution: receipt.result.status === "completed",
      receipt: !!receipt.receiptId,
      verification: bundle.independentVerification?.result === "PASS",
    },
  };
  await appendFile(observationPath, JSON.stringify(observation) + "\n", "utf8");
  await saveJson(join(stateDir, "latest.json"), { receipt, evidence: bundle, observation });
  return { receiptPath, bundlePath, observationPath };
}
