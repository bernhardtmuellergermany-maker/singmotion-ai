import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {CommerceStore} from "../lib/commerce/store.ts";
import {privateSourceKey} from "../lib/cloud-media.ts";
import {assessCustomerMediaErasure,assertCustomerMediaErasureReady,eraseCustomerMedia,CustomerMediaErasureBlocked} from "../lib/commerce/customer-erasure-media.ts";
const pass="a-genuinely-long-test-password";
async function fixture(fn:(store:CommerceStore,demo:DatabaseSync,root:string,id:string,other:string)=>Promise<void>){
 const root=mkdtempSync(path.join(tmpdir(),"sm-media-erasure-"));
 mkdirSync(path.join(root,"media"));mkdirSync(path.join(root,"live-output"));
 const store=new CommerceStore(path.join(root,"commerce.sqlite"),{CUSTOMER_BETA_WELCOME_CREDITS_ENABLED:"false"});
 const demo=new DatabaseSync(path.join(root,"demo.sqlite"));
 demo.exec("CREATE TABLE assets(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL);CREATE TABLE jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL);CREATE TABLE cloud_source_media(asset_id TEXT PRIMARY KEY,owner TEXT NOT NULL,key TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL);CREATE TABLE sessions(token TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL,admin INTEGER NOT NULL DEFAULT 0)");
 const id=store.register("first@example.test",pass),other=store.register("second@example.test",pass);
 store.db.prepare("INSERT INTO customer_erasure_jobs(account_id,token_hash,state,created_at,updated_at) VALUES(?,?,'removing-media',?,?)").run(id,"test-token-hash",1,1);
 try{await fn(store,demo,root,id,other)}
 finally{demo.close();store.close();rmSync(root,{recursive:true,force:true})}
}
function asset(demo:DatabaseSync,root:string,owner:string,id:string){
 const body="test media";
 const file=path.join(root,"media",id);
 writeFileSync(file,body);
 const obj={id,owner,kind:"audio",name:"demo",path:file,mime:"audio/mpeg",bytes:body.length,duration:3,width:null,height:null,created:1};
 demo.prepare("INSERT INTO assets VALUES(?,?,?)").run(id,owner,JSON.stringify(obj));
}
test("one customer can erase their owned files and cloud keys without affecting another owner",async()=>{
 await fixture(async(store,demo,root,id,other)=>{
  const owner="customer-"+id,otherOwner="customer-"+other;
  asset(demo,root,owner,"audio-own");
  asset(demo,root,otherOwner,"audio-foreign");
  const source={asset_id:"audio-own",owner,key:privateSourceKey(owner,"audio-own","a".repeat(64)),sha256:"a".repeat(64),bytes:10};
  demo.prepare("INSERT INTO cloud_source_media VALUES(?,?,?,?,?)")
   .run(source.asset_id,owner,source.key,source.sha256,source.bytes);
  assert.equal(assessCustomerMediaErasure(root,id).assets,1);
  let deleted=0;
  await eraseCustomerMedia(root,id,{
   deleteSource:async(o,a,r)=>{assert.equal(o,owner);assert.equal(a,"audio-own");assert.equal(r.key,source.key);deleted++;}
  });
  assert.equal(deleted,1);
  assert.equal(existsSync(path.join(root,"media","audio-own")),false);
  assert.equal(existsSync(path.join(root,"media","audio-foreign")),true);
  assert.equal(demo.prepare("SELECT 1 FROM assets WHERE owner=?").get(owner),undefined);
  assert.ok(demo.prepare("SELECT 1 FROM assets WHERE owner=?").get(otherOwner));
  assert.equal(demo.prepare("SELECT 1 FROM cloud_source_media WHERE owner=?").get(owner),undefined);
  assert.ok(store.db.prepare("SELECT 1 FROM customer_accounts WHERE id=?").get(id),
   "financial and account data removal is a separate verified job step");
 });
});
test("unfinished demo generation and unknown customer tables block without removing media",async()=>{
 await fixture(async(store,demo,root,id)=>{
  const owner="customer-"+id;
  asset(demo,root,owner,"blocked-audio");
  demo.prepare("INSERT INTO jobs VALUES(?,?,?,?)").run("job-1",owner,"processing","{}");
  assert.throws(()=>assessCustomerMediaErasure(root,id),
   (e:unknown)=>e instanceof CustomerMediaErasureBlocked&&e.code==="ACTIVE_MEDIA_JOB");
  demo.prepare("UPDATE jobs SET status='completed'").run();
  demo.exec("CREATE TABLE future_media_schema(payload TEXT)");
  demo.prepare("INSERT INTO future_media_schema VALUES(?)").run(JSON.stringify({owner}));
  assert.throws(()=>assessCustomerMediaErasure(root,id),
   (e:unknown)=>e instanceof CustomerMediaErasureBlocked&&e.code==="UNKNOWN_MEDIA_REFERENCE");
  assert.ok(existsSync(path.join(root,"media","blocked-audio")));
 });
});
test("incomplete paid-provider output blocks before deleting private files",async()=>{
 await fixture(async(store,demo,root,id)=>{
  const owner="customer-"+id;
  asset(demo,root,owner,"paid-project-audio");
  store.db.prepare("INSERT INTO customer_orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
   .run("paid-order-1",id,null,null,"first@example.test","project-1",499,"eur","paid","{}","req-1",1);
  store.db.prepare("INSERT INTO customer_fulfillment_queue VALUES(?,'processing',?)").run("paid-order-1",1);
  assert.throws(()=>assessCustomerMediaErasure(root,id),
    (e:unknown)=>e instanceof CustomerMediaErasureBlocked&&e.code==="ACTIVE_PAID_PROVIDER_JOB");
  assert.ok(existsSync(path.join(root,"media","paid-project-audio")));
 });
});

test("remote media cleanup is refused before refund when R2 storage is not explicitly enabled",()=>{
 const empty={assets:0,studioProjects:0,providerTasks:0,paidOutputs:0,inputLeases:0,cloudSources:0};
 assert.doesNotThrow(()=>assertCustomerMediaErasureReady(empty));
 const prev=process.env.CUSTOMER_R2_STORAGE_ENABLED;
 try{
  process.env.CUSTOMER_R2_STORAGE_ENABLED="false";
  assert.throws(()=>assertCustomerMediaErasureReady({...empty,cloudSources:1}),
   (e:unknown)=>e instanceof CustomerMediaErasureBlocked&&e.code==="PRIVATE_MEDIA_CLEANUP_UNAVAILABLE");
  assert.throws(()=>assertCustomerMediaErasureReady({...empty,paidOutputs:1}),
   (e:unknown)=>e instanceof CustomerMediaErasureBlocked&&e.code==="PRIVATE_MEDIA_CLEANUP_UNAVAILABLE");
 }finally{
  if(prev===undefined)delete process.env.CUSTOMER_R2_STORAGE_ENABLED;
  else process.env.CUSTOMER_R2_STORAGE_ENABLED=prev;
 }
});
