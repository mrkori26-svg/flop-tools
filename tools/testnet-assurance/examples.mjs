// Synthetic fixtures only: none of these events is a real FLOP event.
import {GENESIS,SOURCES,observation,digest} from './assurance.mjs';
const asOf=1795667100000, hash=n=>'0x'+n.toString(16).padStart(64,'0');
const anchor=n=>({genesis:GENESIS,height:n,blockHash:hash(n),finalized:true});
const obs=(k,data)=>observation(SOURCES[k],asOf,200,data);
const context={genesis:GENESIS,head:anchor(10),blocks:[anchor(6),anchor(7),anchor(8),anchor(9)]};
const receipt={genesis:GENESIS,channelId:hash(20),payer:'synthetic-payer',payee:'synthetic-payee',workSha256:'a'.repeat(64),escrow:'100',paid:'90',fee:'1',refund:'9'};
const event={...anchor(8),...receipt,eventIndex:2,kind:'settlement',success:true,receiptSha256:digest(receipt),disputeStatus:'closed'};
const input={
  rpc:obs('rpc',{genesis:GENESIS,finalizedHash:hash(10),height:10,specName:'flop-testnet',specVersion:1014038,metadataSha256:'b'.repeat(64)}),
  chain:obs('chain',{network:'testnet',genesisHash:GENESIS}),
  limits:obs('limits',{network:'testnet',asOf:new Date(asOf).toISOString(),stale:false,faucet:{status:'daily_cap_reached',dailyCap:{limitFlop:'100',usedFlop:'100',remainingFlop:'0'}}}),
  account:{...anchor(10),registered:false,free:'100',minimumStake:'100',estimatedFee:'1'}
};
const events=[{...anchor(6),eventIndex:0,kind:'settlement',amount:'12',account:'synthetic-account',success:true},{...anchor(8),eventIndex:2,kind:'settlement',amount:'90',account:'synthetic-account',success:true}];
console.log(JSON.stringify({schema:'flop.testnet-assurance/synthetic-example-v1',synthetic:true,asOf,input,context,activation:null,events,receipt,event},null,2));
