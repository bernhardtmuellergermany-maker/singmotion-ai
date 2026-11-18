import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync,mkdtempSync,rmSync,symlinkSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {CommerceStore} from "../lib/commerce/store.ts";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {
 customerInsightsSummary,customerInsight,customerInsightProfile,
 listCustomerInsights,openCustomerInsightsReadOnly,
} from "../lib/commerce/customer-insights.ts";

const read=(file:string)=>readFileSync(new URL("../"+file,import.meta.url),"utf8");

test("Customer Insights shows only real account-owned wallet, orders and verified video transactions",()=>{
 const store=new CommerceStore(":memory:",{CUSTOMER_BETA_WELCOME_CREDITS_ENABLED:"false"});
 try{
  const id=store.register("buyer@example.test","securepassword123");
  const other=store.register("another@example.test","securepassword456");
  const wallet=new CreditWallet(store.db);
  const subject="customer:"+id;
  const topup=wallet.pending({subject,email:"buyer@example.test",customerId:id},1000,randomUUID());
  wallet.bind(topup.id,"cs_test_customerinsights123","https://checkout.stripe.com/c/pay/customer-insights");
  assert.equal(wallet.settle({
   id:topup.id,sessionId:"cs_test_customerinsights123",amount:1000,
   currency:"eur",paymentStatus:"paid",livemode:false,
  }),true);
  store.db.prepare(`INSERT INTO credit_wallet_ledger
   (id,subject,delta,kind,reference,created) VALUES(?, ?, 250, 'beta-welcome', ?, ?)`)
   .run("gift:"+id,subject,"beta-welcome:"+id,Date.now());
  const settled=randomUUID(),review=randomUUID();
  wallet.reserveVideo(settled,subject,250);
  wallet.reconcileVideo(settled,"completed");
  wallet.reserveVideo(review,subject,100);
  wallet.reconcileVideo(review,"review");
  const orderId=randomUUID();
  store.db.prepare(`INSERT INTO customer_orders
   (id,account_id,guest_hash,guest_expiry,email,project_id,price_cents,currency,status,quote_evidence,request_key,created)
   VALUES(?,?,NULL,NULL,?, ?,800,'EUR','paid','synthetic-test',?,?)`)
   .run(orderId,id,"buyer@example.test",randomUUID(),randomUUID(),Date.now());
  store.db.prepare(`INSERT INTO customer_video_deliveries
   (order_id,asset_id,evidence_hash,created) VALUES (?,?,?,?)`)
   .run(orderId,randomUUID(),"synthetic-evidence",Date.now());
  store.db.prepare(`INSERT INTO customer_stripe_refunds
   (order_id,refund_id,amount_cents,created) VALUES (?,?,100,?)`)
   .run(orderId,"re_synthetic",Date.now());
  const buyer=customerInsight(store.db,id);
  assert.ok(buyer);
  assert.equal(buyer.email,"buyer@example.test");
  assert.equal(buyer.orders,1);
  assert.equal(buyer.videos,2);
  assert.equal(buyer.creditVideos,1);
  assert.equal(buyer.historicalVideos,1);
  assert.equal(buyer.boughtCredits,1000);
  assert.equal(buyer.promotionalCredits,250);
  assert.equal(buyer.availableCredits,900);
  assert.equal(buyer.reservedCredits,100);
  assert.equal(buyer.creditsSpent,250);
  assert.equal(buyer.topupCents,1000);
  assert.equal(buyer.legacyGrossCents,800);
  assert.equal(buyer.knownRefundCents,100);
  const empty=customerInsight(store.db,other);
  assert.ok(empty);
  assert.equal(empty.availableCredits,0);
  assert.equal(empty.videos,0);
  assert.equal(empty.topupCents,0);
  const summary=customerInsightsSummary(store.db);
  assert.equal(summary.customers,2);
  assert.equal(summary.creditTopupCents,1000);
  assert.equal(summary.knownRefundCents,100);
  assert.equal(summary.creditVideos,1);
  assert.equal(summary.historicalVideos,1);
  assert.equal(summary.creditsReserved,100);
  assert.equal(summary.verifiedVideoResults,2);
  const profile=customerInsightProfile(store.db,id);
  assert.ok(profile);
  assert.ok(profile.events.some(e=>e.kind==="video"&&e.status==="settled"));
  assert.ok(profile.events.some(e=>e.kind==="credit-topup"&&e.status==="paid"));
  assert.ok(profile.events.some(e=>e.kind==="order"&&e.reference===orderId));
  assert.ok(!("passwordHash" in buyer));
  assert.ok(!("stripeSessionId" in buyer));
  assert.equal(customerInsightProfile(store.db,other)?.events.length,0);
 }finally{store.close();}
});

test("Customer Insights paginates and searches on the server, without returning unrelated customer identities",()=>{
 const store=new CommerceStore(":memory:",{CUSTOMER_BETA_WELCOME_CREDITS_ENABLED:"false"});
 try{
  const jane=store.register("jane@example.test","somepassword123");
  store.register("joe@example.test","somepassword456");
  const filtered=listCustomerInsights(store.db,{search:"Jane",page:1});
  assert.equal(filtered.total,1);
  assert.equal(filtered.rows[0]?.id,jane);
  assert.equal(filtered.rows[0]?.email,"jane@example.test");
  assert.equal(filtered.hasNext,false);
  assert.equal(listCustomerInsights(store.db,{search:"no-such-person",page:1}).total,0);
  assert.equal(listCustomerInsights(store.db,{search:"",page:999}).rows.length,0);
  assert.equal(listCustomerInsights(store.db,{search:jane,page:1}).rows[0]?.id,jane);
  assert.equal(customerInsight(store.db,"../../etc/passwd"),null);
 }finally{store.close();}
});

test("Customer Insights opens only an existing regular file read-only (no database writes)",()=>{
 const tmp=mkdtempSync(path.join(os.tmpdir(),"sm-insights-test-"));
 let store:CommerceStore|undefined;
 try{
  store=new CommerceStore(path.join(tmp,"commerce.sqlite"),{CUSTOMER_BETA_WELCOME_CREDITS_ENABLED:"false"});
  const id=store.register("readonly@example.test","somepassword123");
  store.close();store=undefined;
  const db=openCustomerInsightsReadOnly(tmp);
  try{
   assert.equal(customerInsight(db,id)?.email,"readonly@example.test");
   assert.throws(()=>db.exec("CREATE TABLE forbidden(id TEXT)"));
  }finally{db.close()}
  const link=path.join(tmp,"link");
  symlinkSync(path.join(tmp,"commerce.sqlite"),link);
  assert.throws(()=>openCustomerInsightsReadOnly(link));
 }finally{store?.close();rmSync(tmp,{recursive:true,force:true})}
});

test("CMS UI and API require real Payload Super Admin role; no marketing or browser tracking added",()=>{
 const api=read("app/(site)/api/customer-insights/route.ts");
 const view=read("components/cms/customer-insights-view.tsx");
 const config=read("cms/config.ts");
 const client=read("components/cms/customer-insights-client.tsx");
 const sql=read("lib/commerce/customer-insights.ts");
 assert.match(api,/await payload\.auth\(\{headers:req\.headers\}\)/);
 assert.match(api,/hasRole\(user,\["super-admin"\]\)/);
 assert.match(api,/overrideAccess:true/);
 assert.match(api,/collection:"audit-events"/);
 assert.match(api,/no-store/);
 assert.match(view,/hasRole\(initPageResult\.req\.user,\["super-admin"\]\)/);
 assert.match(config,/path: "\/customer-insights"/);
 assert.match(sql,/new DatabaseSync\(file,\{readOnly:true\}\)/);
 assert.doesNotMatch(sql,/ALTER TABLE|CREATE TABLE|UPDATE customer_accounts|DELETE FROM customer_accounts/);
 assert.doesNotMatch(client,/localStorage\.setItem|document\.cookie|navigator\.geolocation|sendBeacon|gtag\(/);
 assert.match(client,/Marketing-Einwilligung/);
 assert.match(client,/Nicht erfasst/);
});
