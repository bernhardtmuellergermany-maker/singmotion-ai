import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {mkdtempSync,rmSync,symlinkSync,mkdirSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {readCommerceDashboard} from "../cms/dashboard-metrics.ts";

test("CMS metrics report actual anonymous aggregates without mutating commerce data",()=>{
 const root=mkdtempSync(path.join(tmpdir(),"singmotion-cms-metrics-"));
 let db:DatabaseSync|undefined;
 try{
  assert.equal(readCommerceDashboard(root),null,"no database must never yield fictional zero");
  db=new DatabaseSync(path.join(root,"commerce.sqlite"));
  db.exec(`CREATE TABLE customer_accounts(id TEXT PRIMARY KEY,email TEXT);
   CREATE TABLE customer_orders(id TEXT PRIMARY KEY,status TEXT);
   CREATE TABLE free_promo_budget_authorizations(order_id TEXT,state TEXT)`);
  db.prepare("INSERT INTO customer_accounts VALUES(?,?)").run("private-1","private@example.test");
  const orders=db.prepare("INSERT INTO customer_orders VALUES(?,?)");
  orders.run("order-1","free_delivered");orders.run("order-2","paid");orders.run("order-3","awaiting_payment");
  db.prepare("INSERT INTO free_promo_budget_authorizations VALUES(?,?)").run("order-3","requires_review");
  const result=readCommerceDashboard(root);
  assert.deepEqual(result,{
   accounts:1,orders:3,freeDeliveries:1,paidOrders:1,uncertainFreeAttempts:0,freeReviews:1
  });
  assert.ok(!JSON.stringify(result).includes("private@example.test"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM customer_accounts").get()?.n,1);
  assert.equal(db.prepare("SELECT status FROM customer_orders WHERE id='order-3'").get()?.status,"awaiting_payment");
  db.close();db=undefined;
  const alias=mkdtempSync(path.join(root,"symlink-container-"));
  symlinkSync(path.join(root,"commerce.sqlite"),path.join(alias,"commerce.sqlite"));
  assert.equal(readCommerceDashboard(alias),null,"CMS must never follow alternate database symlink");
 }finally{db?.close();rmSync(root,{recursive:true,force:true})}
});
test("CMS metrics fail safely on legacy missing tables",()=>{
 const root=mkdtempSync(path.join(tmpdir(),"singmotion-cms-old-db-"));
 const db=new DatabaseSync(path.join(root,"commerce.sqlite"));
 try{db.exec("CREATE TABLE sessions(token TEXT)");assert.equal(readCommerceDashboard(root),null)}
 finally{db.close();rmSync(root,{recursive:true,force:true})}
});
