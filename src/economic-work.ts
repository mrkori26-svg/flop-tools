import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fetchMarketSnapshot, type MarketOffer, type MarketSnapshot } from "./market.js";
import { OperationalMemory, type OperationalRecord } from "./memory.js";
import { buildReputation, type CounterpartyReputation } from "./reputation.js";
import { executeWorker, type WorkerExecution } from "./workers.js";
import type { WorkerKind } from "./capabilities.js";
import { verifyTestnetSettlement, type TestnetRailObservation, type TestnetSettlementVerification } from "@flop-tools/economic-runtime";

const canonical=(v:unknown):string=>Array.isArray(v)?`[${v.map(canonical).join(",")}]`:(v&&typeof v==="object")?`{${Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`:JSON.stringify(v);
const digest=(v:unknown)=>"sha256:"+createHash("sha256").update(canonical(v)).digest("hex");

export type EconomicWorkConfig={
  stateDir:string;
  marketFeed?:string;
  minReward?:number;
  allowedAssets?:string[];
  allowUnfunded?:boolean;
  requireDeclaredFunding?:boolean;
};

export type WorkPlan={
  schema:"flop.economic-work-plan/v1";
  offer:MarketOffer;
  worker:WorkerKind;
  capability:string;
  funded:boolean;
  reward?:{amount:string;asset:string};
  counterpartyReputation?:CounterpartyReputation;
  priority:number;
  rationale:string[];
};

export type PaymentRequirement={
  schema:"flop.payment-requirement/v1";
  workId:string;
  payer?:string;
  payee?:string;
  amount:string;
  asset:string;
  settlementMode:"EXTERNAL_AUTHORIZED";
  evidenceRequired:true;
};

export type PreparedEconomicExecution={
  schema:"flop.prepared-economic-execution/v1";
  workId:string;
  offerId:string;
  worker:WorkerKind;
  execution:WorkerExecution;
  paymentRequirement?:PaymentRequirement;
  state:"WORK_COMPLETED_PAYMENT_PENDING"|"WORK_COMPLETED_NO_PAYMENT"|"WORK_FAILED";
  preparedAt:string;
  digest:string;
};

export type ExternalExecutionEvidence={
  schema:"flop.external-execution-evidence/v1";
  mode:"TESTNET";
  observations:TestnetRailObservation[];
  expected:{
    reservationId:string;
    asset:string;
    lockedAmount:string;
    settledAmount:string;
    minConfirmations:number;
    allowedNetworks?:string[];
  };
  observedAt:string;
};

export type EconomicWorkReceipt={
  schema:"flop.economic-work-receipt/v1";
  workId:string;
  preparedDigest:string;
  executionDigest:string;
  payment:{
    status:"NOT_REQUIRED"|"VERIFIED_TESTNET"|"UNVERIFIED";
    verification?:TestnetSettlementVerification;
  };
  completedAt:string;
  status:"COMPLETED"|"FAILED";
  digest:string;
};

const text=(o:MarketOffer)=>`${o.protocol} ${o.offerId} ${o.spec??""} ${o.context??""}`.toLowerCase();

export function unsupportedOfferReason(o:MarketOffer):string|undefined{
  const t=text(o);
  if(/\b(logo|thumbnail|banner|cover image|ui mockup|figma|png|jpeg|illustration|image asset|story frames|vertical reel|short video|video clip|voiceover|audio|podcast|3d model|cad)\b/.test(t)) return "unsupported_media_deliverable";
  if(/\b(tabular dataset|dataset)\b/.test(t) && !/analy[sz]e|review|audit|validate|schema|quality/.test(t)) return "unsupported_dataset_artifact";
  return undefined;
}

export function classifyOffer(o:MarketOffer):{worker:WorkerKind;capability:string;rationale:string[]}{
  const t=text(o); const rationale:string[]=[];
  if(/foldtranscript|fold this tclk|reference rules|conformance|reproduc|fixture|compat|protocol drift|verify protocol|public ci|ci test/.test(t)){rationale.push("conformance/protocol keywords");return{worker:"conformance",capability:"conformance",rationale};}
  if(/proof[- ]of[- ]execution|execution proof|evidence bundle|execution receipt/.test(t)){rationale.push("execution evidence keywords");return{worker:"execution-proof",capability:"proof-of-execution",rationale};}
  if(/proposal transport|delivery readback|deliver.*github|github.*deliver/.test(t)){rationale.push("proposal transport keywords");return{worker:"proposal-transport",capability:"proposal-transport",rationale};}
  if(/useful inference|inference routing|\bllm\b|model evaluation|compute market/.test(t)){rationale.push("inference keywords");return{worker:"inference",capability:"inference",rationale};}
  if(/on[- ]chain settlement|settlement verification|verify settlement|rail observation|settlement receipt|escrow verification/.test(t)){rationale.push("explicit settlement keywords");return{worker:"settlement",capability:"settlement",rationale};}
  rationale.push("default technical research");
  return{worker:"research-protocol",capability:"research",rationale};
}

export function rankPlans(
  offers:MarketOffer[],
  reputations:Map<string,CounterpartyReputation>,
  config:Pick<EconomicWorkConfig,"minReward"|"allowedAssets"|"allowUnfunded"|"requireDeclaredFunding">={}
):WorkPlan[]{
  const min=config.minReward??0; const assets=config.allowedAssets??[];
  const plans:WorkPlan[]=[];
  for(const offer of offers){
    if(unsupportedOfferReason(offer)) continue;
    if(!offer.funded && !config.allowUnfunded) continue;
    if(config.requireDeclaredFunding && offer.fundingStatus!=="DECLARED_FUNDED") continue;
    if(offer.reward){
      if(Number(offer.reward.amount)<min) continue;
      if(assets.length && !assets.includes(offer.reward.asset)) continue;
    }
    const c=classifyOffer(offer); const rep=offer.payer?reputations.get(offer.payer):undefined;
    let priority=(offer.funded?100:0)+(offer.reward?Math.min(50,Math.log10(1+Number(offer.reward.amount))*10):0)+(rep?rep.score*20:10);
    if(c.worker==="conformance"||c.worker==="execution-proof") priority+=12;
    plans.push({schema:"flop.economic-work-plan/v1",offer,worker:c.worker,capability:c.capability,funded:offer.funded,reward:offer.reward,counterpartyReputation:rep,priority,rationale:[...c.rationale,offer.funded?"funded":"unfunded",`funding=${offer.fundingStatus.toLowerCase()}`,rep?`reputation=${rep.score.toFixed(3)}`:"reputation=unknown"]});
  }
  return plans.sort((a,b)=>b.priority-a.priority||a.offer.offerId.localeCompare(b.offer.offerId));
}

export class EconomicWorkLayer{
  readonly memory:OperationalMemory;
  constructor(readonly config:EconomicWorkConfig){
    this.memory=new OperationalMemory(join(config.stateDir,"operational-memory.ndjson"));
  }
  async market():Promise<MarketSnapshot>{
    return fetchMarketSnapshot(this.config.marketFeed);
  }
  async reputations():Promise<Map<string,CounterpartyReputation>>{
    const records=await this.memory.read(); const ids=[...new Set(records.map(x=>x.counterparty))];
    const pairs=ids.map(id=>[id,buildReputation(id,records)] as const);
    const dir=join(this.config.stateDir,"reputation"); await mkdir(dir,{recursive:true});
    for(const [id,rep] of pairs){ await writeFile(join(dir,digest(id).slice(7,39)+".json"),JSON.stringify(rep,null,2)+"\n","utf8"); }
    return new Map(pairs);
  }
  async plans():Promise<WorkPlan[]>{
    const snap=await this.market();
    return rankPlans(snap.offers,await this.reputations(),this.config);
  }
  async executePlan(plan:WorkPlan,input?:unknown):Promise<PreparedEconomicExecution>{
    const workId=`market:${plan.offer.source}:${plan.offer.offerId}`;
    const started=Date.now(); const counterparty=plan.offer.payer??"unknown";
    await this.memory.append({schema:"flop.operational-memory/v1",at:new Date().toISOString(),counterparty,capability:plan.capability,workId,outcome:"SELECTED",reward:plan.reward});
    const workerInput=input??(plan.worker==="inference"?{prompt:plan.offer.spec??plan.offer.context??plan.offer.offerId}:{text:plan.offer.spec??plan.offer.context??JSON.stringify(plan.offer)});
    const execution=await executeWorker(plan.worker,workerInput as any);
    await this.memory.append({schema:"flop.operational-memory/v1",at:new Date().toISOString(),counterparty,capability:plan.capability,workId,outcome:execution.status==="COMPLETED"?"COMPLETED":"FAILED",latencyMs:Date.now()-started,evidenceRef:execution.outputDigest,reward:plan.reward,failureMode:execution.error});
    const paymentRequirement=plan.reward?{schema:"flop.payment-requirement/v1" as const,workId,payer:plan.offer.payer,amount:plan.reward.amount,asset:plan.reward.asset,settlementMode:"EXTERNAL_AUTHORIZED" as const,evidenceRequired:true as const}:undefined;
    const body={schema:"flop.prepared-economic-execution/v1" as const,workId,offerId:plan.offer.offerId,worker:plan.worker,execution,paymentRequirement,state:(execution.status==="FAILED"?"WORK_FAILED":paymentRequirement?"WORK_COMPLETED_PAYMENT_PENDING":"WORK_COMPLETED_NO_PAYMENT") as PreparedEconomicExecution["state"],preparedAt:new Date().toISOString()};
    const prepared={...body,digest:digest(body)};
    await mkdir(join(this.config.stateDir,"economic-work"),{recursive:true});
    await writeFile(join(this.config.stateDir,"economic-work",encodeURIComponent(plan.offer.offerId)+".prepared.json"),JSON.stringify(prepared,null,2)+"\n","utf8");
    return prepared;
  }
  async finalize(prepared:PreparedEconomicExecution,evidence?:ExternalExecutionEvidence):Promise<EconomicWorkReceipt>{
    let payment:EconomicWorkReceipt["payment"]={status:prepared.paymentRequirement?"UNVERIFIED":"NOT_REQUIRED"};
    if(prepared.paymentRequirement&&evidence){
      const bindingMatches =
        evidence.expected.asset===prepared.paymentRequirement.asset &&
        evidence.expected.lockedAmount===prepared.paymentRequirement.amount &&
        evidence.expected.settledAmount===prepared.paymentRequirement.amount;
      if(bindingMatches){
        const verification=verifyTestnetSettlement(evidence.observations,evidence.expected);
        payment={status:verification.status==="VERIFIED"?"VERIFIED_TESTNET":"UNVERIFIED",verification};
      }
    }
    const ok=prepared.execution.status==="COMPLETED"&&(!prepared.paymentRequirement||payment.status==="VERIFIED_TESTNET");
    const body={schema:"flop.economic-work-receipt/v1" as const,workId:prepared.workId,preparedDigest:prepared.digest,executionDigest:prepared.execution.outputDigest??digest(prepared.execution),payment,completedAt:new Date().toISOString(),status:(ok?"COMPLETED":"FAILED") as "COMPLETED"|"FAILED"};
    const receipt={...body,digest:digest(body)};
    const counterparty=prepared.paymentRequirement?.payer??"unknown";
    await this.memory.append({schema:"flop.operational-memory/v1",at:new Date().toISOString(),counterparty,capability:prepared.worker,workId:prepared.workId,outcome:ok?"VALIDATED":"FAILED",evidenceRef:receipt.digest,failureMode:ok?undefined:"settlement_or_execution_unverified"});
    await mkdir(join(this.config.stateDir,"economic-work"),{recursive:true});
    await writeFile(join(this.config.stateDir,"economic-work",encodeURIComponent(prepared.offerId)+".receipt.json"),JSON.stringify(receipt,null,2)+"\n","utf8");
    return receipt;
  }
}

export async function readPrepared(path:string):Promise<PreparedEconomicExecution>{
  return JSON.parse(await readFile(path,"utf8")) as PreparedEconomicExecution;
}
