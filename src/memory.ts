import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export type WorkOutcome = "SELECTED"|"ACCEPTED"|"COMPLETED"|"VALIDATED"|"FAILED"|"EXPIRED"|"REJECTED";
export type OperationalRecord = {
  schema:"flop.operational-memory/v1";
  at:string;
  counterparty:string;
  capability:string;
  workId:string;
  outcome:WorkOutcome;
  latencyMs?:number;
  evidenceRef?:string;
  reward?:{amount:string;asset:string};
  failureMode?:string;
  metadata?:Record<string,string|number|boolean|null>;
};

const OUTCOMES=new Set<WorkOutcome>(["SELECTED","ACCEPTED","COMPLETED","VALIDATED","FAILED","EXPIRED","REJECTED"]);

function validateRecord(value:unknown,line:number):OperationalRecord{
  if(!value||typeof value!=="object"||Array.isArray(value)) throw new Error(`OPERATIONAL_MEMORY_CORRUPT_LINE_${line}`);
  const x=value as Record<string,unknown>;
  if(x.schema!=="flop.operational-memory/v1"
    || typeof x.at!=="string" || !Number.isFinite(Date.parse(x.at))
    || typeof x.counterparty!=="string" || !x.counterparty
    || typeof x.capability!=="string" || !x.capability
    || typeof x.workId!=="string" || !x.workId
    || typeof x.outcome!=="string" || !OUTCOMES.has(x.outcome as WorkOutcome)
    || (x.latencyMs!==undefined && (typeof x.latencyMs!=="number" || !Number.isFinite(x.latencyMs) || x.latencyMs<0))
  ) throw new Error(`OPERATIONAL_MEMORY_CORRUPT_LINE_${line}`);
  return value as OperationalRecord;
}

function groupWorks(records:OperationalRecord[]):OperationalRecord[][]{
  const groups=new Map<string,OperationalRecord[]>();
  for(const record of records){
    const key=`${record.counterparty}\u0000${record.workId}`;
    const list=groups.get(key)??[];
    list.push(record);
    groups.set(key,list);
  }
  return [...groups.values()].map(list=>list.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)));
}

export class OperationalMemory {
  constructor(readonly path:string) {}
  async append(record: OperationalRecord): Promise<void> {
    validateRecord(record,0);
    await mkdir(dirname(this.path),{recursive:true});
    const prior=await this.read();
    const duplicate=prior.some(x=>x.counterparty===record.counterparty&&x.workId===record.workId&&x.outcome===record.outcome&&(x.evidenceRef??"")===(record.evidenceRef??""));
    if(duplicate) return;
    await appendFile(this.path, JSON.stringify(record)+"\n","utf8");
  }
  async read(): Promise<OperationalRecord[]> {
    let text:string;
    try {
      text=await readFile(this.path,"utf8");
    } catch(error) {
      if((error as NodeJS.ErrnoException)?.code==="ENOENT") return [];
      throw error;
    }
    const result:OperationalRecord[]=[];
    for(const [index,line] of text.split(/\r?\n/).entries()){
      if(!line) continue;
      let value:unknown;
      try { value=JSON.parse(line); }
      catch { throw new Error(`OPERATIONAL_MEMORY_CORRUPT_LINE_${index+1}`); }
      result.push(validateRecord(value,index+1));
    }
    return result;
  }
  async forCounterparty(counterparty:string): Promise<OperationalRecord[]> {
    return (await this.read()).filter(x=>x.counterparty===counterparty);
  }
  async summary(days=30) {
    const cutoff=Date.now()-days*86400000;
    const records=(await this.read()).filter(x=>Date.parse(x.at)>=cutoff);
    const byCounterparty:Record<string,{jobs:number;completed:number;validated:number;failed:number;capabilities:Record<string,number>}>= {};
    for(const work of groupWorks(records)){
      const last=work.at(-1)!;
      const terminal=[...work].reverse().find(x=>["VALIDATED","COMPLETED","FAILED","EXPIRED","REJECTED"].includes(x.outcome));
      const row=byCounterparty[last.counterparty]??={jobs:0,completed:0,validated:0,failed:0,capabilities:{}};
      row.jobs++;
      if(terminal?.outcome==="VALIDATED"){row.completed++;row.validated++;}
      else if(terminal?.outcome==="COMPLETED")row.completed++;
      else if(terminal?.outcome==="FAILED"||terminal?.outcome==="EXPIRED")row.failed++;
      row.capabilities[last.capability]=(row.capabilities[last.capability]??0)+1;
    }
    return {schema:"flop.operational-memory-summary/v1" as const,windowDays:days,observedAt:new Date().toISOString(),records:records.length,byCounterparty};
  }
  async longitudinal() {
    return {schema:"flop.operational-memory-longitudinal/v1" as const,observedAt:new Date().toISOString(),windows:{d7:await this.summary(7),d30:await this.summary(30),d90:await this.summary(90)}};
  }
}
