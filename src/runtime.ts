import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentConfig, ExecutionResult, WorkRequest } from "./types.js";

const execFileAsync = promisify(execFile);

class RuntimeHttpError extends Error {
  constructor(readonly status:number){ super(`HTTP_RUNTIME_${status}`); }
}

function retryableRuntimeError(error:unknown):boolean {
  if(error instanceof RuntimeHttpError){
    return error.status===408 || error.status===425 || error.status===429 || error.status>=500;
  }
  return true;
}

async function runShell(config: AgentConfig, request: WorkRequest): Promise<unknown> {
  if (!config.runtime.command) throw new Error("SHELL_COMMAND_MISSING");
  const args = [...(config.runtime.args ?? []), JSON.stringify(request.input)];
  const { stdout } = await execFileAsync(config.runtime.command, args, {
    timeout: config.runtime.timeoutMs,
    maxBuffer: 1024 * 1024,
  });
  const text = stdout.trim();
  try { return JSON.parse(text); } catch { return text; }
}

async function runHttp(config: AgentConfig, request: WorkRequest): Promise<unknown> {
  if (!config.runtime.url) throw new Error("HTTP_URL_MISSING");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), config.runtime.timeoutMs);
  try {
    const response = await fetch(config.runtime.url, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": request.idempotencyKey ?? request.id },
      body: JSON.stringify(request),
      signal: ctl.signal,
    });
    if (!response.ok) throw new RuntimeHttpError(response.status);
    const text = await response.text();
    try { return JSON.parse(text); } catch { return text; }
  } finally {
    clearTimeout(timer);
  }
}

export async function executeWork(config: AgentConfig, request: WorkRequest): Promise<ExecutionResult> {
  const startedAt = new Date().toISOString();
  let lastError = "EXECUTION_FAILED";
  const maxAttempts = Math.max(1, config.runtime.maxAttempts);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const output = config.runtime.kind === "http"
        ? await runHttp(config, request)
        : await runShell(config, request);
      return { status: "completed", output, startedAt, finishedAt: new Date().toISOString(), attempts: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      const retryable = config.runtime.kind !== "http" || retryableRuntimeError(error);
      if (!retryable || attempt === maxAttempts) {
        return { status: "failed", error: lastError, startedAt, finishedAt: new Date().toISOString(), attempts: attempt };
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(250 * attempt, 1000)));
    }
  }
  return { status: "failed", error: lastError, startedAt, finishedAt: new Date().toISOString(), attempts: maxAttempts };
}
