import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {spawnSync} from "node:child_process";
import {inspectFreePromoRisk} from "../scripts/inspect-free-promo-risk.ts";

test("private risk inspection does not create a missing spending ledger",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  assert.deepEqual(inspectFreePromoRisk(db,20*86400000),{
   ledgerPresent:false,totalReservedMicroUsd:0,rollingDayReservedMicroUsd:0,
   authorized:0,submittedOrUnknown:0,requiresReview:0,delivered:0,staleUnknown:0
  });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='free_promo_budget_authorizations'").get()?.n,0);
 }finally{db.close()}
});
test("risk inspection reports anonymous cost totals and stale submissions without modifying records",()=>{
 const db=new DatabaseSync(":memory:");
 const now=20*86400000;
 try{
  db.exec(`CREATE TABLE free_promo_budget_authorizations(
   order_id TEXT PRIMARY KEY,account_id TEXT,code TEXT,reserved_micro_usd INTEGER,
   state TEXT,created INTEGER,updated INTEGER)`);
  const add=(id:string,amount:number,state:string,created:number,updated:number)=>
   db.prepare("INSERT INTO free_promo_budget_authorizations VALUES(?,?,?,?,?,?,?)")
    .run(id,"customer-secret","PRIVATECODE",amount,state,created,updated);
  add("a",80000,"authorized",now-1000,now-1000);
  add("b",100000,"submitted_or_unknown",now-1000000,now-950000);
  add("c",120000,"requires_review",now-90000000,now-2000);
  add("d",50000,"delivered",now-5000,now-5000);
  const auditBefore=db.prepare("SELECT COUNT(*) AS n FROM free_promo_budget_authorizations").get()?.n;
  const result=inspectFreePromoRisk(db,now);
  assert.deepEqual(result,{ledgerPresent:true,totalReservedMicroUsd:350000,
   rollingDayReservedMicroUsd:230000,authorized:1,submittedOrUnknown:1,
   requiresReview:1,delivered:1,staleUnknown:1});
  assert.ok(!JSON.stringify(result).includes("customer-secret"));
  assert.ok(!JSON.stringify(result).includes("PRIVATECODE"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM free_promo_budget_authorizations").get()?.n,auditBefore);
  assert.throws(()=>inspectFreePromoRisk(db,Number.NaN),/timestamp/);
 }finally{db.close()}
});
test("operator inspection CLI refuses invocation outside private Staging",()=>{
 const child=spawnSync(process.execPath,["--experimental-strip-types","scripts/inspect-free-promo-risk.ts","--staging"],{
  cwd:process.cwd(),env:{...process.env,RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d"},
  encoding:"utf8",timeout:20000
 });
 assert.equal(child.status,2);
 assert.ok(!child.stdout.includes("FREE_PROMO_RISK"));
});
