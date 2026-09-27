import { verifyRoomMessage } from "./technocore.js";

type RoomMessage={seq?:number;from?:string;text?:string;nonce?:string|number;sig?:string;ts?:string};

export type ObservedCapability = {
  schema:"flop.observed-capability/v1";
  agentId:string;
  capabilities:string[];
  assurance:"SIGNED_SELF_DECLARED";
  observedAt:string;
  evidenceRef:string;
  sourceRoom:string;
  textDigest?:string;
};

const rules:[RegExp,string][]=[
  [/on[- ]chain settlement|settlement layer|settlement/i,"settlement"],
  [/useful inference|inference routing|compute market|verifiable compute/i,"inference"],
  [/proof[- ]of[- ]execution|execution proof/i,"proof-of-execution"],
  [/decentralized identity|did:key|identity/i,"identity"],
  [/shared agent memory|shared memory|agent memory/i,"shared-memory"],
  [/capability discovery/i,"capability-discovery"],
  [/conformance|compatibility|fixture|reproduc/i,"conformance"],
  [/receipt|evidence bundle/i,"execution-receipt"],
  [/proposal transport|delivery readback|readback/i,"proposal-transport"],
  [/research agent|protocol analysis/i,"research"],
];

function capabilities(text:string):string[]{
  const out=new Set<string>();
  for(const [re,cap] of rules) if(re.test(text)) out.add(cap);
  return [...out].sort();
}

function safeBase(baseUrl:string):string{
  const u=new URL(baseUrl);
  if(u.protocol!=="https:" && !(u.protocol==="http:"&&["127.0.0.1","localhost","::1"].includes(u.hostname))) throw new Error("UNSAFE_TECHNOCORE_BASE_URL");
  u.pathname="/";u.search="";u.hash="";
  return u.toString().replace(/\/$/,"");
}

export async function discoverObservedCapabilities(
  room="blockrewards",
  baseUrl="https://technocore.chat",
  limit=200,
):Promise<{schema:"flop.observed-capability-registry/v1";observedAt:string;room:string;agents:ObservedCapability[]}>{
  if(!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(room)) throw new Error("TECHNOCORE_ROOM_INVALID");
  const res=await fetch(`${safeBase(baseUrl)}/r/${room}?format=json&limit=${Math.max(1,Math.min(200,limit))}`,{signal:AbortSignal.timeout(15000)});
  if(!res.ok) throw new Error(`TECHNOCORE_HTTP_${res.status}`);
  const raw=Buffer.from(await res.arrayBuffer()); if(raw.length>5*1024*1024) throw new Error("TECHNOCORE_RESPONSE_TOO_LARGE");
  const body=JSON.parse(raw.toString("utf8")) as {messages?:RoomMessage[]};
  const latest=new Map<string,ObservedCapability>();
  for(const m of body.messages??[]){
    if(!m.from||!m.text||!verifyRoomMessage(room,m)) continue;
    const caps=capabilities(m.text); if(!caps.length) continue;
    const item:ObservedCapability={
      schema:"flop.observed-capability/v1",agentId:m.from,capabilities:caps,assurance:"SIGNED_SELF_DECLARED",
      observedAt:typeof m.ts==="string"?m.ts:new Date(0).toISOString(),evidenceRef:`technocore:${room}:${m.seq??"unknown"}`,sourceRoom:room
    };
    const prior=latest.get(m.from);
    if(!prior||Date.parse(item.observedAt)>=Date.parse(prior.observedAt)) latest.set(m.from,item);
  }
  return {schema:"flop.observed-capability-registry/v1",observedAt:new Date().toISOString(),room,agents:[...latest.values()].sort((a,b)=>a.agentId.localeCompare(b.agentId))};
}
