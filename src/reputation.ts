import { createHash } from "node:crypto";
import type { OperationalRecord } from "./memory.js";

export type CounterpartyReputation = {
  schema:"flop.counterparty-reputation/v1";
  subject:string;
  observations:number;
  accepted:number;
  completed:number;
  validated:number;
  failed:number;
  successRate:number;
  validationRate:number;
  medianLatencyMs:number|null;
  capabilities:Record<string,{observations:number;validated:number;failed:number}>;
  lastObservedAt:string|null;
  evidenceRefs:string[];
  confidence:number;
  score:number;
  digest:string;
};

const canonical=(v:unknown):string=>Array.isArray(v)?`[${v.map(canonical).join(",")}]`:(v&&typeof v==="object")?`{${Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`:JSON.stringify(v);
const hash=(v:unknown)=>"sha256:"+createHash("sha256").update(canonical(v)).digest("hex");
const median=(xs:number[])=>xs.length?xs.sort((a,b)=>a-b)[Math.floor((xs.length-1)/2)]!:null;

export function buildReputation(subject:string, records:OperationalRecord[]): CounterpartyReputation {
  const xs=records.filter(x=>x.counterparty===subject);
  const accepted=xs.filter(x=>x.outcome==="ACCEPTED").length;
  const completed=xs.filter(x=>x.outcome==="COMPLETED"||x.outcome==="VALIDATED").length;
  const validated=xs.filter(x=>x.outcome==="VALIDATED").length;
  const failed=xs.filter(x=>x.outcome==="FAILED"||x.outcome==="EXPIRED").length;
  const terminal=Math.max(1,validated+completed+failed);
  const successRate=(validated+completed)/terminal;
  const validationRate=validated/Math.max(1,validated+completed);
  const confidence=1-Math.exp(-xs.length/8);
  const score=Math.max(0,Math.min(1,(0.55*successRate+0.30*validationRate+0.15*(1-failed/Math.max(1,xs.length)))*confidence + 0.5*(1-confidence)));
  const capabilities:CounterpartyReputation["capabilities"]={};
  for (const x of xs) {
    const c=capabilities[x.capability]??={observations:0,validated:0,failed:0};
    c.observations++; if(x.outcome==="VALIDATED") c.validated++; if(x.outcome==="FAILED"||x.outcome==="EXPIRED") c.failed++;
  }
  const body={
    schema:"flop.counterparty-reputation/v1" as const,
    subject, observations:xs.length, accepted, completed, validated, failed,
    successRate, validationRate, medianLatencyMs:median(xs.flatMap(x=>typeof x.latencyMs==="number"?[x.latencyMs]:[])),
    capabilities, lastObservedAt:xs.map(x=>x.at).sort().at(-1)??null,
    evidenceRefs:[...new Set(xs.flatMap(x=>x.evidenceRef?[x.evidenceRef]:[]))].sort(),
    confidence, score,
  };
  return {...body,digest:hash(body)};
}

export function reputationWeight(rep:CounterpartyReputation|undefined): number {
  return rep ? 0.5 + rep.score : 1;
}
