import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeMarketOffer } from "../src/market.js";
import { rankPlans, classifyOffer, unsupportedOfferReason, EconomicWorkLayer } from "../src/economic-work.js";
import { buildReputation } from "../src/reputation.js";

test("funded market offers normalize and prioritize evidence work",()=>{
  const a=normalizeMarketOffer({id:"ci-1",proto:"a2a",amount:"100",asset:"FLOP",funded:true,task:"run public CI conformance fixture",from:"did:payer:a"},"test",0);
  const b=normalizeMarketOffer({id:"text-1",proto:"a2a",amount:"10",asset:"FLOP",funded:true,task:"explain protocol",from:"did:payer:b"},"test",1);
  assert.equal(a.funded,true);
  assert.equal(classifyOffer(a).worker,"conformance");
  const plans=rankPlans([b,a],new Map(),{allowUnfunded:false});
  assert.equal(plans[0]?.offer.offerId,"ci-1");
});

test("unsupported media is excluded and payment boilerplate does not misclassify protocol work",()=>{
  const media=normalizeMarketOffer({id:"m1",proto:"a2a",amount:"100",asset:"FLOP",funded:true,task:"create a 1080x1080 png ui mockup"},"test",0);
  assert.equal(unsupportedOfferReason(media),"unsupported_media_deliverable");
  assert.equal(rankPlans([media],new Map(),{allowUnfunded:false}).length,0);
  const protocol=normalizeMarketOffer({id:"p1",proto:"blockrewards",amount:"800",asset:"FLOP",funded:true,task:"Fold this tclk/1 transcript with the reference rules. Paid in FLOP on the paper rail."},"test",1);
  assert.equal(classifyOffer(protocol).worker,"conformance");
});

test("reputation is evidence-derived and portable",()=>{
  const records:any[]=[
    {schema:"flop.operational-memory/v1",at:"2026-09-27T00:00:00Z",counterparty:"did:a",capability:"conformance",workId:"1",outcome:"ACCEPTED"},
    {schema:"flop.operational-memory/v1",at:"2026-09-27T00:00:01Z",counterparty:"did:a",capability:"conformance",workId:"1",outcome:"VALIDATED",latencyMs:100,evidenceRef:"sha256:x"},
  ];
  const rep=buildReputation("did:a",records);
  assert.equal(rep.subject,"did:a");
  assert.equal(rep.validated,1);
  assert.match(rep.digest,/^sha256:[0-9a-f]{64}$/);
  assert.ok(rep.score>0.5);
});

test("economic execution stays payment-pending without external settlement evidence",async()=>{
  const stateDir=await mkdtemp(join(tmpdir(),"flop-economic-work-"));
  const layer=new EconomicWorkLayer({stateDir,allowUnfunded:true});
  const offer=normalizeMarketOffer({id:"proof-1",proto:"a2a",amount:"100",asset:"FLOP",funded:true,task:"produce execution receipt",from:"did:payer"},"test",0);
  const plan=rankPlans([offer],new Map(),{allowUnfunded:true})[0]!;
  const prepared=await layer.executePlan(plan,{workId:"w1",executor:"agent",result:{ok:true}});
  assert.equal(prepared.execution.status,"COMPLETED");
  assert.equal(prepared.state,"WORK_COMPLETED_PAYMENT_PENDING");
  const receipt=await layer.finalize(prepared);
  assert.equal(receipt.status,"FAILED");
  assert.equal(receipt.payment.status,"UNVERIFIED");
});


test("advertised reward is not promoted to verified funding",()=>{
  const offer=normalizeMarketOffer({id:"adv-1",proto:"a2a",amount:"100",asset:"FLOP",task:"run public CI conformance fixture"},"test",0);
  assert.equal(offer.funded,true);
  assert.equal(offer.fundingStatus,"ADVERTISED");
  assert.equal(rankPlans([offer],new Map(),{allowUnfunded:false}).length,1);
  assert.equal(rankPlans([offer],new Map(),{allowUnfunded:false,requireDeclaredFunding:true}).length,0);
});

test("local selection is not recorded as external acceptance",async()=>{
  const stateDir=await mkdtemp(join(tmpdir(),"flop-economic-selection-"));
  const layer=new EconomicWorkLayer({stateDir,allowUnfunded:true});
  const offer=normalizeMarketOffer({id:"sel-1",proto:"a2a",amount:"1",asset:"FLOP",funded:true,task:"produce execution receipt",from:"did:payer"},"test",0);
  const plan=rankPlans([offer],new Map(),{allowUnfunded:true})[0]!;
  await layer.executePlan(plan,{workId:"w1",executor:"agent",result:{ok:true}});
  const records=await layer.memory.read();
  assert.equal(records[0]?.outcome,"SELECTED");
  assert.equal(records.some(x=>x.outcome==="ACCEPTED"),false);
});

test("payment evidence must bind asset and amount to the prepared requirement",async()=>{
  const stateDir=await mkdtemp(join(tmpdir(),"flop-economic-binding-"));
  const layer=new EconomicWorkLayer({stateDir,allowUnfunded:true});
  const offer=normalizeMarketOffer({id:"bind-1",proto:"a2a",amount:"100",asset:"FLOP",funded:true,task:"produce execution receipt",from:"did:payer"},"test",0);
  const plan=rankPlans([offer],new Map(),{allowUnfunded:true})[0]!;
  const prepared=await layer.executePlan(plan,{workId:"w1",executor:"agent",result:{ok:true}});
  const receipt=await layer.finalize(prepared,{
    schema:"flop.external-execution-evidence/v1",
    mode:"TESTNET",
    observations:[],
    expected:{reservationId:"r1",asset:"USDC",lockedAmount:"100",settledAmount:"100",minConfirmations:1},
    observedAt:new Date().toISOString(),
  });
  assert.equal(receipt.payment.status,"UNVERIFIED");
  assert.equal(receipt.status,"FAILED");
});

test("payment evidence must also bind locked amount to the prepared requirement",async()=>{
  const stateDir=await mkdtemp(join(tmpdir(),"flop-economic-lock-binding-"));
  const layer=new EconomicWorkLayer({stateDir,allowUnfunded:true});
  const offer=normalizeMarketOffer({id:"bind-lock",proto:"a2a",amount:"100",asset:"FLOP",funded:true,task:"produce execution receipt",from:"did:payer"},"test",0);
  const plan=rankPlans([offer],new Map(),{allowUnfunded:true})[0]!;
  const prepared=await layer.executePlan(plan,{workId:"w1",executor:"agent",result:{ok:true}});
  const receipt=await layer.finalize(prepared,{
    schema:"flop.external-execution-evidence/v1",
    mode:"TESTNET",
    observations:[],
    expected:{reservationId:"r1",asset:"FLOP",lockedAmount:"101",settledAmount:"100",minConfirmations:1},
    observedAt:new Date().toISOString(),
  });
  assert.equal(receipt.payment.status,"UNVERIFIED");
  assert.equal(receipt.status,"FAILED");
});
