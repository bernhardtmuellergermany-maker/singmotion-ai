import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {CampaignPricing,campaignsEnabled,regularTariff} from "../lib/commerce/campaign-pricing.ts";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {quoteVideoCredits} from "../lib/commerce/video-credit-quote.ts";

const valid=(name="black-week")=>({
 identifier:name,status:"active" as const,
 startUtc:Date.now()-60_000,endUtc:Date.now()+86400000,
 creditsPerSecond:12,badgeText:"BLACK WEEK",heading:"Black Week",
 description:"Short sale",actionHint:"",ctaText:"Generate",
 theme:"purple" as const,accent:"#af65ef",showBadge:true,showBanner:true,
 comparisonEvidence:null,maxCustomerGenerations:1,maxCampaignCredits:100,
});
test("campaign feature flags require explicit environment-specific approval",()=>{
 const env={CMS_ENABLED:"true",ADMIN_CAMPAIGNS_ENABLED:"true",RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041"};
 assert.equal(campaignsEnabled(env),true);
 assert.equal(campaignsEnabled({...env,RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d"}),false);
 assert.equal(campaignsEnabled({...env,RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",ADMIN_CAMPAIGNS_PRODUCTION_APPROVED:"true"}),true);
 assert.equal(campaignsEnabled({...env,ADMIN_CAMPAIGNS_ENABLED:"false"}),false);
});
test("pricing is versioned, scheduled, exclusive, correct and safely returns to regular",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec("CREATE TABLE commerce_audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,record TEXT NOT NULL,created INTEGER NOT NULL)");
  const pricing=new CampaignPricing(db);
  assert.equal(pricing.active().creditsPerSecond,25);
  const first=pricing.save(valid(),"admin");
  assert.equal(pricing.active().version,"campaign:"+first.id+":v1");
  assert.equal(pricing.active().creditsPerSecond,12);
  assert.equal(quoteVideoCredits(0,5.1,pricing.active().creditsPerSecond)?.credits,72);
  assert.equal(quoteVideoCredits(0,5.1)?.credits,150);
  assert.equal(pricing.active().discountPercent,null,"do not show unsupported comparative claims");
  assert.throws(()=>pricing.save(valid("holiday-sale"),"admin"),/überschneiden/);
  assert.throws(()=>pricing.save({...valid(),id:first.id,creditsPerSecond:9},"admin",5),/inzwischen geändert/);
  const revised=pricing.save({...first,creditsPerSecond:9},"admin",first.revision);
  assert.equal(revised.revision,2);
  assert.equal(pricing.versions(first.id).length,2);
  assert.equal(pricing.active().version,"campaign:"+first.id+":v2");
  assert.equal(pricing.active().creditsPerSecond,9);
  pricing.save({...revised,status:"paused"},"admin",revised.revision);
  assert.deepEqual(pricing.active(),regularTariff());
  assert.equal(pricing.list()[0].effectiveStatus,"paused");
  assert.throws(()=>pricing.save({...valid("bad-rate"),creditsPerSecond:35},"admin"),/preis|Kampagnenpreis/i);
 }finally{db.close()}
});
test("Wallet holds enforce exact campaign version, global credit budget and customer usage",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec("CREATE TABLE commerce_audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,record TEXT NOT NULL,created INTEGER NOT NULL)");
  const wallet=new CreditWallet(db),pricing=new CampaignPricing(db);
  const campaign=pricing.save(valid(),"admin");
  for(const subject of ["customer:user-a","customer:user-b"]){
   const purchase=wallet.pending({subject,email:"holder@example.test",customerId:"holder"},500,randomUUID());
   const session="cs_test_"+randomUUID().replaceAll("-","");
   wallet.bind(purchase.id,session,"https://checkout.stripe.com/c/pay/valid");
   wallet.settle({id:purchase.id,sessionId:session,amount:500,currency:"eur",paymentStatus:"paid",livemode:false});
  }
  const tariff=pricing.active(),project=randomUUID();
  const snapshot={version:tariff.version,creditsPerSecond:tariff.creditsPerSecond,
   startedSeconds:5,campaignId:tariff.campaignId};
  wallet.reserveVideo(project,"customer:user-a",60,snapshot);
  assert.equal(wallet.reserveVideo(project,"customer:user-a",60,snapshot).state,"reserved");
  assert.throws(()=>wallet.reserveVideo(project,"customer:user-a",60,{...snapshot,version:"regular-v1"}),/conflict/);
  assert.throws(()=>wallet.reserveVideo(randomUUID(),"customer:user-a",60,snapshot),/usage limit/);
  assert.throws(()=>wallet.reserveVideo(randomUUID(),"customer:user-b",60,snapshot),/budget exhausted/);
  wallet.reconcileVideo(project,"completed");
  assert.equal(pricing.stats(campaign.id).settledGenerations,1);
  assert.equal(pricing.stats(campaign.id).settledSeconds,5);
  assert.equal(pricing.stats(campaign.id).discountCredits,65);
  assert.equal(wallet.entries("customer:user-a").filter(e=>e.type==="video").length,1);
  const changed=pricing.save({...campaign,creditsPerSecond:9},"admin",campaign.revision);
  assert.equal(changed.revision,2);
  assert.throws(()=>wallet.reserveVideo(randomUUID(),"customer:user-b",60,snapshot),/expired or changed/);
 }finally{db.close()}
});
