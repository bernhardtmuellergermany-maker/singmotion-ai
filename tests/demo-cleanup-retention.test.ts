import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {existsSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";

/** Isolated filesystem/SQLite integration test: never uses a Railway volume. */
test("expired demo cleanup preserves customer, staff, active-demo and cloud-mirrored files",()=>{
 const root=mkdtempSync(path.join(tmpdir(),"singmotion-cleanup-proof-"));
 let db:DatabaseSync|undefined;
 try{
  const media=path.join(root,"media");
  mkdirSync(media,{recursive:true});
  const customer="customer-"+randomUUID();
  const staff="cms-staff-editor_01";
  const demo=randomUUID(),active=randomUUID(),cloud=randomUUID();
  db=new DatabaseSync(path.join(root,"demo.sqlite"));
  db.exec(`CREATE TABLE sessions(token TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL,admin INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE assets(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL);
   CREATE TABLE cloud_source_media(asset_id TEXT PRIMARY KEY,owner TEXT NOT NULL);`);
  function seed(owner:string,label:string,expires:number){
   const id=randomUUID(),file=path.join(media,label+".png");
   writeFileSync(file,Buffer.from([0x89,0x50,0x4e,0x47]));
   db!.prepare("INSERT INTO sessions VALUES(?,?,?,0)").run("token-"+label,owner,expires);
   db!.prepare("INSERT INTO assets VALUES(?,?,?)").run(id,owner,JSON.stringify({
    id,owner,kind:"image",name:label+".png",path:file,
    mime:"image/png",bytes:4,duration:null,width:null,height:null,created:1
   }));
   return {id,file};
  }
  const c=seed(customer,"customer-persistent",1);
  const st=seed(staff,"staff-persistent",1);
  const d=seed(demo,"demo-expired",1);
  const cl=seed(cloud,"demo-cloud-mirror",1);
  const act=seed(active,"demo-active",1);
  db.prepare("INSERT INTO sessions VALUES(?,?,?,0)").run("token-demo-active-new",active,Date.now()+1000000);
  db.prepare("INSERT INTO cloud_source_media VALUES(?,?)").run(cl.id,cloud);
  db.close();db=undefined;
  const child=spawnSync(process.execPath,["--experimental-strip-types",path.join(process.cwd(),"scripts/cleanup.ts")],{
   cwd:process.cwd(),env:{...process.env,DATA_DIR:root},encoding:"utf8",timeout:30000
  });
  assert.equal(child.status,0,child.stderr||child.stdout);
  db=new DatabaseSync(path.join(root,"demo.sqlite"),{readOnly:true});
  const present=(id:string)=>!!db!.prepare("SELECT 1 FROM assets WHERE id=?").get(id);
  assert.ok(present(c.id),"customer media metadata survives session expiry");
  assert.ok(present(st.id),"staff media metadata survives session expiry");
  assert.ok(present(cl.id),"cloud mirrored media metadata survives");
  assert.ok(present(act.id),"demo owner with active session survives");
  assert.equal(present(d.id),false,"expired demo-only media may be cleaned");
  for(const file of [c.file,st.file,cl.file,act.file])assert.equal(existsSync(file),true,file);
  assert.equal(existsSync(d.file),false);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM cloud_source_media WHERE owner=?").get(cloud) as {n:number}).n,1);
 }finally{
  db?.close();
  rmSync(root,{recursive:true,force:true});
 }
});
