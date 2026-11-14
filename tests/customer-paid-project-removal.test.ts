import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {customerOrderStatusFilter,ownedCustomerOrderStatuses} from "../lib/commerce/customer-orders-query.ts";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const id=(n:number)=>n.toString(16).padStart(8,"0")+"-1111-4111-8111-111111111111";

test("Removing a paid project changes only owner-scoped gallery visibility, not payment or direct video access",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec(`CREATE TABLE customer_orders(id TEXT PRIMARY KEY,account_id TEXT,project_id TEXT,price_cents INTEGER,currency TEXT,status TEXT,created INTEGER);
   CREATE TABLE customer_guest_order_claims(order_id TEXT PRIMARY KEY,account_id TEXT,claimed_at INTEGER);
   CREATE TABLE customer_prepared_media(order_id TEXT PRIMARY KEY,media_json TEXT);
   CREATE TABLE customer_fulfillment_queue(order_id TEXT PRIMARY KEY,state TEXT);
   CREATE TABLE customer_video_deliveries(order_id TEXT PRIMARY KEY,asset_id TEXT);
   CREATE TABLE free_promo_video_deliveries(order_id TEXT PRIMARY KEY,account_id TEXT);
   CREATE TABLE customer_hidden_paid_orders(account_id TEXT,order_id TEXT,hidden_at INTEGER,PRIMARY KEY(account_id,order_id));`);
  db.prepare("INSERT INTO customer_orders VALUES(?,?,?,?,?,?,?)").run(id(1),"account-a","project-1",1800,"EUR","paid",Date.now());
  db.prepare("INSERT INTO customer_orders VALUES(?,?,?,?,?,?,?)").run(id(2),"account-b","project-2",500,"EUR","paid",Date.now());
  const list=(account:string)=>ownedCustomerOrderStatuses(db,account,customerOrderStatusFilter(null,null));
  const direct=(account:string,order:string)=>ownedCustomerOrderStatuses(db,account,customerOrderStatusFilter(order,null));
  assert.equal(list("account-a").length,1);
  db.prepare("INSERT INTO customer_hidden_paid_orders VALUES(?,?,?)").run("account-a",id(1),Date.now());
  assert.equal(list("account-a").length,0);
  assert.equal(direct("account-a",id(1)).length,1,"Direct order still accessible");
  assert.equal(direct("account-b",id(1)).length,0,"Other accounts never see hidden orders");
  assert.equal(list("account-b").length,1,"Other accounts unaffected");
  assert.equal((db.prepare("SELECT price_cents FROM customer_orders WHERE id=?").get(id(1)) as {price_cents:number}).price_cents,1800);
  db.prepare("DELETE FROM customer_hidden_paid_orders WHERE account_id=? AND order_id=?").run("account-a",id(1));
  assert.equal(list("account-a").length,1,"Restoring returns original project");
 }finally{db.close();}
});
test("Customer Remove & Restore requires a customer account, CSRF, owned order and never cancels paid transactions",()=>{
 const api=read("app/(site)/api/customer-orders/route.ts");
 const ui=read("components/my-projects-gallery.tsx");
 assert.match(api,/export async function PUT\(req:NextRequest\)/);
 assert.match(api,/req\.headers\.get\("origin"\)!==origin/);
 assert.match(api,/store\.session\(req\.cookies\.get\("sm_customer"\)/);
 assert.match(api,/ownedCustomerOrderStatuses\(store\.db,accountId,customerOrderStatusFilter\(orderId,null\)\)/);
 assert.match(api,/INSERT INTO customer_hidden_paid_orders\(account_id,order_id,hidden_at\)/);
 assert.match(api,/DELETE FROM customer_hidden_paid_orders WHERE account_id=\? AND order_id=\?/);
 assert.match(ui,/Remove from My Projects/);
 assert.match(ui,/hidden:true/);
 assert.match(ui,/hidden:false/);
 assert.doesNotMatch(ui,/Paid orders cannot be deleted here/);
 assert.match(ui,/Payment records are retained/);
});
