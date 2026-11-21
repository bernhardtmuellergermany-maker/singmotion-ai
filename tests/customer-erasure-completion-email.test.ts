import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {CommerceStore} from "../lib/commerce/store.ts";
import {beginCustomerErasure,advanceErasureJob,readErasureJob} from "../lib/commerce/customer-erasure-job.ts";
import {retryCustomerErasureCompletionEmails} from "../lib/commerce/customer-erasure-completion-email.ts";

test("deletion confirmation is queued on request but sent only after verified completion, once",async()=>{
 const root=mkdtempSync(path.join(tmpdir(),"sm-deletion-receipt-"));
 const file=path.join(root,"commerce.sqlite");
 const store=new CommerceStore(file);
 try{
  const accountId=store.register("receipt@example.test","safe-long-customer-test-password");
  const request=beginCustomerErasure(store,accountId);
  assert.equal(readErasureJob(store.db,accountId)?.state,"requested");
  assert.ok(request.token.length>=40);
  const before=store.db.prepare("SELECT recipient FROM customer_erasure_completion_emails WHERE account_id=?")
   .get(accountId) as {recipient:string};
  assert.equal(before.recipient,"receipt@example.test");
  let sent=0,body="";
  const sender=(async(_url:string|URL,options?:RequestInit)=>{
   sent++;
   body=String(options?.body||"");
   assert.equal(options?.method,"POST");
   assert.equal((options?.headers as Record<string,string>)["Idempotency-Key"].startsWith("sm-erasure-complete-v1-"),true);
   return new Response(JSON.stringify({id:"email_test"}),{status:200});
  }) as typeof fetch;
  const env={RESEND_API_KEY:"resend-test",ACCOUNT_EMAIL_FROM:"SingMotion <hello@example.test>"};
  const waiting=await retryCustomerErasureCompletionEmails(file,env,sender);
  assert.equal(waiting.sent,0);assert.equal(sent,0);
  store.db.exec("CREATE TABLE customer_erasure_refund_intents(account_id TEXT,cents INTEGER,state TEXT)");
  store.db.prepare("INSERT INTO customer_erasure_refund_intents VALUES(?,350,'succeeded')").run(accountId);
  advanceErasureJob(store.db,accountId,"removing-media");
  advanceErasureJob(store.db,accountId,"removing-data");
  // Fixture simulates a fully verified finalizer: an existing account must
  // never be eligible for the completed state.
  assert.throws(()=>advanceErasureJob(store.db,accountId,"completed"),/Cannot mark erasure complete/);
  store.db.prepare("DELETE FROM customer_accounts WHERE id=?").run(accountId);
  advanceErasureJob(store.db,accountId,"completed");
  const result=await retryCustomerErasureCompletionEmails(file,env,sender);
  assert.equal(result.sent,1);assert.equal(sent,1);
  assert.match(body,/Bestätigung Ihrer Kontolöschung/);
  assert.match(body,/3,50/);
  const row=store.db.prepare("SELECT recipient,sent_at FROM customer_erasure_completion_emails WHERE account_id=?")
   .get(accountId) as {recipient:string|null;sent_at:number|null};
  assert.equal(row.recipient,null);assert.ok(row.sent_at);
  const replay=await retryCustomerErasureCompletionEmails(file,env,sender);
  assert.equal(replay.sent,0);assert.equal(sent,1);
 }finally{store.close();rmSync(root,{recursive:true,force:true})}
});
