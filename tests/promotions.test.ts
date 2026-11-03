import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { PromotionLedger, calculatePromotion } from "../lib/commerce/promotions.ts";
const start="2026-11-01T00:00:00.000Z", end="2026-12-01T00:00:00.000Z";
const at=Date.parse("2026-11-03T12:00:00.000Z");
function db(){
  const database=new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE customer_orders (
    id TEXT PRIMARY KEY,account_id TEXT,price_cents INTEGER NOT NULL,status TEXT NOT NULL
  );`);
  return database;
}
function order(database:DatabaseSync,id:string,cents:number,account="customer0001"){
  database.prepare("INSERT INTO customer_orders VALUES(?,?,?,'awaiting_payment')").run(id,account,cents);
}
test("percentage discounts always use integer cents and server price",()=>{
  assert.deepEqual(calculatePromotion("percent",20,null,1999,10),{discountCents:399,finalCents:1600});
  assert.deepEqual(calculatePromotion("percent",10,null,2000,10),{discountCents:200,finalCents:1800});
  assert.throws(()=>calculatePromotion("free_videos",null,10,1000,10.001),/VIDEO_TOO_LONG/);
});
test("admin can create schedules, limits, generated codes and view counts",()=>{
  const database=db(),ledger=new PromotionLedger(database);
  const one=ledger.create({code:"SUMMER20",kind:"percent",percent:20,startsAt:start,endsAt:end,maxUses:2},at);
  const generated=ledger.create({kind:"percent",percent:10,startsAt:start,endsAt:end,maxUses:100},at);
  assert.equal(one.percent,20);
  assert.match(generated.code,/^SM-[A-F0-9]{12}$/);
  assert.equal(ledger.list().length,2);
  assert.throws(()=>ledger.create({code:"SUMMER20",kind:"percent",percent:10,startsAt:start,endsAt:end,maxUses:1},at),/UNIQUE/);
  assert.throws(()=>ledger.create({code:"BADDATE",kind:"percent",percent:10,startsAt:end,endsAt:start,maxUses:1},at),/Start/);
  assert.throws(()=>ledger.preview("SUMMER20","customer0001",1000,10,Date.parse(end)),/unavailable/);
  ledger.setEnabled("SUMMER20",false);
  assert.throws(()=>ledger.preview("SUMMER20","customer0001",1000,10,at),/unavailable/);
  ledger.setEnabled("SUMMER20",true);
  assert.equal(ledger.preview("SUMMER20","customer0001",1000,10,at).finalCents,800);
  database.close();
});
test("three free videos are one redemption each, never a reusable free bypass",()=>{
  const database=db(),ledger=new PromotionLedger(database);
  ledger.create({code:"THREEFREE",kind:"free_videos",freeVideos:3,maxVideoSeconds:10,
    startsAt:start,endsAt:end,maxUses:100},at);
  for(let n=1;n<=3;n++){
    order(database,"free-"+n,0);
    assert.deepEqual(ledger.reserveForOrder({code:"THREEFREE",orderId:"free-"+n,
      accountId:"customer0001",originalCents:1500,durationSeconds:10},at),
      {discountCents:1500,finalCents:0});
    database.prepare("UPDATE customer_orders SET status='paid' WHERE id=?").run("free-"+n);
    assert.equal(ledger.settle("free-"+n,at),true);
    assert.equal(ledger.settle("free-"+n,at),false);
  }
  order(database,"free-4",0);
  assert.throws(()=>ledger.reserveForOrder({code:"THREEFREE",orderId:"free-4",
    accountId:"customer0001",originalCents:1500,durationSeconds:10},at),/allowance exhausted/);
  assert.equal(ledger.list()[0].redeemed,3);
  assert.equal(ledger.list()[0].reserved,0);
  database.close();
});
test("global capacity, idempotency and release require an actual order state",()=>{
  const database=db(),ledger=new PromotionLedger(database);
  ledger.create({code:"PROMO10",kind:"percent",percent:10,startsAt:start,endsAt:end,
    maxUses:1,perCustomerLimit:1},at);
  order(database,"order-a",900);
  const args={code:"PROMO10",orderId:"order-a",accountId:"customer0001",
    originalCents:1000,durationSeconds:10};
  assert.equal(ledger.reserveForOrder(args,at).discountCents,100);
  assert.deepEqual(ledger.reserveForOrder(args,at),{discountCents:100,finalCents:900});
  order(database,"order-b",900,"customer0002");
  assert.throws(()=>ledger.reserveForOrder({...args,orderId:"order-b",accountId:"customer0002"},at),/use limit/);
  assert.throws(()=>ledger.release("order-a",at),/verified reversal/);
  database.prepare("UPDATE customer_orders SET status='cancelled' WHERE id='order-a'").run();
  assert.equal(ledger.release("order-a",at),true);
  assert.equal(ledger.list()[0].released,1);
  assert.equal(ledger.reserveForOrder({...args,orderId:"order-b",accountId:"customer0002"},at).finalCents,900);
  assert.equal(ledger.list()[0].reserved,1);
  database.close();
});
test("discount cannot be reserved for changed or unowned price",()=>{
  const database=db(),ledger=new PromotionLedger(database);
  ledger.create({code:"OWNER20",kind:"percent",percent:20,startsAt:start,endsAt:end,maxUses:10},at);
  order(database,"order-1",1000);
  const input={code:"OWNER20",orderId:"order-1",accountId:"customer0001",originalCents:1000,durationSeconds:10};
  assert.throws(()=>ledger.reserveForOrder(input,at),/price must match/);
  database.prepare("UPDATE customer_orders SET price_cents=800 WHERE id='order-1'").run();
  assert.throws(()=>ledger.reserveForOrder({...input,accountId:"customer0002"},at),/owned order/);
  assert.equal(ledger.reserveForOrder(input,at).finalCents,800);
  assert.throws(()=>ledger.reserveForOrder({...input,originalCents:999},at),/idempotency conflict/);
  database.close();
});
