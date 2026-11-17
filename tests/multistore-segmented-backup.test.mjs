import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, generateKeyPairSync } from "node:crypto";
import {
  mkdtemp, mkdir, writeFile, readFile, rm, stat, readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { CreditWallet } from "../lib/commerce/credit-wallet.ts";
import { auditCreditLedger } from "../lib/commerce/credit-ledger-integrity.ts";
import { hidriveCiphertextSink } from "../lib/ops/hidrive-ciphertext-sink.mjs";
import { openHiDriveCommittedReader } from "../lib/ops/hidrive-committed-reader.mjs";
import {
  produceMultiStoreArchive, restoreMultiStoreArchive,
} from "../lib/ops/multistore-segmented-backup.mjs";

const rsa = generateKeyPairSync("rsa", {modulusLength:3072});
const signer = generateKeyPairSync("ed25519");
const temp = () => mkdtemp(path.join(tmpdir(),"sm-full-backup-"));
async function sources(root) {
  const dir = path.join(root,"source");
  const scratch = path.join(root,"scratch");
  const recovery = path.join(root,"restore-parent");
  const spool = path.join(root,"cipher-spool");
  for (const item of [dir,scratch,recovery,spool])
    await mkdir(item,{mode:0o700});
  const commerce = new DatabaseSync(path.join(dir,"commerce.sqlite"));
  commerce.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
  const wallet = new CreditWallet(commerce);
  const owner = "customer:synthetic-complete-backup";
  const purchase = wallet.pending(
    {subject:owner,email:"fixture@example.invalid",customerId:"fixture"},
    500,randomUUID());
  wallet.bind(purchase.id,"cs_live_fully_synthetic","https://checkout.stripe.com/c/pay/synthetic");
  wallet.settle({id:purchase.id,sessionId:"cs_live_fully_synthetic",
    amount:500,currency:"eur",paymentStatus:"paid",livemode:true});
  const project=randomUUID();
  wallet.reserveVideo(project,owner,125);
  wallet.reconcileVideo(project,"completed");
  commerce.exec("CREATE TABLE backup_fixture(value TEXT); INSERT INTO backup_fixture VALUES ('wal-synthetic')");
  for (const name of ["demo.sqlite","live-test.sqlite"]) {
    const db = new DatabaseSync(path.join(dir,name));
    db.exec("CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES ('synthetic')");
    db.close();
  }
  await mkdir(path.join(dir,"cms-public"));
  await writeFile(path.join(dir,"cms-public","public-fixture.jpg"),"non-customer-image");
  await writeFile(path.join(dir,"large-local.bin"),randomBytes(10*1024*1024+73));
  return {dir,scratch,recovery,spool,commerce};
}
function fakeR2(count=1001, changed=false) {
  const objects=Array.from({length:count},(_,i)=>({
    Key:"private-media/"+String(i).padStart(6,"0")+".mp4",
    ETag:'"fixture-'+i+'"',Size:i===0?0:28,
  }));
  let calls=0;
  return {
    get calls(){return calls;},
    async list(token) {
      calls++;
      if(changed&&calls>2) {
        return {Contents:objects.slice(0,1)};
      }
      if(!token) return {Contents:objects.slice(0,1000),
        IsTruncated:count>1000,
        NextContinuationToken:count>1000?"next-page":undefined};
      assert.equal(token,"next-page");
      return {Contents:objects.slice(1000),IsTruncated:false};
    },
    async get(key,etag) {
      const obj=objects.find(x=>x.Key===key);
      assert.ok(obj);
      assert.equal(obj.ETag,etag);
      return {ETag:obj.ETag,ContentLength:obj.Size,
        Body:Readable.from([Buffer.alloc(obj.Size,7)])};
    },
  };
}
function fakeHiDrive() {
  const remote=new Map(),calls=[];
  const session={
    dir:"root/users/fixture/SingMotion-DR",
    async request(method,endpoint,params,body) {
      assert.equal(endpoint,"/file");
      calls.push({method,endpoint,params});
      if(method==="PUT"){
        assert.equal(params.overwrite,"false");
        if(remote.has(params.name)) return {ok:false,status:409};
        assert.ok(Buffer.isBuffer(body));
        remote.set(params.name,Buffer.from(body));
        return {ok:true,status:200};
      }
      assert.equal(method,"GET");
      const value=remote.get(params.path.split("/").at(-1));
      if(!value) return {ok:false,status:404};
      return {ok:true,status:200,body:Readable.from([Buffer.from(value)])};
    },
  };
  return {remote,calls,session};
}
async function run(root,{objects=1001,changed=false}={}) {
  const fixture=await sources(root);
  const drive=fakeHiDrive();
  const writer=hidriveCiphertextSink({session:drive.session,spool:fixture.spool});
  const r2=fakeR2(objects,changed);
  const result=await produceMultiStoreArchive({
    sourceDir:fixture.dir,scratchParent:fixture.scratch,
    pgEnv:{SYNTHETIC_PG:true},
    pgDump:async(target,env)=>{
      assert.equal(env.SYNTHETIC_PG,true);
      await writeFile(target,"PGDMP_SYNTHETIC_LOGICAL_ARCHIVE",
        {flag:"wx",mode:0o600});
    },
    r2,sink:writer,recoveryPublicKey:rsa.publicKey,
    signingPrivateKey:signer.privateKey,segmentBytes:1024*1024,
  });
  return {fixture,drive,r2,result};
}
test("one ciphertext-only remote transaction covers SQLite WAL, local media, native PG stage and 1001 paginated R2 objects; independent restore",async()=>{
  const root=await temp();
  let runData;
  try {
    const data=await run(root);
    runData=data;
    const {fixture,drive,result}=data;
    assert.ok(result.remoteReceiptCommitted);
    assert.equal(result.independentRestoreVerified,false);
    assert.equal(result.stores.sqlite,3);
    assert.equal(result.stores.postgres,1);
    assert.equal(result.stores.r2,1001);
    assert.ok(result.stores.local>=2);
    assert.ok(result.segments>1001);
    assert.equal(drive.remote.size,result.segments+2);
    assert.equal((await readdir(fixture.scratch)).length,0);
    fixture.commerce.close();
    const previousCalls=drive.calls.length;
    const independent=await openHiDriveCommittedReader({
      session:drive.session,run:result.run,
    });
    const recovered=path.join(fixture.recovery,"production-copy");
    const restore=await restoreMultiStoreArchive({
      sink:independent,run:result.run,
      manifestId:independent.manifestId,manifestMeta:independent.manifestMeta,
      recoveryPrivateKey:rsa.privateKey,signingPublicKey:signer.publicKey,
      targetDir:recovered,
    });
    assert.ok(restore.recovered);
    assert.equal(restore.stores.sqlite,3);
    assert.equal(restore.stores.postgres,1);
    assert.equal(restore.stores.r2,1001);
    assert.ok(drive.calls.slice(previousCalls).every(x=>x.method==="GET"));
    const db=new DatabaseSync(path.join(recovered,"sqlite","commerce.sqlite"),{readOnly:true});
    try {
      assert.equal(db.prepare("PRAGMA quick_check").get().quick_check,"ok");
      assert.equal(auditCreditLedger(db).ok,true);
      assert.equal(db.prepare("SELECT value FROM backup_fixture").get().value,"wal-synthetic");
    } finally {db.close();}
    assert.equal((await readFile(path.join(recovered,"postgres","cms.dump"),"utf8")),
      "PGDMP_SYNTHETIC_LOGICAL_ARCHIVE");
    assert.deepEqual(
      await readFile(path.join(recovered,"local","large-local.bin")),
      await readFile(path.join(fixture.dir,"large-local.bin")),
    );
    assert.equal((await readFile(path.join(recovered,"r2","private-media","000000.mp4"))).length,0);
    assert.equal((await readFile(path.join(recovered,"r2","private-media","001000.mp4"))).length,28);
    assert.equal((await stat(recovered)).mode & 0o077,0);
  } finally {
    if(runData?.fixture?.commerce?.isOpen)runData.fixture.commerce.close();
    await rm(root,{recursive:true,force:true});
  }
});
test("missing or truncated committed ciphertext prevents restore and removes only its isolated output",async()=>{
  const root=await temp();
  let fixture;
  try {
    const data=await run(root,{objects:1});
    fixture=data.fixture;
    fixture.commerce.close();
    const {drive,result}=data;
    const reader=await openHiDriveCommittedReader({session:drive.session,run:result.run});
    const receipt=JSON.parse(drive.remote.get("sm-"+result.run+"-COMMITTED.enc"));
    const item=receipt.files[2];
    const name="sm-"+result.run+"-"+item.id+".enc";
    drive.remote.set(name,drive.remote.get(name).subarray(0,15));
    const output=path.join(fixture.recovery,"broken");
    await assert.rejects(restoreMultiStoreArchive({
      sink:reader,run:result.run,manifestId:reader.manifestId,
      manifestMeta:reader.manifestMeta,
      recoveryPrivateKey:rsa.privateKey,
      signingPublicKey:signer.publicKey,targetDir:output,
    }),/COMMITTED_CIPHERTEXT_MISMATCH/);
    await assert.rejects(stat(output),{code:"ENOENT"});
  } finally {
    if(fixture?.commerce?.isOpen) fixture.commerce.close();
    await rm(root,{recursive:true,force:true});
  }
});
test("remote source change fails closed before COMMITTED receipt",async()=>{
  const root=await temp();
  let fixture;
  try {
    fixture=await sources(root);
    const remote=fakeHiDrive();
    const sink=hidriveCiphertextSink({session:remote.session,spool:fixture.spool});
    await assert.rejects(produceMultiStoreArchive({
      sourceDir:fixture.dir,scratchParent:fixture.scratch,
      pgEnv:{},pgDump:async target=>writeFile(target,"SYNTHETIC_PG"),
      r2:fakeR2(1001,true),sink,recoveryPublicKey:rsa.publicKey,
      signingPrivateKey:signer.privateKey,segmentBytes:1024*1024,
    }),/R2_SOURCE_CHANGED/);
    assert.ok(![...remote.remote.keys()].some(k=>k.endsWith("-COMMITTED.enc")));
    assert.equal((await readdir(fixture.scratch)).length,0);
  } finally {
    if(fixture?.commerce?.isOpen) fixture.commerce.close();
    await rm(root,{recursive:true,force:true});
  }
});
