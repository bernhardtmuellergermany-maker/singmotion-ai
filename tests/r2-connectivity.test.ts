import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { checkR2Connectivity } from "../lib/live/r2-connectivity.ts";
import { loadR2Config, r2ClientConfig } from "../lib/live/r2-config.ts";
const env = {
  R2_ACCOUNT_ID: "0".repeat(32),
  R2_BUCKET: "singmotion-ai-private",
  R2_ACCESS_KEY_ID: "fake-ak",
  R2_SECRET_ACCESS_KEY: "fake-sk",
};
const signal = () => new AbortController().signal;
for (const failure of [
  "none",
  "upload403",
  "collision",
  "uncertain",
  "readhash",
  "signedhash",
  "signed403",
  "oversize",
  "delete",
  "timeout",
] as const) {
  test(`R2 connectivity mock scenario: ${failure}`, async (t) => {
    const client = new S3Client(r2ClientConfig(loadR2Config(env)));
    const commands: (
      PutObjectCommand | GetObjectCommand | DeleteObjectCommand
    )[] = [];
    let content = Buffer.alloc(0),
      signedGets = 0;
    t.mock.method(
      client,
      "send",
      async (
        command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand,
      ) => {
        commands.push(command);
        assert.equal(command.input.Bucket, env.R2_BUCKET);
        assert.match(
          command.input.Key!,
          /^connectivity-tests\/[a-f0-9]{64}\.txt$/,
        );
        if (command instanceof PutObjectCommand) {
          assert.equal(command.input.IfNoneMatch, "*");
          assert.equal(command.input.ACL, undefined);
          content = Buffer.from(command.input.Body as Uint8Array);
          assert.ok(content.length < 200);
          if (["upload403", "collision", "uncertain"].includes(failure))
            throw {
              $metadata: {
                httpStatusCode:
                  failure === "upload403"
                    ? 403
                    : failure === "collision"
                      ? 412
                      : undefined,
              },
              message: "LEAK_SECRET",
            };
          return {};
        }
        if (command instanceof GetObjectCommand)
          return {
            Body: {
              transformToWebStream: () =>
                new Response(failure === "readhash" ? "corrupted" : content)
                  .body!,
            },
          };
        assert.ok(command instanceof DeleteObjectCommand);
        if (failure === "delete") throw new Error("LEAK_SECRET");
        return {};
      },
    );
    const http: typeof fetch = async (raw, options) => {
      signedGets++;
      assert.equal(options?.method, "GET");
      assert.equal(options?.redirect, "error");
      assert.equal(options?.credentials, "omit");
      assert.equal(new Headers(options?.headers).has("authorization"), false);
      const url = new URL(String(raw));
      assert.equal(
        url.hostname,
        `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      );
      assert.equal(url.pathname, `/${env.R2_BUCKET}/${commands[0].input.Key}`);
      assert.equal(url.searchParams.get("X-Amz-Expires"), "60");
      assert.ok(url.searchParams.has("X-Amz-Signature"));
      if (failure === "timeout")
        return new Promise((_resolve, reject) =>
          options!.signal!.addEventListener(
            "abort",
            () => reject(new Error("LEAK_SECRET")),
            { once: true },
          ),
        );
      return new Response(
        failure === "signedhash"
          ? "corrupt"
          : failure === "oversize"
            ? "x".repeat(1025)
            : content,
        { status: failure === "signed403" ? 403 : 200 },
      );
    };
    const result = await checkR2Connectivity(env, {
      client,
      http,
      timeoutMs: failure === "timeout" ? 20 : 1000,
      signal: signal(),
    });
    assert.doesNotMatch(
      JSON.stringify(result),
      /LEAK_SECRET|fake-sk|fake-ak|X-Amz|Authorization/i,
    );
    const uploaded = !["upload403", "collision", "uncertain"].includes(failure);
    const deletes = commands.filter(
      (command) => command instanceof DeleteObjectCommand,
    );
    assert.equal(deletes.length, uploaded ? 1 : 0);
    assert.equal(new Set(commands.map((command) => command.input.Key)).size, 1);
    if (uploaded)
      assert.equal(result.cleanup, failure === "delete" ? "failed" : "deleted");
    else {
      assert.equal(commands.length, 1);
      assert.equal(signedGets, 0);
      assert.equal(
        result.cleanup,
        failure === "uncertain" ? "upload-uncertain" : "not-needed",
      );
    }
    assert.equal(result.ok, failure === "none");
    client.destroy();
  });
}
test("invalid bucket or missing credentials cannot send requests", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("unexpected");
  });
  for (const input of [{}, { ...env, R2_BUCKET: "customer-bucket" }]) {
    const result = await checkR2Connectivity(input);
    assert.equal(result.stage, "configuration");
    assert.equal(result.testKey, undefined);
  }
  assert.equal(calls, 0);
});
test("CLI requires deliberate confirmation even when credentials exist", () => {
  const child = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/r2-connectivity.ts"],
    { env: { ...process.env, ...env }, encoding: "utf8", timeout: 10000 },
  );
  assert.equal(child.status, 1);
  assert.match(child.stderr, /No requests made/);
  assert.doesNotMatch(child.stderr, /fake-ak|fake-sk/);
});

test("operator cancellation still cleans up a confirmed upload with a fresh signal", async (t) => {
  const controller = new AbortController();
  const client = new S3Client(r2ClientConfig(loadR2Config(env)));
  let body = Buffer.alloc(0),
    deleted = false;
  t.mock.method(
    client,
    "send",
    async (
      command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand,
      options: { abortSignal: AbortSignal },
    ) => {
      if (command instanceof PutObjectCommand) {
        body = Buffer.from(command.input.Body as Uint8Array);
        return {};
      }
      if (command instanceof GetObjectCommand)
        return {
          Body: { transformToWebStream: () => new Response(body).body! },
        };
      assert.equal(options.abortSignal.aborted, false);
      deleted = true;
      return {};
    },
  );
  const http: typeof fetch = async (_url, options) => {
    const pending = new Promise<Response>((_resolve, reject) =>
      options!.signal!.addEventListener(
        "abort",
        () => reject(Error("stopped")),
        { once: true },
      ),
    );
    controller.abort();
    return pending;
  };
  const result = await checkR2Connectivity(env, {
    client,
    http,
    signal: controller.signal,
    timeoutMs: 1000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.cleanup, "deleted");
  assert.equal(deleted, true);
  client.destroy();
});
