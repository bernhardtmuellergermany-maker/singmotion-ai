import assert from "node:assert/strict";
import { test } from "node:test";
import { BytePlusError, BytePlusProtocol } from "../lib/live/byteplus.ts";
import { readExistingStudioTask } from "../lib/live/studio-runtime.ts";
const signal = () => new AbortController().signal;

test("retries 50501 only as status reads for one immutable task ID", async () => {
  const ids: string[] = [];
  const protocol = new BytePlusProtocol(async request => {
    assert.equal(new URL(request.url).searchParams.get("Action"), "CVSync2AsyncGetResult");
    ids.push((JSON.parse(request.body) as {task_id: string}).task_id);
    return ids.length < 3
      ? { status: 500, body: {code: 50501, data: null} }
      : { status: 200, body: {code: 10000, data: {status: "done", video_url: "https://example.test/ready.mp4"}} };
  });
  assert.equal((await readExistingStudioTask(protocol, "retained-task", signal())).status, "done");
  assert.deepEqual(ids, ["retained-task", "retained-task", "retained-task"]);
});

test("permanent 50501 returns original failure after at most three status reads", async () => {
  let reads = 0;
  const protocol = new BytePlusProtocol(async request => {
    reads++;
    assert.equal(new URL(request.url).searchParams.get("Action"), "CVSync2AsyncGetResult");
    return {status: 500, body: {code: 50501, data: null}};
  });
  await assert.rejects(readExistingStudioTask(protocol, "retained-task", signal()), (error: unknown) => {
    assert.ok(error instanceof BytePlusError);
    assert.equal(error.diagnostic.providerCode, 50501);
    return true;
  });
  assert.equal(reads, 3);
});

test("permanent rejection is never retried or resubmitted", async () => {
  for (const code of [50510, 50400]) {
    let reads = 0;
    const protocol = new BytePlusProtocol(async request => {
      reads++;
      assert.equal(new URL(request.url).searchParams.get("Action"), "CVSync2AsyncGetResult");
      return {status: 500, body: {code, data: null}};
    });
    await assert.rejects(readExistingStudioTask(protocol, "retained-task", signal()), BytePlusError);
    assert.equal(reads, 1);
  }
});
