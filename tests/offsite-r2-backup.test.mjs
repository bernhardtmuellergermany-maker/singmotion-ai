import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {
 readConfigSections,validateOffsiteRemotes,validateRemotePath,
 buildOffsiteCopyPlan,executeOffsiteBackup
} from "../scripts/offsite-r2-backup.mjs";

const config=String.raw`
[r2_source]
type = s3
provider = Cloudflare
endpoint = https://fixture123.r2.cloudflarestorage.com
access_key_id = synthetic_only
secret_access_key = synthetic_only

[b2_private]
type = s3
provider = Other
endpoint = https://s3.us-west-004.backblazeb2.com
access_key_id = synthetic_only
secret_access_key = synthetic_only

[encrypted_offsite]
type = crypt
remote = b2_private:singmotion-disaster-recovery
filename_encryption = standard
password = synthetic_obscured_credential_not_real
`;

test("R2 source and encrypted destination must be different independent providers",()=>{
 const sections=readConfigSections(config);
 assert.equal(sections.get("r2_source").type,"s3");
 assert.equal(sections.get("encrypted_offsite").type,"crypt");
 const ok=validateOffsiteRemotes(config,"r2_source","encrypted_offsite");
 assert.deepEqual(ok,{sourceRemote:"r2_source",destinationCryptRemote:"encrypted_offsite",backingType:"s3"});
 assert.throws(()=>validateOffsiteRemotes(config,"r2_source","r2_source"),/INVALID_REMOTES/);
 assert.throws(()=>validateOffsiteRemotes(config,"r2_source","not_configured"),/SOURCE_OR_ENCRYPTION_NOT_VERIFIED/);
 assert.throws(()=>validateOffsiteRemotes(config.replace(
  "https://s3.us-west-004.backblazeb2.com","https://fixture123.r2.cloudflarestorage.com"
 ),"r2_source","encrypted_offsite"),/INDEPENDENT_DESTINATION_NOT_VERIFIED/);
 assert.throws(()=>validateOffsiteRemotes(config.replace(
  "filename_encryption = standard","filename_encryption = off"
 ),"r2_source","encrypted_offsite"),/SOURCE_OR_ENCRYPTION_NOT_VERIFIED/);
});

test("safe R2 remote roots reject local folders, path traversal or command injection",()=>{
 assert.equal(validateRemotePath("r2_source:private-media"),"r2_source:private-media");
 for(const input of [
  "r2_source:","file:/tmp/private","r2_source:../folder",
  "r2_source:folder/../exfil","r2_source:a//b",
  "r2_source:a;rm -rf /","r2_source:a\nb",
  "r2_source:/var/lib/postgresql/data","r2_source:a/",
  "","r2_source:a\\b"
 ])assert.throws(()=>validateRemotePath(input));
});

test("offsite R2 procedure is immutable, encrypted, complete-content verified and has no destructive verbs",()=>{
 const plan=buildOffsiteCopyPlan({
  sourcePath:"r2_source:private-media",
  destinationCryptRemote:"encrypted_offsite",
  runId:"20261116T125959Z-abcdef0123456789",
 });
 assert.equal(plan.destination,"encrypted_offsite:r2/20261116T125959Z-abcdef0123456789");
 assert.deepEqual(plan.steps.map(x=>x[0]),["size","copy","check","size"]);
 assert.ok(plan.steps[1].includes("--immutable"));
 assert.ok(plan.steps[2].includes("--download"));
 assert.ok(plan.steps[2].includes("--one-way"));
 assert.doesNotMatch(JSON.stringify(plan.steps),/delete|purge|sync|move|copyto|--size-only/);
 assert.throws(()=>buildOffsiteCopyPlan({
  sourcePath:"r2_source:private-media",destinationCryptRemote:"encrypted_offsite",runId:"../unsafe"
 }));
});

test("offsite backup only reports success after copy, full download check and matching inventory",()=>{
 const plan=buildOffsiteCopyPlan({
  sourcePath:"r2_source:private-media",
  destinationCryptRemote:"encrypted_offsite",
  runId:"20261116T125959Z-abcdef0123456789"
 });
 const calls=[];
 function successful(args,_configFile,capture){
  calls.push({verb:args[0],capture});
  if(args[0]==="size")return {count:3,bytes:128000};
  return null;
 }
 const result=executeOffsiteBackup(plan,"/dummy/owner-only.conf",successful);
 assert.equal(result.ok,true);
 assert.equal(result.count,3);
 assert.equal(result.bytes,128000);
 assert.deepEqual(calls.map(x=>x.verb),["size","copy","check","size"]);
 assert.throws(()=>executeOffsiteBackup(plan,"/dummy",(...args)=>{
  const [command]=args;
  if(command[0]==="size")return {count:0,bytes:0};
 }),/EMPTY_OR_UNAVAILABLE_SOURCE/);
 let i=0;
 assert.throws(()=>executeOffsiteBackup(plan,"/dummy",(args)=>{
  if(args[0]==="size")return (++i===1)?{count:3,bytes:128000}:{count:2,bytes:120000};
  return null;
 }),/OFFSITE_INVENTORY_MISMATCH/);
 assert.throws(()=>executeOffsiteBackup(plan,"/dummy",(args)=>{
  if(args[0]==="size")return {count:3,bytes:128000};
  if(args[0]==="check")throw Error("mock bad checksum");
 }),/mock bad checksum/);
});

test("manual CLI refuses Railway, root, and missing explicit cost/privacy confirmation",()=>{
 const run=spawnSync(process.execPath,[
  new URL("../scripts/offsite-r2-backup.mjs",import.meta.url).pathname
 ],{env:{...process.env,RAILWAY_ENVIRONMENT_ID:"production",OFFSITE_COPY_COST_AND_PRIVACY_APPROVED:"YES"},
  encoding:"utf8",timeout:15000});
 assert.notEqual(run.status,0);
 assert.match(run.stderr,/TRUSTED_OPERATOR_OFFSITE_CONFIGURATION_REQUIRED/);
 assert.doesNotMatch(run.stderr,/access_key|secret_access_key|private-media/);
});


test("STRATO HiDrive OAuth backend can independently store client-side-encrypted R2 backups",()=>{
 const stratoConfig=config.replace(
  /\[b2_private\][\s\S]*?(?=\[encrypted_offsite\])/,
  "[hidrive_private]\ntype = hidrive\ntoken = {\"access_token\":\"synthetic-test-only\"}\nendpoint = https://api.hidrive.strato.com/2.1\n\n"
 ).replace("remote = b2_private:singmotion-disaster-recovery",
           "remote = hidrive_private:SingMotion-DR");
 const accepted=validateOffsiteRemotes(stratoConfig,"r2_source","encrypted_offsite");
 assert.deepEqual(accepted,{sourceRemote:"r2_source",destinationCryptRemote:"encrypted_offsite",backingType:"hidrive"});
 assert.throws(()=>validateOffsiteRemotes(
  stratoConfig.replace("https://api.hidrive.strato.com/2.1","https://attacker.invalid"),
  "r2_source","encrypted_offsite"
 ),/STRATO_HIDRIVE_OAUTH_NOT_VERIFIED/);
 assert.throws(()=>validateOffsiteRemotes(
  stratoConfig.replace('token = {"access_token":"synthetic-test-only"}',''),
  "r2_source","encrypted_offsite"
 ),/STRATO_HIDRIVE_OAUTH_NOT_VERIFIED/);
 assert.throws(()=>validateOffsiteRemotes(
  stratoConfig.replace("remote = hidrive_private:SingMotion-DR",
                       "remote = hidrive_private:public"),
  "r2_source","encrypted_offsite"
 ),/STRATO_HIDRIVE_OAUTH_NOT_VERIFIED/);
});
