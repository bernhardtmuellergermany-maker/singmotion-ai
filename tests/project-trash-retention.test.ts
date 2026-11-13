import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {mkdtemp,mkdir,readFile,stat,rm,writeFile} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {randomUUID} from "node:crypto";
import {ensureDraftTrash,ensureLiveTrash,deleteDraftToTrash,restoreDraftFromTrash,listDraftTrash,PROJECT_TRASH_MS} from "../lib/project-trash.ts";
import {runProjectTrashCleanup} from "../lib/project-trash-cleanup.ts";

const now=Date.UTC(2026,10,13,12);
async function fixture(){
 const root=await mkdtemp(path.join(tmpdir(),"sm-project-trash-"));
 await mkdir(path.join(root,"media"));await mkdir(path.join(root,"live-output"));
 const db=new DatabaseSync(path.join(root,"demo.sqlite"));
 db.exec("CREATE TABLE assets(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL);CREATE TABLE jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL);CREATE TABLE artists(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL);");
 ensureDraftTrash(db);
 const live=new DatabaseSync(path.join(root,"live-test.sqlite"));
 live.exec("CREATE TABLE live_studio_projects(attempt_id TEXT PRIMARY KEY,owner TEXT NOT NULL,selection_json TEXT NOT NULL,policy_json TEXT NOT NULL,artist_name TEXT NOT NULL,project_name TEXT NOT NULL,diagnostic TEXT,started_at INTEGER);CREATE TABLE live_attempts(id TEXT PRIMARY KEY,source_job_id TEXT,data TEXT NOT NULL);");
 ensureLiveTrash(live);
 return {root,db,live,async close(){db.close();live.close();await rm(root,{recursive:true,force:true})}};
}
function selection(owner:string,id:string){return JSON.stringify({owner,songId:id,imageId:"",start:0,end:5});}
function draft(db:DatabaseSync,owner:string,id:string,assetId:string){
 db.prepare("INSERT INTO studio_drafts(id,owner,selection,artist_name,step,updated,project_name) VALUES(?,?,?,?,1,?,?)")
  .run(id,owner,selection(owner,assetId),"Musician",now,"Saved performance");
}
async function ownedAsset(root:string,db:DatabaseSync,owner:string,id:string,data="private original"){
 const filepath=path.join(root,"media",id);
 await writeFile(filepath,data);
 db.prepare("INSERT INTO assets VALUES(?,?,?)").run(id,owner,JSON.stringify({
  id,owner,kind:"audio",name:"recording.wav",path:filepath,mime:"audio/wav",
  bytes:Buffer.byteLength(data),duration:5,width:null,height:null,created:now
 }));
}
test("draft deletion hides it, allows owner restore for 30 days, and prohibits other owners",async()=>{
 const f=await fixture();try{
  const owner="customer-"+randomUUID(),id=randomUUID(),asset=randomUUID();
  draft(f.db,owner,id,asset);
  const deleted=deleteDraftToTrash(f.db,id,owner,now);
  assert.equal(deleted.purgeAfter,now+PROJECT_TRASH_MS);
  assert.equal(listDraftTrash(f.db,owner,now+1).length,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM studio_drafts WHERE deleted_at IS NULL").get()!.n,0);
  assert.throws(()=>restoreDraftFromTrash(f.db,id,"customer-"+randomUUID(),now+1));
  assert.equal(restoreDraftFromTrash(f.db,id,owner,now+PROJECT_TRASH_MS-1).restored,true);
  assert.equal(listDraftTrash(f.db,owner,now).length,0);
  deleteDraftToTrash(f.db,id,owner,now);
  assert.throws(()=>restoreDraftFromTrash(f.db,id,owner,now+PROJECT_TRASH_MS+1));
 }finally{await f.close()}
});
test("cleanup removes expired unreferenced files and DB asset records; keeps immutable ledger",async()=>{
 const f=await fixture();try{
  const owner="cms-staff-owner",id=randomUUID(),asset=randomUUID();
  draft(f.db,owner,id,asset);await ownedAsset(f.root,f.db,owner,asset);
  f.db.exec("CREATE TABLE ledger(id TEXT PRIMARY KEY,amount INTEGER NOT NULL)");
  f.db.prepare("INSERT INTO ledger VALUES(?,?)").run(randomUUID(),150);
  deleteDraftToTrash(f.db,id,owner,now);
  let clean=await runProjectTrashCleanup(f.root,{now:now+PROJECT_TRASH_MS-1});
  assert.deepEqual(clean,{draftsPurged:0,studioPurged:0,assetsDeleted:0,bytesFreed:0,held:0});
  clean=await runProjectTrashCleanup(f.root,{now:now+PROJECT_TRASH_MS});
  assert.equal(clean.draftsPurged,1);assert.equal(clean.assetsDeleted,1);assert.equal(clean.bytesFreed,16);
  assert.equal(f.db.prepare("SELECT count(*) n FROM assets").get()!.n,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM studio_drafts").get()!.n,0);
  assert.equal(f.db.prepare("SELECT amount FROM ledger").get()!.amount,150);
  await assert.rejects(stat(path.join(f.root,"media",asset)));
 }finally{await f.close()}
});
test("shared uploads survive deletion until all referencing projects are removed",async()=>{
 const f=await fixture();try{
  const owner="cms-staff-owner",id1=randomUUID(),id2=randomUUID(),asset=randomUUID();
  draft(f.db,owner,id1,asset);draft(f.db,owner,id2,asset);await ownedAsset(f.root,f.db,owner,asset);
  deleteDraftToTrash(f.db,id1,owner,now);
  const first=await runProjectTrashCleanup(f.root,{now:now+PROJECT_TRASH_MS});
  assert.equal(first.draftsPurged,1);assert.equal(first.assetsDeleted,0);
  assert.ok((await readFile(path.join(f.root,"media",asset))).length>0);
  deleteDraftToTrash(f.db,id2,owner,now);
  const second=await runProjectTrashCleanup(f.root,{now:now+PROJECT_TRASH_MS});
  assert.equal(second.draftsPurged,1);assert.equal(second.assetsDeleted,1);
 }finally{await f.close()}
});
test("unverified R2 deletion blocks permanent purge and retries safely",async()=>{
 const f=await fixture();try{
  const owner="cms-staff-owner",id=randomUUID(),asset=randomUUID();
  draft(f.db,owner,id,asset);await ownedAsset(f.root,f.db,owner,asset);
  f.db.exec("CREATE TABLE cloud_source_media(asset_id TEXT PRIMARY KEY,owner TEXT NOT NULL,key TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL)");
  f.db.prepare("INSERT INTO cloud_source_media VALUES(?,?,?,?,?)")
   .run(asset,owner,"private-key","a".repeat(64),16);
  deleteDraftToTrash(f.db,id,owner,now);
  let called=0;
  const held=await runProjectTrashCleanup(f.root,{now:now+PROJECT_TRASH_MS,
   deleteCloud:async()=>{called++;throw Error("R2 not confirmed")}});
  assert.equal(held.held,1);assert.equal(called,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM assets").get()!.n,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM studio_drafts").get()!.n,1);
  const success=await runProjectTrashCleanup(f.root,{now:now+PROJECT_TRASH_MS,deleteCloud:async()=>{called++}});
  assert.equal(success.draftsPurged,1);assert.equal(success.assetsDeleted,1);assert.equal(called,2);
 }finally{await f.close()}
});
test("terminal private video MP4 expires while immutable provider evidence remains",async()=>{
 const f=await fixture();try{
  const owner="cms-staff-owner",id=randomUUID(),asset=randomUUID(),file=path.join(f.root,"live-output",id+".mp4");
  await writeFile(file,"validated test MP4");
  f.live.prepare("INSERT INTO live_studio_projects(attempt_id,owner,selection_json,policy_json,artist_name,project_name,deleted_at) VALUES(?,?,?,?,?,?,?)")
    .run(id,owner,selection(owner,asset),"{}","Artist","Finished project",now);
  f.live.prepare("INSERT INTO live_attempts VALUES(?,?,?)")
    .run(id,"test-job",JSON.stringify({state:"completed",outputPath:file}));
  const outcome=await runProjectTrashCleanup(f.root,{now:now+PROJECT_TRASH_MS});
  assert.equal(outcome.studioPurged,1);
  assert.equal(f.live.prepare("SELECT count(*) n FROM live_studio_projects").get()!.n,0);
  assert.equal(f.live.prepare("SELECT count(*) n FROM live_attempts").get()!.n,1);
  await assert.rejects(stat(file));
 }finally{await f.close()}
});
test("uncertain provider never has its project or files physically purged",async()=>{
 const f=await fixture();try{
  const owner="cms-staff-owner",id=randomUUID(),asset=randomUUID();
  const file=path.join(f.root,"live-output",id+".mp4");await writeFile(file,"existing");
  f.live.prepare("INSERT INTO live_studio_projects(attempt_id,owner,selection_json,policy_json,artist_name,project_name,deleted_at) VALUES(?,?,?,?,?,?,?)")
   .run(id,owner,selection(owner,asset),"{}","Artist","Uncertain",now);
  f.live.prepare("INSERT INTO live_attempts VALUES(?,?,?)")
   .run(id,"test-job",JSON.stringify({state:"uncertain",outputPath:file}));
  const outcome=await runProjectTrashCleanup(f.root,{now:now+PROJECT_TRASH_MS});
  assert.equal(outcome.held,1);assert.equal(outcome.studioPurged,0);
  assert.equal((await readFile(file)).length,8);
 }finally{await f.close()}
});
