import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {exportEncryptedSqlite} from "../lib/ops/encrypted-sqlite-export.ts";
import {verifyIsolatedEncryptedSqliteArchive} from "../lib/ops/verify-isolated-encrypted-sqlite.ts";

function isolatedFixture(){
 const source=mkdtempSync(path.join(tmpdir(),"sm-restore-src-"));
 const originalArchive=mkdtempSync(path.join(tmpdir(),"sm-restore-archives-"));
 const exportScratch=mkdtempSync(path.join(tmpdir(),"sm-restore-export-scratch-"));
 const independentScratch=mkdtempSync(path.join(tmpdir(),"sm-restore-independent-scratch-"));
 const dbs:DatabaseSync[]=[];
 const commerce=new DatabaseSync(path.join(source,"commerce.sqlite"));
 dbs.push(commerce);
 commerce.exec("PRAGMA journal_mode=WAL");
 const wallet=new CreditWallet(commerce);
 const owner="synthetic:isolated-backup";
 const purchase=wallet.pending({
  subject:owner,email:"synthetic-restore@example.invalid",customerId:"synthetic-restore"
 },500,randomUUID());
 const checkout="cs_live_synthetic_restore_not_real";
 wallet.bind(purchase.id,checkout,"https://checkout.stripe.com/c/pay/offline-fixture");
 wallet.settle({id:purchase.id,sessionId:checkout,amount:500,currency:"eur",paymentStatus:"paid",livemode:true});
 const project=randomUUID();
 wallet.reserveVideo(project,owner,125);
 wallet.reconcileVideo(project,"completed");
 for(const name of ["live-test.sqlite","demo.sqlite"]){
  const db=new DatabaseSync(path.join(source,name));
  dbs.push(db);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE offline_test (id INTEGER PRIMARY KEY, description TEXT NOT NULL)");
  db.prepare("INSERT INTO offline_test(description) VALUES (?)").run(randomUUID());
 }
 return {source,originalArchive,exportScratch,independentScratch,dbs,dispose(){
  dbs.forEach(db=>{try{db.close();}catch{}});
  for(const dir of [source,originalArchive,exportScratch,independentScratch])
   rmSync(dir,{recursive:true,force:true});
 }};
}
test("independent host can decrypt exported encrypted SQLite and verify WAL-backed Credit ledger",async()=>{
 const f=isolatedFixture();
 const secret="independent-synthetic-backup-secret-0123456789";
 try{
  const exportReport=await exportEncryptedSqlite(
   f.source,f.originalArchive,f.exportScratch,secret
  );
  assert.equal(exportReport.ok,true,JSON.stringify(exportReport.failed));
  assert.ok(exportReport.bundle);
  const archive=path.join(f.originalArchive,exportReport.bundle!);
  const report=await verifyIsolatedEncryptedSqliteArchive(
   archive,f.independentScratch,secret
  );
  assert.equal(report.ok,true,JSON.stringify(report.failed));
  assert.deepEqual(report.verified,["commerce.sqlite","live-test.sqlite","demo.sqlite"]);
  assert.deepEqual(readdirSync(f.independentScratch),[]);
  assert.deepEqual(readdirSync(f.exportScratch),[]);
 }finally{f.dispose();}
});
test("wrong encryption key never passes independent archive recovery",async()=>{
 const f=isolatedFixture();
 try{
  const b=await exportEncryptedSqlite(f.source,f.originalArchive,f.exportScratch,
   "synthetic-private-source-password-0123456789");
  assert.equal(b.ok,true);
  const output=await verifyIsolatedEncryptedSqliteArchive(
   path.join(f.originalArchive,b.bundle!),f.independentScratch,
   "wrong-synthetic-recovery-password-012345678901"
  );
  assert.equal(output.ok,false);
  assert.ok(output.failed.includes("ISOLATED_ENCRYPTED_SQLITE_RESTORE_FAILED"));
  assert.deepEqual(readdirSync(f.independentScratch),[]);
 }finally{f.dispose();}
});
test("tampered ciphertext fails before SQLite restore; no private scratch leakage",async()=>{
 const f=isolatedFixture();
 try{
  const secret="synthetic-private-source-password-0123456789";
  const b=await exportEncryptedSqlite(f.source,f.originalArchive,f.exportScratch,secret);
  assert.equal(b.ok,true);
  const archive=path.join(f.originalArchive,b.bundle!);
  const filename=path.join(archive,"commerce.sqlite.aes-256-gcm");
  const bytes=readFileSync(filename);bytes[0]^=255;writeFileSync(filename,bytes,{mode:0o600});
  const result=await verifyIsolatedEncryptedSqliteArchive(archive,f.independentScratch,secret);
  assert.equal(result.ok,false);
  assert.deepEqual(readdirSync(f.independentScratch),[]);
 }finally{f.dispose();}
});
test("misplaced or nested private archive scratch is rejected",async()=>{
 const f=isolatedFixture();
 try{
  const b=await exportEncryptedSqlite(f.source,f.originalArchive,f.exportScratch,
   "synthetic-private-source-password-0123456789");
  assert.equal(b.ok,true);
  const archive=path.join(f.originalArchive,b.bundle!);
  const result=await verifyIsolatedEncryptedSqliteArchive(
   archive,archive,"synthetic-private-source-password-0123456789"
  );
  assert.equal(result.ok,false);
  assert.ok(result.failed.includes("ISOLATED_RESTORE_PATH_OVERLAP"));
 }finally{f.dispose();}
});
test("offsite verifier cannot run implicitly from worker/startup or in Railway",()=>{
 const read=(name:string)=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
 const script=read("scripts/verify-isolated-encrypted-sqlite.ts");
 const worker=read("scripts/worker.ts");
 assert.match(script,/--confirm-isolated-offline-restore/);
 assert.match(script,/process\.env\.RAILWAY_ENVIRONMENT_ID/);
 assert.match(script,/process\.getuid\?\.\(\)===0/);
 assert.doesNotMatch(worker,/verifyIsolatedEncryptedSqliteArchive|verify-isolated-encrypted-sqlite/);
});
