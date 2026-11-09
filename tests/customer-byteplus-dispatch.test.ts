import {test} from "node:test";
import assert from "node:assert/strict";
import {CommerceStore} from "../lib/commerce/store.ts";
import {BytePlusProtocol} from "../lib/live/byteplus.ts";
import {dispatchReviewedCustomerBytePlus,reviewedCustomerBytePlusCost,
 type CustomerBytePlusDispatch} from "../lib/commerce/customer-byteplus-dispatch.ts";
import type {PreparedMedia} from "../lib/live/store.ts";
import type {VerifiedContract} from "../lib/live/contract.ts";

const STAGING="dfaeabed-03df-43ed-aa71-50f343a75041";
const contract:VerifiedContract={
 revision:"synthetic-review-test-only",
 model:"OmniHuman 2.0",documentationUrl:"https://example.test/review",
 maxDurationSeconds:5,promptSupported:true,inputFetchWindowSeconds:44100,
 generatedDurationBound:{minInputSeconds:5,maxInputSeconds:5,maxAdditionalSeconds:1,
  evidence:"fictional complete generated-duration review for offline tests"},
 billing:{microUsdPerSecond:70000,minimumBillableMs:0,billingQuantumMs:1000,
  minimumChargeMicroUsd:0,fixedFeeMicroUsd:0,taxBasisPointsUpperBound:1900},
 output:{width:1280,height:720,fps:25,durationToleranceSeconds:1,
  transfer:{maxBytes:20_000_000,timeoutMs:120000,evidence:"synthetic offline MP4 review"}},
 outputHosts:["example.test"],
};
const account="11111111-1111-4111-8111-111111111111";
const media:PreparedMedia={
 sourceJobId:"synthetic-customer-source",promptLanguageConfirmed:true,
 owner:`customer-${account}`,audioPath:"/private/input.mp3",imagePath:"/private/image.png",
 audioSha256:"a".repeat(64),imageSha256:"b".repeat(64),
 durationSeconds:5,prompt:"Sing naturally",outputFormat:"9:16"
};
let networkCalls=0;
const review=():CustomerBytePlusDispatch=>({
 contract,delivery:{async issue(m){
  assert.equal(m.owner,media.owner);
  return {owner:m.owner,audioSha256:m.audioSha256,imageSha256:m.imageSha256,
   audioUrl:"https://r2.example.test/audio.mp3",imageUrl:"https://r2.example.test/image.png",
   expiresAt:Date.now()+46800000};
 }},
 inputHosts:["r2.example.test"],protocol:new BytePlusProtocol(async(request)=>{
  networkCalls++;
  assert.match(request.url,/CVSync2AsyncSubmitTask/);
  return {status:200,body:{code:10000,data:{task_id:"synthetic-task-0001"}}};
 }),
 dailyCapMicroUsd:1_000_000,lifetimeCapMicroUsd:2_000_000,
 reviewEvidence:"fictional reviewed all-inclusive customer policy",
 signal:new AbortController().signal,verify:async()=>{},
});
test("offline contract computes ceiling from generated duration and includes tax",()=>{
 const p=reviewedCustomerBytePlusCost(media,review());
 assert.equal(p.inclusiveMaxMicroUsd,499800);
 assert.equal(p.dailyCapMicroUsd,1000000);
 assert.match(p.reviewEvidence,/customer-byteplus-v1:/);
 for(const invalid of [
  {...review(),contract:{...contract,pilotAdmission:{inclusiveMaxMicroUsd:499800,
   evidence:"pilot",planningUpliftBasisPoints:1900 as const,maxGeneratedSeconds:6}}},
  {...review(),contract:{...contract,billing:{...contract.billing,taxBasisPointsUpperBound:null}}},
  {...review(),contract:{...contract,inputFetchWindowSeconds:null}},
 ])assert.throws(()=>reviewedCustomerBytePlusCost(media,invalid),/contract required|nonnegative integers/);
});
test("production and disabled staging never call provider or claim orders",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const id="11111111-1111-4111-8111-111111111111";
  networkCalls=0;
  await assert.rejects(dispatchReviewedCustomerBytePlus(store,id,review(),{
   RAILWAY_ENVIRONMENT_ID:"production",CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"true"
  }),/not authorized/);
  await assert.rejects(dispatchReviewedCustomerBytePlus(store,id,review(),{
   RAILWAY_ENVIRONMENT_ID:STAGING,CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"false"
  }),/not authorized/);
  assert.equal(networkCalls,0);
 }finally{store.close()}
});
test("authenticated paid customer submits once with durable spend and task record",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  store.db.prepare("INSERT INTO customer_accounts VALUES(?,?,?,?)").run(account,"buyer@example.test","test-hash",Date.now());
  const id=store.preparedVideoOrder({
   account,email:"buyer@example.test",project:"reviewed-song",
   cents:125,quoteEvidence:"reviewed-inclusive-verified-customer-quote",
   key:"customer-byteplus-offline-1",media,
  }).id;
  assert.equal(store.hasEarlyPerformanceConsent(id),false);
  store.recordEarlyPerformanceConsent(id,account);
  assert.equal(store.hasEarlyPerformanceConsent(id),true);
  store.bindStripeCheckout(id,"cs_test_dispatch_customer_1");
  await store.webhook(new Uint8Array(),"signed",{async verify(){return {
   eventId:"evt_dispatch_customer_1",provider:"stripe",orderId:id,cents:125,
   currency:"EUR" as const,evidence:"cs_test_dispatch_customer_1"
  }}});
  // A verified payment and consent still do NOT authorize external BytePlus cost
  // until the durable contract confirmation has actually been sent.
  networkCalls=0;
  await assert.rejects(
   dispatchReviewedCustomerBytePlus(store,id,review(),{
    RAILWAY_ENVIRONMENT_ID:STAGING,CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"true"
   }),/Durable contract confirmation missing/);
  assert.equal(networkCalls,0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_provider_submissions WHERE order_id=?").get(id)?.n,0);
  store.markContractConfirmationSent(id);
  assert.equal(store.hasContractConfirmation(id),true);
  const env={RAILWAY_ENVIRONMENT_ID:STAGING,CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"true"};
  networkCalls=0;
  assert.equal(await dispatchReviewedCustomerBytePlus(store,id,review(),env),"submitted");
  assert.equal(await dispatchReviewedCustomerBytePlus(store,id,review(),env),"already-claimed");
  assert.equal(networkCalls,1);
  assert.equal(store.paidProviderJob(id)?.jobId,"synthetic-task-0001");
  assert.equal(store.paidSubmissionStatus(id),"acknowledged");
  assert.equal(store.db.prepare("SELECT inclusive_micro_usd AS cost FROM customer_provider_cost_reservations WHERE order_id=?").get(id)?.cost,499800);
 }finally{store.close()}
});

test("P0: paid customer without explicit pre-payment consent never reaches BytePlus",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  store.db.prepare("INSERT INTO customer_accounts VALUES(?,?,?,?)").run(account,"buyer@example.test","test-hash",Date.now());
  const id=store.preparedVideoOrder({
   account,email:"buyer@example.test",project:"missing-consent-song",
   cents:125,quoteEvidence:"reviewed-inclusive-verified-customer-quote",
   key:"customer-byteplus-no-consent",media,
  }).id;
  store.bindStripeCheckout(id,"cs_test_dispatch_customer_noconsent");
  await store.webhook(new Uint8Array(),"signed",{async verify(){return {
   eventId:"evt_dispatch_customer_noconsent",provider:"stripe",orderId:id,cents:125,
   currency:"EUR" as const,evidence:"cs_test_dispatch_customer_noconsent"
  }}});
  networkCalls=0;
  await assert.rejects(dispatchReviewedCustomerBytePlus(store,id,review(),{
   RAILWAY_ENVIRONMENT_ID:STAGING,CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"true"
  }),/Early performance acknowledgement missing/);
  assert.equal(networkCalls,0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_provider_submissions WHERE order_id=?").get(id)?.n,0);
 }finally{store.close()}
});

test("P0: uncertain provider response reserves cost and cannot submit or charge again",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  store.db.prepare("INSERT INTO customer_accounts VALUES(?,?,?,?)").run(account,"buyer@example.test","test-hash",Date.now());
  const id=store.preparedVideoOrder({
   account,email:"buyer@example.test",project:"uncertain-provider-song",
   cents:125,quoteEvidence:"reviewed-inclusive-verified-customer-quote",
   key:"customer-byteplus-uncertain",media,
  }).id;
  store.recordEarlyPerformanceConsent(id,account);
  store.bindStripeCheckout(id,"cs_test_dispatch_customer_uncertain");
  await store.webhook(new Uint8Array(),"signed",{async verify(){return {
   eventId:"evt_dispatch_customer_uncertain",provider:"stripe",orderId:id,cents:125,
   currency:"EUR" as const,evidence:"cs_test_dispatch_customer_uncertain"
  }}});
  store.markContractConfirmationSent(id);
  let submits=0;
  const unavailable=review();
  unavailable.protocol=new BytePlusProtocol(async()=>{
   submits++;
   throw Error("Network response lost AFTER provider might have accepted");
  });
  const env={RAILWAY_ENVIRONMENT_ID:STAGING,CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"true"};
  assert.equal(await dispatchReviewedCustomerBytePlus(store,id,unavailable,env),"submission-uncertain");
  assert.equal(await dispatchReviewedCustomerBytePlus(store,id,unavailable,env),"already-claimed");
  assert.equal(submits,1);
  assert.equal(store.paidSubmissionStatus(id),"submitted_or_unknown");
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_provider_cost_reservations WHERE order_id=?").get(id)?.n,1);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_provider_submissions WHERE order_id=?").get(id)?.n,1);
 }finally{store.close()}
});
