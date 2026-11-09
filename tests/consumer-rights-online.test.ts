import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {readFileSync} from "node:fs";
import {validateWithdrawal,recordWithdrawal,withdrawalReceiptText,sendRightsEmail,retryPendingWithdrawalReceipts} from "../lib/commerce/consumer-rights.ts";

test("electronic withdrawal stores exact declaration and UTC receipt in durable database",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  const input=validateWithdrawal({name:"Max Mustermann",orderReference:"contract-123",email:"TEST@example.de"});
  const record=recordWithdrawal(db,input);
  assert.equal(record.email,"test@example.de");
  assert.match(record.receivedAt,/Z$/);
  assert.equal(db.prepare("SELECT name FROM consumer_withdrawals WHERE id=?").get(record.id)?.name,"Max Mustermann");
  const mail=withdrawalReceiptText(record);
  for(const value of [record.id,record.receivedAt,record.name,record.orderReference,record.email])
   assert.ok(mail.includes(value));
  assert.match(mail,/nicht deren rechtliche Wirksamkeit/);
 }finally{db.close();}
});
test("withdrawal rejects missing contract reference, invalid email and control characters",()=>{
 for(const input of [{name:"A",orderReference:"123",email:"a@example.de"},
  {name:"Alice",orderReference:"",email:"a@example.de"},
  {name:"Alice",orderReference:"123",email:"not-an-email"},
  {name:"Alice\nBob",orderReference:"123",email:"a@example.de"}])
   assert.throws(()=>validateWithdrawal(input));
});
test("acknowledgement emails are reported sent only after provider success",async()=>{
 const good=await sendRightsEmail({to:"a@example.de",subject:"Confirmation",text:"Saved"},
  {RESEND_API_KEY:"synthetic",ACCOUNT_EMAIL_FROM:"no-reply@example.de"},
  async(_url,_opts)=>new Response(null,{status:202}));
 assert.equal(good,true);
 const bad=await sendRightsEmail({to:"a@example.de",subject:"Confirmation",text:"Saved"},
  {RESEND_API_KEY:"synthetic",ACCOUNT_EMAIL_FROM:"no-reply@example.de"},
  async(_url,_opts)=>new Response(null,{status:503}));
 assert.equal(bad,false);
});
test("public statutory form has a second explicit confirm step and no authentication requirement",()=>{
 const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
 const ui=read("components/online-withdrawal.tsx");
 const route=read("app/(site)/api/withdrawal/route.ts");
 assert.match(ui,/Widerruf bestätigen/);
 assert.match(ui,/Vertrag widerrufen/);
 assert.match(route,/recordWithdrawal\(db,input\)/);
 assert.match(route,/confirmationSent:customerSent/);
 assert.doesNotMatch(route,/sm_customer|\.session\(/);
 const dispatch=read("lib/commerce/customer-byteplus-dispatch.ts");
 assert.match(dispatch,/hasContractConfirmation\(orderId\)/);
 const webhook=read("app/(site)/api/stripe-webhook/route.ts");
 assert.match(webhook,/ensurePaidContractConfirmation/);
});

test("failed email receipts remain in durable outbox and are retried",async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),"sm-withdrawal-"));
 const file=path.join(dir,"commerce.sqlite");
 try{
  const db=new DatabaseSync(file);
  const saved=recordWithdrawal(db,{name:"Example Consumer",orderReference:"12345",email:"person@example.de"});
  db.close();
  const sent:string[]=[];
  const result=await retryPendingWithdrawalReceipts(file,
   {RESEND_API_KEY:"test",ACCOUNT_EMAIL_FROM:"SingMotion <no-reply@example.de>",CONTACT_EMAIL_TO:"operator@example.de"},
   async(_url,options)=>{
    const request=JSON.parse(String(options?.body)) as {to:string[]};
    sent.push(request.to[0]);
    return new Response(null,{status:202});
   });
  assert.equal(result.sent,1);
  assert.deepEqual(sent,["person@example.de","operator@example.de"]);
  const check=new DatabaseSync(file);
  const row=check.prepare("SELECT receipt_sent_at,operator_notified_at FROM consumer_withdrawals WHERE id=?").get(saved.id);
  assert.ok(row?.receipt_sent_at);
  assert.ok(row?.operator_notified_at);
  check.close();
  const second=await retryPendingWithdrawalReceipts(file,{RESEND_API_KEY:"test",ACCOUNT_EMAIL_FROM:"test@example.de"});
  assert.equal(second.attempted,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
