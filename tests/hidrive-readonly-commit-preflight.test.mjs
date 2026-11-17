import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { verifyRemoteCommittedCiphertext230 } from "../lib/ops/hidrive-readonly-commit-preflight.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");

function fixture() {
  const run = randomUUID(), manifestId = randomUUID();
  const manifest = randomBytes(700);
  const segments = [randomBytes(1024), randomBytes(64)];
  const entries = segments.map((bytes) => ({ id: randomUUID(), bytes }));
  const files = [
    ...entries.map(({id, bytes}) => ({ id, bytes: bytes.length, sha256: sha(bytes) })),
    { id: manifestId, bytes: manifest.length, sha256: sha(manifest) },
  ];
  const payload = new Map([
    ["COMMITTED", Buffer.from(JSON.stringify({run, manifestId, files}))],
    [manifestId, manifest],
    ...entries.map(({id, bytes}) => [id, bytes]),
  ]);
  const calls = [];
  const session = {
    dir: "root/users/SYNTHETIC/SingMotion-DR",
    async request(method, endpoint, params, body) {
      calls.push({method, endpoint, params});
      assert.equal(method, "GET");
      assert.equal(endpoint, "/file");
      assert.equal(body, null);
      const expected = session.dir + "/sm-" + run + "-";
      assert.ok(params.path.startsWith(expected));
      const filename = params.path.slice(expected.length);
      assert.match(filename, /^(?:COMMITTED|[a-f0-9-]{36})\.enc$/);
      const key = filename.slice(0, -4);
      const bytes = payload.get(key);
      if (!bytes) return { ok: false, status: 404 };
      return { ok: true, body: Readable.from([Buffer.from(bytes)]) };
    },
  };
  const pin = {
    run, manifestId, manifestBytes: manifest.length, manifestSha256: sha(manifest),
    segments: entries.length, sourceFiles: 4, sourceBytes: 0,
  };
  return {session, pin, calls, payload, entries};
}

test("independent preflight fetches only COMMITTED and pinned encrypted manifest by GET", async () => {
  const {session,pin,calls} = fixture();
  const report = await verifyRemoteCommittedCiphertext230({session,pin});
  assert.equal(report.remoteReceiptStructurallyValid, true);
  assert.equal(report.manifestCiphertextSha256Verified, true);
  assert.equal(report.ciphertextObjectsVerified, 1);
  assert.equal(report.ciphertextBytesVerified, pin.manifestBytes);
  assert.equal(report.completeCiphertextReadbackVerified, false);
  assert.equal(report.rsaDecryptionVerified, false);
  assert.equal(report.independentRestoreVerified, false);
  assert.equal(calls.length, 2);
});

test("explicit full-readback mode independently verifies every receipt-listed ciphertext", async () => {
  const {session,pin,calls} = fixture();
  const report = await verifyRemoteCommittedCiphertext230({session,pin,verifyAll:true});
  assert.equal(report.completeCiphertextReadbackVerified,true);
  assert.equal(report.ciphertextObjectsVerified,pin.segments+1);
  assert.equal(calls.length,pin.segments+2);
  assert.ok(calls.every(c=>c.method==="GET"));
});

test("refuses mismatched manifest pin even when receipt is otherwise valid", async () => {
  const {session,pin,calls} = fixture();
  await assert.rejects(
    verifyRemoteCommittedCiphertext230({session,pin:{...pin,manifestSha256:"f".repeat(64)}}),
    /RECEIPT_PIN_MISMATCH/,
  );
  assert.equal(calls.length,1);
});

test("refuses tampered remote manifest, without decrypting", async () => {
  const {session,pin,payload} = fixture();
  const altered = Buffer.from(payload.get(pin.manifestId));
  altered[0] ^= 1;
  payload.set(pin.manifestId,altered);
  await assert.rejects(
    verifyRemoteCommittedCiphertext230({session,pin}),/CIPHERTEXT_HASH_INVALID/,
  );
});

test("refuses altered, missing, or truncated segments in all-ciphertext mode", async () => {
  for (const change of ["changed","missing","truncated"]) {
    const {session,pin,entries,payload} = fixture();
    const original = payload.get(entries[0].id);
    if (change==="changed") {
      const altered = Buffer.from(original); altered[0]^=1;
      payload.set(entries[0].id,altered);
    } else if (change==="missing") payload.delete(entries[0].id);
    else payload.set(entries[0].id,original.subarray(0,original.length-1));
    await assert.rejects(verifyRemoteCommittedCiphertext230({
      session,pin,verifyAll:true,
    }), /HIDRIVE_READ_FAILED|CIPHERTEXT_HASH_INVALID/);
  }
});

test("refuses additional receipt entries and wrong run", async () => {
  const {session,pin,payload} = fixture();
  const receipt = JSON.parse(payload.get("COMMITTED").toString("utf8"));
  receipt.files.splice(-1,0,{id:randomUUID(),bytes:100,sha256:"a".repeat(64)});
  payload.set("COMMITTED",Buffer.from(JSON.stringify(receipt)));
  await assert.rejects(verifyRemoteCommittedCiphertext230({session,pin}),/RECEIPT_PIN_MISMATCH/);
  await assert.rejects(verifyRemoteCommittedCiphertext230({
    session,pin:{...pin,run:randomUUID()},
  }),/HIDRIVE_READ_FAILED/);
});
