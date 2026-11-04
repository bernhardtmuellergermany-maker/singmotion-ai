import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Job, Asset } from "../lib/domain.ts";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "singmotion-test-"));
const {
  db,
  createSession,
  session,
  asset,
  putAsset,
  enqueue,
  balance,
  transition,
  job,
  demoOnly,
  limit,
} = await import("../lib/db.ts");
after(() => {
  db.close();
  rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
});
function makeJob(owner: string): Job {
  return {
    id: randomUUID(),
    owner,
    requestKey: randomUUID(),
    songId: "song",
    imageId: "image",
    artistName: "Artist",
    start: 0,
    end: 10,
    performance: "Natural",
    camera: "Static Close-Up",
    prompt: "Sing",
    price: 299,
    status: "queued",
    stage: "Queued",
    outputId: null,
    error: null,
    created: Date.now(),
    updated: Date.now(),
    saved: false,
    demo: true,
  };
}
test("session credentials are hashed and resources cannot be read by another user", () => {
  const a = createSession(),
    b = createSession();
  assert.equal(session(a.token)?.owner, a.owner);
  assert.equal(session("forged"), undefined);
  const row = db
    .prepare("SELECT token FROM sessions WHERE owner=?")
    .get(a.owner);
  assert.notEqual(row?.token, a.token);
  const file: Asset = {
    id: randomUUID(),
    owner: a.owner,
    kind: "audio",
    name: "test.mp3",
    path: "/private",
    mime: "audio/mpeg",
    bytes: 10,
    duration: 10,
    width: null,
    height: null,
    created: Date.now(),
  };
  putAsset(file);
  assert.equal(asset(file.id, a.owner).name, "test.mp3");
  assert.throws(() => asset(file.id, b.owner), /not found/);
  const j = enqueue(makeJob(a.owner));
  assert.throws(() => job(j.id, b.owner), /not found/);
});
test("duplicate submission reserves once; technical failure restores exactly once", () => {
  const { owner } = createSession();
  const opening = balance(owner);
  const j = makeJob(owner);
  enqueue(j);
  const duplicate = enqueue({ ...j, id: randomUUID() });
  assert.equal(duplicate.id, j.id);
  assert.equal(balance(owner), opening - 299);
  transition(j.id, "processing");
  transition(j.id, "failed", { error: "test failure" });
  assert.equal(balance(owner), opening);
  assert.throws(() => transition(j.id, "failed"));
  assert.equal(balance(owner), opening);
});
test("completed jobs capture once; queued cancellation restores reservation", () => {
  const { owner } = createSession();
  const j = enqueue(makeJob(owner));
  transition(j.id, "processing");
  transition(j.id, "completed");
  assert.equal(balance(owner), 1250 - 299);
  assert.throws(() => transition(j.id, "completed"));
  const c = enqueue(makeJob(owner));
  transition(c.id, "cancelled");
  assert.equal(balance(owner), 1250 - 299);
});
test("insufficient credit and concurrency checks roll back atomically", () => {
  const { owner } = createSession();
  assert.throws(
    () => enqueue({ ...makeJob(owner), price: 99999 }),
    /Not enough/,
  );
  assert.equal(balance(owner), 1250);
  enqueue(makeJob(owner));
  enqueue(makeJob(owner));
  assert.throws(() => enqueue(makeJob(owner)), /wait/);
  assert.equal(balance(owner), 1250 - 598);
});
test("demo mode fails closed when disabled and rate limits are enforced", () => {
  process.env.DEMO_MODE = "false";
  assert.throws(() => demoOnly(), /Live mode/);
  delete process.env.DEMO_MODE;
  limit("test", 1);
  assert.throws(() => limit("test", 1), /Too many/);
});

test("expired sessions never delete customer or CMS media owners",async()=>{
 const {expiredDemoOwners}=await import("../lib/live/cleanup.ts");
 const {DatabaseSync}=await import("node:sqlite");
 const {randomUUID}=await import("node:crypto");
 const testDb=new DatabaseSync(":memory:");
 try{
  testDb.exec("CREATE TABLE sessions(token TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL)");
  const demo=randomUUID(),activeDemo=randomUUID(),customer="customer-"+randomUUID();
  const staff="cms-staff-editor_001",now=1000000;
  const add=(token:string,owner:string,expires:number)=>testDb.prepare("INSERT INTO sessions VALUES(?,?,?)").run(token,owner,expires);
  add("demo-expired",demo,now-1);
  add("demo-old",activeDemo,now-1);
  add("demo-fresh",activeDemo,now+10000);
  add("customer-expired",customer,now-1);
  add("staff-expired",staff,now-1);
  assert.deepEqual(expiredDemoOwners(testDb,now),[demo]);
  assert.throws(()=>expiredDemoOwners(testDb,Number.NaN),/timestamp/);
 }finally{testDb.close()}
});
