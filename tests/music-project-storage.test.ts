import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {projectStorage,storageOverview,storageCapacity,reserveProjectUpload} from "../lib/music-video/storage.ts";
test("project storage is owner scoped, counts physical copies only, and rejects symlink directories",()=>{
 const root=mkdtempSync(path.join(tmpdir(),"sm-storage-"));
 const a="11111111-1111-4111-8111-111111111111",b="22222222-2222-4222-8222-222222222222",c="33333333-3333-4333-8333-333333333333";
 try{
  const db=new DatabaseSync(path.join(root,"music-video.sqlite"));db.exec("CREATE TABLE music_projects(id TEXT PRIMARY KEY,owner_id TEXT)");
  for(const [id,owner] of [[a,"staff:a"],[b,"staff:b"],[c,"staff:a"]])db.prepare("INSERT INTO music_projects VALUES(?,?)").run(id,owner);db.close();
  const base=path.join(root,"music-video");mkdirSync(path.join(base,a),{recursive:true});mkdirSync(path.join(base,b));
  writeFileSync(path.join(base,a,"song-original.mp3"),Buffer.alloc(100));writeFileSync(path.join(base,a,"song.mp3"),Buffer.alloc(100));
  writeFileSync(path.join(base,a,a+".mp4"),Buffer.alloc(200));writeFileSync(path.join(base,a,"preview.jpg"),Buffer.alloc(50));
  writeFileSync(path.join(base,b,b+".mp4"),Buffer.alloc(999));symlinkSync(path.join(base,b),path.join(base,c));
  const own=projectStorage(root,"staff:a");assert.equal(own.totalBytes,450);assert.equal(own.audioBytes,200);assert.equal(own.videoBytes,200);assert.equal(own.otherBytes,50);assert.equal(own.partial,true);
  assert.equal(projectStorage(root,"staff:b").totalBytes,999);assert.equal(projectStorage(root,"staff:other").totalBytes,0);assert.equal(projectStorage(root).totalBytes,1449);
  const d=new DatabaseSync(path.join(root,"demo.sqlite"));d.exec("CREATE TABLE cloud_source_media(bytes INTEGER); INSERT INTO cloud_source_media VALUES(123)");d.close();
  const e=new DatabaseSync(path.join(root,"commerce.sqlite"));e.exec("CREATE TABLE cloud_paid_videos(bytes INTEGER); INSERT INTO cloud_paid_videos VALUES(456)");e.close();
  assert.deepEqual(storageOverview(root).cloud,{sourceBytes:123,sourceObjects:1,videoBytes:456,videoObjects:1});
  const disk=storageCapacity(root);assert.ok(disk.totalBytes>=disk.availableBytes);
  assert.throws(()=>reserveProjectUpload(root,disk.availableBytes,"video"));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("Projects workspace has no storage panel; authenticated admin retains owner-scoped cloud migration",()=>{
 const projects=readFileSync("components/music-projects-client.tsx","utf8");
 const admin=readFileSync("components/cms/customer-insights-client.tsx","utf8");
 const route=readFileSync("app/(site)/api/music-video/[[...parts]]/route.ts","utf8");
 assert.ok(!projects.includes('aria-label="Project storage"'));
 assert.ok(!projects.includes("/storage-migrate"));
 assert.ok(admin.includes("Bestehende Uploads nach R2 verschieben"));
 assert.ok(admin.includes('fetch("/api/music-video/storage-migrate"'));
 assert.ok(route.includes("const owner=await musicPrincipal"));
 assert.ok(route.includes('if(req.method!=="GET")checkOrigin(req)'));
 assert.ok(route.includes("projectMigrationCandidates(owner)"));
 assert.ok(route.includes("reserveProjectUpload"));
});

import {projectLimits,reserveProjectOperation,ProjectCapacityError} from "../lib/music-video/capacity.ts";
test("shared SQLite leases enforce account, global, project and manifest quotas across connections",()=>{
 const root=mkdtempSync(path.join(tmpdir(),"sm-capacity-"));
 const file=path.join(root,"music-video.sqlite"),a=new DatabaseSync(file),b=new DatabaseSync(file);
 const MiB=1024*1024,owner="customer:11111111-1111-4111-8111-111111111111",other="customer:22222222-2222-4222-8222-222222222222";
 const limits={...projectLimits({}),customerBytes:200*MiB,projects:1,uploadsPerOwner:1,uploadsGlobal:2,exportsGlobal:1,tempBytes:1024*MiB,exportClaim:64*MiB,minFreeBytes:1};
 try{
  a.exec("CREATE TABLE music_projects(id TEXT PRIMARY KEY,owner_id TEXT); CREATE TABLE music_asset_cloud(owner_id TEXT,bytes INTEGER,pending_delete INTEGER)");
  const release=reserveProjectOperation(a,root,owner,"song",10*MiB,limits);
  assert.throws(()=>reserveProjectOperation(b,root,owner,"video",MiB,limits),ProjectCapacityError);
  const releaseOther=reserveProjectOperation(b,root,other,"video",MiB,limits);
  assert.throws(()=>reserveProjectOperation(a,root,"staff:third","video",MiB,limits),ProjectCapacityError);
  releaseOther();release();release();
  a.prepare("INSERT INTO music_projects VALUES(?,?)").run("p",owner);
  assert.throws(()=>reserveProjectOperation(b,root,owner,"song",MiB,limits),/Project limit/);
   const replacement=reserveProjectOperation(b,root,owner,"song-replacement",MiB,limits);replacement();
  a.prepare("INSERT INTO music_asset_cloud VALUES(?,?,1)").run(owner,200*MiB);
  assert.throws(()=>reserveProjectOperation(b,root,owner,"video",MiB,limits),/quota/);
  const exportRelease=reserveProjectOperation(a,root,owner,"export",0,limits);
  assert.throws(()=>reserveProjectOperation(b,root,other,"export",0,limits),/concurrent/);
  exportRelease();
  const next=reserveProjectOperation(b,root,other,"export",0,limits);next();
  assert.throws(()=>reserveProjectOperation(a,root,other,"video",251*MiB,limits),/File too large/);
  assert.throws(()=>projectLimits({PROJECTS_UPLOADS_GLOBAL:"0"}),/incorrectly configured/);
 }finally{a.close();b.close();rmSync(root,{recursive:true,force:true});}
});

import {parseVideoUpload,writeVideoUpload} from "../lib/music-video/video-upload.ts";
import {PROJECT_VIDEO_MAX_BYTES} from "../lib/music-video/media-limits.ts";
import {statSync} from "node:fs";
test("250 MiB raw video is admitted and streamed with exact byte accounting",async()=>{
 const root=mkdtempSync(path.join(tmpdir(),"sm-large-video-"));
 const target=path.join(root,"large.mp4"),MiB=1024*1024;
 const headers=new Headers({"x-project-filename":encodeURIComponent("Großes Video.mp4"),"x-project-bytes":String(PROJECT_VIDEO_MAX_BYTES),"content-length":String(PROJECT_VIDEO_MAX_BYTES)});
 try{
  assert.equal(projectLimits({}).videoBytes,250*MiB);
  assert.equal(parseVideoUpload(headers).size,250*MiB);
  assert.equal(parseVideoUpload(headers).name,"Großes Video.mp4");
  const block=new Uint8Array(MiB);let sent=0;
  const stream=new ReadableStream<Uint8Array>({pull(controller){if(sent===250)controller.close();else{sent++;controller.enqueue(block);}}});
  await writeVideoUpload(stream,target,250*MiB);
  assert.equal(statSync(target).size,250*MiB);
  headers.set("x-project-bytes",String(250*MiB+1));
  assert.throws(()=>parseVideoUpload(headers),/File too large/);
  headers.set("x-project-bytes","8");
  assert.throws(()=>parseVideoUpload(headers),/length mismatch/);
  const small=(n:number)=>new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(n));c.close();}});
  await assert.rejects(writeVideoUpload(small(9),path.join(root,"too-big.mp4"),8),/File too large/);
  await assert.rejects(writeVideoUpload(small(7),path.join(root,"short.mp4"),8),/length mismatch/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

import {BrowserPreviewCache} from "../lib/music-video/browser-preview-cache.ts";
test("complete preview bytes are reused on repeated seek and revoked when leaving editor",async()=>{
 const original=globalThis.fetch;let requests=0,notify!:()=>void;
 const downloaded=new Promise<void>(resolve=>{notify=resolve;});
 const cache=new BrowserPreviewCache(false,notify);
 try{
  globalThis.fetch=async()=>{requests++;return new Response(new Uint8Array([1,2,3,4]),{headers:{"content-type":"video/mp4","content-length":"4"}});};
  const candidate={key:"project:asset:desktop",url:"https://example.invalid/preview"};
  cache.update([candidate],[]);
  await Promise.race([downloaded,new Promise<never>((_,reject)=>{const t=setTimeout(()=>reject(Error("Preview cache timeout")),2000);t.unref();})]);
  const local=cache.get(candidate.key)!;
  assert.ok(local.startsWith("blob:"));
  for(let n=0;n<10;n++){cache.update([candidate],[candidate.key]);assert.equal(cache.get(candidate.key),local);}
  assert.equal(requests,1);
  globalThis.fetch=original;
  assert.deepEqual(new Uint8Array(await (await fetch(local)).arrayBuffer()),new Uint8Array([1,2,3,4]));
  cache.close();
  await assert.rejects(()=>fetch(local));
 }finally{cache.close();globalThis.fetch=original;}
});
