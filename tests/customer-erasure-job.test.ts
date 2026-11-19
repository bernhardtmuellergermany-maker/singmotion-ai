import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {CommerceStore} from "../lib/commerce/store.ts";
import {beginCustomerErasure,erasureJobByToken,readErasureJob,advanceErasureJob,erasureInProgress} from "../lib/commerce/customer-erasure-job.ts";

const password="safe-test-passphrase-12345";
function fixture(fn:(store:CommerceStore)=>void){
 const root=mkdtempSync(path.join(tmpdir(),"sm-erasure-freeze-"));
 const store=new CommerceStore(path.join(root,"commerce.sqlite"),{
  CUSTOMER_BETA_WELCOME_CREDITS_ENABLED:"false"});
 try{fn(store)}finally{store.close();rmSync(root,{recursive:true,force:true})}
}
test("irreversible deletion request immediately blocks both devices but not other customers",()=>{
 fixture(store=>{
  const id=store.register("holder@example.test",password);
  const other=store.register("other@example.test",password);
  const one=store.login("holder@example.test",password);
  const two=store.login("holder@example.test",password);
  const otherToken=store.login("other@example.test",password);
  assert.equal(store.session(one),id);
  const begun=beginCustomerErasure(store,id);
  assert.equal(begun.job.state,"requested");
  assert.equal(store.session(one),null);
  assert.equal(store.session(two),null);
  assert.equal(store.session(otherToken),other);
  assert.equal(erasureInProgress(store.db,id),true);
  assert.throws(()=>store.login("holder@example.test",password),/permanently deleted/);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_sessions WHERE account_id=?").get(id)?.n,0);
  assert.equal(erasureJobByToken(store.db,"invalid"),null);
  assert.equal(erasureJobByToken(store.db,begun.token)?.accountId,id);
  assert.equal(readErasureJob(store.db,other),null);
  assert.throws(()=>beginCustomerErasure(store,id),/already requested/);
 });
});
test("Google-only account cannot silently reopen customer sessions after deletion starts",()=>{
 fixture(store=>{
  const google=store.googleLogin("1234567890123","oauth@example.test");
  beginCustomerErasure(store,google.id);
  assert.equal(store.session(google.token),null);
  assert.throws(()=>store.googleLogin("1234567890123","oauth@example.test"),/permanently deleted/);
 });
});
test("durable erasure state machine rejects skipped steps and unsafe issue strings",()=>{
 fixture(store=>{
  const id=store.register("state@example.test",password);
  beginCustomerErasure(store,id);
  assert.throws(()=>advanceErasureJob(store.db,id,"completed"),/Invalid erasure state/);
  assert.equal(advanceErasureJob(store.db,id,"refunding").state,"refunding");
  assert.equal(advanceErasureJob(store.db,id,"needs-attention","STRIPE_PENDING").issue,"STRIPE_PENDING");
  assert.throws(()=>advanceErasureJob(store.db,id,"removing-data","raw private email@test.com"),/Invalid safe issue/);
  assert.equal(advanceErasureJob(store.db,id,"removing-media").state,"removing-media");
  assert.equal(advanceErasureJob(store.db,id,"removing-data").state,"removing-data");
  assert.equal(advanceErasureJob(store.db,id,"completed").state,"completed");
  assert.equal(erasureInProgress(store.db,id),false);
  assert.throws(()=>advanceErasureJob(store.db,id,"requested"),/Invalid erasure state/);
 });
});
