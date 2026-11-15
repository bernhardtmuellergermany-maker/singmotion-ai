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

test("Rename Save PATCHes an owned account title, never hides a paid project",()=>{
 const ui=read("components/my-projects-gallery.tsx");
 const api=read("app/(site)/api/customer-orders/route.ts");
 const rename=ui.split("async function renameProject(item:ProjectItem){")[1]?.split("async function refreshTrash()")[0];
 const removal=ui.split("async function deleteProject(item:ProjectItem){")[1]?.split(" // Refresh account-owned names")[0];
 assert.ok(rename,"Rename event handler must exist");
 assert.match(rename,/if\(item\.kind==="customer"\)/);
 assert.match(rename,/method:"PATCH"/);
 assert.match(rename,/JSON\.stringify\(\{orderId:id,name:next\}\)/);
 assert.match(rename,/setOrders\(previous=>previous\.map\(o=>o\.orderId===id\?\{\.\.\.o,displayName:next\}:o\)\)/);
 assert.doesNotMatch(rename,/method:"PUT"|hidden:true|filter\(o=>o\.orderId!==id\)/);
 assert.ok(removal,"Separate Remove event handler must exist");
 assert.match(removal,/method:"PUT"/);
 assert.match(removal,/hidden:true/);
 assert.match(api,/export async function PATCH\(req:NextRequest\)/);
 assert.match(api,/ownedCustomerOrderStatuses\(store\.db,accountId/);
 assert.match(api,/customer_order_display_names/);
 assert.match(api,/name=excluded\.name/);
});

test("My Projects requests small private previews, not original full-resolution source images",()=>{
 const gallery=read("components/my-projects-gallery.tsx");
 const customerPreview=read("app/(site)/api/customer-generation-photo/route.ts");
 const asset=read("app/(site)/api/[...path]/route.ts");
 assert.match(gallery,/customer-generation-photo\?orderId=\$\{encodeURIComponent\(o\.orderId\)\}&thumbnail=1/);
 assert.match(gallery,/\/api\/assets\/\$\{encodeURIComponent\(d\.selection\.imageId\)\}\?thumbnail=1/);
 assert.match(gallery,/\/api\/assets\/\$\{encodeURIComponent\(p\.imageId\)\}\?thumbnail=1/);
 assert.match(gallery,/loading="lazy" decoding="async"/);
 assert.match(customerPreview,/store\.ownedOrder\(id,account,guest\)/);
 assert.match(customerPreview,/createHash\("sha256"\)/);
 assert.match(customerPreview,/req\.nextUrl\.searchParams\.get\("thumbnail"\)==="1"/);
 assert.match(customerPreview,/\.resize\(\{width:520,height:520,fit:"inside",withoutEnlargement:true\}\)/);
 assert.match(customerPreview,/\.webp\(\{quality:74,effort:3\}\)/);
 assert.match(customerPreview,/"Cache-Control":"private, no-store"/);
 assert.match(asset,/const a = asset\(id, owner\)/);
 assert.match(asset,/const thumbnail=a\.kind==="image"&&req\.nextUrl\.searchParams\.get\("thumbnail"\)==="1"/);
 assert.match(asset,/"Content-Type": thumbnail \? "image\/webp"/);
 assert.match(asset,/"Cache-Control": "private, no-store"/);
});
