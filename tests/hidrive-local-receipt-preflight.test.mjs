import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  validateLocalHiDriveReceiptManifest230,
  verifyLocalHiDriveReceiptManifest230,
} from "../lib/ops/hidrive-local-receipt-verifier.mjs";

const sha=(bytes)=>createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const run=randomUUID(),manifestId=randomUUID();
  const manifest=randomBytes(600);
  const part1=randomBytes(256),part2=randomBytes(150);
  const files=[
    {id:randomUUID(),bytes:part1.length,sha256:sha(part1)},
    {id:randomUUID(),bytes:part2.length,sha256:sha(part2)},
    {id:manifestId,bytes:manifest.length,sha256:sha(manifest)},
  ];
  const receipt=Buffer.from(JSON.stringify({run,manifestId,files}));
  const pin={run,manifestId,manifestBytes:manifest.length,
    manifestSha256:sha(manifest),segments:2};
  return {run,manifestId,manifest,receipt,pin,files};
}
test("valid offline receipt and ciphertext manifest yields unambiguous non-restore evidence",()=>{
  const f=fixture();
  const report=validateLocalHiDriveReceiptManifest230(f.receipt,f.manifest,f.pin);
  assert.equal(report.localCommittedReceiptVerified,true);
  assert.equal(report.localEncryptedManifestSha256Verified,true);
  assert.equal(report.receiptAllowlistedCiphertextObjects,3);
  assert.equal(report.independentlyAuthenticatedHiDriveGetVerified,false);
  assert.equal(report.independentRestoreVerified,false);
  assert.equal(report.rsaDecryptionVerified,false);
});
test("rejects changed, truncated or wrong ciphertext manifest",()=>{
  const f=fixture(),tampered=Buffer.from(f.manifest);tampered[2]^=1;
  assert.throws(()=>validateLocalHiDriveReceiptManifest230(f.receipt,tampered,f.pin),/LOCAL_MANIFEST_HASH_MISMATCH/);
  assert.throws(()=>validateLocalHiDriveReceiptManifest230(f.receipt,f.manifest.subarray(0,-1),f.pin),/LOCAL_MANIFEST_HASH_MISMATCH/);
  assert.throws(()=>validateLocalHiDriveReceiptManifest230(f.receipt,f.manifest,{...f.pin,manifestSha256:"0".repeat(64)}),/COMMITTED_RECEIPT_PIN_MISMATCH/);
});
test("rejects edited receipt, wrong run, duplicate entry and missing manifest",()=>{
  const f=fixture(),raw=JSON.parse(f.receipt);
  for(const change of [
    {...raw,run:randomUUID()},
    {...raw,files:[...raw.files,raw.files[0]]},
    {...raw,files:raw.files.slice(0,-1)},
    {...raw,manifestId:randomUUID()},
  ]) assert.throws(()=>validateLocalHiDriveReceiptManifest230(
    Buffer.from(JSON.stringify(change)),f.manifest,f.pin));
});
test("owner-only local file reading rejects group writable files",async()=>{
  const f=fixture(),root=await mkdtemp(path.join(tmpdir(),"sm-browser-receipt-"));
  const receiptPath=path.join(root,"receipt.enc"),manifestPath=path.join(root,"manifest.enc");
  try{
    await writeFile(receiptPath,f.receipt,{mode:0o600});
    await writeFile(manifestPath,f.manifest,{mode:0o600});
    await chmod(receiptPath,0o666);
    await assert.rejects(verifyLocalHiDriveReceiptManifest230({receiptPath,manifestPath}),
      /LOCAL_FILE_NOT_PRIVATE_REGULAR/);
    await chmod(receiptPath,0o600);
    // Fixture's run intentionally differs from the real pinned Production run.
    await assert.rejects(verifyLocalHiDriveReceiptManifest230({receiptPath,manifestPath}),
      /COMMITTED_RECEIPT_INVALID/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test("refuses invalid input lengths and unsafe CLI payload shapes",()=>{
  const f=fixture();
  assert.throws(()=>validateLocalHiDriveReceiptManifest230(Buffer.alloc(0),f.manifest,f.pin),/LOCAL_ENCRYPTED_INPUT_INVALID/);
  assert.throws(()=>validateLocalHiDriveReceiptManifest230(f.receipt,Buffer.alloc(1024*1024*5),f.pin),/LOCAL_ENCRYPTED_INPUT_INVALID/);
});
