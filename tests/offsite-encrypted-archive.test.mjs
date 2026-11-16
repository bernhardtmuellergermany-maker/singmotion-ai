import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,writeFileSync,rmSync,chmodSync,symlinkSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import path from "node:path";
import {
 validateEncryptedBundle,validatePrivateHidriveCrypt,
 buildEncryptedArchivePlan,executeEncryptedArchiveCopy
} from "../scripts/offsite-encrypted-archive.mjs";

const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
function fixture(){
 const dir=mkdtempSync(path.join(tmpdir(),"sm-hidrive-offsite-fixture-"));
 chmodSync(dir,0o700);
 const write=(name,data)=>writeFileSync(path.join(dir,name),data,{flag:"wx",mode:0o600});
 return {dir,write,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
function populateSqlite(f){
 const names=["commerce.sqlite","live-test.sqlite","demo.sqlite"];
 const files=names.map((database,i)=>{
  const archive=database+".aes-256-gcm";
  const data=Buffer.from("synthetic-ciphertext-fixture-"+i);
  f.write(archive,data);
  return {database,archive,ciphertextSha256:sha(data)};
 });
 f.write("manifest.json",JSON.stringify({
  format:"singmotion-sqlite-aes256gcm-v1",
  kdf:{algorithm:"scrypt",N:32768,r:8,p:1},
  files
 }));
}
function populatePg(f){
 const contents=Buffer.from("age-encryption.org/v1\n-> X25519 synthetic-offline-test-only\nnot-a-real-key\n");
 f.write("cms.dump.age",contents);
 f.write("cms.dump.age.sha256",sha(contents)+"  cms.dump.age\n");
}
const rcloneConfig=[
 "[hidrive_private]","type = hidrive",
 'token = {"access_token":"synthetic-not-a-real-access-token"}',
 "endpoint = https://api.hidrive.strato.com/2.1",
 "","[encrypted_offsite]","type = crypt",
 "remote = hidrive_private:SingMotion-DR",
 "filename_encryption = standard","directory_name_encryption = true",
 "password = synthetic-obscured-rclone-fixture-only",""
].join("\n");

test("only exact private encrypted SQLite bundle may be handed off",async()=>{
 const f=fixture();
 try{
  populateSqlite(f);
  const out=await validateEncryptedBundle(f.dir,"sqlite");
  assert.equal(out.kind,"sqlite");
  assert.equal(out.files.length,4);
  assert.ok(Object.values(out.checksums).every(x=>/^[a-f0-9]{64}$/.test(x)));
  const tampered=path.join(f.dir,"commerce.sqlite.aes-256-gcm");
  writeFileSync(tampered,"corrupted-synthetic-ciphertext",{mode:0o600});
  await assert.rejects(validateEncryptedBundle(f.dir,"sqlite"),/ENCRYPTED_ARCHIVE_HASH_MISMATCH/);
  f.write("extra-unencrypted-file.txt","never upload this");
  await assert.rejects(validateEncryptedBundle(f.dir,"sqlite"),/UNEXPECTED_ARCHIVE_FILE/);
 }finally{f.cleanup();}
});

test("Postgres source requires age envelope and matching checksum",async()=>{
 const f=fixture();
 try{
  populatePg(f);
  const out=await validateEncryptedBundle(f.dir,"postgres");
  assert.equal(out.files.length,2);
  writeFileSync(path.join(f.dir,"cms.dump.age.sha256"),"0".repeat(64)+"  cms.dump.age\n",{mode:0o600});
  await assert.rejects(validateEncryptedBundle(f.dir,"postgres"),/ENCRYPTED_ARCHIVE_HASH_MISMATCH/);
 }finally{f.cleanup();}
});

test("symlinks and group/world readable archive files are rejected",async()=>{
 const f=fixture(),outside=fixture();
 try{
  populateSqlite(f);
  chmodSync(path.join(f.dir,"manifest.json"),0o644);
  await assert.rejects(validateEncryptedBundle(f.dir,"sqlite"),/UNSAFE_ENCRYPTED_ARCHIVE/);
  chmodSync(path.join(f.dir,"manifest.json"),0o600);
  rmSync(path.join(f.dir,"demo.sqlite.aes-256-gcm"));
  symlinkSync(path.join(outside.dir,"unrelated"),path.join(f.dir,"demo.sqlite.aes-256-gcm"));
  await assert.rejects(validateEncryptedBundle(f.dir,"sqlite"),/UNSAFE_ENCRYPTED_ARCHIVE/);
  rmSync(path.join(f.dir,"demo.sqlite.aes-256-gcm"));
  chmodSync(f.dir,0o755);
  await assert.rejects(validateEncryptedBundle(f.dir,"sqlite"),/PRIVATE_ARCHIVE_DIRECTORY_REQUIRED/);
 }finally{f.cleanup();outside.cleanup();}
});

test("destination requires a private encrypted STRATO HiDrive backend",()=>{
 assert.deepEqual(validatePrivateHidriveCrypt(rcloneConfig,"encrypted_offsite"),{
  cryptName:"encrypted_offsite",backingType:"hidrive"
 });
 for(const config of [
  rcloneConfig.replace("filename_encryption = standard","filename_encryption = off"),
  rcloneConfig.replace("remote = hidrive_private:SingMotion-DR","remote = hidrive_private:public"),
  rcloneConfig.replace("type = hidrive","type = local"),
  rcloneConfig.replace("endpoint = https://api.hidrive.strato.com/2.1","endpoint = https://example.invalid"),
  rcloneConfig.replace('token = {"access_token":"synthetic-not-a-real-access-token"}',"")
 ])assert.throws(()=>validatePrivateHidriveCrypt(config,"encrypted_offsite"));
});

test("immutable upload, full readback and remote inventory all required",async()=>{
 const f=fixture();
 try{
  populateSqlite(f);
  const bundle=await validateEncryptedBundle(f.dir,"sqlite");
  const plan=buildEncryptedArchivePlan({
   root:f.dir,kind:"sqlite",cryptName:"encrypted_offsite",
   runId:"20261116T183000Z-0123456789abcdef"
  });
  assert.equal(plan.target,"encrypted_offsite:sqlite/20261116T183000Z-0123456789abcdef");
  assert.deepEqual(plan.steps.map(x=>x[0]),["size","copy","check","size"]);
  assert.ok(plan.steps[1].includes("--immutable"));
  assert.ok(plan.steps[2].includes("--download"));
  assert.doesNotMatch(JSON.stringify(plan.steps),/"(sync|move|delete|purge)"/);
  const calls=[];
  const result=await executeEncryptedArchiveCopy(bundle,plan,"/fixture/private.conf",(args)=>{
   calls.push(args[0]);
   if(args[0]==="size")return {count:4,bytes:400};
   return null;
  });
  assert.equal(result.ok,true);
  assert.equal(result.isolatedRestoreVerified,false);
  assert.deepEqual(calls,["size","copy","check","size"]);
  await assert.rejects(executeEncryptedArchiveCopy(bundle,plan,"/test",args=>{
   if(args[0]==="size")return {count:0,bytes:0};
  }),/INVALID_ARCHIVE_INVENTORY/);
  await assert.rejects(executeEncryptedArchiveCopy(bundle,plan,"/test",args=>{
   if(args[0]==="size")return {count:4,bytes:400};
   if(args[0]==="check")throw Error("fixture-integrity-mismatch");
  }),/fixture-integrity-mismatch/);
  let i=0;
  await assert.rejects(executeEncryptedArchiveCopy(bundle,plan,"/test",args=>{
   if(args[0]==="size")return ++i===1?{count:4,bytes:400}:{count:4,bytes:399};
  }),/ENCRYPTED_ARCHIVE_OFFSITE_MISMATCH/);
 }finally{f.cleanup();}
});

test("without private host and explicit approval the CLI refuses all transfers",()=>{
 const result=spawnSync(process.execPath,[
  new URL("../scripts/offsite-encrypted-archive.mjs",import.meta.url).pathname,
  "--confirm-immutable-encrypted-offsite-copy"
 ],{env:{...process.env,RAILWAY_ENVIRONMENT_ID:"production",OFFSITE_TRANSFER_PRIVACY_APPROVED:"YES"},encoding:"utf8",timeout:15000});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/TRUSTED_OPERATOR_ARCHIVE_TRANSFER_REQUIRED/);
 assert.doesNotMatch(result.stderr,/token|credential|secret|customer:|SingMotion-DR/i);
});
