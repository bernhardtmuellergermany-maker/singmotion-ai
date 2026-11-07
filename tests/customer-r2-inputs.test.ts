import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,chmod,rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import sharp from "sharp";
import {CommerceStore} from "../lib/commerce/store.ts";
import {CustomerR2PrivateInputDelivery} from "../lib/commerce/customer-r2-inputs.ts";
import type {PreparedMedia} from "../lib/live/store.ts";

const env={
 RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041",
 R2_ACCOUNT_ID:"0".repeat(32),
 R2_BUCKET:"private-test-bucket",
 R2_ACCESS_KEY_ID:"fictional",
 R2_SECRET_ACCESS_KEY:"fictional-only",
};
test("customer R2 input adapter refuses Production before constructing a network client",()=>{
 const store=new CommerceStore(":memory:");
 try{
  assert.throws(()=>new CustomerR2PrivateInputDelivery(store,
   "11111111-1111-4111-8111-111111111111","/nonexistent",
   {...env,RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d"}),/protected staging/);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_provider_input_leases").get()?.n,0);
 }finally{store.close()}
});
test("unpaid order cannot create a BytePlus R2 input lease or upload media",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"singmotion-customer-r2-input-"));
 const store=new CommerceStore(":memory:");
 let inputs:CustomerR2PrivateInputDelivery|undefined;
 try{
  await mkdir(path.join(root,"media"),{mode:0o700});
  const audio=Buffer.from("synthetic mp3 input for admission checks");
  const image=await sharp({create:{width:400,height:400,channels:3,
   background:{r:30,g:40,b:50}}}).png().toBuffer();
  const audioPath=path.join(root,"media","test.mp3");
  const imagePath=path.join(root,"media","test.png");
  await writeFile(audioPath,audio,{mode:0o600});
  await writeFile(imagePath,image,{mode:0o600});
  await chmod(audioPath,0o600);
  await chmod(imagePath,0o600);
  const owner="11111111-1111-4111-8111-111111111111";
  const media:PreparedMedia={
   sourceJobId:"synthetic-unpaid",promptLanguageConfirmed:true,
   owner:"customer-"+owner,audioPath,imagePath,
   audioSha256:createHash("sha256").update(audio).digest("hex"),
   imageSha256:createHash("sha256").update(image).digest("hex"),
   durationSeconds:5,prompt:"Sing naturally",
  };
  const order=store.order({account:owner,email:"buyer@example.test",project:"unpaid",
   cents:125,quoteEvidence:"reviewed-synthetic-customer-price",
   key:"unpaid-cloud-input"}).id;
  inputs=new CustomerR2PrivateInputDelivery(store,order,root,env);
  await assert.rejects(inputs.issue(media,new AbortController().signal),
   /already attempted or unauthorized/);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_provider_input_leases").get()?.n,0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_provider_submissions").get()?.n,0);
 }finally{
  inputs?.close();
  store.close();
  await rm(root,{recursive:true,force:true});
 }
});
