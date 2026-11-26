#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { resolve, join, dirname } from 'node:path';
import { GENESIS, SOURCES, observation, bytesDigest, readiness, verifyCertificate, faucetState, compatibilityMatrix, voucherLedger, settlementVerifier, validateMetadata } from './assurance.mjs';

const MAX=16*1024*1024;
async function boundedJson(response) {
  if(!response.body) throw new Error('empty response');
  const chunks=[]; let size=0;
  for await (const chunk of response.body) {size+=chunk.byteLength;if(size>MAX) throw new Error('response limit');chunks.push(Buffer.from(chunk));}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function fetchJson(url,options={}) {
  const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'application/json',...(options.headers??{})}});
  if(!response.ok) return {status:response.status,data:null};
  return {status:response.status,data:await boundedJson(response)};
}
async function get(key) {
  const url=SOURCES[key];
  try {const r=await fetchJson(url);return observation(url,Date.now(),r.status,r.data);}
  catch {return observation(url,Date.now(),0,null);}
}
const RPC_METHODS=new Set(['chain_getBlockHash','chain_getFinalizedHead','chain_getHeader','state_getRuntimeVersion','state_getMetadata']);
async function rpc(method,params) {
  if(!RPC_METHODS.has(method)) throw new Error('read-only RPC methods only');
  const r=await fetchJson(SOURCES.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  if(r.status!==200||r.data?.id!==1||r.data?.error||r.data?.result==null) throw new Error('RPC response unavailable');
  return r.data.result;
}
async function captureRpc() {
  try {
    const genesis=await rpc('chain_getBlockHash',[0]);
    if(genesis!==GENESIS) return observation(SOURCES.rpc,Date.now(),200,{genesis});
    const finalizedHash=await rpc('chain_getFinalizedHead',[]);
    if(!/^0x[0-9a-f]{64}$/.test(finalizedHash)) throw new Error('invalid block');
    const [header,runtime,metadata]=await Promise.all([rpc('chain_getHeader',[finalizedHash]),rpc('state_getRuntimeVersion',[finalizedHash]),rpc('state_getMetadata',[finalizedHash])]);
    if(!/^0x[0-9a-f]+$/.test(header?.number)||!Number.isSafeInteger(runtime?.specVersion)) throw new Error('invalid runtime');
    const height=Number(BigInt(header.number));
    if(!Number.isSafeInteger(height)||height<0) throw new Error('invalid height');
    return observation(SOURCES.rpc,Date.now(),200,{genesis,finalizedHash,height,specName:runtime.specName,specVersion:runtime.specVersion,metadataSha256:bytesDigest(metadata),metadata});
  } catch {return observation(SOURCES.rpc,Date.now(),0,null);}
}
async function capture() {
  const keys=['chain','limits','health','gateway','sdk'];
  const responses=await Promise.all([...keys.map(get),captureRpc()]);
  const input=Object.fromEntries([...keys,'rpc'].map((k,i)=>[k,responses[i]]));
  // The npm response may contain arbitrary published metadata. Keep only the public version.
  const s=input.sdk;
  if(s.status===200) input.sdk=observation(s.source,s.observedAt,200,{version:typeof s.data?.version==='string'?s.data.version:null});
  return {schema:'flop.testnet-assurance/capture-v1',asOf:Date.now(),input};
}
async function load(file) {
  if(!file) throw new Error('missing input file');
  if((await stat(file)).size>MAX) throw new Error('input limit');
  const raw=await readFile(file);
  const decoded=file.endsWith('.json.gz')?gunzipSync(raw,{maxOutputLength:MAX}):raw;
  if(decoded.length>MAX)throw new Error('input limit');
  return JSON.parse(decoded.toString('utf8'));
}
function decode(capture,root) {
  const o=capture?.input?.rpc;
  const r=o?.data;
  if(o?.source!==SOURCES.rpc||o?.status!==200||r?.genesis!==GENESIS||r.specName!=='flop-testnet'||bytesDigest(r.metadata)!==r.metadataSha256||observation(o.source,o.observedAt,o.status,r).sha256!==o.sha256) throw new Error('unverified metadata bytes');
  // Resolve only from an explicitly chosen trusted local installation, never auto-install.
  const require=createRequire(join(resolve(root??'.'),'package.json'));
  const {Metadata,TypeRegistry}=require('@polkadot/types');
  const registry=new TypeRegistry();
  const md=new Metadata(registry,r.metadata);
  registry.setMetadata(md);
  const pallets=Array.from(md.asLatest.pallets,p=>{
    const calls=p.calls.isSome?Array.from(registry.lookup.getSiType(p.calls.unwrap().type).def.asVariant.variants,v=>({
      name:v.name.toString(),index:v.index.toNumber(),
      args:Array.from(v.fields,(f,i)=>({name:f.name.isSome?f.name.unwrap().toString():String(i),type:registry.lookup.getTypeDef(f.type).type}))
    })):[];
    return {name:p.name.toString(),index:p.index.toNumber(),calls};
  });
  return validateMetadata({genesis:r.genesis,specVersion:r.specVersion,blockHash:r.finalizedHash,metadataSha256:r.metadataSha256,pallets});
}
async function sdkObserve(capture,root) {
  if(!root) throw new Error('trusted SDK installation root required');
  const o=capture?.input?.rpc;
  const r=o?.data;
  if(o?.source!==SOURCES.rpc||o?.status!==200||r?.genesis!==GENESIS||r.specName!=='flop-testnet'||bytesDigest(r.metadata)!==r.metadataSha256||observation(o.source,o.observedAt,o.status,r).sha256!==o.sha256) throw new Error('unverified metadata bytes');
  const require=createRequire(join(resolve(root),'package.json'));
  const entry=require.resolve('@flop-labs/sdk');
  let dir=dirname(entry), pkg;
  for(let i=0;i<8;i++) {
    try {const p=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));if(p.name==='@flop-labs/sdk'){pkg=p;break;}}catch{}
    const parent=dirname(dir);if(parent===dir)break;dir=parent;
  }
  if(!pkg||typeof pkg.version!=='string')throw new Error('SDK package metadata missing');
  const sdk=require('@flop-labs/sdk');
  const specVersions=sdk.SUPPORTED_SPEC_VERSIONS;
  if(!Array.isArray(specVersions)||!specVersions.every(Number.isSafeInteger)) throw new Error('SDK supported versions unavailable');
  return {...capture,input:{...capture.input,sdkSupport:{version:pkg.version,specVersions:[...new Set(specVersions)].sort((a,b)=>a-b),metadataSha256:r.metadataSha256}}};
}
async function verifyAnchors(ctx) {
  if(ctx?.genesis!==GENESIS||!ctx.head||!Array.isArray(ctx.blocks)||ctx.blocks.length>128) throw new Error('invalid context or anchor limit');
  const entries=[ctx.head,...ctx.blocks];
  const genesis=await rpc('chain_getBlockHash',[0]);
  if(genesis!==GENESIS) throw new Error('wrong network');
  const headHash=await rpc('chain_getFinalizedHead',[]);
  const header=await rpc('chain_getHeader',[headHash]);
  const head=Number(BigInt(header.number));
  if(!Number.isSafeInteger(head)||head<0) throw new Error('invalid finalized height');
  const rows=[];
  const heights=new Map();
  for(const e of entries){
    if(e?.genesis!==GENESIS||!Number.isSafeInteger(e.height)||e.height<0||!/^0x[0-9a-f]{64}$/.test(e.blockHash)||e.finalized!==true)throw new Error('invalid anchor');
    if(!heights.has(e.height))heights.set(e.height,e.height>head?null:await rpc('chain_getBlockHash',[e.height]));
    rows.push({height:e.height,blockHash:e.blockHash,state:e.height>head?'ABOVE_FINALIZED_HEAD':heights.get(e.height)===e.blockHash?'RPC_ANCHOR_MATCH':'ANCHOR_MISMATCH'});
  }
  return {genesis,headHash,head,checkedAt:Date.now(),rows,allMatched:rows.every(r=>r.state==='RPC_ANCHOR_MATCH'),eventsAuthenticated:false,limitations:'Single public RPC; no independent finality proof or event authentication.'};
}
const [command,...args]=process.argv.slice(2);
async function main() {
  switch(command) {
    case 'capture': if(args.length)throw new Error('capture takes no arguments');return capture();
    case 'readiness': {const v=await load(args[0]);return readiness(v.input??v,v.asOf??Date.now());}
    case 'faucet': {const v=await load(args[0]);return faucetState(v.input??v,v.asOf??Date.now());}
    case 'verify-certificate': {const c=await load(args[0]);const v=await load(args[1]);const valid=verifyCertificate(c,v.input??v);if(!valid)process.exitCode=1;return {valid,authenticityProven:false};}
    case 'decode-metadata': return decode(await load(args[0]),args[1]);
    case 'sdk-observe': return sdkObserve(await load(args[0]),args[1]);
    case 'verify-anchors': {const v=await load(args[0]);return verifyAnchors(v.context??v);}
    case 'compatibility': return compatibilityMatrix(await load(args[0]),await load(args[1]),args[2]?await load(args[2]):[]);
    case 'voucher-ledger': {const v=await load(args[0]);return voucherLedger(v.context,v.activation,v.events);}
    case 'settlement': {const v=await load(args[0]);return settlementVerifier(v.context,v.receipt,v.event);}
    default: throw new Error('commands: capture, readiness FILE, faucet FILE, verify-certificate CERT CAPTURE, decode-metadata CAPTURE [DECODER_ROOT], sdk-observe CAPTURE SDK_ROOT, verify-anchors FILE, compatibility BEFORE AFTER [REQUIREMENTS], voucher-ledger FILE, settlement FILE');
  }
}
try {console.log(JSON.stringify(await main(),null,2));}
catch(e){console.error('assurance:',e.message);process.exitCode=1;}
