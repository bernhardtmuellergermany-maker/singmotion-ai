import {test} from "node:test";
import assert from "node:assert/strict";
import {CommerceStore} from "../lib/commerce/store.ts";
import {inspectRecoveryCounts} from "../scripts/inspect-paid-recovery.ts";

test("recovery inspection is read-only and returns no private identifiers",()=>{
 const store=new CommerceStore(":memory:");
 try{
  const before=store.db.prepare("SELECT COUNT(*) AS n FROM commerce_audit").get()?.n;
  const result=inspectRecoveryCounts(store);
  assert.deepEqual(result,{awaitingPayment:0,paidPending:0,acknowledgedRecovery:0,ambiguousProcessing:0,delivered:0,failed:0});
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM commerce_audit").get()?.n,before);
  assert.equal(Object.values(result).every(x=>typeof x==="number"),true);
 }finally{store.close()}
});
