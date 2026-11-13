import type { Candidate } from "./types.js";

export type WorkerKind = "inference"|"conformance"|"execution-proof"|"settlement"|"proposal-transport"|"research-protocol";
export type WorkerCapability = {
  worker:WorkerKind;
  capabilities:string[];
  assurance:"SOFT"|"EVIDENCE"|"VERIFIED";
  economic:boolean;
};

export const INTERNAL_WORKERS:WorkerCapability[]=[
  {worker:"inference",capabilities:["inference","useful-inference","llm"],assurance:"EVIDENCE",economic:true},
  {worker:"conformance",capabilities:["conformance","verification","protocol-reproduction","ci-evidence"],assurance:"VERIFIED",economic:true},
  {worker:"execution-proof",capabilities:["proof-of-execution","execution-receipt","evidence-bundle","receipt-verification"],assurance:"VERIFIED",economic:true},
  {worker:"settlement",capabilities:["settlement","testnet-settlement","rail-verification"],assurance:"VERIFIED",economic:true},
  {worker:"proposal-transport",capabilities:["proposal-transport","delivery-proof","readback"],assurance:"EVIDENCE",economic:true},
  {worker:"research-protocol",capabilities:["research","protocol-analysis","spec-analysis"],assurance:"EVIDENCE",economic:true},
];

export function capabilityRegistry(external:Candidate[]=[]){
  return {
    schema:"flop.capability-registry/v1" as const,
    observedAt:new Date().toISOString(),
    internal:INTERNAL_WORKERS,
    external:external.map(x=>({agentId:x.agentId,capabilities:x.capabilities,endpoint:x.endpoint,observedAt:x.observedAt})),
  };
}
