import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BytePlusProtocol,
  BytePlusError,
  DocumentedBytePlusProvider,
  wireRequest,
  omni20,
  type WireRequest,
} from "../lib/live/byteplus.ts";
import { validateOmniAudio, validateOmniImage } from "../lib/live/limits.ts";
const signal = () => new AbortController().signal;
const ok = (data: unknown) => ({
  status: 200,
  body: { code: 10000, data, status: 99999 },
});
test("documented requests use the exact 2.0 endpoint, version and body with a single image", async () => {
  const requests: WireRequest[] = [];
  const protocol = new BytePlusProtocol(async (request) => {
    requests.push(request);
    return ok({ task_id: "task-1" });
  });
  assert.deepEqual(
    await protocol.submit(
      {
        imageUrl: "https://input.example.test/i",
        audioUrl: "https://input.example.test/a",
        prompt: "Sing softly. Static close-up.",
      },
      signal(),
    ),
    { jobId: "task-1" },
  );
  assert.equal(
    requests[0].url,
    "https://cv.byteplusapi.com/?Action=CVSync2AsyncSubmitTask&Version=2024-06-06",
  );
  assert.equal(requests[0].method, "POST");
  assert.deepEqual(JSON.parse(requests[0].body), {
    req_key: omni20.reqKey,
    image_urls: ["https://input.example.test/i"],
    audio_url: "https://input.example.test/a",
    prompt: "Sing softly. Static close-up.",
    enable_watermark: false,
  });
  assert.equal(requests[0].headers["Content-Type"], "application/json");
  await protocol.submit({ imageUrl: "i", audioUrl: "a" }, signal());
  assert.equal("prompt" in JSON.parse(requests[1].body), false);
  await protocol.submit({ imageUrl: "i", audioUrl: "a", prompt: "   " }, signal());
  assert.equal("prompt" in JSON.parse(requests[2].body), false);
  assert.equal(JSON.parse(requests[1].body).enable_watermark, false);
  assert.deepEqual(
    JSON.parse(
      wireRequest("CVSync2AsyncGetResult", { task_id: "task-1" }).body,
    ),
    { req_key: omni20.reqKey, task_id: "task-1" },
  );
});
test("poll parses documented statuses, only reads successful code, and rejects missing output/unknown status", async () => {
  for (const status of [
    "in_queue",
    "generating",
    "done",
    "not_found",
    "expired",
    "canceled",
  ]) {
    const protocol = new BytePlusProtocol(async () =>
      ok({ status, video_url: "https://output.example.test/v" }),
    );
    const result = await protocol.status("id", signal());
    assert.equal(result.status, status);
    assert.equal(
      result.outputUrl,
      status === "done" ? "https://output.example.test/v" : undefined,
    );
  }
  for (const data of [null, { status: "done" }, { status: "invented" }]) {
    await assert.rejects(
      new BytePlusProtocol(async () => ok(data)).status("id", signal()),
      BytePlusError,
    );
  }
  const body = {
    code: 50400,
    get data() {
      throw new Error("must not read");
    },
  };
  await assert.rejects(
    new BytePlusProtocol(async () => ({ status: 200, body })).status(
      "id",
      signal(),
    ),
    BytePlusError,
  );
});
test("completed task retrieves the documented nested JSON video URL without new provider submission",async()=>{
 const calls:string[]=[];
 const protocol=new BytePlusProtocol(async request=>{
  calls.push(new URL(request.url).searchParams.get("Action")||"");
  return ok({status:"done",resp_data:JSON.stringify({video_url:"https://output.example.test/ready.mp4",progress:100})});
 });
 assert.deepEqual(await protocol.status("existing-paid-task",signal()),{
  status:"done",outputUrl:"https://output.example.test/ready.mp4"
 });
 assert.deepEqual(calls,["CVSync2AsyncGetResult"]);
 for(const resp_data of ['{','[]','{}',JSON.stringify({video_url:""})]){
  await assert.rejects(new BytePlusProtocol(async()=>ok({status:"done",resp_data})).status("existing-paid-task",signal()),BytePlusError);
 }
});
test("provider failures redact raw messages; retryable codes never cause automatic submission retries", async () => {
  for (const code of [50429, 50430, 50500, 50501, 50510, 50215, 50400]) {
    let calls = 0;
    const protocol = new BytePlusProtocol(async () => {
      calls++;
      return {
        status: 500,
        body: {
          code,
          message: "secret signed URL must not escape",
          data: null,
        },
      };
    });
    await assert.rejects(
      protocol.submit({ imageUrl: "i", audioUrl: "a" }, signal()),
      (error) => {
        assert.ok(error instanceof BytePlusError);
        assert.equal(
          error.retryableRead,
          [50429, 50430, 50500, 50501].includes(code),
        );
        assert.doesNotMatch(error.message, /secret signed/);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});
test("cancellation checks queued state and handles provider consumption race without retry", async () => {
  for (const status of ["in_queue", "generating", "done", "expired"]) {
    const actions: string[] = [];
    const protocol = new BytePlusProtocol(async (request) => {
      actions.push(new URL(request.url).searchParams.get("Action")!);
      return ok({ status, video_url: "https://output.example.test/v" });
    });
    if (status === "in_queue") {
      await protocol.cancelQueued("id", signal());
      assert.equal(actions[1], "CVCancelTask");
    } else {
      await assert.rejects(protocol.cancelQueued("id", signal()));
      assert.equal(actions.length, 1);
    }
  }
  let calls = 0;
  const race = new BytePlusProtocol(async () =>
    ++calls === 1
      ? ok({ status: "in_queue" })
      : { status: 200, body: { code: 50217, data: null } },
  );
  await assert.rejects(race.cancelQueued("id", signal()));
  assert.equal(calls, 2);
});
test("default transport fails closed and aborted requests never reach a transport", async () => {
  await assert.rejects(
    new BytePlusProtocol().submit({ imageUrl: "i", audioUrl: "a" }, signal()),
  );
  let calls = 0;
  const protocol = new BytePlusProtocol(async () => {
    calls++;
    return ok({});
  });
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(protocol.status("id", aborted.signal));
  assert.equal(calls, 0);
});
test("model limits enforce strict sizes, inclusive duration/dimensions and aspect ratio", () => {
  const img = { format: "png", bytes: 10, width: 300, height: 750 };
  validateOmniImage(img);
  validateOmniImage({ ...img, width: 6000, height: 2400 });
  for (const change of [
    { bytes: 30_000_000 },
    { width: 299 },
    { height: 6001 },
    { width: 300, height: 751 },
    { format: "svg" },
    { bytes: NaN },
  ])
    assert.throws(() => validateOmniImage({ ...img, ...change }));
  const audio = { format: "mp3", bytes: 100, duration: 4 };
  validateOmniAudio(audio);
  validateOmniAudio({ ...audio, duration: 300, format: "wav" });
  for (const change of [
    { duration: 3.99 },
    { duration: 300.01 },
    { bytes: 15_000_000 },
    { format: "aac" },
    { duration: NaN },
  ])
    assert.throws(() => validateOmniAudio({ ...audio, ...change }));
});

test("verified 50510 status error reaches Studio reconciliation, without a second provider submission",async()=>{
 const actions:string[]=[];
 const originalTask="existing-paid-task-50510";
 const protocol=new BytePlusProtocol(async request=>{
  const action=new URL(request.url).searchParams.get("Action")||"";
  actions.push(action);
  assert.equal(action,"CVSync2AsyncGetResult","this test only READS the existing provider task");
  assert.equal((JSON.parse(request.body) as {task_id?:string}).task_id,originalTask);
  return {status:500,body:{code:50510,data:null,message:"private diagnostic must not leak"}};
 });
 const provider=new DocumentedBytePlusProvider(
   {} as ConstructorParameters<typeof DocumentedBytePlusProvider>[0],
   {} as ConstructorParameters<typeof DocumentedBytePlusProvider>[1],[],protocol);
 await assert.rejects(provider.poll(originalTask,signal()),error=>{
  assert.ok(error instanceof BytePlusError);
  assert.equal(error.rejection?.taskId,originalTask);
  assert.equal(error.rejection?.code,50510);
  assert.equal(error.rejection?.httpStatus,500);
  assert.match(error.rejection?.responseSha256??"",/^[a-f0-9]{64}$/);
  assert.doesNotMatch(error.message,/private diagnostic/);
  return true;
 });
 assert.deepEqual(actions,["CVSync2AsyncGetResult"]);
});
test("ordinary nonbillability-unknown provider failures remain terminal without refund evidence",async()=>{
 const actions:string[]=[];
 const protocol=new BytePlusProtocol(async request=>{
  actions.push(new URL(request.url).searchParams.get("Action")||"");
  return {status:500,body:{code:50400,data:null}};
 });
 const provider=new DocumentedBytePlusProvider(
   {} as ConstructorParameters<typeof DocumentedBytePlusProvider>[0],
   {} as ConstructorParameters<typeof DocumentedBytePlusProvider>[1],[],protocol);
 assert.deepEqual(await provider.poll("existing-task",signal()),{state:"failed"});
 assert.deepEqual(actions,["CVSync2AsyncGetResult"]);
});
