import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const cli=path.resolve("scripts/hidrive-readonly-commit-preflight.mjs");
const run=(args, env={})=>spawnSync(process.execPath,[cli,...args],{
  cwd:process.cwd(),
  encoding:"utf8",
  timeout:10000,
  env:{PATH:process.env.PATH,HOME:process.env.HOME,...env},
});

test("read-only CLI refuses missing command and never contacts HiDrive",()=>{
  const r=run([]);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/READONLY_MODE_REQUIRED/);
});

test("read-only CLI refuses source production and staging before config or network",()=>{
  for(const id of ["36adc41d-7e54-4396-ad1a-fd432ba0441d","dfaeabed-03df-43ed-aa71-50f343a75041"]){
    const r=run(["--manifest-only"],{RAILWAY_ENVIRONMENT_ID:id});
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/SOURCE_ENVIRONMENT_FORBIDDEN/);
  }
  const r=run(["--manifest-only"],{RAILWAY_PROJECT_ID:"96ab3402-f974-4cdf-b9a3-408443b17025"});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/SOURCE_ENVIRONMENT_FORBIDDEN/);
});

test("read-only CLI refuses unapproved 690-object read before touching config",()=>{
  const r=run(["--all-ciphertext"]);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/FULL_READ_APPROVAL_REQUIRED/);
});

test("read-only CLI refuses unsafe rclone config permissions and option-like remote",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"sm-hidrive-cli-fixture-"));
  const file=path.join(root,"rclone.conf");
  try{
    await writeFile(file,"[synthetic]\ntype = hidrive\n",{mode:0o600});
    await chmod(file,0o644);
    const r=run(["--manifest-only"],{
      RESTORE_HIDRIVE_RO_RCLONE_CONFIG:file,
      RESTORE_HIDRIVE_RO_REMOTE:"hidrive-ro:SingMotion-DR",
    });
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/PRIVATE_CONFIG_PERMISSIONS_INVALID/);
    await chmod(file,0o600);
    const option=run(["--manifest-only"],{
      RESTORE_HIDRIVE_RO_RCLONE_CONFIG:file,
      RESTORE_HIDRIVE_RO_REMOTE:"--dangerous:SingMotion-DR",
    });
    assert.notEqual(option.status,0);
    assert.match(option.stderr,/RESTORE_REMOTE_INVALID/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test("read-only CLI refuses a reused app context containing source secrets",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"sm-hidrive-source-fixture-"));
  const file=path.join(root,"rclone.conf");
  try{
    await writeFile(file,"[synthetic]\ntype = hidrive\n",{mode:0o600});
    const r=run(["--manifest-only"],{
      RESTORE_HIDRIVE_RO_RCLONE_CONFIG:file,
      RESTORE_HIDRIVE_RO_REMOTE:"hidrive-ro:SingMotion-DR",
      STRIPE_SECRET_KEY:"fixture-only-never-real",
    });
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/SOURCE_SECRETS_FORBIDDEN/);
    assert.doesNotMatch(r.stderr,/fixture-only/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
