import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {CreditWallet,stripeCreditTopupsTestEnabled} from "../lib/commerce/credit-wallet.ts";

const safeEnv={RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041",
 STRIPE_CREDIT_TOPUPS_TEST_ENABLED:"true",STRIPE_CHECKOUT_ENABLED:"true",
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
  assert.throws(()=>w.bind(p.id,"cs_live_bad","https://checkout.stripe.com/test"),/Invalid Stripe/);
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