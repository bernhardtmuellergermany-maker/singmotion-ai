import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {customerOrderStatusFilter,ownedCustomerOrderStatuses} from "../lib/commerce/customer-orders-query.ts";
import {privateCustomerVideoLinks} from "../lib/commerce/customer-video-links.ts";

const id=(n:number)=>n.toString(16).padStart(8,"0")+"-1111-4111-8111-111111111111";

test("the existing paid output loads an older owned order beyond the latest 50",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec(`CREATE TABLE customer_orders(
   id TEXT PRIMARY KEY,account_id TEXT,project_id TEXT,price_cents INTEGER,
   currency TEXT,status TEXT,created INTEGER);
   CREATE TABLE customer_fulfillment_queue(order_id TEXT PRIMARY KEY,state TEXT);
   CREATE TABLE customer_video_deliveries(order_id TEXT PRIMARY KEY,asset_id TEXT);`);
  const insert=db.prepare("INSERT INTO customer_orders VALUES(?,?,?,?,?,?,?)");
  for(let i=0;i<65;i++)insert.run(id(i),"owner-a","project-a",125,"EUR","paid",i);
  insert.run(id(100),"owner-b","project-a",125,"EUR","paid",100);
  db.prepare("INSERT INTO customer_fulfillment_queue VALUES(?,?)").run(id(0),"delivered");
  db.prepare("INSERT INTO customer_video_deliveries VALUES(?,?)").run(id(0),"customer-video-private");

  const history=ownedCustomerOrderStatuses(db,"owner-a",customerOrderStatusFilter(null,null));
  assert.equal(history.length,50);
  assert.equal(history.some(order=>order.orderId===id(0)),false);

  const direct=ownedCustomerOrderStatuses(db,"owner-a",customerOrderStatusFilter(id(0),null));
  assert.equal(direct.length,1);
  assert.equal(direct[0].orderId,id(0));
  assert.equal(direct[0].videoReady,1);
  assert.deepEqual(privateCustomerVideoLinks(direct[0]),{
   videoUrl:`/api/customer-video?orderId=${id(0)}`,
   downloadUrl:`/api/customer-video?orderId=${id(0)}&download=1`
  });
  assert.equal(ownedCustomerOrderStatuses(db,"owner-b",customerOrderStatusFilter(id(0),null)).length,0);
  assert.equal(ownedCustomerOrderStatuses(db,"owner-a",customerOrderStatusFilter(id(100),null)).length,0);
  assert.equal(ownedCustomerOrderStatuses(db,"owner-a",customerOrderStatusFilter(id(0),"other-project")).length,0);
  assert.equal(ownedCustomerOrderStatuses(db,"owner-a",customerOrderStatusFilter(id(0),"project-a")).length,1);
 }finally{db.close();}
});

test("customer status rejects malformed IDs and project filters before querying",()=>{
 assert.equal(customerOrderStatusFilter(null,null).limit,50);
 assert.equal(customerOrderStatusFilter(id(0),null).limit,1);
 for(const candidate of ["","../etc/passwd","0".repeat(36),id(0).replace("-4111-","-0111-"),
  id(0)+"' OR 1=1 --","11111111-1111-1111-1111-111111111111"])
  assert.throws(()=>customerOrderStatusFilter(candidate,null),undefined,candidate);
 for(const candidate of ["../secret","","a".repeat(161),"project?a=1","owner/other"])
  assert.throws(()=>customerOrderStatusFilter(null,candidate),undefined,candidate);
});
