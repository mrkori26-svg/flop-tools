import { createHash } from 'node:crypto';
export const GENESIS = '0x918abd58fb16306b30ef3886514cfaebffecb4de43e82b6f8ec4795c43cfd800';
const obj = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
const hash = x => typeof x === 'string' && /^0x[0-9a-f]{64}$/.test(x);
const uint = x => Number.isSafeInteger(x) && x >= 0;
const text = x => typeof x === 'string' && x.length > 0 && x.length <= 256;
const ident = x => typeof x === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(x);
const units = x => typeof x === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(x);
const exact = (x, keys) => Object.keys(obj(x)).sort().join('|') === [...keys].sort().join('|');
export function canonical(x) {
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k)+':'+canonical(x[k])).join(',') + '}';
  if (x === null || typeof x === 'string' || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x))) return JSON.stringify(x);
  throw new Error('non-canonical JSON value');
}
export const digest = x => createHash('sha256').update(canonical(x)).digest('hex');
export const bytesDigest = hex => {
  if (typeof hex !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error('invalid hex');
  return createHash('sha256').update(Buffer.from(hex.slice(2),'hex')).digest('hex');
};
const sha = x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const fresh = (t, now, ttl=360000) => uint(t) && uint(now) && now >= t && now-t <= ttl;
const date = x => typeof x === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(x) ? Date.parse(x) : NaN;
export function observation(source, observedAt, status, data=null) {
  return {source,observedAt,status,data,sha256:digest({source,observedAt,status,data})};
}
export const SOURCES = Object.freeze({
  chain:'https://faucet.flop.network/chain',
  limits:'https://faucet.flop.network/limits',
  health:'https://faucet.flop.network/health',
  gateway:'https://api.flop.network/health',
  rpc:'https://testnet.flop.network/',
  sdk:'https://registry.npmjs.org/@flop-labs%2fsdk/latest',
  phase:'https://ask.flop.finance/networks/testnet'
});
function observed(o,source,now,ttl) {
  if (!exact(o,['source','observedAt','status','data','sha256']) || o.source!==source || !fresh(o.observedAt,now,ttl) || o.status!==200) return null;
  try { const {sha256,...body}=o; return sha256===digest(body) && o.data && typeof o.data==='object' ? o.data : null; } catch { return null; }
}
function chainAnchor(c) {
  return c?.genesis===GENESIS && hash(c.blockHash) && uint(c.height) && c.finalized===true;
}
export function faucetState(input, now, ttl=360000) {
  const c=observed(input?.chain,SOURCES.chain,now,ttl), l=observed(input?.limits,SOURCES.limits,now,ttl), h=observed(input?.health,SOURCES.health,now,ttl);
  const rpc=observed(input?.rpc,SOURCES.rpc,now,ttl);
  const f=obj(l?.faucet), daily=obj(f.dailyCap), agent=obj(f.agent);
  let policy='NOT_OBSERVED', operation='NOT_OBSERVED', state='UNVERIFIED';
  const binding=h?.dependencies?.indexer?.details?.binding?.genesis;
  const networkBound=rpc?.genesis===GENESIS && c?.network==='testnet' && c?.genesisHash===GENESIS;
  const conflict=(rpc && rpc.genesis!==GENESIS)||(c && (c.network!=='testnet'||c.genesisHash!==GENESIS))||(l && l.network!=='testnet')||(binding!=null&&binding!==GENESIS);
  if (l) {
    if(l.network!=='testnet') policy='WRONG_NETWORK';
    else if(l.stale!==false||!fresh(date(l.asOf),now,ttl)) policy='STALE';
    else if(f.status==='daily_cap_reached') policy='DAILY_CAP_REACHED';
    else if(['open','closed','paused','disabled','exhausted'].includes(f.status)) policy=f.status.toUpperCase();
    else policy='UNKNOWN';
  }
  if(h) {
    if(binding!==GENESIS) operation=binding?'WRONG_NETWORK':'UNVERIFIED';
    else operation=h.status==='ok'&&h.ready===true&&h.live===true&&h.connected===true&&h.dependencies?.funding?.ok===true&&h.dependencies?.indexer?.ok===true&&h.signing?.held===false?'READY':'DEGRADED';
  }
  const consistent=units(daily.limitFlop)&&units(daily.usedFlop)&&units(daily.remainingFlop)&&BigInt(daily.usedFlop)+BigInt(daily.remainingFlop)===BigInt(daily.limitFlop);
  if(conflict) state='WRONG_NETWORK';
  else if(!networkBound) state='NETWORK_UNVERIFIED';
  else if(policy==='STALE') state='STALE';
  else if(policy==='DAILY_CAP_REACHED') state=consistent&&daily.remainingFlop==='0'?'DAILY_CAP_REACHED':'POLICY_CONFLICT';
  else if(['CLOSED','PAUSED','DISABLED','EXHAUSTED'].includes(policy)) state='NOT_OPEN';
  else if(policy!=='OPEN') state='UNVERIFIED';
  else if(!consistent||daily.remainingFlop==='0') state='POLICY_CONFLICT';
  else if(operation!=='READY') state='NOT_READY';
  else if(agent.claimPath!=='/v1/testnet/agent-claims'||agent.grantFlop!==10||agent.rolling24HourCapFlop!==10||agent.cooldownSeconds!==86400||typeof agent.rolloverRequiresSpend!=='boolean') state='CONTRACT_REVIEW_REQUIRED';
  else state='OPEN_OBSERVED';
  return {state,policy,operation,networkBound:!!networkBound,remainingFlop:consistent?daily.remainingFlop:null,requestAuthorized:false,walletEligibility:'UNVERIFIED'};
}
export function gatewayState(o,now,ttl=360000) {
  const h=observed(o,SOURCES.gateway,now,ttl);
  if(!h) return 'NOT_OBSERVED';
  if(h.network?.network!=='testnet'||h.network?.observed_genesis_hash!==GENESIS||h.network?.expected_genesis_hash!==GENESIS) return 'WRONG_NETWORK';
  return h.status==='ok'&&h.connected===true&&h.syncing===false&&h.dependencies?.settlement?.ok===true?'HEALTH_OBSERVED':'NOT_READY';
}
export function readiness(input,now,ttl=360000) {
  const r=observed(input?.rpc,SOURCES.rpc,now,ttl);
  const registry=observed(input?.sdk,SOURCES.sdk,now,ttl);
  const f=faucetState(input,now,ttl), gateway=gatewayState(input?.gateway,now,ttl);
  const support=obj(input?.sdkSupport), account=obj(input?.account);
  const chain=!!(r?.genesis===GENESIS&&r?.specName==='flop-testnet'&&uint(r.specVersion)&&hash(r.finalizedHash)&&uint(r.height)&&sha(r.metadataSha256));
  const sdk=chain&&typeof registry?.version==='string'&&registry.version===support.version&&Array.isArray(support.specVersions)&&support.specVersions.includes(r.specVersion)&&support.metadataSha256===r.metadataSha256?'SUPPLIED_VERSION_RANGE_MATCH':'UNVERIFIED';
  const accountBound=chain&&account.genesis===GENESIS&&account.blockHash===r.finalizedHash&&account.height===r.height&&account.finalized===true;
  let registration='UNVERIFIED';
  if(accountBound&&account.registered===true) registration='SUPPLIED_REGISTERED';
  else if(accountBound&&account.registered===false&&units(account.free)&&units(account.minimumStake)&&units(account.estimatedFee)) registration=BigInt(account.free)>=BigInt(account.minimumStake)+BigInt(account.estimatedFee)?'SUPPLIED_FUNDS_SUFFICIENT':'SUPPLIED_FUNDS_INSUFFICIENT';
  const findings={chain:chain?'OBSERVED':'UNVERIFIED',runtime:chain?r.specVersion:null,sdk,faucet:f.state,gateway,registration,settlement:'UNVERIFIED'};
  const evidence=Object.fromEntries(['rpc','chain','limits','health','gateway','sdk','sdkSupport','account'].map(k=>[k,input?.[k]===undefined?null:digest(input[k])]));
  const body={schema:'flop.testnet-assurance/readiness-v1',asOf:now,genesis:GENESIS,evidence,findings,assessment:'NOT_OPERATIONALLY_ATTESTED',executionAuthorized:false,economicAuthority:false,limitations:['Digest binds supplied bytes, not source authenticity.','Account and SDK claims require independent verification.','Health is not admission or settlement proof.']};
  return {...body,certificateSha256:digest(body)};
}
export function verifyCertificate(cert,input) {
  try {const {certificateSha256,...body}=cert;return sha(certificateSha256)&&body.schema==='flop.testnet-assurance/readiness-v1'&&body.genesis===GENESIS&&body.executionAuthorized===false&&body.economicAuthority===false&&body.assessment==='NOT_OPERATIONALLY_ATTESTED'&&digest(body)===certificateSha256&&(input===undefined||digest(readiness(input,body.asOf))===digest(cert));}catch{return false;}
}
export function validateMetadata(m) {
  if(!m||m.genesis!==GENESIS||!uint(m.specVersion)||!hash(m.blockHash)||!sha(m.metadataSha256)||!Array.isArray(m.pallets)||m.pallets.length>256) throw new Error('invalid metadata snapshot');
  const pNames=new Set(),pIndices=new Set();
  for(const p of m.pallets) {
    if(!ident(p.name)||!uint(p.index)||p.index>255||pNames.has(p.name)||pIndices.has(p.index)||!Array.isArray(p.calls)||p.calls.length>256) throw new Error('invalid pallet');
    pNames.add(p.name);pIndices.add(p.index);
    const cn=new Set(),ci=new Set();
    for(const c of p.calls) {
      if(!ident(c.name)||!uint(c.index)||c.index>255||cn.has(c.name)||ci.has(c.index)||!Array.isArray(c.args)||c.args.length>64||c.args.some(a=>!text(a.name)||typeof a.type!=='string'||a.type.length===0||a.type.length>4096)) throw new Error('invalid call');
      cn.add(c.name);ci.add(c.index);
    }
  }
  return m;
}
export function compatibilityMatrix(before,after,requirements=[]) {
  validateMetadata(before);validateMetadata(after);
  if(!Array.isArray(requirements)||requirements.length>1000) throw new Error('invalid requirements');
  const rows=[];
  const map=m=>new Map(m.pallets.flatMap(p=>p.calls.map(c=>[p.name+'.'+c.name,{palletIndex:p.index,callIndex:c.index,args:c.args}])));
  const a=map(before),b=map(after);
  for(const key of [...new Set([...a.keys(),...b.keys()])].sort()) {
    const old=a.get(key),next=b.get(key);
    const state=!old?'ADDED':!next?'REMOVED':digest(old)===digest(next)?'UNCHANGED':'CHANGED';
    rows.push({call:key,state,before:old??null,after:next??null});
  }
  const required=requirements.map(q=>{
    if(!exact(q,['pallet','call'])||!ident(q.pallet)||!ident(q.call)) throw new Error('invalid requirement');
    const key=q.pallet+'.'+q.call;
    const caseMatches=[...b.keys()].filter(k=>k.toLowerCase()===key.toLowerCase());
    return {call:key,state:b.has(key)?'PRESENT':caseMatches.length?'CASE_MISMATCH':'MISSING',caseMatches};
  });
  return {schema:'flop.testnet-assurance/compatibility-v1',from:before.specVersion,to:after.specVersion,metadataChanged:before.metadataSha256!==after.metadataSha256,rows,required,limitations:'Call-level structural comparison only; not proof of SDK or semantic compatibility.'};
}
function context(ctx) {
  if(ctx?.genesis!==GENESIS||!chainAnchor(ctx.head)||!Array.isArray(ctx.blocks)||ctx.blocks.length>100000) throw new Error('invalid finalized context');
  const blocks=new Map([[ctx.head.height,ctx.head.blockHash]]);
  for(const b of ctx.blocks) {
    if(!chainAnchor(b)||b.height>ctx.head.height||(blocks.has(b.height)&&blocks.get(b.height)!==b.blockHash)) throw new Error('conflicting finalized block');
    blocks.set(b.height,b.blockHash);
  }
  return blocks;
}
function anchored(row,blocks) {return chainAnchor(row)&&blocks.get(row.height)===row.blockHash;}
export function voucherLedger(ctx,activation,events) {
  const blocks=context(ctx);
  if(!Array.isArray(events)||events.length>100000) throw new Error('invalid events');
  const active=activation?.announced===true&&activation.source===SOURCES.phase&&anchored(activation,blocks);
  const seen=new Map(),rows=[];
  for(const e of events) {
    if(!chainAnchor(e)||!uint(e.eventIndex)||!['settlement','faucet','failed','other'].includes(e.kind)||!units(e.amount)||!text(e.account)) throw new Error('invalid event');
    const key=e.blockHash+':'+e.eventIndex, fingerprint=digest(e);
    if(seen.has(key)) {if(seen.get(key)!==fingerprint) throw new Error('conflicting duplicate event');continue;}
    seen.set(key,fingerprint);
    const state=!anchored(e,blocks)?'UNVERIFIED_ANCHOR':e.kind!=='settlement'||e.success!==true||e.amount==='0'?'NOT_ELIGIBLE_KIND':!active?'ACTIVATION_UNVERIFIED':e.height<activation.height?'PRE_ACTIVATION':'POST_ACTIVATION_CANDIDATE';
    rows.push({key,height:e.height,kind:e.kind,amount:e.amount,account:e.account,state});
  }
  rows.sort((a,b)=>a.height-b.height||a.key.localeCompare(b.key));
  return {schema:'flop.testnet-assurance/voucher-ledger-v1',activation:active?'SUPPLIED_ANCHORED':'UNVERIFIED',rows,creditedVouchers:null,limitations:'Classification of supplied events only. No voucher credit or scoring is inferred.'};
}
export function settlementVerifier(ctx,receipt,event) {
  const blocks=context(ctx);
  const reject=reason=>({state:'UNVERIFIED',reason,settlementProven:false});
  const keys=['genesis','channelId','payer','payee','workSha256','escrow','paid','fee','refund'];
  if(!exact(receipt,keys)||receipt.genesis!==GENESIS||!hash(receipt.channelId)||!text(receipt.payer)||!text(receipt.payee)||!sha(receipt.workSha256)||!['escrow','paid','fee','refund'].every(k=>units(receipt[k]))) return reject('INVALID_RECEIPT');
  if(!anchored(event,blocks)||event.kind!=='settlement'||event.success!==true||!uint(event.eventIndex)) return reject('UNVERIFIED_FINALIZED_EVENT');
  if(event.receiptSha256!==digest(receipt)||keys.some(k=>event[k]!==receipt[k])) return reject('RECEIPT_EVENT_MISMATCH');
  if(BigInt(receipt.paid)+BigInt(receipt.fee)+BigInt(receipt.refund)!==BigInt(receipt.escrow)||receipt.paid==='0') return reject('AMOUNT_CONSERVATION_OR_ZERO');
  if(event.disputeStatus!=='closed') return reject('DISPUTE_UNVERIFIED');
  return {state:'MATCHED_SUPPLIED_FINALIZED_EVIDENCE',receiptSha256:digest(receipt),blockHash:event.blockHash,eventIndex:event.eventIndex,settlementProven:false,limitations:'Normalized receipt/event reconciliation; independently authenticate the chain, event decoding and work proof before relying on it.'};
}
