import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import https from "node:https";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createOutputTransport,
  isPublicOutputAddress,
} from "../lib/live/output-transport.ts";
import {
  downloadValidatedOutput,
  validateOutputUrl,
} from "../lib/live/output.ts";
import type { VerifiedContract } from "../lib/live/contract.ts";

const url = new URL("https://approved.example.test/video?secret=never-log");
const publicIP = "93.184.216.34";
function wire(
  options: {
    peer?: string;
    status?: number;
    error?: boolean;
    authorized?: boolean;
    bytes?: Uint8Array;
    headers?: Record<string, string>;
  } = {},
) {
  const calls: https.RequestOptions[] = [];
  let destroyed = false;
  const send = ((
    opts: https.RequestOptions,
    callback: (res: unknown) => void,
  ) => {
    calls.push(opts);
    const req = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: () => void;
    };
    req.destroy = () => {
      destroyed = true;
    };
    req.end = () =>
      queueMicrotask(() => {
        if (options.error) {
          req.emit("error", new Error("secret upstream diagnostic"));
          return;
        }
        const res = Object.assign(new PassThrough(), {
          socket: {
            authorized: options.authorized ?? true,
            remoteAddress: options.peer ?? publicIP,
          },
          statusCode: options.status ?? 200,
          headers: options.headers ?? {},
        });
        callback(res);
        res.end(options.bytes ?? Buffer.from("mock"));
      });
    return req;
  }) as typeof https.request;
  return { send, calls, destroyed: () => destroyed };
}
const signal = () => AbortSignal.timeout(2000);

test("public address policy excludes IPv4 and IPv6 internal, mapped and reserved destinations", () => {
  for (const ip of [
    "0.0.0.0",
    "10.1.1.1",
    "127.1.2.3",
    "169.254.169.254",
    "168.63.129.16",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.1.1",
    "192.0.0.9",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "fe80::1%eth0",
    "ff02::1",
    "::ffff:8.8.8.8",
    "::ffff:127.0.0.1",
    "64:ff9b::808:808",
    "2002:0808:0808::1",
    "2001::1",
    "2001:db8::1",
    "3fff::1",
    "bad",
  ])
    assert.equal(isPublicOutputAddress(ip), false, ip);
  for (const ip of [publicIP, "8.8.8.8", "2606:4700:4700::1111"])
    assert.equal(isPublicOutputAddress(ip), true, ip);
});

test("literal pin prevents DNS rebinding and preserves authenticated hostname", async () => {
  let resolutions = 0;
  const mock = wire();
  const transport = createOutputTransport(async () => {
    resolutions++;
    return [{ address: resolutions === 1 ? publicIP : "127.0.0.1", family: 4 }];
  }, mock.send);
  const response = await transport(url, signal());
  assert.equal(await response.text(), "mock");
  assert.equal(resolutions, 1);
  assert.equal(mock.calls.length, 1);
  const opts = mock.calls[0];
  assert.equal(opts.hostname, publicIP);
  assert.equal(opts.servername, url.hostname);
  assert.equal(opts.rejectUnauthorized, true);
  assert.equal(opts.agent, false);
  assert.equal(opts.lookup, undefined); // Literal IP requires no additional lookup.
  assert.deepEqual(opts.headers, {
    Host: url.hostname,
    "Accept-Encoding": "identity",
  });
  assert.equal(opts.path, "/video?secret=never-log");
});

test("IPv6 literal connection accepts canonical equivalents but never a different peer", async () => {
  const address = "2606:4700:4700::1111";
  const mock = wire({ peer: "2606:4700:4700:0:0:0:0:1111" });
  const response = await createOutputTransport(
    async () => [{ address, family: 6 }],
    mock.send,
  )(url, signal());
  await response.body!.cancel();
  assert.equal(mock.calls[0].hostname, address);
  assert.equal(mock.calls[0].family, 6);
});

test("mixed DNS, empty answers, malformed addresses and resolver errors fail before connecting", async () => {
  for (const addresses of [
    [],
    [{ address: "127.0.0.1", family: 4 }],
    [
      { address: publicIP, family: 4 },
      { address: "::1", family: 6 },
    ],
    [{ address: publicIP, family: 6 }],
  ]) {
    const mock = wire();
    await assert.rejects(
      createOutputTransport(async () => addresses, mock.send)(url, signal()),
      /not public/,
    );
    assert.equal(mock.calls.length, 0);
  }
  const mock = wire();
  await assert.rejects(
    createOutputTransport(async () => {
      throw new Error("sensitive DNS data");
    }, mock.send)(url, signal()),
    /^Error: Provider output DNS resolution failed or timed out\.$/,
  );
  const controller = new AbortController();
  const waiting = createOutputTransport(() => new Promise(() => {}), mock.send)(
    url,
    controller.signal,
  );
  controller.abort();
  await assert.rejects(waiting, /DNS resolution/);
  assert.equal(mock.calls.length, 0);
});

test("redirects, unauthorized TLS, wrong peers and connection errors fail without retries", async () => {
  for (const options of [
    { status: 302 },
    { status: 307 },
    { authorized: false },
    { peer: "127.0.0.1" },
    { peer: "8.8.8.8" },
    { error: true },
  ]) {
    const mock = wire(options);
    await assert.rejects(
      createOutputTransport(
        async () => [{ address: publicIP, family: 4 }],
        mock.send,
      )(url, signal()),
      /Provider output (HTTP status rejected|connection failed)/,
    );
    assert.equal(mock.calls.length, 1);
  }
});

test("URL allowlist rejects malicious URLs and remains closed when empty", () => {
  for (const raw of [
    "https://127.1/x",
    "https://2130706433/x",
    "https://[::1]/x",
    "https://[::ffff:8.8.8.8]/x",
    "https://user:pass@approved.example.test/x",
    "https://approved.example.test.evil/x",
    "https://approved.example.test./x",
    "https://approved.example.test:444/x",
    "http://approved.example.test/x",
    "https://approved.example.test/x#fragment",
  ])
    assert.throws(() => validateOutputUrl(raw, [url.hostname]));
  assert.throws(() => validateOutputUrl(url.href, []));
  assert.throws(() => validateOutputUrl(url.href, ["*.example.test"]));
});

test("production downloader defaults to pinned transport and retains validation/size limits", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "output pinned "));
  const mock = wire({ bytes: await readFile("public/media/demo.mp4") });
  // Mock built-in I/O boundaries, not the downloader: no network requests occur.
  t.mock.method(dns, "lookup", async () => [{ address: publicIP, family: 4 }]);
  t.mock.method(https, "request", mock.send);
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("fetch must not be used");
  });
  syncBuiltinESMExports();
  const contract: VerifiedContract = {
    revision: "fictional-output-test",
    model: "OmniHuman 2.0",
    documentationUrl: "https://example.test/mock",
    maxDurationSeconds: 300,
    promptSupported: true,
    inputFetchWindowSeconds: 44100,
    generatedDurationBound: null,
    billing: {
      microUsdPerSecond: 1,
      minimumBillableMs: 0,
      billingQuantumMs: 1,
      minimumChargeMicroUsd: 0,
      fixedFeeMicroUsd: 0,
      taxBasisPointsUpperBound: 0,
    },
    outputHosts: [url.hostname],
    output: {
      width: 1280,
      height: 720,
      fps: 25,
      durationToleranceSeconds: 0.2,
    },
  };
  try {
    await assert.rejects(
      downloadValidatedOutput(url.href, path.join(root, "blocked.mp4"), 10, {
        ...contract,
        outputHosts: [],
      }),
      /approved HTTPS/,
    );
    assert.equal(mock.calls.length, 0);
    await downloadValidatedOutput(
      url.href,
      path.join(root, "valid.mp4"),
      10,
      contract,
    );
    assert.equal(mock.calls[0].hostname, publicIP);
    const large = wire({
      headers: { "content-length": String(101 * 1024 * 1024) },
    });
    t.mock.method(https, "request", large.send);
    syncBuiltinESMExports();
    await assert.rejects(
      downloadValidatedOutput(
        url.href,
        path.join(root, "large.mp4"),
        10,
        contract,
      ),
      /too large/,
    );
    await assert.rejects(stat(path.join(root, "large.mp4")));
    const streamed = wire({ bytes: Buffer.alloc(101 * 1024 * 1024) });
    t.mock.method(https, "request", streamed.send);
    syncBuiltinESMExports();
    await assert.rejects(
      downloadValidatedOutput(
        url.href,
        path.join(root, "streamed.mp4"),
        10,
        contract,
      ),
      /too large/,
    );
    await assert.rejects(stat(path.join(root, "streamed.mp4")));
    assert.equal(streamed.destroyed(), true);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  }
});

test("synchronous connection setup errors and invalid URL details are sanitized", async () => {
  const send = (() => {
    throw new Error("secret signed URL");
  }) as typeof https.request;
  await assert.rejects(
    createOutputTransport(async () => [{ address: publicIP, family: 4 }], send)(
      url,
      signal(),
    ),
    /^Error: Provider output connection failed or timed out\.$/,
  );
  assert.throws(
    () => validateOutputUrl("invalid secret URL", []),
    /^Error: Provider output URL is invalid\.$/,
  );
});
