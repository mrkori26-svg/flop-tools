// Minimize a public capture before retaining it for reproducible analysis.
import {readFile,writeFile,stat} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {SOURCES,GENESIS,observation,readiness,bytesDigest} from './assurance.mjs';
const [source,destination,certificate]=process.argv.slice(2);
const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o&&Object.hasOwn(o,k)).map(k=>[k,o[k]]));
if(!source||!destination?.endsWith('.json.gz')||!certificate||source===destination||source===certificate||destination===certificate)throw new Error('usage: retain-public.mjs CAPTURE OUTPUT.json.gz CERTIFICATE.json');
if((await stat(source)).size>16*1024*1024)throw new Error('input limit');
const c=JSON.parse(await readFile(source,'utf8'));
const i=c.input;
const fields={
  chain:x=>pick(x,['network','genesisHash']),
  limits:x=>({...pick(x,['network','asOf','stale']),faucet:{...pick(x.faucet,['status']),dailyCap:pick(x.faucet?.dailyCap,['limitFlop','usedFlop','remainingFlop']),agent:pick(x.faucet?.agent,['grantFlop','claimPath','rolling24HourCapFlop','cooldownSeconds','rolloverRequiresSpend'])}}),
  health:x=>({...pick(x,['status','ready','live','connected']),signing:pick(x.signing,['held']),dependencies:{funding:pick(x.dependencies?.funding,['ok']),indexer:{...pick(x.dependencies?.indexer,['ok']),details:{binding:pick(x.dependencies?.indexer?.details?.binding,['genesis'])}}}}),
  gateway:x=>({...pick(x,['status','connected','syncing']),network:pick(x.network,['network','expected_genesis_hash','observed_genesis_hash']),dependencies:{settlement:pick(x.dependencies?.settlement,['ok'])}}),
  sdk:x=>pick(x,['version']),
  rpc:x=>pick(x,['genesis','finalizedHash','height','specName','specVersion','metadataSha256','metadata'])
};
const input={};
for(const [key,project] of Object.entries(fields)){
  const o=i[key];
  if(o?.source!==SOURCES[key]||observation(o.source,o.observedAt,o.status,o.data).sha256!==o.sha256)throw new Error('observation integrity failed: '+key);
  input[key]=observation(o.source,o.observedAt,o.status,o.status===200&&o.data?project(o.data):null);
}
const r=input.rpc.data;
if(r?.genesis!==GENESIS||bytesDigest(r.metadata)!==r.metadataSha256)throw new Error('metadata integrity failed');
if(i.sdkSupport)input.sdkSupport=pick(i.sdkSupport,['version','specVersions','metadataSha256']);
// Deliberately discard account data and unrelated service fields.
const retained={schema:'flop.testnet-assurance/capture-v1',asOf:c.asOf,retention:'minimized-public-projection',input};
await writeFile(destination,gzipSync(JSON.stringify(retained)),{flag:'wx'});
await writeFile(certificate,JSON.stringify(readiness(input,c.asOf),null,2)+'\n',{flag:'wx'});
