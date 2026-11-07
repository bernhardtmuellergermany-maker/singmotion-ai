import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  signBytePlusRequest,
  loadBytePlusCredentials,
} from "../lib/live/signing.ts";
import {
  createSignedTransport,
  liveSignedTransport,
  BytePlusTransportError,
} from "../lib/live/signed-transport.ts";
import {
  BytePlusProtocol,
  BytePlusError,
  wireRequest,
  type Action,
} from "../lib/live/byteplus.ts";
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/byteplus-signatures.json", import.meta.url),
    "utf8",
  ),
);
const credentials = {
  accessKeyId: fixture.accessKeyId,
  secretAccessKey: fixture.secretAccessKey,
};
const date = () => new Date("2026-10-15T05:29:58.123Z");
const signal = () => new AbortController().signal;
const request = () => wireRequest("CVSync2AsyncGetResult", { task_id: "id" });
test("all three CV actions match pinned official SDK-derived signatures byte for byte", () => {
  for (const vector of fixture.vectors) {
    const input = {
      ...wireRequest(vector.action as Action, {}),
      body: vector.body,
    };
    const signed = signBytePlusRequest(input, credentials, date());
    assert.deepEqual(signed.headers, vector.headers);
    assert.equal(signed.body, vector.body);
    assert.equal(input.headers.Authorization, undefined);
    const reordered = {
      ...input,
      url: `https://cv.byteplusapi.com/?Version=2024-06-06&Action=${vector.action}`,
    };
    assert.deepEqual(
      signBytePlusRequest(reordered, credentials, date()),
      signed,
    );
  }
});
test("payload bytes and UTC dates bind signatures; timestamp has no milliseconds", () => {
  const baseline = signBytePlusRequest(request(), credentials, date());
  assert.equal(baseline.headers["x-date"], "20261015T052958Z");
  const changed = signBytePlusRequest(
    { ...request(), body: request().body + " " },
    credentials,
    date(),
  );
  assert.notEqual(
    changed.headers.authorization,
    baseline.headers.authorization,
  );
  const next = signBytePlusRequest(
    request(),
    credentials,
    new Date("2026-10-16T00:00:00Z"),
  );
  assert.match(
    next.headers.authorization,
    /20261016\/ap-singapore-1\/cv\/request/,
  );
  assert.throws(() =>
    signBytePlusRequest(request(), credentials, new Date("invalid")),
  );
});
test("credential loading and destination/header validation fail without exposing secrets", () => {
  assert.deepEqual(
    loadBytePlusCredentials({
      BYTEPLUS_ACCESS_KEY_ID: credentials.accessKeyId,
      BYTEPLUS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    }),
    credentials,
  );
  assert.throws(() => loadBytePlusCredentials({}), /missing or invalid/);
  assert.throws(() =>
    loadBytePlusCredentials({
      NEXT_PUBLIC_BYTEPLUS_ACCESS_KEY_ID: "x",
      NEXT_PUBLIC_BYTEPLUS_SECRET_ACCESS_KEY: "x",
    }),
  );
  for (const url of [
    "https://other.example.test/",
    request().url + "&Action=CVCancelTask",
    request().url + "#x",
    request().url.replace("https:", "http:"),
    request().url.replace("/?", "/other?"),
  ]) {
    assert.throws(() =>
      signBytePlusRequest({ ...request(), url }, credentials, date()),
    );
  }
  assert.throws(() =>
    signBytePlusRequest(
      {
        ...request(),
        headers: { ...request().headers, Authorization: "injected" },
      },
      credentials,
    ),
  );
});
test("signed mock HTTP sends the exact body and safe fetch options without retries", async () => {
  let calls = 0;
  const http: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(url, request().url);
    assert.equal(options?.body, request().body);
    assert.equal(options?.redirect, "error");
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.cache, "no-store");
    assert.match(
      new Headers(options?.headers).get("authorization")!,
      /^HMAC-SHA256 /,
    );
    return Response.json({ code: 10000, data: { status: "generating" } });
  };
  const protocol = new BytePlusProtocol(
    createSignedTransport(http, () => credentials, date),
  );
  assert.equal((await protocol.status("id", signal())).status, "generating");
  assert.equal(calls, 1);
});
test("authentication, throttling, server failures and malformed responses have safe classifications", async () => {
  for (const [status, kind, retryable] of [
    [401, "authentication", false],
    [403, "authentication", false],
    [429, "throttled", true],
    [500, "transient", true],
    [302, "protocol", false],
    [200, "protocol", false],
  ] as const) {
    let calls = 0;
    const transport = createSignedTransport(
      async () => {
        calls++;
        return new Response("do not leak provider detail", { status });
      },
      () => credentials,
      date,
    );
    await assert.rejects(
      transport(request(), signal()),
      (error) =>
        error instanceof BytePlusTransportError &&
        error.kind === kind &&
        !error.message.includes("provider detail"),
    );
    const protocol = new BytePlusProtocol(transport);
    await assert.rejects(
      protocol.status("id", signal()),
      (error) =>
        error instanceof BytePlusError && error.retryableRead === retryable,
    );
    assert.equal(calls, 2);
  }
});
test("timeouts abort mock HTTP and never replay; caller cancellation and body-size cap are enforced", async () => {
  let calls = 0;
  let captured: AbortSignal | undefined;
  const transport = createSignedTransport(
    async (_url, options) => {
      calls++;
      captured = options?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) =>
        captured!.addEventListener("abort", () => reject(new Error("secret")), {
          once: true,
        }),
      );
    },
    () => credentials,
    date,
    10,
  );
  await assert.rejects(transport(request(), signal()), BytePlusTransportError);
  assert.equal(captured?.aborted, true);
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(transport(request(), controller.signal));
  assert.equal(calls, 1);
  await assert.rejects(
    createSignedTransport(
      async () => new Response("x".repeat(1024 * 1024 + 1)),
      () => credentials,
    )(request(), signal()),
    BytePlusTransportError,
  );
});
test("production signed transport still cannot dispatch or load credentials", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("must not reach network");
  });
  await assert.rejects(
    liveSignedTransport(request(), signal()),
    /not verified/,
  );
  assert.equal(calls, 0);
});

test("signed transport supports submit and queued cancel; business failure codes override generic HTTP 500", async () => {
  const actions: string[] = [];
  const protocol = new BytePlusProtocol(
    createSignedTransport(
      async (url) => {
        const action = new URL(String(url)).searchParams.get("Action")!;
        actions.push(action);
        return Response.json({
          code: 10000,
          data:
            action === "CVSync2AsyncGetResult"
              ? { status: "in_queue" }
              : { task_id: "id" },
        });
      },
      () => credentials,
      date,
    ),
  );
  await protocol.submit(
    {
      imageUrl: "https://input.example.test/i",
      audioUrl: "https://input.example.test/a",
    },
    signal(),
  );
  await protocol.cancelQueued("id", signal());
  assert.deepEqual(actions, [
    "CVSync2AsyncSubmitTask",
    "CVSync2AsyncGetResult",
    "CVCancelTask",
  ]);
  const failed = new BytePlusProtocol(
    createSignedTransport(
      async () => Response.json({ code: 50510, data: null }, { status: 500 }),
      () => credentials,
    ),
  );
  await assert.rejects(
    failed.status("id", signal()),
    (error) => error instanceof BytePlusError && !error.retryableRead,
  );
});

test("a stalled response body is canceled at the deadline", async () => {
  let canceled = false;
  const transport = createSignedTransport(
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            canceled = true;
          },
        }),
      ),
    () => credentials,
    date,
    10,
  );
  await assert.rejects(transport(request(), signal()), BytePlusTransportError);
  assert.equal(canceled, true);
});
