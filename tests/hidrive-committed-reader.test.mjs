import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { hidriveCiphertextSink } from "../lib/ops/hidrive-ciphertext-sink.mjs";
import { uploadSegmentedArchive, restoreSegmentedArchive } from "../lib/ops/backup-segmented-archive.mjs";
import { validateCommittedReceipt, openHiDriveCommittedReader } from "../lib/ops/hidrive-committed-reader.mjs";

const rsa = generateKeyPairSync("rsa", { modulusLength: 3072 });
const signer = generateKeyPairSync("ed25519");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const temp = () => mkdtemp(path.join(tmpdir(), "sm-committed-reader-"));

function drive() {
  const store = new Map(), calls = [];
  const session = {
    dir: "root/users/synthetic/SingMotion-DR",
    async request(method, endpoint, params, body) {
      calls.push({method,endpoint,params});
      assert.equal(endpoint, "/file");
      if (method === "POST") {
        assert.equal(Object.hasOwn(params, "overwrite"), false);
        assert.ok(Buffer.isBuffer(body));
        if (store.has(params.name)) return {ok:false,status:409};
        store.set(params.name, Buffer.from(body));
        return {ok:true,status:201};
      }
      assert.equal(method, "GET");
      const bytes = store.get(params.path.split("/").at(-1));
      if (!bytes) return {ok:false,status:404};
      return {ok:true,status:200,body:Readable.from([Buffer.from(bytes)])};
    },
  };
  return {store,calls,session};
}
async function archive(root, sourceBytes) {
  const src = path.join(root, "input");
  await writeFile(src, sourceBytes);
  const remote = drive();
  const sink = hidriveCiphertextSink({session:remote.session,spool:root});
  const result = await uploadSegmentedArchive({
    source:src,sink,recoveryPublicKey:rsa.publicKey,signingPrivateKey:signer.privateKey,
    segmentBytes:1024*1024,
  });
  return {remote,result,src};
}
async function restore(root,reader,result) {
  const target = path.join(root,"recovered");
  const check = await restoreSegmentedArchive({
    sink:reader,run:result.run,manifestId:reader.manifestId,
    manifestMeta:reader.manifestMeta,target,
    recoveryPrivateKey:rsa.privateKey,signingPublicKey:signer.publicKey,
  });
  return {target,check};
}

test("fresh HiDrive reader reconstructs signed encrypted archive after sender/receiver state loss", async () => {
  const root = await temp();
  try {
    const contents = randomBytes(11*1024*1024+41);
    const {remote,result,src} = await archive(root,contents);
    await rm(src);
    // Original writer and its in-memory verified map are discarded.
    const previousOps = remote.calls.length;
    const independent = await openHiDriveCommittedReader({session:remote.session,run:result.run});
    assert.equal(independent.manifestId,result.manifestId);
    assert.deepEqual(independent.manifestMeta,result.manifestMeta);
    const {target,check} = await restore(root,independent,result);
    assert.equal(check.recovered,true);
    assert.equal(check.bytes,contents.length);
    assert.deepEqual(await readFile(target),contents);
    assert.ok(remote.calls.slice(previousOps).every((c)=>c.method==="GET"));
    const receiptPath = "sm-"+result.run+"-COMMITTED.enc";
    assert.ok(remote.store.has(receiptPath));
    assert.equal(remote.store.size,result.segments+2);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test("read-only reader denies unknown run, uncommitted IDs and arbitrary paths", async () => {
  const root = await temp();
  try {
    const {remote,result} = await archive(root,Buffer.from("no-public-access"));
    const reader = await openHiDriveCommittedReader({session:remote.session,run:result.run});
    const before = remote.calls.length;
    await assert.rejects(reader.readStream(randomUUID(),result.manifestId),/COMMITTED_OBJECT_NOT_AUTHORIZED/);
    await assert.rejects(reader.readStream(result.run,randomUUID()),/COMMITTED_OBJECT_NOT_AUTHORIZED/);
    await assert.rejects(reader.readStream(result.run,"../../state"),/COMMITTED_OBJECT_NOT_AUTHORIZED/);
    assert.equal(remote.calls.length,before);
    await assert.rejects(openHiDriveCommittedReader({session:remote.session,run:randomUUID()}),/COMMITTED_REMOTE_READ_REFUSED/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test("tampered or incomplete ciphertext is refused, with no partial restore output", async () => {
  const root = await temp();
  try {
    const {remote,result} = await archive(root,randomBytes(3*1024*1024+30));
    const reader = await openHiDriveCommittedReader({session:remote.session,run:result.run});
    const receipt = JSON.parse(remote.store.get("sm-"+result.run+"-COMMITTED.enc").toString());
    const chunk = "sm-"+result.run+"-"+receipt.files[1].id+".enc";
    const edited = Buffer.from(remote.store.get(chunk));
    edited[edited.length-1] ^= 1;
    remote.store.set(chunk,edited);
    await assert.rejects(restore(root,reader,result), /COMMITTED_CIPHERTEXT_MISMATCH/);
    await assert.rejects(stat(path.join(root,"recovered")),{code:"ENOENT"});
    remote.store.set(chunk,edited.subarray(0,edited.length-1));
    await assert.rejects(restore(root,reader,result), /COMMITTED_CIPHERTEXT_MISMATCH/);
    await assert.rejects(stat(path.join(root,"recovered")),{code:"ENOENT"});
  } finally { await rm(root,{recursive:true,force:true}); }
});

test("remote COMMITTED receipt is bounded, exact and cannot authorize extra objects", async () => {
  const root = await temp();
  try {
    const {remote,result} = await archive(root,Buffer.from("test"));
    const name = "sm-"+result.run+"-COMMITTED.enc";
    const valid = JSON.parse(remote.store.get(name).toString());
    assert.equal(validateCommittedReceipt(valid,result.run).manifestId,result.manifestId);
    for(const bad of [
      {...valid,run:randomUUID()},
      {...valid,manifestId:randomUUID()},
      {...valid,files:[...valid.files,valid.files[0]]},
      {...valid,files:[...valid.files,{id:randomUUID(),bytes:4,sha256:"0".repeat(64)}]},
      {...valid,files:valid.files.map((f)=>({...f,sha256:"garbage"}))},
      {...valid,sourcePath:"customer-path"},
    ]) assert.throws(()=>validateCommittedReceipt(bad,result.run));
    remote.store.set(name,Buffer.alloc(1024*1024+1,8));
    await assert.rejects(openHiDriveCommittedReader({session:remote.session,run:result.run}),/COMMITTED_RECEIPT_TOO_LARGE/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
