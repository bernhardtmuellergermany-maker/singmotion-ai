import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {CreditWallet,stripeCreditTopupsTestEnabled,stripeCreditTopupsLiveEnabled} from "../lib/commerce/credit-wallet.ts";

const safeEnv={RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041",
 STRIPE_CREDIT_TOPUPS_TEST_ENABLED:"true",
 STRIPE_SECRET_KEY:"sk_test_mock",STRIPE_WEBHOOK_SECRET:"whsec_mock"};
test("only staging with a Test secret may sell test credits",()=>{
 assert.equal(stripeCreditTopupsTestEnabled(safeEnv),true);
 for(const change of [
  {RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d"},
  {STRIPE_CREDIT_TOPUPS_TEST_ENABLED:"false"},
  {STRIPE_SECRET_KEY:"sk_live_mock"},
  {STRIPE_WEBHOOK_SECRET:""}
 ]) assert.equal(stripeCreditTopupsTestEnabled({...safeEnv,...change}),false);
});
test("real wallet binds one account and settles confirmed payment exactly once",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  const w=new CreditWallet(db);
  const alice={subject:"customer:alice",email:"alice@example.test",customerId:"alice"};
  const admin={subject:"super-admin:123",email:"admin@example.test",customerId:null};
  const key=randomUUID();
  const p=w.pending(alice,2357,key);
  assert.equal(p.cents,2357);
  assert.equal(w.pending(alice,2357,key).id,p.id);
  assert.throws(()=>w.pending(admin,2357,key),/idempotency conflict/);
  assert.throws(()=>w.pending(alice,999,key),/idempotency conflict/);
  assert.throws(()=>w.bind(p.id,"cs_bad","https://checkout.stripe.com/test"),/Invalid Stripe/);
  w.bind(p.id,"cs_test_safe123","https://checkout.stripe.com/c/pay/safe");
  const paid={id:p.id,sessionId:"cs_test_safe123",amount:2357,currency:"eur",paymentStatus:"paid",livemode:false};
  assert.throws(()=>w.settle({...paid,paymentStatus:"unpaid"}),/mismatch/);
  assert.throws(()=>w.settle({...paid,amount:999}),/mismatch/);
  assert.equal(w.total(alice.subject),0);
  assert.equal(w.settle(paid),true);
  assert.equal(w.settle(paid),false);
  assert.equal(w.total(alice.subject),2357);
  assert.equal(w.total(admin.subject),0);
  assert.equal(w.entries(alice.subject).length,1);
  assert.throws(()=>w.reverse({sessionId:"cs_test_safe123",amount:2300,currency:"eur",livemode:false,kind:"refund"}),/mismatch/);
  assert.equal(w.reverse({sessionId:"cs_test_safe123",amount:2357,currency:"eur",livemode:false,kind:"refund"}),true);
  assert.equal(w.reverse({sessionId:"cs_test_safe123",amount:2357,currency:"eur",livemode:false,kind:"dispute"}),false);
  assert.equal(w.total(alice.subject),0);
  assert.equal(w.entries(alice.subject).length,2);
 }finally{db.close();}
});
test("out-of-range and fractional credit purchases cannot enter the ledger",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  const w=new CreditWallet(db),identity={subject:"customer:123",email:"a@example.test",customerId:"123"};
  for(const n of [0,499,100001,1.5,NaN])assert.throws(()=>w.pending(identity,n,randomUUID()),/Invalid credit amount/);
 }finally{db.close();}
});
test("video credits are held before provider submission, billed once only after verified output",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  const w=new CreditWallet(db);
  const admin={subject:"super-admin:42",email:"admin@example.test",customerId:null};
  const customer={subject:"customer:alice",email:"alice@example.test",customerId:"alice"};
  const topup=w.pending(admin,500,randomUUID());
  w.bind(topup.id,"cs_test_video500","https://checkout.stripe.com/c/pay/video");
  w.settle({id:topup.id,sessionId:"cs_test_video500",amount:500,currency:"eur",paymentStatus:"paid",livemode:false});
  const job=randomUUID(),another=randomUUID(),unpaid=randomUUID();
  assert.equal(w.total(admin.subject),500);
  assert.equal(w.available(admin.subject),500);
  assert.throws(()=>w.reserveVideo(job,customer.subject,125),/Insufficient video credits/);
  assert.equal(w.reserveVideo(job,admin.subject,125).state,"reserved");
  assert.equal(w.reserveVideo(job,admin.subject,125).state,"reserved");
  assert.throws(()=>w.reserveVideo(job,admin.subject,150),/conflict/);
  assert.throws(()=>w.reserveVideo(job,customer.subject,125),/conflict/);
  assert.equal(w.reserved(admin.subject),125);
  assert.equal(w.total(admin.subject),500,"reserving must not record a completed spend");
  assert.equal(w.available(admin.subject),375);
  assert.throws(()=>w.reserveVideo(another,admin.subject,376),/Insufficient video credits/);
  assert.equal(w.reconcileVideo(job,"review")?.state,"review");
  assert.equal(w.reserved(admin.subject),125,"uncertain provider response retains hold");
  assert.equal(w.reconcileVideo(job,"completed")?.state,"settled");
  assert.equal(w.reconcileVideo(job,"completed")?.state,"settled","duplicate webhook or page refresh must not recharge");
  assert.equal(w.reserved(admin.subject),0);
  assert.equal(w.total(admin.subject),375);
  assert.equal(w.available(admin.subject),375);
  assert.equal(w.entries(admin.subject).filter(x=>x.type==="video").length,1);
  assert.equal(w.entries(admin.subject).find(x=>x.type==="video")?.credits,-125);
  assert.equal(w.reconcileVideo(unpaid,"completed"),null,"historical uncharged tasks remain uncharged");
  assert.equal(w.total(admin.subject),375);
  assert.throws(()=>w.reserveVideo(job,admin.subject,125),/final/);
  assert.equal(w.available(customer.subject),0,"staff and customer wallets remain isolated");
 }finally{db.close();}
});
test("nonbillable provider prefilter rejection releases Credits, uncertain failure does not",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  const w=new CreditWallet(db),identity={subject:"customer:c1",email:"customer@example.test",customerId:"c1"};
  const purchase=w.pending(identity,500,randomUUID());
  w.bind(purchase.id,"cs_test_refundA","https://checkout.stripe.com/c/pay/release");
  w.settle({id:purchase.id,sessionId:"cs_test_refundA",amount:500,currency:"eur",paymentStatus:"paid",livemode:false});
  const job=randomUUID();w.reserveVideo(job,identity.subject,150);
  assert.equal(w.available(identity.subject),350);
  assert.equal(w.reconcileVideo(job,"review")?.state,"review");
  assert.equal(w.available(identity.subject),350);
  assert.equal(w.reconcileVideo(job,"nonbillable")?.state,"released");
  assert.equal(w.reconcileVideo(job,"nonbillable")?.state,"released");
  assert.equal(w.total(identity.subject),500);
  assert.equal(w.reserved(identity.subject),0);
  assert.equal(w.available(identity.subject),500);
  assert.equal(w.entries(identity.subject).filter(x=>x.type==="video-release").length,1);
 }finally{db.close();}
});

test("live credit purchases require independent reviewed billing, tax and launch switches",()=>{
 const approved={
  RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
  STRIPE_CREDIT_TOPUPS_LIVE_ENABLED:"true",STRIPE_LIVE_CHECKOUT_ENABLED:"true",
  PUBLIC_CUSTOMER_LAUNCH_APPROVED:"true",STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED:"true",
  CREDIT_TAX_WORLDWIDE_REVIEW_APPROVED:"true",
  CREDIT_TAX_COUNTRY_POLICY_JSON:JSON.stringify({revision:"fixture-2026",reviewedAt:new Date().toISOString().slice(0,10),entries:[{
   country:"DE",buyerType:"consumer",voucherKind:"single-purpose",mode:"de-small-business",
   evidence:"Synthetic domestic voucher review with accountant, for tests only"
  }]}),
  STRIPE_SECRET_KEY:"sk_live_mock",STRIPE_WEBHOOK_SECRET:"whsec_mock"
 };
 assert.equal(stripeCreditTopupsLiveEnabled(approved),true);
 for(const change of [
  {RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041"},
  {STRIPE_CREDIT_TOPUPS_LIVE_ENABLED:"false"},
  {STRIPE_LIVE_CHECKOUT_ENABLED:"false"},
  {PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false"},
  {STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED:"false"},
  {CREDIT_TAX_WORLDWIDE_REVIEW_APPROVED:"false"},
  {CREDIT_TAX_COUNTRY_POLICY_JSON:""},
  {STRIPE_SECRET_KEY:"sk_test_mock"},
  {STRIPE_WEBHOOK_SECRET:""},
 ])assert.equal(stripeCreditTopupsLiveEnabled({...approved,...change}),false);
});
test("live Stripe credit payment is account bound, settles once and reverses once",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  const wallet=new CreditWallet(db);
  const identity={subject:"customer:live-customer",email:"live@example.test",customerId:"live-customer"};
  const purchase=wallet.pending(identity,1500,randomUUID());
  wallet.bind(purchase.id,"cs_live_valid123","https://checkout.stripe.com/c/pay/live");
  const paid={id:purchase.id,sessionId:"cs_live_valid123",amount:purchase.cents,
   currency:"eur",paymentStatus:"paid",livemode:true};
  assert.throws(()=>wallet.settle({...paid,livemode:false}),/mismatch/);
  assert.equal(wallet.settle(paid),true);
  assert.equal(wallet.settle(paid),false);
  assert.equal(wallet.total(identity.subject),1500);
  assert.throws(()=>wallet.reverse({sessionId:paid.sessionId,amount:paid.amount,
   currency:"eur",livemode:false,kind:"refund"}),/mismatch/);
  assert.equal(wallet.reverse({sessionId:paid.sessionId,amount:paid.amount,
   currency:"eur",livemode:true,kind:"refund"}),true);
  assert.equal(wallet.total(identity.subject),0);
 }finally{db.close();}
});

test("terminal provider failure returns reserved Credits as goodwill exactly once; uncertain failures retain holds",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  const wallet=new CreditWallet(db),owner="customer:retry-owner";
  const pending=wallet.pending({subject:owner,email:"refund@example.test",customerId:"retry-owner"},500,randomUUID());
  wallet.bind(pending.id,"cs_test_service_failure","https://checkout.stripe.com/c/offline");
  wallet.settle({id:pending.id,sessionId:"cs_test_service_failure",amount:500,currency:"eur",paymentStatus:"paid",livemode:false});
  const job=randomUUID(),unknown=randomUUID();
  wallet.reserveVideo(job,owner,150);
  wallet.reserveVideo(unknown,owner,125);
  assert.equal(wallet.available(owner),225);
  wallet.reconcileVideo(unknown,"review");
  assert.equal(wallet.available(owner),225);
  assert.equal(wallet.reconcileVideo(job,"service-failed")?.state,"released");
  assert.equal(wallet.reconcileVideo(job,"service-failed")?.state,"released");
  assert.equal(wallet.available(owner),375);
  assert.equal(wallet.reserved(owner),125);
  assert.equal(wallet.total(owner),500);
  assert.equal(wallet.entries(owner).filter(e=>e.type==="video-service-refund"&&e.reference==="video-service-refund:"+job).length,1);
 }finally{db.close()}
});
