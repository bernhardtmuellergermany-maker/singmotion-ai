import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {PutObjectCommand,GetObjectCommand} from "@aws-sdk/client-s3";
import {projectCloudKey,projectR2Enabled,validProjectCloudRecord,mirrorProjectBytes,verifiedCloudBytes,mirrorProjectFile,verifyCloudStream} from "../lib/music-video/project-r2.ts";
const env={RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041",PROJECT_VIDEO_R2_ENABLED:"true",PROJECT_VIDEO_R2_VERIFIED:"true"};
const prod={...env,RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d"};
const project="11111111-1111-4111-8111-111111111111",asset="22222222-2222-4222-8222-222222222222";
const bytes=Buffer.from("test video"),sha256=createHash("sha256").update(bytes).digest("hex");
test("Projects cloud keys isolate owner and environment, writes are gated",()=>{
 const key=projectCloudKey("staff:a",project,asset,sha256,env),record={key,sha256,bytes:bytes.length};
 assert.ok(projectR2Enabled(env));assert.ok(!projectR2Enabled({}));assert.ok(!projectR2Enabled({...env,PROJECT_VIDEO_R2_VERIFIED:"false"}));
 assert.ok(validProjectCloudRecord("staff:a",project,asset,record,env));
 assert.ok(!validProjectCloudRecord("staff:b",project,asset,record,env));
 assert.ok(!validProjectCloudRecord("staff:a",project,asset,record,prod));
 assert.throws(()=>projectCloudKey("customer:a",project,asset,sha256,env));
 const customer="customer:33333333-3333-4333-8333-333333333333";
 const customerKey=projectCloudKey(customer,project,asset,sha256,env);
 assert.notEqual(customerKey,key);
 assert.ok(validProjectCloudRecord(customer,project,asset,{...record,key:customerKey},env));
 assert.ok(!validProjectCloudRecord("staff:a",project,asset,{...record,key:customerKey},env));
 const slot=project+":song.mp3",songKey=projectCloudKey(customer,project,slot,sha256,env);
 assert.ok(validProjectCloudRecord(customer,project,slot,{key:songKey,sha256,bytes:70*1024*1024},env));
 assert.ok(validProjectCloudRecord(customer,project,asset,{key:customerKey,sha256,bytes:250*1024*1024},env));
 assert.ok(!validProjectCloudRecord(customer,project,asset,{key:customerKey,sha256,bytes:250*1024*1024+1},env));
 assert.ok(!validProjectCloudRecord(customer,project,slot,{key:songKey,sha256,bytes:129*1024*1024},env));
 assert.throws(()=>projectCloudKey(customer,project,asset+":song.mp3",sha256,env));
});
test("migration demands full byte-for-byte readback, not just metadata",async()=>{
 const key=projectCloudKey("staff:a",project,asset,sha256,env);
 let stored:Buffer|undefined;
 const client={async send(c:any){
  if(c instanceof PutObjectCommand){assert.equal(c.input.IfNoneMatch,"*");assert.ok(Buffer.isBuffer(c.input.Body));stored=Buffer.from(c.input.Body);return {};}
  assert.ok(c instanceof GetObjectCommand);assert.ok(stored);
  return {ContentLength:stored.length,Metadata:{"singmotion-sha256":sha256},Body:[stored]};
 }};
 const record=await mirrorProjectBytes(client,"test",key,bytes,"video/mp4");
 assert.deepEqual(await verifiedCloudBytes(client,"test",record),bytes);
 stored=Buffer.alloc(bytes.length);await assert.rejects(verifiedCloudBytes(client,"test",record),/checksum/);
});

import {DatabaseSync} from "node:sqlite";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {retryProjectDeletes} from "../lib/music-video/project-cleanup.ts";
test("deletion retries preserve live references, owner isolation and failed manifests",async()=>{
 const root=mkdtempSync(path.join(tmpdir(),"sm-delete-"));
 const db=new DatabaseSync(path.join(root,"music-video.sqlite"));
 const owner="customer:33333333-3333-4333-8333-333333333333",key=projectCloudKey(owner,project,asset,sha256,env);
 try{
  db.exec("CREATE TABLE music_asset_cloud(owner_id TEXT,project_id TEXT,asset_id TEXT,object_key TEXT,sha256 TEXT,bytes INTEGER,pending_delete INTEGER); CREATE TABLE music_projects(id TEXT,owner_id TEXT); CREATE TABLE music_assets(id TEXT); CREATE TABLE music_clips(asset_id TEXT); CREATE TABLE music_operation_leases(owner_id TEXT,expires_at INTEGER)");
  db.prepare("INSERT INTO music_asset_cloud VALUES(?,?,?,?,?,?,1)").run(owner,project,asset,key,sha256,bytes.length);
  let removed=0;
  const remove=async()=>{removed++;};
  db.prepare("INSERT INTO music_clips VALUES(?)").run(asset);
  assert.equal((await retryProjectDeletes(root,{env,remove})).checked,0);
  db.exec("DELETE FROM music_clips");
  db.prepare("INSERT INTO music_operation_leases VALUES(?,?)").run(owner,Date.now()+60000);
  assert.equal((await retryProjectDeletes(root,{env,remove})).checked,0);
  db.exec("DELETE FROM music_operation_leases");
  assert.equal((await retryProjectDeletes(root,{env,remove,owner:"staff:a"})).checked,0);
  assert.equal((await retryProjectDeletes(root,{env,remove:async()=>{throw Error("R2 unavailable")}})).deferred,1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM music_asset_cloud").get() as {n:number}).n,1);
  assert.equal((await retryProjectDeletes(root,{env,remove})).deleted,1);
  assert.equal(removed,1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM music_asset_cloud").get() as {n:number}).n,0);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

import {writeFileSync} from "node:fs";
test("R2 file transfer streams a conditional upload and verifies every byte",async()=>{
 const root=mkdtempSync(path.join(tmpdir(),"sm-stream-r2-")),file=path.join(root,"test.mp4");
 const content=Buffer.from("video payload");
 let remote=Buffer.alloc(0),metadata:Record<string,string>|undefined;
 const client={async send(command:any){
  if(command instanceof PutObjectCommand){
   assert.equal(command.input.IfNoneMatch,"*");
   assert.equal(command.input.ContentLength,content.length);
   assert.equal(command.input.ContentMD5,createHash("md5").update(content).digest("base64"));
   assert.ok(!Buffer.isBuffer(command.input.Body));
   const chunks:Buffer[]=[];for await(const chunk of command.input.Body as AsyncIterable<Uint8Array>)chunks.push(Buffer.from(chunk));remote=Buffer.concat(chunks);
   metadata=command.input.Metadata;
   return {};
  }
  return {ContentLength:remote.length,Metadata:metadata,Body:[remote.subarray(0,3),remote.subarray(3)]};
 }};
 try{
  writeFileSync(file,content);
  const key=(hash:string)=>projectCloudKey("staff:a",project,asset,hash,env);
  const record=await mirrorProjectFile(client,"test",key,file,"video/mp4",250*1024*1024);
  assert.equal(record.sha256,createHash("sha256").update(content).digest("hex"));
  let total=0;await verifyCloudStream(client,"test",record,async chunk=>{total+=chunk.length;});
  assert.equal(total,content.length);
  remote[0]^=1;
  await assert.rejects(verifyCloudStream(client,"test",record),/checksum mismatch/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("frozen customer Projects erasure removes only verified owned projects and retains rows on cloud failure",async()=>{
 const {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync}=await import("node:fs");
 const {tmpdir}=await import("node:os");const {join}=await import("node:path");
 const {DatabaseSync}=await import("node:sqlite");
 const {customerProjectsErasureInventory,eraseCustomerProjects}=await import("../lib/music-video/customer-project-erasure.ts");
 const root=mkdtempSync(join(tmpdir(),"sm-project-erase-"));
 const account="33333333-3333-4333-8333-333333333333",owner="customer:"+account,other="customer:44444444-4444-4444-8444-444444444444";
 const otherProject="55555555-5555-4555-8555-555555555555";
 try{
  const db=new DatabaseSync(join(root,"music-video.sqlite"));
  db.exec("CREATE TABLE music_projects(id TEXT PRIMARY KEY,owner_id TEXT); CREATE TABLE music_assets(id TEXT,project_id TEXT); CREATE TABLE music_clips(project_id TEXT); CREATE TABLE music_asset_cloud(project_id TEXT,asset_id TEXT,owner_id TEXT,object_key TEXT,sha256 TEXT,bytes INTEGER);");
  db.prepare("INSERT INTO music_projects VALUES(?,?)").run(project,owner);db.prepare("INSERT INTO music_projects VALUES(?,?)").run(otherProject,other);
  db.prepare("INSERT INTO music_asset_cloud VALUES(?,?,?,?,?,?)").run(project,asset,owner,projectCloudKey(owner,project,asset,sha256,env),sha256,bytes.length);db.close();
  for(const id of [project,otherProject]){mkdirSync(join(root,"music-video",id),{recursive:true});writeFileSync(join(root,"music-video",id,"song.mp3"),bytes);}
  assert.deepEqual(customerProjectsErasureInventory(root,account),{musicProjects:1,musicProjectCloudObjects:1});
  await assert.rejects(eraseCustomerProjects(root,account,{env,remove:async()=>{throw Error("R2 unavailable")}}));
  assert.equal(customerProjectsErasureInventory(root,account).musicProjects,1);
  assert.ok(existsSync(join(root,"music-video",project)));
  const removed:string[]=[];
  await eraseCustomerProjects(root,account,{env,remove:async(o,p,a)=>{assert.equal(o,owner);assert.equal(p,project);removed.push(a);}});
  assert.deepEqual(removed,[asset]);assert.deepEqual(customerProjectsErasureInventory(root,account),{musicProjects:0,musicProjectCloudObjects:0});
  assert.ok(existsSync(join(root,"music-video",otherProject)));assert.ok(!existsSync(join(root,"music-video",project)));
 }finally{rmSync(root,{recursive:true,force:true});}
});
