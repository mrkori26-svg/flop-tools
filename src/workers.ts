import { createHash } from "node:crypto";
import { createReceipt, RECEIPT_VERSION } from "@flop-tools/work-execution-receipt";
import { verifyExternalProfile } from "@flop-tools/conformance-lab";
import { runNoValueSettlementEvidence, verifyTestnetSettlement, type TestnetRailObservation } from "@flop-tools/economic-runtime";
import { observeEvmTestnetSettlement } from "./evm-observer.js";
import type { WorkerKind } from "./capabilities.js";

const digest=(value:unknown)=>"sha256:"+createHash("sha256").update(typeof value==="string"?value:JSON.stringify(value)).digest("hex");
const safeText=(v:unknown)=>typeof v==="string"?v.trim():"";

export type WorkerExecution = {
  schema:"flop.worker-execution/v1";
  worker:WorkerKind;
  status:"COMPLETED"|"FAILED";
  startedAt:string;
  finishedAt:string;
  output?:unknown;
  outputDigest?:string;
  evidenceRefs:string[];
  metadata:Record<string,string|number|boolean|null>;
  error?:string;
};

async function inference(prompt:string):Promise<{text:string;model:string;provider:string}>{
  const key=process.env.GEMINI_API_KEY;
  if(key){
    const model=process.env.GEMINI_MODEL||"gemini-3.8-flash";
    for(let attempt=0;attempt<4;attempt++){
      try{
        const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
          method:"POST",headers:{"content-type":"application/json","x-goog-api-key":key},
          body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.1,maxOutputTokens:1200}}),
          signal:AbortSignal.timeout(90000)
        });
        if(res.ok){
          const j:any=await res.json();
          const text=(j.candidates?.[0]?.content?.parts??[]).map((p:any)=>p.text||"").join("\n").trim();
          if(text) return {text,model,provider:"gemini"};
        }
        if(![429,500,502,503,504].includes(res.status)) break;
      }catch{}
      await new Promise(r=>setTimeout(r,[1000,2500,5000,8000][attempt]));
    }
  }
  const model=process.env.OLLAMA_MODEL||"gemma4:12b";
  const res=await fetch("http://127.0.0.1:11434/api/generate",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({model,prompt,stream:false,options:{temperature:0.1,num_predict:1200},keep_alive:"10m"}),
    signal:AbortSignal.timeout(120000)
  });
  if(!res.ok) throw new Error(`OLLAMA_HTTP_${res.status}`);
  const j:any=await res.json(); const text=safeText(j.response);
  if(!text) throw new Error("EMPTY_INFERENCE");
  return {text,model,provider:"ollama"};
}

export async function executeWorker(worker:WorkerKind,input:any):Promise<WorkerExecution>{
  const startedAt=new Date().toISOString();
  try{
    let output:unknown; const evidenceRefs:string[]=[]; const metadata:Record<string,string|number|boolean|null>={};
    if(worker==="inference"){
      const r=await inference(safeText(input?.prompt) || JSON.stringify(input));
      output={text:r.text}; metadata.model=r.model; metadata.provider=r.provider;
    }else if(worker==="conformance"){
      const profile=safeText(input?.profile)||"flop-agent";
      const result=verifyExternalProfile(profile,input?.artifact??input?.value??input);
      output=result; metadata.profile=profile; evidenceRefs.push(`conformance:${digest(result)}`);
    }else if(worker==="execution-proof"){
      const workId=safeText(input?.workId)||`work-${Date.now()}`;
      const result=input?.result??input?.output??input;
      const resultDigest=digest(result);
      const receipt=createReceipt({
        receipt_version:RECEIPT_VERSION,
        work_id:workId,
        participants:[{identifier:safeText(input?.executor)||"local-worker",identifier_type:"agent-id",role:"runtime-executor"}],
        execution_evidence:[{evidence_type:"runtime-output",artifact_digest:resultDigest,verification_state:"UNVERIFIED",event_time:new Date().toISOString(),source_ref:`economic-work:${workId}`}],
        coverage:{state:"PARTIAL",gaps:["acceptance and payment are independent evidence"]},
        event_time:new Date().toISOString(),observation_time:new Date().toISOString(),assurance_class:"CROSS_REFERENCED",
        evidence_refs:[`output:${resultDigest}`],
      });
      output={receipt,resultDigest}; evidenceRefs.push(`receipt:${digest(receipt)}`);
    }else if(worker==="settlement"){
      if(input?.mode==="evm-testnet-observe"){
        const observations=await observeEvmTestnetSettlement(input.request);
        const verification=verifyTestnetSettlement(observations,input.expected);
        output={observations,verification};
      }else if(input?.mode==="testnet-verify"){
        const observations=(input.observations??[]) as TestnetRailObservation[];
        output=verifyTestnetSettlement(observations,input.expected);
      }else{
        output=await runNoValueSettlementEvidence();
      }
      evidenceRefs.push(`settlement:${digest(output)}`);
    }else if(worker==="proposal-transport"){
      const envelope={schema:"flop.proposal-transport/v1",target:safeText(input?.target)||"unknown",proposal:input?.proposal??input?.body??input,createdAt:new Date().toISOString()};
      output={...envelope,digest:digest(envelope)}; evidenceRefs.push(`proposal:${digest(envelope)}`);
    }else if(worker==="research-protocol"){
      const url=safeText(input?.url); let sourceText=safeText(input?.text);
      if(url){
        const u=new URL(url); if(u.protocol!=="https:") throw new Error("UNSAFE_RESEARCH_URL");
        const res=await fetch(u,{signal:AbortSignal.timeout(20000)}); if(!res.ok) throw new Error(`RESEARCH_HTTP_${res.status}`);
        const bytes=Buffer.from(await res.arrayBuffer()); if(bytes.length>1024*1024) throw new Error("RESEARCH_SOURCE_TOO_LARGE");
        sourceText=bytes.toString("utf8");
      }
      const r=await inference(`Analyze this protocol/task source and return a concise, factual technical answer with concrete evidence and no invented claims:\n\n${sourceText.slice(0,30000)}`);
      output={analysis:r.text,sourceDigest:digest(sourceText)}; metadata.model=r.model; metadata.provider=r.provider; evidenceRefs.push(`source:${digest(sourceText)}`);
    }else throw new Error("UNKNOWN_WORKER");
    const finishedAt=new Date().toISOString(); const outputDigest=digest(output);
    return {schema:"flop.worker-execution/v1",worker,status:"COMPLETED",startedAt,finishedAt,output,outputDigest,evidenceRefs,metadata};
  }catch(error){
    return {schema:"flop.worker-execution/v1",worker,status:"FAILED",startedAt,finishedAt:new Date().toISOString(),evidenceRefs:[],metadata:{},error:error instanceof Error?error.message:String(error)};
  }
}
