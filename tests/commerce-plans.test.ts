import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {PlanLedger,quotePlanSeconds} from "../lib/commerce/plans.ts";
const create=()=>{const db=new DatabaseSync(":memory:");const ledger=new PlanLedger(db);return {db,ledger}};
const activate=(db:DatabaseSync,account="customer-1",start=Date.UTC(2026,9,20),end=Date.UTC(2026,10,20),paidThrough=end)=>{
 db.prepare("INSERT INTO customer_subscriptions(account_id,plan,provider,provider_subscription_id,status,current_period_start,current_period_end,updated_at,paid_through) VALUES(?,?,?,?,?,?,?,?,?)").run(account,"hobby","stripe","sub_test_1","active",start,end,Date.now(),paidThrough);
};
const NOW=Date.UTC(2026,10,1);
test("Free accounts cannot reserve any inclusive video seconds",()=>{const {db,ledger}=create();assert.equal(ledger.snapshot("free-user",NOW).uploadStorageBytes,250*1024**2);assert.equal(ledger.snapshot("free-user",NOW).secondsRemaining,0);assert.throws(()=>ledger.reserve("free-user","attempt-12345",5,NOW));db.close()});
test("Hobby requires a paid invoice covering the current Stripe billing period",()=>{const {db,ledger}=create();activate(db,"a",undefined,undefined,0);assert.equal(ledger.snapshot("a",NOW).code,"free");db.prepare("UPDATE customer_subscriptions SET paid_through=current_period_end WHERE account_id='a'").run();assert.equal(ledger.snapshot("a",NOW).code,"hobby");assert.equal(ledger.snapshot("a",NOW).uploadStorageBytes,2*1024**3);db.close()});
test("Hobby quota is 30 seconds across multiple videos, idempotently",()=>{const {db,ledger}=create();activate(db,"a");assert.equal(ledger.reserve("a","attempt-12345",10,NOW).secondsRemaining,20);assert.equal(ledger.reserve("a","attempt-12345",10,NOW).secondsRemaining,20);assert.equal(ledger.reserve("a","attempt-54321",20,NOW).secondsRemaining,0);assert.throws(()=>ledger.reserve("a","attempt-aaaaa",5,NOW));ledger.settle("attempt-12345",true);assert.equal(ledger.snapshot("a",NOW).secondsRemaining,0);db.close()});
test("Only provider-confirmed nonbillable failure releases the reserved allowance",()=>{const {db,ledger}=create();activate(db,"a");ledger.reserve("a","attempt-12345",10,NOW);ledger.settle("attempt-12345",false);assert.equal(ledger.snapshot("a",NOW).secondsRemaining,30);assert.throws(()=>ledger.reserve("a","attempt-12345",10,NOW));db.close()});
test("Quota resets on Stripe renewal, not a calendar month boundary",()=>{const {db,ledger}=create();activate(db,"a");ledger.reserve("a","attempt-12345",20,NOW);assert.equal(ledger.snapshot("a",NOW).secondsRemaining,10);db.prepare("UPDATE customer_subscriptions SET current_period_start=?,current_period_end=?,paid_through=? WHERE account_id='a'").run(Date.UTC(2026,10,20),Date.UTC(2026,11,20),Date.UTC(2026,11,20));assert.equal(ledger.snapshot("a",Date.UTC(2026,10,21)).secondsRemaining,30);db.close()});

test("Split quotes reserve remaining Hobby seconds atomically and never double-count",()=>{
 const {db,ledger}=create();activate(db,"11111111-1111-4111-8111-111111111111");
 const first=ledger.reserveSplitQuote("11111111-1111-4111-8111-111111111111","order-123456",25,NOW);
 assert.deepEqual({included:first.includedSeconds,extra:first.extraSeconds,cents:first.extraCents},{included:25,extra:0,cents:0});
 const second=ledger.reserveSplitQuote("11111111-1111-4111-8111-111111111111","order-234567",15,NOW);
 assert.deepEqual({included:second.includedSeconds,extra:second.extraSeconds,cents:second.extraCents},{included:5,extra:10,cents:200});
 assert.equal(ledger.snapshot("11111111-1111-4111-8111-111111111111",NOW).secondsRemaining,0);
 assert.equal(ledger.reserveSplitQuote("11111111-1111-4111-8111-111111111111","order-234567",15,NOW).extraCents,200);
 assert.throws(()=>ledger.reserveSplitQuote("11111111-1111-4111-8111-111111111111","order-234567",16,NOW),/mismatch/);
 ledger.settleSplitQuote("order-234567","consumed");
 ledger.settleSplitQuote("order-234567","consumed");
 assert.equal(ledger.snapshot("11111111-1111-4111-8111-111111111111",NOW).secondsRemaining,0);
 assert.throws(()=>ledger.releaseSplitQuote("order-234567"),/finalized/);
 db.close();
});
test("Confirmed non-submission restores reserved allowance; repeated release is harmless",()=>{
 const {db,ledger}=create();activate(db,"11111111-1111-4111-8111-111111111111");
 ledger.reserveSplitQuote("11111111-1111-4111-8111-111111111111","order-123456",15,NOW);
 assert.equal(ledger.snapshot("11111111-1111-4111-8111-111111111111",NOW).secondsRemaining,15);
 ledger.releaseSplitQuote("order-123456");
 ledger.releaseSplitQuote("order-123456");
 assert.equal(ledger.snapshot("11111111-1111-4111-8111-111111111111",NOW).secondsRemaining,30);
 assert.throws(()=>ledger.reserveSplitQuote("11111111-1111-4111-8111-111111111111","order-123456",15,NOW),/released/);
 db.close();
});
test("Free split quotes never consume included seconds and use 25 cents per second",()=>{
 const {db,ledger}=create();
 const q=ledger.reserveSplitQuote("11111111-1111-4111-8111-111111111111","order-123456",10,NOW);
 assert.equal(q.includedSeconds,0);assert.equal(q.extraCents,250);
 ledger.settleSplitQuote("order-123456","consumed");
 assert.equal(ledger.snapshot("11111111-1111-4111-8111-111111111111",NOW).secondsRemaining,0);
 db.close();
});
test("A failed inconsistent allowance settlement rolls back its quote state",()=>{
 const {db,ledger}=create();activate(db,"11111111-1111-4111-8111-111111111111");
 ledger.reserveSplitQuote("11111111-1111-4111-8111-111111111111","order-123456",10,NOW);
 db.prepare("UPDATE customer_plan_usage SET seconds=9 WHERE provider_attempt_id='order-123456'").run();
 assert.throws(()=>ledger.settleSplitQuote("order-123456","consumed"),/mismatch/);
 assert.equal((db.prepare("SELECT state FROM customer_split_quotes WHERE attempt_id='order-123456'").get() as {state:string}).state,"reserved");
 db.close();
});

test("300-second video bills only seconds beyond the Hobby monthly allowance",()=>{
 const hobby=quotePlanSeconds("hobby",30,300);
 assert.deepEqual(hobby,{seconds:300,includedSeconds:30,extraSeconds:270,extraCents:5400,currency:"EUR"});
 const free=quotePlanSeconds("free",0,300);
 assert.equal(free.extraCents,7500);
 assert.equal(quotePlanSeconds("hobby",8,15).extraCents,140);
 assert.throws(()=>quotePlanSeconds("hobby",30,301),/Invalid video quote/);
});
