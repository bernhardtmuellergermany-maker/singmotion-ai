import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {auditCreditLedger} from "../lib/commerce/credit-ledger-integrity.ts";
import {auditCreditLedgerFile} from "../scripts/audit-credit-ledger.ts";

function fixture(){
 const root=mkdtempSync(path.join(os.tmpdir(),"singmotion-credit-audit-"));
 const file=path.join(root,"commerce.sqlite");
 const db=new DatabaseSync(file);
 const wallet=new CreditWallet(db);
 const owner="customer:credit-audit";
 const identity={subject:owner,email:"private@example.test",customerId:"credit-audit"};
 const purchase=wallet.pending(identity,500,randomUUID());
 const sessionId="cs_live_audit"+randomUUID().replaceAll("-","");
 wallet.bind(purchase.id,sessionId,"https://checkout.stripe.com/c/pay/fixture");
 const payment={id:purchase.id,sessionId,amount:500,currency:"eur",paymentStatus:"paid",livemode:true};
 wallet.settle(payment);
 const first=randomUUID(),second=randomUUID();
 wallet.reserveVideo(first,owner,120);
 wallet.reserveVideo(second,owner,130);
 wallet.reconcileVideo(first,"completed");
 wallet.reconcileVideo(second,"review");
 return {root,db,wallet,owner,purchase,sessionId,first,second,cleanup(){
  db.close();rmSync(root,{recursive:true,force:true});
 }};
}

test("read-only audit validates genuine purchase, multiple holds, settlement and uncertainty",()=>{
 const f=fixture();
 try{
  assert.deepEqual(auditCreditLedger(f.db),{ok:true,failed:[]});
  assert.deepEqual(auditCreditLedgerFile(f.root),{ok:true,failed:[]});
  assert.equal(f.wallet.total(f.owner),380);
  assert.equal(f.wallet.reserved(f.owner),130);
  assert.equal(f.wallet.available(f.owner),250);
  assert.equal(f.wallet.reconcileVideo(f.first,"completed")?.state,"settled");
  assert.equal(f.wallet.reconcileVideo(f.second,"review")?.state,"review");
  assert.deepEqual(auditCreditLedgerFile(f.root),{ok:true,failed:[]});
  const readonly=new DatabaseSync(path.join(f.root,"commerce.sqlite"),{readOnly:true});
  try{
   assert.throws(()=>readonly.exec("DELETE FROM credit_wallet_ledger"));
  }finally{readonly.close();}
 }finally{f.cleanup();}
});
test("refunded paid Credits can cause a negative available balance without false integrity failure",()=>{
 const f=fixture();
 try{
  assert.equal(f.wallet.reverse({
   sessionId:f.sessionId,amount:500,currency:"eur",livemode:true,kind:"refund"
  }),true);
  assert.equal(f.wallet.reverse({
   sessionId:f.sessionId,amount:500,currency:"eur",livemode:true,kind:"dispute"
  }),false);
  assert.ok(f.wallet.available(f.owner)<0,"do not disguise refunded spent Credits as an available balance");
  assert.deepEqual(auditCreditLedger(f.db),{ok:true,failed:[]});
  assert.equal(f.wallet.reconcileVideo(f.second,"nonbillable")?.state,"released");
  assert.deepEqual(auditCreditLedger(f.db),{ok:true,failed:[]});
  assert.equal(f.wallet.supportRefundVideo(f.first,"admin-1",
   "Documented owner support refund after completed job failure.","PROVIDER_JOB_FAILED").state,"released");
  assert.deepEqual(auditCreditLedger(f.db),{ok:true,failed:[]});
  assert.equal(f.wallet.total(f.owner),0);
 }finally{f.cleanup();}
});
test("refund of pending unpaid purchase leaves no invented credit or reversal event",()=>{
 const f=fixture();
 try{
  const p=f.wallet.pending({subject:f.owner,email:"private@example.test",customerId:"credit-audit"},500,randomUUID());
  f.wallet.bind(p.id,"cs_live_pendingtest","https://checkout.stripe.com/c/pay/fixture2");
  assert.equal(f.wallet.reverse({
   sessionId:"cs_live_pendingtest",amount:500,currency:"eur",livemode:true,kind:"refund"
  }),true);
  assert.deepEqual(auditCreditLedger(f.db),{ok:true,failed:[]});
 }finally{f.cleanup();}
});
test("audit spots mismatched purchase or delivered-video debit and orphan entries without exposing identities",()=>{
 const f=fixture();
 try{
  f.db.prepare("UPDATE credit_wallet_ledger SET delta=499 WHERE reference=?")
   .run("credit-topup:"+f.purchase.id);
  let report=auditCreditLedger(f.db);
  assert.equal(report.ok,false);
  assert.ok(report.failed.includes("CREDIT_PURCHASE_LEDGER_MISMATCH"));
  assert.doesNotMatch(JSON.stringify(report),/credit-audit|private@example|cs_live/);
  f.db.prepare("UPDATE credit_wallet_ledger SET delta=500 WHERE reference=?")
   .run("credit-topup:"+f.purchase.id);
  f.db.prepare("UPDATE credit_wallet_ledger SET delta=-119 WHERE reference=?")
   .run("video-charge:"+f.first);
  report=auditCreditLedger(f.db);
  assert.ok(report.failed.includes("CREDIT_VIDEO_LEDGER_MISMATCH"));
  f.db.prepare("UPDATE credit_wallet_ledger SET delta=-120 WHERE reference=?")
   .run("video-charge:"+f.first);
  f.db.prepare("INSERT INTO credit_wallet_ledger VALUES(?,?,?,?,?,?)")
   .run(randomUUID(),f.owner,-1,"video","video-charge:"+randomUUID(),Date.now());
  report=auditCreditLedger(f.db);
  assert.ok(report.failed.includes("CREDIT_ORPHAN_LEDGER_EVENT"));
 }finally{f.cleanup();}
});
test("missing wallet schema fails closed; audit performs no schema creation",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  assert.deepEqual(auditCreditLedger(db),{ok:false,failed:["CREDIT_SCHEMA_MISSING"]});
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'credit_%'").get() as {n:number}).n,0);
 }finally{db.close();}
});
test("worker and CLI audit only wallet local database; no remote payments or provider calls",()=>{
 const worker=readFileSync(new URL("../scripts/worker.ts",import.meta.url),"utf8");
 const script=readFileSync(new URL("../scripts/audit-credit-ledger.ts",import.meta.url),"utf8");
 assert.match(worker,/CREDIT_LEDGER_INTEGRITY/);
 assert.match(worker,/auditCreditLedgerFile\(dataDir\)/);
 assert.match(script,/readOnly:true/);
 assert.match(script,/PRAGMA query_only=ON/);
 assert.doesNotMatch(script,/stripe\.com|BytePlusProtocol|fetch\(/);
});
