import {test} from "node:test";
import assert from "node:assert/strict";
import {CommerceStore} from "../lib/commerce/store.ts";

const review={
 inclusiveMaxMicroUsd:700_000,
 dailyCapMicroUsd:1_400_000,
 lifetimeCapMicroUsd:2_100_000,
 reviewEvidence:"independently-reviewed-inclusive-byteplus-ceiling-2026",
};
async function paid(store:CommerceStore,index:number){
 const account=store.register(`customer${index}@example.test`,`a correct secure password for customer ${index} 2026`);
 const id=store.order({account,email:`customer${index}@example.test`,project:`customer-${index}`,
  cents:1250,quoteEvidence:"reviewed-server-quote-for-real-customer",
  key:`paid-budget-${index}`}).id;
 store.bindStripeCheckout(id,`cs_test_paid_budget_${index}`);
 await store.webhook(new Uint8Array(),"signed",{async verify(){return {
  provider:"stripe",eventId:`evt_budget_${index}`,orderId:id,cents:1250,
  currency:"EUR" as const,evidence:`cs_test_paid_budget_${index}`
 }}});
 assert.equal(store.claimPaidFulfillment(id),true);
 return id;
}

test("provider budgets reserve once across two different customer accounts",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const first=await paid(store,1);
  const second=await paid(store,2);
  const third=await paid(store,3);
  assert.equal(store.reservePaidProviderSpend(first,review),true);
  assert.equal(store.reservePaidProviderSpend(first,review),false);
  assert.equal(store.reservePaidProviderSpend(second,review),true);
  assert.throws(()=>store.reservePaidProviderSpend(third,review),/budget exhausted/);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_provider_cost_reservations").get()?.n,2);
  assert.equal(store.paidSubmissionStatus(third),null);
  assert.equal(store.paidProviderJob(third),null);
 }finally{store.close()}
});

test("budget policy rejects fake approval, oversized requests and changed per-order cost",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const id=await paid(store,4);
  for(const policy of [
   {...review,reviewEvidence:""},
   {...review,inclusiveMaxMicroUsd:0},
   {...review,inclusiveMaxMicroUsd:1_500_000},
   {...review,dailyCapMicroUsd:0},
   {...review,lifetimeCapMicroUsd:Number.MAX_SAFE_INTEGER},
  ])assert.throws(()=>store.reservePaidProviderSpend(id,policy),/policy required/);
  assert.equal(store.reservePaidProviderSpend(id,review),true);
  assert.throws(()=>store.reservePaidProviderSpend(id,{...review,reviewEvidence:"different-verified-published-review-evidence"}),/conflict/);
  assert.throws(()=>store.reservePaidProviderSpend(id,{...review,inclusiveMaxMicroUsd:600000}),/conflict/);
 }finally{store.close()}
});

test("unpaid and unclaimed orders never reserve provider spending",()=>{
 const store=new CommerceStore(":memory:");
 try{
  const id=store.order({account:null,email:"guest@example.test",project:"unpaid",
   cents:1250,quoteEvidence:"reviewed-customer-invoice-2026",key:"unpaid-budget"}).id;
  assert.throws(()=>store.reservePaidProviderSpend(id,review),/paid order claim/);
  const count=store.db.prepare("SELECT COUNT(*) AS n FROM customer_provider_cost_reservations").get()?.n;
  assert.equal(count,0);
 }finally{store.close()}
});

test("uncertain provider submission retains its cost reservation permanently",async()=>{
 const store=new CommerceStore(":memory:");
 try{
  const id=await paid(store,5);
  store.reservePaidProviderSpend(id,review);
  assert.equal(store.beginPaidProviderSubmission(id),true);
  assert.equal(store.beginPaidProviderSubmission(id),false);
  assert.equal(store.paidSubmissionStatus(id),"submitted_or_unknown");
  const count=store.db.prepare("SELECT COUNT(*) AS n FROM customer_provider_cost_reservations WHERE order_id=?").get(id);
  assert.equal(count?.n,1);
  assert.equal(store.claimPaidFulfillment(id),false);
 }finally{store.close()}
});
