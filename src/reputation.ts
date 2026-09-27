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
const median=(xs:number[])=>xs.length?[...xs].sort((a,b)=>a-b)[Math.floor((xs.length-1)/2)]!:null;

function works(records:OperationalRecord[]):OperationalRecord[][]{
  const groups=new Map<string,OperationalRecord[]>();
  for(const record of records){
    const list=groups.get(record.workId)??[];
    list.push(record);
    groups.set(record.workId,list);
  }
  return [...groups.values()].map(list=>list.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)));
}

export function buildReputation(subject:string, records:OperationalRecord[]): CounterpartyReputation {
  const xs=records.filter(x=>x.counterparty===subject);
  const jobs=works(xs);
  let accepted=0,completed=0,validated=0,failed=0;
  const capabilities:CounterpartyReputation["capabilities"]={};
  const latencies:number[]=[];

  for(const job of jobs){
    if(job.some(x=>x.outcome==="ACCEPTED")) accepted++;
    const terminal=[...job].reverse().find(x=>["VALIDATED","COMPLETED","FAILED","EXPIRED","REJECTED"].includes(x.outcome));
    if(terminal?.outcome==="VALIDATED"){completed++;validated++;}
    else if(terminal?.outcome==="COMPLETED")completed++;
    else if(terminal?.outcome==="FAILED"||terminal?.outcome==="EXPIRED")failed++;

    const last=job.at(-1)!;
    const c=capabilities[last.capability]??={observations:0,validated:0,failed:0};
    c.observations++;
    if(terminal?.outcome==="VALIDATED") c.validated++;
    if(terminal?.outcome==="FAILED"||terminal?.outcome==="EXPIRED") c.failed++;

    const latency=[...job].reverse().find(x=>typeof x.latencyMs==="number")?.latencyMs;
    if(typeof latency==="number") latencies.push(latency);
  }

  const terminal=Math.max(1,completed+failed);
  const successRate=completed/terminal;
  const validationRate=validated/Math.max(1,completed);
  const confidence=1-Math.exp(-jobs.length/8);
  const score=Math.max(0,Math.min(1,(0.55*successRate+0.30*validationRate+0.15*(1-failed/Math.max(1,jobs.length)))*confidence + 0.5*(1-confidence)));
  const body={
    schema:"flop.counterparty-reputation/v1" as const,
    subject, observations:jobs.length, accepted, completed, validated, failed,
    successRate, validationRate, medianLatencyMs:median(latencies),
    capabilities, lastObservedAt:xs.map(x=>x.at).sort().at(-1)??null,
    evidenceRefs:[...new Set(xs.flatMap(x=>x.evidenceRef?[x.evidenceRef]:[]))].sort(),
    confidence, score,
  };
  return {...body,digest:hash(body)};
}

export function reputationWeight(rep:CounterpartyReputation|undefined): number {
  return rep ? 0.5 + rep.score : 1;
}
