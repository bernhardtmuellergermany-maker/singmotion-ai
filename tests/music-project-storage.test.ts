import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from "node:fs";
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
