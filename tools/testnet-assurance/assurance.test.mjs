import test from 'node:test';
import assert from 'node:assert/strict';
import {GENESIS,SOURCES,observation,digest,bytesDigest,faucetState,gatewayState,readiness,verifyCertificate,compatibilityMatrix,voucherLedger,settlementVerifier} from './assurance.mjs';
const now=1795667100000, block=(n)=>'0x'+n.toString(16).padStart(64,'0'), A='a'.repeat(64);
const obs=(k,data,status=200,t=now)=>observation(SOURCES[k],t,status,data);
const clone=structuredClone;
function fixture(){
  return {rpc:obs('rpc',{genesis:GENESIS,finalizedHash:block(10),height:10,specName:'flop-testnet',specVersion:1014038,metadataSha256:A}),
  chain:obs('chain',{network:'testnet',genesisHash:GENESIS}),
  limits:obs('limits',{network:'testnet',stale:false,asOf:new Date(now).toISOString(),faucet:{status:'open',dailyCap:{limitFlop:'100',usedFlop:'90',remainingFlop:'10'},agent:{grantFlop:10,rolling24HourCapFlop:10,claimPath:'/v1/testnet/agent-claims',cooldownSeconds:86400,rolloverRequiresSpend:true}}}),
  health:obs('health',{status:'ok',ready:true,live:true,connected:true,signing:{held:false},dependencies:{funding:{ok:true},indexer:{ok:true,details:{binding:{genesis:GENESIS}}}}}),
  gateway:obs('gateway',{status:'ok',connected:true,syncing:false,network:{network:'testnet',expected_genesis_hash:GENESIS,observed_genesis_hash:GENESIS},dependencies:{settlement:{ok:true}}}),
  sdk:obs('sdk',{version:'0.12.0'}),sdkSupport:{version:'0.12.0',specVersions:[1014038],metadataSha256:A},
  account:{genesis:GENESIS,blockHash:block(10),height:10,finalized:true,registered:false,free:'10000000000000000000',minimumStake:'10000000000000000000',estimatedFee:'1'}};
}
function mutate(i,key,fn){const x=clone(i[key].data);fn(x);i[key]=obs(key,x);}
test('canonical digests stable across key order',()=>assert.equal(digest({a:1,b:2}),digest({b:2,a:1})));
test('metadata hash is over decoded bytes',()=>assert.equal(bytesDigest('0x616263'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
test('faucet open is observation only',()=>{const x=faucetState(fixture(),now);assert.equal(x.state,'OPEN_OBSERVED');assert.equal(x.requestAuthorized,false);assert.equal(x.walletEligibility,'UNVERIFIED');});
test('daily_cap_reached is not UNKNOWN',()=>{const i=fixture();mutate(i,'limits',l=>{l.faucet.status='daily_cap_reached';l.faucet.dailyCap={limitFlop:'100',usedFlop:'100',remainingFlop:'0'};});assert.equal(faucetState(i,now).state,'DAILY_CAP_REACHED');});
test('daily cap contradictions fail closed',()=>{const i=fixture();mutate(i,'limits',l=>{l.faucet.status='daily_cap_reached';});assert.equal(faucetState(i,now).state,'POLICY_CONFLICT');});
test('open with zero remaining is inconsistent',()=>{const i=fixture();mutate(i,'limits',l=>{l.faucet.dailyCap={limitFlop:'100',usedFlop:'100',remainingFlop:'0'};});assert.equal(faucetState(i,now).state,'POLICY_CONFLICT');});
test('open with unhealthy indexer is not ready',()=>{const i=fixture();mutate(i,'health',h=>{h.dependencies.indexer.ok=false;});assert.equal(faucetState(i,now).state,'NOT_READY');});
test('open with unavailable health is not ready',()=>{const i=fixture();i.health=obs('health',null,503);assert.equal(faucetState(i,now).state,'NOT_READY');});
test('closed differs from unobserved',()=>{const i=fixture();mutate(i,'limits',l=>{l.faucet.status='closed';});assert.equal(faucetState(i,now).state,'NOT_OPEN');i.limits=obs('limits',null,0);assert.equal(faucetState(i,now).state,'UNVERIFIED');});
test('stale server timestamp is rejected',()=>{const i=fixture();mutate(i,'limits',l=>{l.asOf=new Date(now-360001).toISOString();});assert.equal(faucetState(i,now).state,'STALE');});
test('future observation is rejected',()=>{const i=fixture();i.chain=obs('chain',i.chain.data,200,now+1);assert.equal(faucetState(i,now).state,'NETWORK_UNVERIFIED');});
test('tampered observation is not accepted',()=>{const i=fixture();i.chain.data.genesisHash=block(1);assert.equal(faucetState(i,now).state,'NETWORK_UNVERIFIED');});
test('devnet RPC rejects faucet',()=>{const i=fixture();mutate(i,'rpc',r=>{r.genesis=block(1);});assert.equal(faucetState(i,now).state,'WRONG_NETWORK');});
test('wrong health binding is rejected',()=>{const i=fixture();mutate(i,'health',h=>{h.dependencies.indexer.details.binding.genesis=block(1);});assert.equal(faucetState(i,now).state,'WRONG_NETWORK');});
test('contract drift requires review',()=>{const i=fixture();mutate(i,'limits',l=>{l.faucet.agent.grantFlop=11;});assert.equal(faucetState(i,now).state,'CONTRACT_REVIEW_REQUIRED');});
test('gateway rejects devnet',()=>{const i=fixture();mutate(i,'gateway',h=>{h.network.network='devnet';});assert.equal(gatewayState(i.gateway,now),'WRONG_NETWORK');});
test('gateway settlement dependency matters',()=>{const i=fixture();mutate(i,'gateway',h=>{h.dependencies.settlement.ok=false;});assert.equal(gatewayState(i.gateway,now),'NOT_READY');});
test('readiness detects stake plus fee shortfall',()=>{const i=fixture(),c=readiness(i,now);assert.equal(c.findings.registration,'SUPPLIED_FUNDS_INSUFFICIENT');assert.equal(c.findings.sdk,'SUPPLIED_VERSION_RANGE_MATCH');assert.equal(c.executionAuthorized,false);assert.equal(c.economicAuthority,false);assert.equal(c.assessment,'NOT_OPERATIONALLY_ATTESTED');assert.equal(verifyCertificate(c,i),true);});
test('certificate binds supplied evidence',()=>{const i=fixture(),c=readiness(i,now);i.account.estimatedFee='0';assert.equal(verifyCertificate(c,i),false);c.findings.sdk='invented';assert.equal(verifyCertificate(c),false);});
test('runtime mismatch and mismatched account anchor fail closed',()=>{const i=fixture();i.sdkSupport.specVersions=[];i.account.height=9;const c=readiness(i,now);assert.equal(c.findings.sdk,'UNVERIFIED');assert.equal(c.findings.registration,'UNVERIFIED');});
const call=(name,index,type='u32')=>({name,index,args:[{name:'value',type}]});
const meta=(pallets,version=1014038)=>({genesis:GENESIS,specVersion:version,blockHash:block(version),metadataSha256:A,pallets});
test('metadata matrix distinguishes casing, index and type drift',()=>{const before=meta([{name:'FlopPoUI',index:1,calls:[call('submit',0)]},{name:'System',index:0,calls:[call('remark',0)]}]);const after=meta([{name:'FlopPoui',index:1,calls:[call('submit',0)]},{name:'System',index:0,calls:[call('remark',1,'Bytes')]}],1014039);const x=compatibilityMatrix(before,after,[{pallet:'FlopPoUI',call:'submit'}]);assert.equal(x.required[0].state,'CASE_MISMATCH');assert.equal(x.rows.find(r=>r.call==='System.remark').state,'CHANGED');assert.equal(x.rows.find(r=>r.call==='FlopPoUI.submit').state,'REMOVED');assert.equal(x.rows.find(r=>r.call==='FlopPoui.submit').state,'ADDED');});
test('metadata rejects duplicate indices',()=>assert.throws(()=>compatibilityMatrix(meta([{name:'A',index:0,calls:[]},{name:'B',index:0,calls:[]}]),meta([])),/invalid pallet/));
const anchor=n=>({genesis:GENESIS,height:n,blockHash:block(n),finalized:true});
const ctx={genesis:GENESIS,head:anchor(10),blocks:[anchor(5),anchor(6),anchor(7),anchor(8),anchor(9)]};
const activation={...anchor(7),announced:true,source:SOURCES.phase};
const event=(n,kind='settlement',i=0)=>({...anchor(n),eventIndex:i,kind,amount:'100',account:'fixture-account',success:true});
test('ledger distinguishes before, at, after activation and non-settlement',()=>{const x=voucherLedger(ctx,activation,[event(6),event(7),event(8),event(9,'faucet'),event(9,'failed',1)]);assert.deepEqual(x.rows.map(r=>r.state),['PRE_ACTIVATION','POST_ACTIVATION_CANDIDATE','POST_ACTIVATION_CANDIDATE','NOT_ELIGIBLE_KIND','NOT_ELIGIBLE_KIND']);assert.equal(x.creditedVouchers,null);});
test('no activation is inferred from height',()=>assert.equal(voucherLedger(ctx,null,[event(9)]).rows[0].state,'ACTIVATION_UNVERIFIED'));
test('activation must be anchored',()=>assert.equal(voucherLedger(ctx,{...activation,blockHash:block(1)},[event(9)]).rows[0].state,'ACTIVATION_UNVERIFIED'));
test('duplicate events deduplicate and conflicts reject',()=>{const e=event(8);assert.equal(voucherLedger(ctx,activation,[e,e]).rows.length,1);assert.throws(()=>voucherLedger(ctx,activation,[e,{...e,amount:'101'}]),/conflicting duplicate/);});
test('unknown finalized anchor is not credit',()=>assert.equal(voucherLedger(ctx,activation,[event(4)]).rows[0].state,'UNVERIFIED_ANCHOR'));
const receipt={genesis:GENESIS,channelId:block(20),payer:'fixture-payer',payee:'fixture-payee',workSha256:A,escrow:'10000000000000000000',paid:'9000000000000000000',fee:'100000000000000000',refund:'900000000000000000'};
const settle=r=>({...anchor(8),...r,eventIndex:2,kind:'settlement',success:true,receiptSha256:digest(r),disputeStatus:'closed'});
test('settlement reconciliation is not cryptographic proof',()=>{const x=settlementVerifier(ctx,receipt,settle(receipt));assert.equal(x.state,'MATCHED_SUPPLIED_FINALIZED_EVIDENCE');assert.equal(x.settlementProven,false);});
test('settlement rejects tampered work digest',()=>assert.equal(settlementVerifier(ctx,receipt,{...settle(receipt),workSha256:'b'.repeat(64)}).reason,'RECEIPT_EVENT_MISMATCH'));
test('settlement rejects amount imbalance using exact integers',()=>{const r={...receipt,refund:'900000000000000001'};assert.equal(settlementVerifier(ctx,r,settle(r)).reason,'AMOUNT_CONSERVATION_OR_ZERO');});
test('settlement rejects unverified dispute and wrong anchor',()=>{assert.equal(settlementVerifier(ctx,receipt,{...settle(receipt),disputeStatus:'open'}).reason,'DISPUTE_UNVERIFIED');assert.equal(settlementVerifier(ctx,receipt,{...settle(receipt),blockHash:block(1)}).reason,'UNVERIFIED_FINALIZED_EVENT');});
test('settlement rejects floating point money',()=>{const r={...receipt,fee:1};assert.equal(settlementVerifier(ctx,r,settle(r)).reason,'INVALID_RECEIPT');});
