import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {mkdtempSync,rmSync,readdirSync,symlinkSync,unlinkSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {CreditWallet} from "../lib/commerce/credit-wallet.ts";
import {CRITICAL_SQLITE_NAMES,rehearseSqliteRestore} from "../lib/ops/sqlite-restore-drill.ts";

function setup(){
 const source=mkdtempSync(path.join(tmpdir(),"sm-source-"));
 const scratch=mkdtempSync(path.join(tmpdir(),"sm-scratch-"));
 const dbs:DatabaseSync[]=[];
 const commerce=new DatabaseSync(path.join(source,"commerce.sqlite"));
 dbs.push(commerce);
 commerce.exec("PRAGMA journal_mode=WAL");
 const wallet=new CreditWallet(commerce);
 const owner="customer:private-recovery-fixture";
 const purchase=wallet.pending({subject:owner,email:"private@example.invalid",customerId:"private-recovery-fixture"},500,randomUUID());
 const checkout="cs_live_recoveryfixture";
 wallet.bind(purchase.id,checkout,"https://checkout.stripe.com/c/pay/offline");
 wallet.settle({id:purchase.id,sessionId:checkout,amount:500,currency:"eur",paymentStatus:"paid",livemode:true});
 const project=randomUUID();
 wallet.reserveVideo(project,owner,125);
 wallet.reconcileVideo(project,"completed");
 for(const name of ["live-test.sqlite","demo.sqlite"]){
  const db=new DatabaseSync(path.join(source,name));
  dbs.push(db);
  db.exec("PRAGMA journal_mode=WAL;CREATE TABLE restore_fixture (id TEXT PRIMARY KEY, marker INTEGER NOT NULL)");
  db.prepare("INSERT INTO restore_fixture VALUES (?,?)").run(randomUUID(),1);
 }
 return {source,scratch,dbs,commerce,wallet,purchase,owner,dispose(){
  for(const db of dbs)db.close();
  rmSync(source,{recursive:true,force:true});
  rmSync(scratch,{recursive:true,force:true});
 }};
}

test("WAL-safe snapshot restores all three SQLite databases and cleans up every plaintext copy",async()=>{
 const f=setup();
 try{
  const result=await rehearseSqliteRestore(f.source,f.scratch);
  assert.deepEqual(result,{ok:true,checked:[...CRITICAL_SQLITE_NAMES],failed:[]});
  assert.deepEqual(readdirSync(f.scratch),[],"temporary customer data must be removed");
  assert.equal(f.wallet.total(f.owner),375,"the original live wallet is not mutated");
 }finally{f.dispose();}
});

test("a changed Credit debit is detected in the restored copy, without reporting customer identity",async()=>{
 const f=setup();
 try{
  f.commerce.prepare("UPDATE credit_wallet_ledger SET delta=-124 WHERE reference=?")
   .run("video-charge:"+String(f.commerce.prepare("SELECT project_id AS id FROM credit_video_reservations LIMIT 1").get()?.id));
  const result=await rehearseSqliteRestore(f.source,f.scratch);
  assert.equal(result.ok,false);
  assert.ok(result.failed.includes("CREDIT_VIDEO_LEDGER_MISMATCH"));
  assert.equal(result.checked.includes("commerce.sqlite"),false);
  assert.deepEqual(readdirSync(f.scratch),[]);
  assert.doesNotMatch(JSON.stringify(result),/private-recovery-fixture|private@example|cs_live/);
 }finally{f.dispose();}
});

test("missing or symlinked critical database fails closed; temp data is always deleted",async()=>{
 const f=setup();
 try{
  f.dbs[2].close();
  f.dbs.pop();
  unlinkSync(path.join(f.source,"demo.sqlite"));
  symlinkSync(path.join(f.source,"live-test.sqlite"),path.join(f.source,"demo.sqlite"));
  const result=await rehearseSqliteRestore(f.source,f.scratch);
  assert.equal(result.ok,false);
  assert.ok(result.failed.includes("DEMO_RESTORE_FAILED"));
  assert.deepEqual(readdirSync(f.scratch),[]);
 }finally{f.dispose();}
});

test("rejects backup scratch inside source; no directories are created inside the live volume",async()=>{
 const f=setup();
 try{
  const original=readdirSync(f.source).sort();
  const result=await rehearseSqliteRestore(f.source,f.source);
  assert.deepEqual(result,{ok:false,checked:[],failed:["ISOLATED_SCRATCH_REQUIRED"]});
  assert.deepEqual(readdirSync(f.source).sort(),original);
 }finally{f.dispose();}
});

test("restore drill is operator-invoked, never part of paid submission or automated Production startup",()=>{
 const cli=readFileSync(new URL("../scripts/sqlite-restore-drill.ts",import.meta.url),"utf8");
 const worker=readFileSync(new URL("../scripts/worker.ts",import.meta.url),"utf8");
 const snapshot=readFileSync(new URL("../lib/ops/sqlite-restore-drill.ts",import.meta.url),"utf8");
 assert.match(cli,/--confirm-ephemeral-private-copy/);
 assert.match(cli,/process\.getuid\?\.\(\)===0/);
 assert.doesNotMatch(worker,/rehearseSqliteRestore|sqlite-restore-drill/);
 assert.match(snapshot,/await backup\(sourceDB,target\)/);
 assert.match(snapshot,/await rm\(scratch,\{recursive:true,force:true\}\)/);
 assert.doesNotMatch(snapshot,/stripe\.com|BytePlus|fetch\(/);
});
