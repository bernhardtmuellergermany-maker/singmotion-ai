import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {quoteCustomerErasureRefund} from "../lib/commerce/customer-erasure-refund-quote.ts";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
const accountId="11111111-1111-4111-8111-111111111111",subject="customer:"+accountId;
const session=(i:number)=>"cs_test_abcdefghi"+i;
function fixture(){
 const db=new DatabaseSync(":memory:");new CreditWallet(db);return db;
}
function paid(db:DatabaseSync,id:string,amount:number,created:number){
 db.prepare("INSERT INTO credit_topup_purchases(id,subject,email,credits,cents,status,request_key,stripe_session_id,created) VALUES(?,?,?, ?,?,'paid',?,?,?)")
  .run(id,subject,"owner@example.test",amount,amount,"req-"+id,session(created),created);
 db.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,?)")
  .run("credit-topup:"+id,subject,amount,"purchase","credit-topup:"+id,created);
}
function event(db:DatabaseSync,id:string,amount:number,kind:string){
 db.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,?)")
  .run(id,subject,amount,kind,id,Date.now());
}
test("refund plan is zero for accounts without wallet history and makes no schema",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  assert.equal(quoteCustomerErasureRefund(db,accountId).refundableCents,0);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='credit_wallet_ledger'").get(),undefined);
 }finally{db.close();}
});
test("bought Credits are returned at one cent each; bonus not refunded",()=>{
 const db=fixture();
 try{
  paid(db,"p1",1000,1);paid(db,"p2",500,2);
  event(db,"beta-welcome:v1:"+accountId,250,"beta-welcome");
  const quote=quoteCustomerErasureRefund(db,accountId);
  assert.equal(quote.ready,true);
  assert.equal(quote.refundableCents,1500);
  assert.equal(quote.freeCredits,250);
  assert.deepEqual(quote.lines.map(l=>l.cents),[500,1000]);
  event(db,"video-charge:a",-600,"video");
  const spent=quoteCustomerErasureRefund(db,accountId);
  assert.equal(spent.refundableCents,1150);
  assert.deepEqual(spent.lines.map(l=>l.cents),[500,650]);
 }finally{db.close();}
});
test("unsettled job, pending checkout, refund and malformed purchase all block payout",()=>{
 const db=fixture();
 try{
  paid(db,"p1",1000,1);
  db.prepare("INSERT INTO credit_video_reservations VALUES(?,?,?,'review',?,?)")
   .run("job-1",subject,50,1,1);
  assert.equal(quoteCustomerErasureRefund(db,accountId).reason,"unsettled-video");
  db.prepare("DELETE FROM credit_video_reservations").run();
  db.prepare("INSERT INTO credit_topup_purchases VALUES(?,?,?, ?,?,'pending',?,NULL,NULL,?,NULL)")
   .run("p2",subject,"owner@example.test",500,500,"req2",Date.now());
  assert.equal(quoteCustomerErasureRefund(db,accountId).reason,"pending-checkout");
  db.prepare("DELETE FROM credit_topup_purchases WHERE id='p2'").run();
  event(db,"manual-1",-100,"dispute");
  assert.equal(quoteCustomerErasureRefund(db,accountId).reason,"disputed-or-reversed");
  db.prepare("DELETE FROM credit_wallet_ledger WHERE kind='dispute'").run();
  db.prepare("UPDATE credit_topup_purchases SET stripe_session_id=NULL WHERE id='p1'").run();
  assert.equal(quoteCustomerErasureRefund(db,accountId).reason,"invalid-paid-purchase");
 }finally{db.close();}
});
test("a refund quote cannot infer paid balance from forged ledger entries",()=>{
 const db=fixture();
 try{
  event(db,"purchase-no-session",500,"purchase");
  assert.equal(quoteCustomerErasureRefund(db,accountId).reason,"unreconciled-wallet");
  db.prepare("DELETE FROM credit_wallet_ledger").run();
  paid(db,"p1",1000,1);
  event(db,"mystery",100,"unknown");
  assert.equal(quoteCustomerErasureRefund(db,accountId).reason,"unreconciled-wallet");
 }finally{db.close();}
});

test("legacy one-video credits or reserved holds are never mistaken for refundable prepaid Credits",()=>{
 const db=fixture();
 try{
  paid(db,"p1",1000,1);
  db.exec("CREATE TABLE customer_credits(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,delta INTEGER NOT NULL,kind TEXT NOT NULL,evidence TEXT NOT NULL,created INTEGER NOT NULL)");
  db.prepare("INSERT INTO customer_credits VALUES('legacy-paid',?,500,'purchase','legacy',1)").run(accountId);
  assert.equal(quoteCustomerErasureRefund(db,accountId).reason,"legacy-financial-balance");
  db.prepare("DELETE FROM customer_credits").run();
  db.exec("CREATE TABLE customer_holds(order_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,cents INTEGER NOT NULL,state TEXT NOT NULL)");
  db.prepare("INSERT INTO customer_holds VALUES('legacy-1',?,200,'reserved')").run(accountId);
  assert.equal(quoteCustomerErasureRefund(db,accountId).reason,"legacy-financial-balance");
 }finally{db.close();}
});
test("active Hobby subscription must be resolved before initiating any Stripe Credit refund",()=>{
 const db=fixture();
 try{
  paid(db,"p1",1000,1);
  db.exec("CREATE TABLE customer_subscriptions(account_id TEXT PRIMARY KEY,plan TEXT,status TEXT)");
  db.prepare("INSERT INTO customer_subscriptions VALUES(?,'hobby','active')").run(accountId);
  assert.equal(quoteCustomerErasureRefund(db,accountId).reason,"active-subscription");
 }finally{db.close();}
});
