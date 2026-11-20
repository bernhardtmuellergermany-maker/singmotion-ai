import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {CommerceStore} from "../lib/commerce/store.ts";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {ManualCreditGifts,manualGiftEnabled} from "../lib/commerce/manual-credit-gifts.ts";
const staging={
 CMS_ENABLED:"true",RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041",
 ADMIN_MANUAL_CREDITS_ENABLED:"true",
 ADMIN_MANUAL_CREDITS_MAX_GRANT:"5000",
 ADMIN_MANUAL_CREDITS_ACTOR_DAILY_LIMIT:"3000",
 ADMIN_MANUAL_CREDITS_GLOBAL_DAILY_LIMIT:"5000",
 CUSTOMER_BETA_WELCOME_CREDITS_ENABLED:"false",
};
test("manual gift permissions fail closed outside approved environment",()=>{
 assert.equal(manualGiftEnabled(staging),true);
 assert.equal(manualGiftEnabled({...staging,ADMIN_MANUAL_CREDITS_ENABLED:"false"}),false);
 assert.equal(manualGiftEnabled({...staging,RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d"}),false);
 assert.equal(manualGiftEnabled({...staging,RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",ADMIN_MANUAL_CREDITS_PRODUCTION_APPROVED:"true"}),true);
});
test("single customer gifts are atomic, idempotent, audited and never Stripe top-ups",()=>{
 const store=new CommerceStore(":memory:",staging);
 try{
  const alice=store.register("alice@example.test","securepassword123"),
   bob=store.register("bob@example.test","securepassword789");
  const gifts=new ManualCreditGifts(store.db,staging),wallet=new CreditWallet(store.db);
  const requestKey=randomUUID();
  const grant={customerId:alice,credits:1000,reason:"welcome" as const,actor:"owner",requestKey};
  const first=gifts.grant(grant);
  assert.equal(first.gift.credits,1000);assert.equal(first.replayed,false);
  assert.equal(first.availableCredits,1000);
  assert.equal(gifts.grant(grant).gift.id,first.gift.id);
  assert.equal(gifts.grant(grant).replayed,true);
  assert.throws(()=>gifts.grant({...grant,credits:500}),/Idempotenzkonflikt/);
  assert.throws(()=>gifts.grant({...grant,customerId:bob}),/Idempotenzkonflikt/);
  assert.equal(wallet.total("customer:"+alice),1000);
  assert.equal(wallet.total("customer:"+bob),0);
  assert.equal(wallet.entries("customer:"+alice).filter(x=>x.type==="manual-gift").length,1);
  assert.equal(gifts.summary().referenceValueCents,1000,"book value is not Stripe revenue");
  assert.equal(Number((store.db.prepare("SELECT COUNT(*) n FROM credit_topup_purchases")
   .get() as {n:number}).n),0);
  assert.equal(Number((store.db.prepare("SELECT COUNT(*) n FROM commerce_audit WHERE action='manual-credit-gift'")
   .get() as {n:number}).n),1);
 }finally{store.close()}
});
test("gifts enforce validated accounts, integer counts and rolling budgets",()=>{
 const store=new CommerceStore(":memory:",staging);
 try{
  const id=store.register("limited@example.test","securepassword123"),
   gifts=new ManualCreditGifts(store.db,staging);
  const valid=(credits:number)=>({customerId:id,credits,actor:"owner",reason:"marketing" as const,requestKey:randomUUID()});
  for(const invalid of [0,-100,1.2,NaN,6000])
   assert.throws(()=>gifts.grant(valid(invalid)));
  assert.throws(()=>gifts.grant({...valid(100),customerId:randomUUID()}),/nicht gefunden/);
  assert.equal(gifts.grant(valid(500)).gift.credits,500);
  assert.equal(gifts.grant(valid(1000)).gift.credits,1000);
  assert.equal(gifts.grant(valid(1000)).gift.credits,1000);
  assert.throws(()=>gifts.grant(valid(1000)),/Tägliches Vergabebudget/);
  assert.equal(gifts.list(id).length,3);
 }finally{store.close()}
});
test("corrections create a separate negative ledger row only if available balance permits",()=>{
 const store=new CommerceStore(":memory:",staging);
 try{
  const id=store.register("correction@example.test","securepassword123"),
   gifts=new ManualCreditGifts(store.db,staging),wallet=new CreditWallet(store.db);
  const gift=gifts.grant({customerId:id,credits:500,reason:"goodwill",actor:"owner",requestKey:randomUUID()}).gift;
  const project=randomUUID();
  wallet.reserveVideo(project,"customer:"+id,125);
  assert.throws(()=>gifts.correct({giftId:gift.id,actor:"owner",reason:"Documented administrative duplicate request",requestKey:randomUUID()}),/reserviert/);
  assert.equal(wallet.total("customer:"+id),500);
  wallet.reconcileVideo(project,"nonbillable");
  const requestKey=randomUUID();
  const input={giftId:gift.id,actor:"owner",reason:"Documented administrative duplicate request",requestKey};
  assert.equal(gifts.correct(input).availableCredits,0);
  assert.equal(gifts.correct(input).replayed,true);
  assert.equal(gifts.list(id)[0].reversedAt!==null,true);
  assert.equal(wallet.entries("customer:"+id).filter(x=>x.type==="manual-gift-correction").length,1);
  assert.throws(()=>gifts.correct({...input,requestKey:randomUUID()}),/bereits korrigiert/);
 }finally{store.close()}
});
