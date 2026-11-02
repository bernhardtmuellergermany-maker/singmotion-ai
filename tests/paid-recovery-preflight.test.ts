import {test} from "node:test";
import assert from "node:assert/strict";
import {CommerceStore} from "../lib/commerce/store.ts";
import {recoveryPreflight} from "../scripts/paid-recovery-preflight.ts";
test("recovery preflight makes no paid dispatch and reports only counts",()=>{
 const store=new CommerceStore(":memory:");
 try {
  const before=store.db.prepare("SELECT COUNT(*) AS n FROM commerce_audit").get()?.n;
  assert.deepEqual(recoveryPreflight(store),{
   acknowledgedRecovery:0,pendingNotDispatched:0,dispatchEnabled:false,networkRequests:0
  });
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM commerce_audit").get()?.n,before);
 }finally{store.close()}
});
