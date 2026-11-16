import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {randomUUID,scryptSync,createDecipheriv} from "node:crypto";
import {mkdtempSync,rmSync,readdirSync,readFileSync,symlinkSync,unlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {exportEncryptedSqlite} from "../lib/ops/encrypted-sqlite-export.ts";

function fixture(){
 const source=mkdtempSync(path.join(tmpdir(),"sm-backup-source-"));
 const output=mkdtempSync(path.join(tmpdir(),"sm-backup-output-"));
 const scratch=mkdtempSync(path.join(tmpdir(),"sm-backup-scratch-"));
 const dbs:DatabaseSync[]=[];
 const commerce=new DatabaseSync(path.join(source,"commerce.sqlite"));
 dbs.push(commerce);
 commerce.exec("PRAGMA journal_mode=WAL");
 const wallet=new CreditWallet(commerce);
 const owner="customer:encrypted-backup-fixture";
 const purchase=wallet.pending({
  subject:owner,email:"backup-fixture@example.invalid",customerId:"encrypted-backup-fixture"
 },500,randomUUID());
 const checkout="cs_live_encryptedbackupfixture";
 wallet.bind(purchase.id,checkout,"https://checkout.stripe.com/c/pay/offline");
 wallet.settle({id:purchase.id,sessionId:checkout,amount:500,currency:"eur",paymentStatus:"paid",livemode:true});
 const project=randomUUID();
 wallet.reserveVideo(project,owner,125);
 wallet.reconcileVideo(project,"completed");
 for(const name of ["live-test.sqlite","demo.sqlite"]){
  const db=new DatabaseSync(path.join(source,name));
  dbs.push(db);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE backup_fixture (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  db.prepare("INSERT INTO backup_fixture (value) VALUES (?)").run(randomUUID());
 }
 return {source,output,scratch,dbs,wallet,owner,dispose(){
  for(const db of dbs)try{db.close();}catch{}
  for(const directory of [source,output,scratch])rmSync(directory,{recursive:true,force:true});
 }};
}

test("operator encrypted SQLite snapshots include WAL and can decrypt after export",async()=>{
 const f=fixture(),passphrase="synthetic-private-restore-passphrase-0123456789";
 try{
  const result=await exportEncryptedSqlite(f.source,f.output,f.scratch,passphrase);
  assert.equal(result.ok,true,JSON.stringify(result.failed));
  assert.equal(result.verified.length,3);
  assert.ok(result.bundle);
  assert.deepEqual(readdirSync(f.scratch),[],"all ephemeral plaintext removed");
  const folder=path.join(f.output,result.bundle!);
  const manifest=JSON.parse(readFileSync(path.join(folder,"manifest.json"),"utf8"));
  assert.equal(manifest.format,"singmotion-sqlite-aes256gcm-v1");
  assert.equal(manifest.files.length,3);
  for(const item of manifest.files){
   const key=scryptSync(passphrase,Buffer.from(item.salt,"hex"),32,{
    N:32768,r:8,p:1,maxmem:64*1024*1024
   });
   const cipher=createDecipheriv("aes-256-gcm",key,Buffer.from(item.iv,"hex"));
   cipher.setAuthTag(Buffer.from(item.authTag,"hex"));
   const plaintext=Buffer.concat([
    cipher.update(readFileSync(path.join(folder,item.archive))),cipher.final()
   ]);
   key.fill(0);
   assert.equal(plaintext.subarray(0,16).toString("utf8"),"SQLite format 3\u0000");
  }
  assert.doesNotMatch(JSON.stringify(manifest),/backup-fixture@example|encrypted-backup-fixture|cs_live_/);
  assert.equal(f.wallet.total(f.owner),375,"live original wallet untouched");
 }finally{f.dispose();}
});

test("bad source symlink aborts export and removes all partial ciphertext/plaintext",async()=>{
 const f=fixture();
 try{
  f.dbs[2].close();
  f.dbs.pop();
  unlinkSync(path.join(f.source,"demo.sqlite"));
  symlinkSync(path.join(f.source,"live-test.sqlite"),path.join(f.source,"demo.sqlite"));
  const report=await exportEncryptedSqlite(
   f.source,f.output,f.scratch,"fixture-passphrase-12345678901234567890123"
  );
  assert.equal(report.ok,false);
  assert.deepEqual(readdirSync(f.output),[]);
  assert.deepEqual(readdirSync(f.scratch),[]);
 }finally{f.dispose();}
});

test("rejects nonprivate or overlapping backup destinations; no live source mutations",async()=>{
 const f=fixture();
 try{
  const before=readdirSync(f.source).sort();
  const report=await exportEncryptedSqlite(
   f.source,f.source,f.scratch,"fixture-passphrase-12345678901234567890123"
  );
  assert.equal(report.ok,false);
  assert.ok(report.failed.includes("PRIVATE_ISOLATED_DESTINATIONS_REQUIRED"));
  assert.deepEqual(readdirSync(f.source).sort(),before);
 }finally{f.dispose();}
});

test("export command is operator-confirmed and never invoked from worker or public route",()=>{
 const read=(file:string)=>readFileSync(new URL("../"+file,import.meta.url),"utf8");
 const script=read("scripts/export-encrypted-sqlite.ts");
 const worker=read("scripts/worker.ts");
 assert.match(script,/--confirm-private-encrypted-export/);
 assert.match(script,/process\.getuid\?\.\(\)===0/);
 assert.doesNotMatch(worker,/exportEncryptedSqlite|export-encrypted-sqlite/);
});
