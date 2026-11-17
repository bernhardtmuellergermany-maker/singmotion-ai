/**
 * One coherent (per-store), bounded, encrypted archive for local SQLite,
 * PostgreSQL and private R2. A SINGLE HiDrive run, signed manifest and commit.
 *
 * No startup hook, network listener, cron or automatic Production activation.
 * Source credentials stay on the app-side producer; the sink sees ciphertext.
 * Recovery private key is ONLY accepted by restoreMultiStoreArchive.
 */
import path from "node:path";
import { constants, createWriteStream } from "node:fs";
import { open, lstat, realpath, mkdtemp, mkdir, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { backup, DatabaseSync } from "node:sqlite";
import {
  createHash, randomUUID, createPublicKey, createPrivateKey, sign, verify,
} from "node:crypto";
import {
  localFiles, listR2, nativePostgresDump,
} from "./cloud-backup.mjs";
import {
  sealSegment, openSegment, MAX_SEGMENT_BYTES, MAX_SEGMENTS,
} from "./backup-segmented-archive.mjs";
import { auditCreditLedger } from "../commerce/credit-ledger-integrity.ts";

const validId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const MAX_FILES = 2000;
const MAX_PLAINTEXT_BYTES = 16 * 1024 * 1024 * 1024;
const MAX_ENCRYPTED_SEGMENT = MAX_SEGMENT_BYTES + 8192 + 20;
const MAX_SIGNED_MANIFEST = 4 * 1024 * 1024;
const digest = (v) => createHash("sha256").update(v).digest("hex");
const refuse = (code) => { throw Error(code); };
const below = (a,b) => b === a || b.startsWith(a + path.sep);
function publicRecoveryKey(key) {
  const result = key?.type === "public" ? key : createPublicKey(key);
  if (result.asymmetricKeyType !== "rsa" ||
      result.asymmetricKeyDetails?.modulusLength < 3072)
    refuse("RECOVERY_PUBLIC_KEY_INVALID");
  return result;
}
function signerKey(key) {
  const result = key?.type === "private" ? key : createPrivateKey(key);
  if (result.asymmetricKeyType !== "ed25519")
    refuse("BACKUP_SIGNER_INVALID");
  return result;
}
function recoveryKey(key) {
  const result = key?.type === "private" ? key : createPrivateKey(key);
  if (result.asymmetricKeyType !== "rsa" ||
      result.asymmetricKeyDetails?.modulusLength < 3072)
    refuse("RECOVERY_PRIVATE_KEY_INVALID");
  return result;
}
function verifierKey(key) {
  const result = key?.type === "public" ? key : createPublicKey(key);
  if (result.asymmetricKeyType !== "ed25519")
    refuse("BACKUP_VERIFIER_INVALID");
  return result;
}
function safeRelative(name) {
  if (typeof name !== "string" || !name || name.length > 1024 ||
      name.includes("\\") || name.includes("\0") ||
      name.startsWith("/") || name.split("/").some(s => !s || s === "." || s === ".."))
    refuse("ARCHIVE_PATH_INVALID");
  return name;
}
function validateSourceName(kind,name) {
  safeRelative(name);
  if (kind === "postgres" && name !== "cms.dump") refuse("ARCHIVE_PATH_INVALID");
  if (!["sqlite","postgres","local","r2"].includes(kind))
    refuse("ARCHIVE_KIND_INVALID");
}
function guardDeadline(started, maxDurationMs) {
  if (Date.now() - started > maxDurationMs) refuse("BACKUP_DEADLINE_EXCEEDED");
}
async function readCiphertext(stream, expected, limit) {
  if (!Number.isSafeInteger(expected) || expected < 40 || expected > limit)
    refuse("CIPHERTEXT_SIZE_INVALID");
  const chunks = [];
  let count = 0;
  for await (const item of stream) {
    const piece = Buffer.isBuffer(item) ? item : Buffer.from(item);
    count += piece.length;
    if (count > expected) refuse("CIPHERTEXT_OVERSIZE");
    chunks.push(piece);
  }
  if (count !== expected) refuse("CIPHERTEXT_TRUNCATED");
  return Buffer.concat(chunks, count);
}
function validateIndex(index, run) {
  if (!index || index.version !== 3 ||
      index.format !== "singmotion-multistore-segmented-v3" ||
      index.run !== run || !Array.isArray(index.files) ||
      index.files.length < 4 || index.files.length > MAX_FILES ||
      index.atomicAcrossStores !== false ||
      !Number.isSafeInteger(index.totalBytes) ||
      index.totalBytes < 0 || index.totalBytes > MAX_PLAINTEXT_BYTES)
    refuse("SIGNED_MULTISTORE_INDEX_INVALID");
  const ids = new Set(), sources = new Set(), sqlite = new Set();
  let bytes = 0, parts = 0;
  const kinds = { sqlite: 0, postgres: 0, r2: 0, local: 0 };
  for (const file of index.files) {
    validateSourceName(file.kind, file.name);
    const name = file.kind + ":" + file.name;
    if (sources.has(name) || !sha256Pattern.test(file.sha256 ?? "") ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
        !Array.isArray(file.segments)) refuse("SIGNED_MULTISTORE_FILE_INVALID");
    sources.add(name);
    if (file.kind === "sqlite") sqlite.add(file.name);
    kinds[file.kind]++;
    let size = 0;
    for (const [position, seg] of file.segments.entries()) {
      if (!seg || seg.position !== position || !validId.test(seg.id) ||
          ids.has(seg.id) || !sha256Pattern.test(seg.sha256 ?? "") ||
          !sha256Pattern.test(seg.plaintextSha256 ?? "") ||
          !Number.isSafeInteger(seg.bytes) ||
          seg.bytes < 40 || seg.bytes > MAX_ENCRYPTED_SEGMENT ||
          !Number.isSafeInteger(seg.plaintextBytes) ||
          seg.plaintextBytes < 1 || seg.plaintextBytes > MAX_SEGMENT_BYTES)
        refuse("SIGNED_MULTISTORE_SEGMENT_INVALID");
      ids.add(seg.id); size += seg.plaintextBytes; parts++;
    }
    if (size !== file.bytes ||
        (file.bytes === 0) !== (file.segments.length === 0))
      refuse("SIGNED_MULTISTORE_SIZE_MISMATCH");
    bytes += file.bytes;
  }
  if (!["commerce.sqlite","live-test.sqlite","demo.sqlite"].every(x=>sqlite.has(x)) ||
      kinds.postgres !== 1 || kinds.r2 < 1 ||
      index.totalBytes !== bytes || parts > MAX_SEGMENTS)
    refuse("SIGNED_MULTISTORE_COVERAGE_INVALID");
  return { index, parts, kinds };
}
async function strictCopy(src, target, entry) {
  const input = await open(src, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await input.stat();
    if (!before.isFile() || before.nlink !== 1 ||
        before.ino !== entry.stat.ino || before.dev !== entry.stat.dev)
      refuse("SOURCE_CHANGED");
    await pipeline(
      input.createReadStream({autoClose:false}),
      createWriteStream(target,{flags:"wx",mode:0o600}),
    );
    const after = await input.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs)
      refuse("SOURCE_CHANGED");
  } finally { await input.close(); }
}
async function sqliteSnapshot(src, target, name) {
  const db = new DatabaseSync(src,{readOnly:true});
  try { await backup(db,target); } finally { db.close(); }
  const output = new DatabaseSync(target,{readOnly:true});
  try {
    if (output.prepare("PRAGMA quick_check").get()?.quick_check !== "ok" ||
        (name === "commerce.sqlite" && !auditCreditLedger(output).ok))
      refuse("SQLITE_BACKUP_INTEGRITY_FAILED");
  } finally {output.close();}
}
/** This function requires a caller-supplied private ciphertext-only sink that
 * implements putStream and commit with remote-readback verification.
 * The caller, not this module, owns certificate management and key escrow.
 */
export async function produceMultiStoreArchive({
  sourceDir, scratchParent, pgEnv, r2, sink,
  recoveryPublicKey, signingPrivateKey,
  segmentBytes = 4 * 1024 * 1024,
  maxDurationMs = 60 * 60 * 1000,
  pgDump = nativePostgresDump,
}) {
  if (!path.isAbsolute(sourceDir) || !path.isAbsolute(scratchParent) ||
      !Number.isSafeInteger(segmentBytes) || segmentBytes < 64*1024 ||
      segmentBytes > MAX_SEGMENT_BYTES ||
      !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1000 ||
      maxDurationMs > 60*60*1000 ||
      typeof sink?.putStream !== "function" || typeof sink?.commit !== "function" ||
      typeof pgDump !== "function" || !r2 ||
      typeof r2.list !== "function" || typeof r2.get !== "function")
    refuse("BACKUP_CONFIGURATION_INVALID");
  const recovery = publicRecoveryKey(recoveryPublicKey);
  const signing = signerKey(signingPrivateKey);
  const source = await realpath(sourceDir), parent = await realpath(scratchParent);
  const srcStat = await lstat(source), parentStat = await lstat(parent);
  if (!srcStat.isDirectory() || srcStat.isSymbolicLink() ||
      !parentStat.isDirectory() || parentStat.isSymbolicLink() ||
      (parentStat.mode & 0o077) !== 0 ||
      (process.getuid && parentStat.uid !== process.getuid()) ||
      below(source,parent) || below(parent,source))
    refuse("ISOLATED_PRIVATE_SCRATCH_REQUIRED");
  const started = Date.now();
  const scratch = await mkdtemp(path.join(parent,"singmotion-cross-store-"));
  const run = randomUUID();
  let committed = false;
  const index = {
    version:3,format:"singmotion-multistore-segmented-v3",
    run,startedAt:new Date().toISOString(),atomicAcrossStores:false,
    files:[],totalBytes:0,finishedAt:null,
  };
  const uploaded = [];
  let count = 0;
  async function uploadSnapshot(snapshot,kind,name,etag=null) {
    guardDeadline(started,maxDurationMs);
    validateSourceName(kind,name);
    if (index.files.length >= MAX_FILES) refuse("BACKUP_FILE_LIMIT");
    const handle = await open(snapshot,constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 ||
          !Number.isSafeInteger(stat.size) || stat.size > MAX_PLAINTEXT_BYTES ||
          stat.size + index.totalBytes > MAX_PLAINTEXT_BYTES)
        refuse("BACKUP_SOURCE_SIZE_LIMIT");
      const hash = createHash("sha256");
      const record = {kind,name, ...(etag ? {etag}:{}),bytes:stat.size,sha256:null,segments:[]};
      for (let start=0;start<stat.size;start+=segmentBytes) {
        guardDeadline(started,maxDurationMs);
        if (++count >= MAX_SEGMENTS) refuse("BACKUP_SEGMENT_LIMIT");
        const n = Math.min(segmentBytes,stat.size-start);
        const plain = Buffer.allocUnsafe(n);
        try {
          let offset=0;
          while(offset<n) {
            const value=await handle.read(plain,offset,n-offset,start+offset);
            if (!value.bytesRead) refuse("BACKUP_SOURCE_TRUNCATED");
            offset+=value.bytesRead;
          }
          hash.update(plain);
          const id=randomUUID(),sealed=sealSegment(plain,recovery,run+"/"+id);
          const metadata={
            id,position:record.segments.length,plaintextBytes:n,
            plaintextSha256:digest(plain),bytes:sealed.length,sha256:digest(sealed),
          };
          await sink.putStream(run,id,Readable.from([sealed]),
            {bytes:metadata.bytes,sha256:metadata.sha256});
          uploaded.push({id,bytes:metadata.bytes,sha256:metadata.sha256});
          record.segments.push(metadata);
        } finally {plain.fill(0);}
      }
      const after=await handle.stat();
      if (after.ino!==stat.ino || after.dev!==stat.dev ||
          after.nlink!==1 || after.size!==stat.size ||
          after.mtimeMs!==stat.mtimeMs || after.ctimeMs!==stat.ctimeMs)
        refuse("BACKUP_SOURCE_MUTATED");
      record.sha256=hash.digest("hex");
      index.files.push(record);
      index.totalBytes+=stat.size;
    } finally {await handle.close();}
  }
  async function withTemporary(kind,name,create,etag=null) {
    const file=path.join(scratch,randomUUID());
    try {
      await create(file);
      await uploadSnapshot(file,kind,name,etag);
    } finally {await rm(file,{force:true});}
  }
  try {
    for (const entry of await localFiles(source)) {
      await withTemporary(entry.sqlite ? "sqlite":"local",entry.name,async file=>{
        if (entry.sqlite) await sqliteSnapshot(entry.file,file,entry.name);
        else await strictCopy(entry.file,file,entry);
      });
    }
    await withTemporary("postgres","cms.dump",file=>pgDump(file,pgEnv));
    const initial = await listR2(r2);
    for (const item of initial) {
      guardDeadline(started,maxDurationMs);
      await withTemporary("r2",item.Key,async file=>{
        if (!Number.isSafeInteger(item.Size) || item.Size > MAX_PLAINTEXT_BYTES)
          refuse("R2_SOURCE_SIZE_INVALID");
        const response=await r2.get(item.Key,item.ETag);
        if (response?.ETag !== item.ETag || response.ContentLength !== item.Size ||
            !response.Body) refuse("R2_SOURCE_CHANGED");
        await pipeline(response.Body,createWriteStream(file,{flags:"wx",mode:0o600}));
        if ((await lstat(file)).size !== item.Size) refuse("R2_SOURCE_TRUNCATED");
      },item.ETag);
    }
    if (JSON.stringify(initial)!==JSON.stringify(await listR2(r2)))
      refuse("R2_SOURCE_CHANGED");
    index.finishedAt=new Date().toISOString();
    validateIndex(index,run);
    const payload=JSON.stringify(index),signature=sign(null,Buffer.from(payload),signing);
    const signed=Buffer.from(JSON.stringify({payload,signature:signature.toString("base64")}));
    if (signed.length > MAX_SIGNED_MANIFEST) refuse("BACKUP_MANIFEST_LIMIT");
    const manifestId=randomUUID(),manifest=sealSegment(signed,recovery,run+"/"+manifestId);
    const manifestMeta={bytes:manifest.length,sha256:digest(manifest)};
    await sink.putStream(run,manifestId,Readable.from([manifest]),manifestMeta);
    uploaded.push({id:manifestId,...manifestMeta});
    await sink.commit(run,manifestId,uploaded);
    committed=true;
    return {
      run,manifestId,manifestMeta,files:index.files.length,
      segments:count,bytes:index.totalBytes,stores:{
        sqlite:index.files.filter(x=>x.kind==="sqlite").length,
        postgres:1,r2:index.files.filter(x=>x.kind==="r2").length,
        local:index.files.filter(x=>x.kind==="local").length,
      },remoteReceiptCommitted:true,independentRestoreVerified:false,
    };
  } finally {
    await rm(scratch,{recursive:true,force:true});
    if(!committed) await sink.abort?.(run);
  }
}
export async function restoreMultiStoreArchive({
  sink,run,manifestId,manifestMeta,
  recoveryPrivateKey,signingPublicKey,targetDir,
}) {
  if (!validId.test(run) || !validId.test(manifestId) ||
      !manifestMeta || !sha256Pattern.test(manifestMeta.sha256) ||
      !path.isAbsolute(targetDir) ||
      typeof sink?.readStream !== "function")
    refuse("RECOVERY_CONFIG_INVALID");
  const priv=recoveryKey(recoveryPrivateKey),pub=verifierKey(signingPublicKey);
  const cipher=await readCiphertext(
    await sink.readStream(run,manifestId),
    manifestMeta.bytes,MAX_SIGNED_MANIFEST+8192+20,
  );
  if (digest(cipher)!==manifestMeta.sha256) refuse("RECOVERY_MANIFEST_HASH_INVALID");
  const signed=JSON.parse(openSegment(cipher,priv,run+"/"+manifestId).toString("utf8"));
  if(typeof signed.payload!=="string" || typeof signed.signature!=="string" ||
     !verify(null,Buffer.from(signed.payload),pub,Buffer.from(signed.signature,"base64")))
    refuse("RECOVERY_MANIFEST_SIGNATURE_INVALID");
  const {index,kinds,parts}=validateIndex(JSON.parse(signed.payload),run);
  const rootParent=path.dirname(targetDir),parentInfo=await lstat(rootParent);
  if(!parentInfo.isDirectory() || parentInfo.isSymbolicLink() ||
     (parentInfo.mode & 0o077)!==0 ||
     (process.getuid && parentInfo.uid!==process.getuid()))
    refuse("PRIVATE_RECOVERY_PARENT_REQUIRED");
  let created=false,success=false;
  try {
    await mkdir(targetDir,{mode:0o700});
    created=true;
    let restored=0;
    for(const file of index.files) {
      const folder=path.join(targetDir,file.kind);
      const target=path.join(folder,...file.name.split("/"));
      await mkdir(path.dirname(target),{recursive:true,mode:0o700});
      const output=await open(target,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
      try {
        const hash=createHash("sha256");
        let size=0;
        for (const seg of file.segments) {
          const bytes=await readCiphertext(await sink.readStream(run,seg.id),seg.bytes,MAX_ENCRYPTED_SEGMENT);
          if(digest(bytes)!==seg.sha256) refuse("RECOVERY_SEGMENT_HASH_INVALID");
          const plain=openSegment(bytes,priv,run+"/"+seg.id);
          try {
            if(plain.length!==seg.plaintextBytes ||
               digest(plain)!==seg.plaintextSha256)
              refuse("RECOVERY_SEGMENT_PLAINTEXT_INVALID");
            hash.update(plain);
            let offset=0;
            while(offset<plain.length) {
              const w=await output.write(plain,offset,plain.length-offset);
              if(!w.bytesWritten) refuse("RECOVERY_WRITE_FAILED");
              offset+=w.bytesWritten;
            }
            size+=plain.length;
          } finally{plain.fill(0);}
        }
        if(size!==file.bytes || hash.digest("hex")!==file.sha256)
          refuse("RECOVERY_FILE_HASH_INVALID");
        await output.sync();
        restored++;
      } finally {await output.close();}
    }
    success=true;
    return {recovered:true,run,files:restored,segments:parts,bytes:index.totalBytes,
      stores:kinds,sqlIntegrityNotYetVerified:true,publicReleaseVerified:false};
  } finally {
    if(created&&!success) await rm(targetDir,{recursive:true,force:true});
  }
}
