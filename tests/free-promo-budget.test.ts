import {test} from "node:test";
import assert from "node:assert/strict";
import {CommerceStore} from "../lib/commerce/store.ts";
import {PromotionLedger} from "../lib/commerce/promotions.ts";
import {FreePromoBudgetLedger,signOperatorFreePromoApproval} from "../lib/commerce/free-promo-budget.ts";
import type {PreparedMedia} from "../lib/live/store.ts";

const secret="dedicated-free-promo-operator-authorization-secret-very-long";
const now=Date.parse("2026-11-04T12:00:00.000Z");
const budget={perJobMicroUsd:100000,rollingDayMicroUsd:150000,lifetimeMicroUsd:250000};
function setup(){
 const store=new CommerceStore(":memory:");
 const account=store.register("freebudget@example.test","long-unique-test-password-12345");
 const promo=new PromotionLedger(store.db);
 promo.create({code:"TRIPLEFREE",kind:"free_videos",freeVideos:3,maxVideoSeconds:10,
  startsAt:"2026-10-01T00:00:00.000Z",endsAt:"2026-12-31T00:00:00.000Z",maxUses:10},now);
 const ledger=new FreePromoBudgetLedger(store.db);
 function order(index:number,durationSeconds=8.2){
  const media={owner:"customer-"+account,sourceJobId:"draft-promo-"+index,
   audioPath:"/private/audio.mp3",imagePath:"/private/image.png",
   audioSha256:"a".repeat(64),imageSha256:"b".repeat(64),durationSeconds,
   prompt:"Reviewed English performance.",outputFormat:"9:16",
   promptLanguageConfirmed:true} as PreparedMedia;
  return store.preparedVideoOrder({account,email:"freebudget@example.test",
   project:"promo-project-"+index,cents:0,originalCents:Math.ceil(durationSeconds)*25,
   promoCode:"TRIPLEFREE",quoteEvidence:"reviewed-zero-eur-studio-quote-"+index,
   key:"free-authorization-order-"+index,media}).id;
 }
 const approval=(orderId:string,maxMicroUsd=100000)=>signOperatorFreePromoApproval(
  {orderId,accountId:account,maxMicroUsd,expiresAt:now+300000},secret);
 return {store,account,promo,ledger,order,approval};
}
test("signed cost approval reserves once without fabricating a Stripe payment or provider job",()=>{
 const x=setup();
 try{
  const id=x.order(1),a=x.approval(id);
  assert.deepEqual(x.ledger.authorize(a,secret,budget,now),
    {orderId:id,accountId:x.account,reservedMicroUsd:100000,state:"authorized"});
  assert.deepEqual(x.ledger.authorize(a,secret,budget,now),
    {orderId:id,accountId:x.account,reservedMicroUsd:100000,state:"authorized"});
  assert.equal((x.store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(id) as {status:string}).status,"awaiting_payment");
  assert.equal(x.store.pendingPaidFulfillment().length,0);
  assert.equal(x.store.db.prepare("SELECT * FROM customer_fulfillment_queue WHERE order_id=?").get(id),undefined);
  assert.equal(x.promo.list()[0].reserved,1);
  assert.throws(()=>x.store.cancelUnstartedCustomerOrder(id,x.account),/manual reconciliation/);
 }finally{x.store.close()}
});
test("forged, wrong-account, expired approvals and altered cost cannot reserve",()=>{
 const x=setup();
 try{
  const id=x.order(2),approval=x.approval(id);
  assert.throws(()=>x.ledger.authorize({...approval,signature:"0".repeat(64)},secret,budget,now),/forged/);
  assert.throws(()=>x.ledger.authorize({...approval,accountId:"22222222-2222-4222-8222-222222222222"},secret,budget,now),/forged/);
  assert.throws(()=>x.ledger.authorize(approval,secret,budget,now+400000),/expired/);
  assert.throws(()=>x.ledger.authorize(x.approval(id,200000),secret,budget,now),/per-job/);
  assert.equal((x.store.db.prepare("SELECT COUNT(*) AS n FROM free_promo_budget_authorizations").get() as {n:number}).n,0);
 }finally{x.store.close()}
});
test("rolling daily budget refuses second order and does not release the promo or alter payment",()=>{
 const x=setup();
 try{
  const a=x.order(3),b=x.order(4);
  x.ledger.authorize(x.approval(a),secret,budget,now);
  assert.throws(()=>x.ledger.authorize(x.approval(b),secret,budget,now),/ceiling/);
  assert.equal((x.store.db.prepare("SELECT COUNT(*) AS n FROM free_promo_budget_authorizations").get() as {n:number}).n,1);
  assert.equal(x.promo.list()[0].reserved,2);
  assert.equal((x.store.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(b) as {status:string}).status,"awaiting_payment");
 }finally{x.store.close()}
});
test("disabled promo never obtains provider cost authorization",()=>{
 const x=setup();
 try{
  const id=x.order(5);
  x.promo.setEnabled("TRIPLEFREE",false);
  assert.throws(()=>x.ledger.authorize(x.approval(id),secret,budget,now),/not eligible/);
 }finally{x.store.close()}
});
