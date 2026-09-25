import { FlopAgent } from "./agent.js";
import { technocoreSignerStatus } from "./technocore.js";
import type { AgentConfig } from "./types.js";

export interface AgentDoctorReport {
  schema: "flop-agent-doctor/v1";
  status: "PASS" | "FAIL";
  checks: Record<string, unknown>;
}

export async function diagnoseAgent(config: AgentConfig): Promise<AgentDoctorReport> {
  const agent = new FlopAgent(config);
  const checks: Record<string, unknown> = {
    config: "PASS",
    agentId: config.id,
    capabilities: config.capabilities,
    discovery: config.discovery?.kind ?? "local",
  };
  if (!config.capabilities.length) checks.config = "FAIL:NO_CAPABILITIES";
  if (config.discovery?.kind === "technocore") {
    checks.signer = await technocoreSignerStatus(config);
    try {
      checks.discoveryRead = { ok: true, candidates: (await agent.candidates()).length };
    } catch (error) {
      checks.discoveryRead = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  } else {
    checks.discoveryRead = { ok: true, candidates: (await agent.candidates()).length };
  }
  const failed = Object.values(checks).some(value =>
    typeof value === "string"
      ? value.startsWith("FAIL")
      : value && typeof value === "object" && "ok" in value &&
        (value as { ok?: boolean }).ok === false
  );
  return {
    schema: "flop-agent-doctor/v1",
    status: failed ? "FAIL" : "PASS",
    checks,
  };
}
