/** Owner-bound file and database cleanup for a frozen customer.
 *
 * This is a resumable saga step: every remote/local deletion is verified
 * before removing its owner record. No cross-database atomicity is claimed.
 * Any active/uncertain provider task, unverified R2 lease, unknown owner
 * reference or unexpected file type stops the job without falsely marking
 * it complete. Financial Stripe and paid Credit records are not erased here.
 */
import path from "node:path";
import {existsSync} from "node:fs";
import {lstat,realpath,unlink} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {DeleteObjectCommand,HeadObjectCommand,S3Client} from "@aws-sdk/client-s3";
import {deleteMirroredPrivateSource,validCloudRecord,type CloudMediaRecord} from "../cloud-media.ts";
import {deletePrivatePaidVideo,validPaidCloudRecord,type CloudPaidVideoRecord} from "../cloud-paid-video.ts";
import {R2PrivateInputDelivery} from "../live/r2.ts";
import {LiveTestStore} from "../live/store.ts";
import {loadR2Config,r2ClientConfig} from "../live/r2-config.ts";
import {inputDeliveryPolicy} from "../live/input-policy.ts";
import type {Asset} from "../domain.ts";
import {readErasureJob} from "./customer-erasure-job.ts";

type StorageDb={db:DatabaseSync;kind:"demo"|"live"|"commerce"};
type CloudSource={asset_id:string;key:string;sha256:string;bytes:number};
type PaidOutput={order_id:string;key:string;sha256:string;bytes:number};
type Lease={order_id:string;audio_key:string;image_key:string;expires_at:number;state:string};
type LiveAttempt={id:string;source_job_id:string;data:string};
type MediaAsset={id:string;owner:string;data:string};
const uuid=/^[a-f0-9-]{36}$/i;
const fileId=/^[A-Za-z0-9_-]{1,180}$/;
const localName=/^[A-Za-z0-9_-]{1,180}(?:\.[A-Za-z0-9_-]{1,30}){0,2}$/;
const safe=(name:string)=>'"'+name.replaceAll('"','""')+'"';
const sha=(input:string)=>createHash("sha256").update(input).digest("hex");
const has=(db:DatabaseSync,name:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const cols=(db:DatabaseSync,name:string)=>(db.prepare("PRAGMA table_info("+safe(name)+")").all() as Array<{name:string;type:string}>);
export class CustomerMediaErasureBlocked extends Error{
 constructor(readonly code:string){super(code)}
}
export type CustomerMediaErasurePlan={
 assets:number;studioProjects:number;providerTasks:number;paidOutputs:number;
 inputLeases:number;cloudSources:number;
};
type Dependencies={
 deleteSource?:(owner:string,id:string,record:CloudMediaRecord)=>Promise<void>;
 deletePaid?:(account:string,order:string,record:CloudPaidVideoRecord)=>Promise<void>;
 deleteLease?:(account:string,order:string,audio:string,image:string)=>Promise<void>;
 deleteLiveInputs?:(attemptId:string,root:string)=>Promise<void>;
 deleteLocal?:(root:string,base:"media"|"live-output",name:string)=>Promise<void>;
};
const run=(db:DatabaseSync,sql:string,...args:(string|number)[])=>
 db.prepare(sql).all(...args) as Array<Record<string,unknown>>;
const list=<T>(db:DatabaseSync,name:string,sql:string,...params:(string|number)[]):T[]=>
 has(db,name)?db.prepare(sql).all(...params) as T[]:[];
const owns=(db:DatabaseSync,id:string,email:string,allowed:Set<string>)=>{
 const owner="customer-"+id,subject="customer:"+id;
 for(const item of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[]){
  if(allowed.has(item.name))continue;
  const clauses:string[]=[],args:string[]=[];
  for(const col of cols(db,item.name)){
   if(!/(TEXT|CHAR|CLOB|JSON|VARCHAR)/i.test(col.type))continue;
   const field=safe(col.name);
   clauses.push("("+field+"=? OR "+field+"=? OR "+field+"=? OR lower("+field+")=lower(?) OR instr("+field+",?)>0 OR instr("+field+",?)>0)");
   args.push(id,owner,subject,email,owner,subject);
  }
  if(clauses.length&&db.prepare("SELECT 1 FROM "+safe(item.name)+" WHERE "+clauses.join(" OR ")+" LIMIT 1").get(...args))
   throw new CustomerMediaErasureBlocked("UNKNOWN_MEDIA_REFERENCE");
 }
};
async function localFile(root:string,base:"media"|"live-output",name:string):Promise<void>{
 if(!localName.test(name)||name.includes(".."))throw new CustomerMediaErasureBlocked("INVALID_MEDIA_ID");
 const absolute=await realpath(root);
 const folder=await realpath(path.join(root,base)).catch(()=>null);
 if(folder!==path.join(absolute,base))
  throw new CustomerMediaErasureBlocked("MEDIA_FOLDER_UNVERIFIED");
 const location=path.resolve(folder,name);
 if(path.dirname(location)!==folder)throw new CustomerMediaErasureBlocked("MEDIA_PATH_OUTSIDE_STORAGE");
 const info=await lstat(location).catch((error:NodeJS.ErrnoException)=>{
  if(error.code==="ENOENT")return null;throw error;
 });
 if(!info)return;
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)
  throw new CustomerMediaErasureBlocked("MEDIA_FILE_NOT_REGULAR");
 await unlink(location);
}
async function deletePaidInputLease(account:string,order:string,audio:string,image:string){
 const owner="customer-"+account,pre="customer-byteplus-inputs/v1/"+sha(owner)+"/"+order+"/";
 if(!uuid.test(account)||!uuid.test(order)||!audio.startsWith(pre)||!image.startsWith(pre)||
    audio===image||!/^customer-byteplus-inputs\/v1\/[a-f0-9]{64}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9]{64}\.mp3$/.test(audio)||
    !/^customer-byteplus-inputs\/v1\/[a-f0-9]{64}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9]{64}\.(?:jpg|png)$/.test(image)||
    audio.slice(0,audio.lastIndexOf("/"))!==image.slice(0,image.lastIndexOf("/")))
  throw new CustomerMediaErasureBlocked("UNTRUSTED_INPUT_LEASE");
 const config=loadR2Config(),client=new S3Client(r2ClientConfig(config));
 try{
  for(const key of [audio,image]){
   await client.send(new DeleteObjectCommand({Bucket:config.bucket,Key:key}));
   try{
    await client.send(new HeadObjectCommand({Bucket:config.bucket,Key:key}));
    throw new CustomerMediaErasureBlocked("R2_DELETE_NOT_VERIFIED");
   }catch(error){
    if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==404)
     throw error;
   }
  }
 }finally{client.destroy()}
}
const demoKnown=new Set(["sessions","assets","artists","jobs","ledger","audit","studio_drafts",
 "studio_draft_actions","cloud_source_media","rate_limits"]);
const liveKnown=new Set(["live_attempts","live_studio_projects","live_studio_actions",
 "live_input_deliveries","live_daily_reservations","live_private_exceptions",
 "live_contract_reviews","live_first_test","live_second_test","live_second_authorizations",
 "live_first_test_results","live_output_reviews","live_operator_actions",
 "live_output_checks","live_export_attempts","live_studio_credit_video_ready_outbox"]);
const commerceKnown=new Set(["customer_accounts","customer_sessions","customer_erasure_jobs",
 "customer_erasure_refund_intents","customer_session_policies","customer_email_verifications",
 "customer_google_identities","customer_password_resets","customer_email_preferences",
 "credit_topup_purchases","credit_purchase_tax_context","credit_wallet_ledger",
 "credit_video_reservations","customer_orders","customer_credits","customer_holds",
 "customer_fulfillment_queue","customer_provider_jobs","customer_video_deliveries",
 "customer_order_inputs","customer_prepared_media","customer_provider_submissions",
 "customer_provider_cost_reservations","customer_provider_input_leases",
 "customer_guest_media_owners","customer_guest_order_claims","cloud_paid_videos",
 "customer_hidden_paid_orders","customer_video_ready_notifications",
 "customer_studio_credit_video_ready_outbox","commerce_audit"]);
function inspect(demo:DatabaseSync,live:DatabaseSync|null,commerce:DatabaseSync,id:string,email:string){
 const owner="customer-"+id;
 // Each namespace must be unambiguous. Guest-claimed orders require separate
 // owner proofs; never delete a different customer's or guest's files.
 if(has(commerce,"customer_guest_order_claims")&&
    commerce.prepare("SELECT 1 FROM customer_guest_order_claims WHERE account_id=? LIMIT 1").get(id))
  throw new CustomerMediaErasureBlocked("GUEST_ORDER_CLAIM");
 const assets=list<MediaAsset>(demo,"assets","SELECT id,owner,data FROM assets WHERE owner=?",owner);
 const demoJobs=list<{status:string}>(demo,"jobs","SELECT status FROM jobs WHERE owner=?",owner);
 if(demoJobs.some(x=>["queued","processing"].includes(x.status)))
  throw new CustomerMediaErasureBlocked("ACTIVE_MEDIA_JOB");
 const orders=list<{id:string;status:string}>(commerce,"customer_orders",
  "SELECT id,status FROM customer_orders WHERE account_id=?",id);
 const orderIds=new Set(orders.map(x=>x.id));
 if(has(commerce,"customer_fulfillment_queue")){
  for(const order of orders){
   const queue=commerce.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(order.id) as {state:string}|undefined;
   if(queue&&["pending","processing"].includes(queue.state))
    throw new CustomerMediaErasureBlocked("ACTIVE_PAID_PROVIDER_JOB");
  }
 }
 const attempts=live?list<LiveAttempt>(live,"live_attempts",
  "SELECT id,source_job_id,data FROM live_attempts WHERE json_extract(data,'$.media.owner')=?",owner):[];
 for(const entry of attempts){
  const attempt=JSON.parse(entry.data) as {id:string;state?:string;media?:{owner?:string};outputPath?:string|null};
  if(entry.id!==attempt.id||attempt.media?.owner!==owner||
     !["prepared","completed","failed"].includes(attempt.state||""))
   throw new CustomerMediaErasureBlocked("ACTIVE_OR_UNKNOWN_PROVIDER_JOB");
 }
 const projectIds=live?list<{attempt_id:string}>(live,"live_studio_projects",
  "SELECT attempt_id FROM live_studio_projects WHERE owner=?",owner).map(x=>x.attempt_id):[];
 if(projectIds.some(id=>!attempts.some(x=>x.id===id)))
  throw new CustomerMediaErasureBlocked("STUDIO_PROJECT_MISSING_ATTEMPT");
 // An unmodelled table referencing a deleted attempt or paid order would be
 // left orphaned, or worse: lose payment evidence. Refuse before any purge.
 if(live){
  const tables=live.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[];
  for(const table of tables){
   if(liveKnown.has(table.name))continue;
   if(cols(live,table.name).some(c=>c.name==="attempt_id")){
    const stmt=live.prepare("SELECT 1 FROM "+safe(table.name)+" WHERE attempt_id=? LIMIT 1");
    if(attempts.some(a=>stmt.get(a.id)))
     throw new CustomerMediaErasureBlocked("UNKNOWN_LIVE_ATTEMPT_REFERENCE");
   }
  }
 }
 const unknownOrders=commerce.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[];
 for(const table of unknownOrders){
  if(commerceKnown.has(table.name))continue;
  if(cols(commerce,table.name).some(c=>c.name==="order_id")){
   const match=commerce.prepare("SELECT 1 FROM "+safe(table.name)+" WHERE order_id=? LIMIT 1");
   if(orders.some(order=>match.get(order.id)))
    throw new CustomerMediaErasureBlocked("UNKNOWN_PAID_ORDER_REFERENCE");
  }
 }
 const sources=list<CloudSource>(demo,"cloud_source_media",
  "SELECT asset_id,key,sha256,bytes FROM cloud_source_media WHERE owner=?",owner);
 for(const source of sources){
  if(!assets.some(x=>x.id===source.asset_id)||!validCloudRecord(owner,source.asset_id,source))
   throw new CustomerMediaErasureBlocked("R2_SOURCE_OWNER_MISMATCH");
 }
 const paid=list<PaidOutput>(commerce,"cloud_paid_videos",
  "SELECT order_id,key,sha256,bytes FROM cloud_paid_videos WHERE account_id=?",id);
 for(const item of paid)
  if(!orderIds.has(item.order_id)||!validPaidCloudRecord(id,item.order_id,item))
   throw new CustomerMediaErasureBlocked("R2_PAID_VIDEO_OWNER_MISMATCH");
 const leases=list<Lease>(commerce,"customer_provider_input_leases",
  "SELECT order_id,audio_key,image_key,expires_at,state FROM customer_provider_input_leases WHERE account_id=?",id);
 for(const lease of leases)
  if(!orderIds.has(lease.order_id)||lease.state==="uploading"||lease.state==="requires-review"||
     lease.state!=="ready"||!Number.isSafeInteger(lease.expires_at)||
     Date.now()<lease.expires_at+inputDeliveryPolicy.cleanupGraceSeconds*1000)
   throw new CustomerMediaErasureBlocked("PROVIDER_INPUT_LEASE_ACTIVE");
 // Incomplete active R2 signed deliveries require their own independent
 // expiry/grace check before sending any delete requests to R2.
 for(const attempt of attempts){
  if(!live||!has(live,"live_input_deliveries"))continue;
  const delivery=live.prepare("SELECT state,manifest FROM live_input_deliveries WHERE attempt_id=?")
   .get(attempt.id) as {state:string;manifest:string}|undefined;
  if(!delivery||delivery.state==="cleaned")continue;
  const manifest=JSON.parse(delivery.manifest) as {expiresAt?:number};
  if(!Number.isSafeInteger(manifest.expiresAt)||
     Date.now()<(manifest.expiresAt!+inputDeliveryPolicy.cleanupGraceSeconds*1000))
   throw new CustomerMediaErasureBlocked("LIVE_PROVIDER_INPUT_LEASE_ACTIVE");
 }
 // Future columns/tables with owner identities block rather than silently
 // outliving the account in unmodelled storage.
 owns(demo,id,email,demoKnown);
 if(live)owns(live,id,email,liveKnown);
 owns(commerce,id,email,commerceKnown);
 return {owner,assets,orders,attempts,sources,paid,leases,projectIds};
}
export function assessCustomerMediaErasure(root:string,id:string):CustomerMediaErasurePlan{
 if(!uuid.test(id))throw new CustomerMediaErasureBlocked("INVALID_OWNER");
 const demoFile=path.join(root,"demo.sqlite"),commerceFile=path.join(root,"commerce.sqlite");
 if(!existsSync(demoFile)||!existsSync(commerceFile))
  throw new CustomerMediaErasureBlocked("MEDIA_DATABASE_MISSING");
 const demo=new DatabaseSync(demoFile,{readOnly:true});
 const live=existsSync(path.join(root,"live-test.sqlite"))?
  new DatabaseSync(path.join(root,"live-test.sqlite"),{readOnly:true}):null;
 const commerce=new DatabaseSync(commerceFile,{readOnly:true});
 try{
  const profile=commerce.prepare("SELECT email FROM customer_accounts WHERE id=?")
   .get(id) as {email:string}|undefined;
  if(!profile)throw new CustomerMediaErasureBlocked("ACCOUNT_NOT_FOUND");
  const v=inspect(demo,live,commerce,id,profile.email);
  return {assets:v.assets.length,studioProjects:v.projectIds.length,
   providerTasks:v.attempts.length,paidOutputs:v.paid.length,
   inputLeases:v.leases.length,cloudSources:v.sources.length};
 }finally{demo.close();live?.close();commerce.close()}
}
/** Deletes all verified owner-owned local + cloud media, then the corresponding
 * rows. Never deletes invoices, paid purchase evidence or other users' media.
 * Caller must freeze the account first. On remote failure the durable job
 * remains incomplete and the worker can safely repeat the same exact keys.
 */
export async function eraseCustomerMedia(root:string,id:string,deps:Dependencies={}):Promise<CustomerMediaErasurePlan>{
 if(!uuid.test(id))throw new CustomerMediaErasureBlocked("INVALID_OWNER");
 const demoFile=path.join(root,"demo.sqlite"),commerceFile=path.join(root,"commerce.sqlite"),
  liveFile=path.join(root,"live-test.sqlite");
 if(!existsSync(demoFile)||!existsSync(commerceFile))
  throw new CustomerMediaErasureBlocked("MEDIA_DATABASE_MISSING");
 const commerce=new DatabaseSync(commerceFile);
 const demo=new DatabaseSync(demoFile);
 const live=existsSync(liveFile)?new DatabaseSync(liveFile):null;
 const source=deps.deleteSource??deleteMirroredPrivateSource;
 const paidDelete=deps.deletePaid??deletePrivatePaidVideo;
 const leaseDelete=deps.deleteLease??deletePaidInputLease;
 const local=deps.deleteLocal??localFile;
 const liveInputs=deps.deleteLiveInputs??(async(attemptId:string,root:string)=>{
  const db=new LiveTestStore(path.join(root,"live-test.sqlite"));
  const provider=new R2PrivateInputDelivery(db,root);
  try{await provider.cleanupExpired(attemptId,new AbortController().signal)}
  finally{provider.close();db.close()}
 });
 try{
  const job=readErasureJob(commerce,id);
  if(!job||job.state!=="removing-media")
   throw new CustomerMediaErasureBlocked("ERASURE_NOT_FROZEN");
  const profile=commerce.prepare("SELECT email FROM customer_accounts WHERE id=?")
   .get(id) as {email:string}|undefined;
  if(!profile)throw new CustomerMediaErasureBlocked("ACCOUNT_NOT_FOUND");
  const v=inspect(demo,live,commerce,id,profile.email);
  const result:CustomerMediaErasurePlan={
   assets:v.assets.length,studioProjects:v.projectIds.length,
   providerTasks:v.attempts.length,paidOutputs:v.paid.length,
   inputLeases:v.leases.length,cloudSources:v.sources.length};
  // Verify every authorized local path *before* any irreversible R2 call.
  for(const row of v.assets){
   const asset=JSON.parse(row.data) as Asset;
   if(asset.id!==row.id||asset.owner!==v.owner||!fileId.test(asset.id)||
      !["audio","image","video"].includes(asset.kind)||
      !Number.isSafeInteger(asset.bytes)||asset.bytes<=0)
    throw new CustomerMediaErasureBlocked("INVALID_LOCAL_ASSET");
   const filename=asset.id.startsWith("customer-video-")?
    "paid-"+asset.id.slice("customer-video-".length)+".mp4":asset.id;
   if(path.resolve(asset.path)!==path.resolve(root,"media",filename))
    throw new CustomerMediaErasureBlocked("INVALID_LOCAL_ASSET_PATH");
  }
  for(const item of v.attempts){
   const attempt=JSON.parse(item.data) as {outputPath?:string|null};
   if(typeof attempt.outputPath==="string"&&attempt.outputPath){
    const filename=path.basename(attempt.outputPath);
    if(!localName.test(filename)||path.resolve(attempt.outputPath)!==path.resolve(root,"live-output",filename))
     throw new CustomerMediaErasureBlocked("INVALID_LIVE_OUTPUT_PATH");
   }
  }
  for(const entry of v.leases)
   await leaseDelete(id,entry.order_id,entry.audio_key,entry.image_key);
  for(const item of v.attempts){
   if(live&&has(live,"live_input_deliveries")){
    const state=live.prepare("SELECT state FROM live_input_deliveries WHERE attempt_id=?")
     .get(item.id) as {state:string}|undefined;
    if(state&&state.state!=="cleaned")await liveInputs(item.id,root);
   }
  }
  for(const row of v.sources)await source(v.owner,row.asset_id,row);
  for(const row of v.paid)await paidDelete(id,row.order_id,row);
  for(const assetRow of v.assets){
   const asset=JSON.parse(assetRow.data) as Asset;
   if(asset.id!==assetRow.id||asset.owner!==v.owner||!fileId.test(asset.id)||
      !["audio","image","video"].includes(asset.kind)||
      !Number.isSafeInteger(asset.bytes)||asset.bytes<=0)
    throw new CustomerMediaErasureBlocked("INVALID_LOCAL_ASSET");
   const filename=asset.id.startsWith("customer-video-")?
    "paid-"+asset.id.slice("customer-video-".length)+".mp4":asset.id;
   if(path.resolve(asset.path)!==path.resolve(root,"media",filename))
    throw new CustomerMediaErasureBlocked("INVALID_LOCAL_ASSET_PATH");
   await local(root,"media",filename);
   if(asset.kind==="audio")await local(root,"media",asset.id+".preview.mp3");
  }
  for(const item of v.attempts){
   const attempt=JSON.parse(item.data) as {outputPath?:string|null};
   if(typeof attempt.outputPath==="string"&&attempt.outputPath){
    const filename=path.basename(attempt.outputPath);
    if(!localName.test(filename)||path.resolve(attempt.outputPath)!==path.resolve(root,"live-output",filename))
     throw new CustomerMediaErasureBlocked("INVALID_LIVE_OUTPUT_PATH");
    await local(root,"live-output",filename);
   }
  }
  // SQL files cannot share an atomic transaction. We only perform SQL
  // changes after remote/local deletion is independently confirmed.
  demo.exec("BEGIN IMMEDIATE");
  try{
   for(const table of ["sessions","assets","artists","jobs","ledger","audit","studio_drafts"]){
    if(has(demo,table)&&cols(demo,table).some(c=>c.name==="owner"))
     demo.prepare("DELETE FROM "+safe(table)+" WHERE owner=?").run(v.owner);
   }
   if(has(demo,"studio_draft_actions")&&cols(demo,"studio_draft_actions").some(c=>c.name==="owner"))
    demo.prepare("DELETE FROM studio_draft_actions WHERE owner=?").run(v.owner);
   if(has(demo,"cloud_source_media"))demo.prepare("DELETE FROM cloud_source_media WHERE owner=?").run(v.owner);
   demo.exec("COMMIT");
  }catch(e){demo.exec("ROLLBACK");throw e}
  if(live){
   live.exec("BEGIN IMMEDIATE");
   try{
    for(const attempt of v.attempts){
     const tables=live.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[];
     for(const table of tables){
      if(table.name==="live_attempts"||!liveKnown.has(table.name))continue;
      if(cols(live,table.name).some(c=>c.name==="attempt_id"))
       live.prepare("DELETE FROM "+safe(table.name)+" WHERE attempt_id=?").run(attempt.id);
     }
     live.prepare("DELETE FROM live_attempts WHERE id=?").run(attempt.id);
    }
    if(has(live,"live_studio_projects"))live.prepare("DELETE FROM live_studio_projects WHERE owner=?").run(v.owner);
    live.exec("COMMIT");
   }catch(e){live.exec("ROLLBACK");throw e}
  }
  // The paid output and provider input rows contain private filenames/keys;
  // financial tax and refund records intentionally remain out of this scope.
  commerce.exec("BEGIN IMMEDIATE");
  try{
   for(const order of v.orders){
    for(const table of ["cloud_paid_videos","customer_video_deliveries",
      "customer_prepared_media","customer_order_inputs",
      "customer_provider_input_leases","customer_provider_submissions"]){
     if(has(commerce,table))
      commerce.prepare("DELETE FROM "+safe(table)+" WHERE order_id=?").run(order.id);
    }
   }
   commerce.exec("COMMIT");
  }catch(e){commerce.exec("ROLLBACK");throw e}
  return result;
 }finally{commerce.close();demo.close();live?.close()}
}
