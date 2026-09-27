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

export class OperationalMemory {
  constructor(readonly path:string) {}
  async append(record: OperationalRecord): Promise<void> {
    await mkdir(dirname(this.path),{recursive:true});
    const prior=await this.read();
    const duplicate=prior.some(x=>x.counterparty===record.counterparty&&x.workId===record.workId&&x.outcome===record.outcome&&(x.evidenceRef??"")===(record.evidenceRef??""));
    if(duplicate) return;
    await appendFile(this.path, JSON.stringify(record)+"\n","utf8");
  }
  async read(): Promise<OperationalRecord[]> {
    try {
      const text=await readFile(this.path,"utf8");
      return text.split(/\r?\n/).filter(Boolean).flatMap(line=>{
        try { const x=JSON.parse(line); return x?.schema==="flop.operational-memory/v1" ? [x as OperationalRecord] : []; } catch { return []; }
      });
    } catch { return []; }
  }
  async forCounterparty(counterparty:string): Promise<OperationalRecord[]> {
    return (await this.read()).filter(x=>x.counterparty===counterparty);
  }
  async summary(days=30) {
    const cutoff=Date.now()-days*86400000;
    const records=(await this.read()).filter(x=>Date.parse(x.at)>=cutoff);
    const byCounterparty:Record<string,{jobs:number;completed:number;validated:number;failed:number;capabilities:Record<string,number>}>= {};
    for(const x of records){
      const row=byCounterparty[x.counterparty]??={jobs:0,completed:0,validated:0,failed:0,capabilities:{}};
      row.jobs++; if(x.outcome==="COMPLETED") row.completed++; if(x.outcome==="VALIDATED") row.validated++; if(x.outcome==="FAILED"||x.outcome==="EXPIRED") row.failed++;
      row.capabilities[x.capability]=(row.capabilities[x.capability]??0)+1;
    }
    return {schema:"flop.operational-memory-summary/v1" as const,windowDays:days,observedAt:new Date().toISOString(),records:records.length,byCounterparty};
  }
  async longitudinal() {
    return {schema:"flop.operational-memory-longitudinal/v1" as const,observedAt:new Date().toISOString(),windows:{d7:await this.summary(7),d30:await this.summary(30),d90:await this.summary(90)}};
  }
}
