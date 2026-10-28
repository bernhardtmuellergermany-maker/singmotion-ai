// Runs against a production build using isolated, disposable storage. No paid calls.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
const directory = await mkdtemp(path.join(tmpdir(), "sm-staging-"));
const password = randomBytes(32).toString("hex");
const port = "3197";
const origin = `http://127.0.0.1:${port}`;
const authorization = `Basic ${Buffer.from(`staging:${password}`).toString("base64")}`;
const environment = {
  ...process.env,
  PORT: port,
  DATA_DIR: directory,
  NODE_ENV: "production",
  STAGING_AUTH_ENABLED: "true",
  STAGING_PASSWORD: password,
  DEMO_MODE: "true",
  GENERATIONS_ENABLED: "false",
  ADMIN_DEMO_ENABLED: "false",
  BYTEPLUS_LIVE_TEST_ENABLED: "false",
  APP_ORIGIN: origin,
};
// Invalid configuration/storage must fail before either child can serve traffic.
for (const override of [
  { STAGING_PASSWORD: "" },
  { GENERATIONS_ENABLED: "true" },
]) {
  const result = spawnSync(process.execPath, ["scripts/serve.mjs"], {
    env: { ...environment, ...override },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /ready/i);
}
const blocked = path.join(directory, "not-a-directory");
await writeFile(blocked, "test");
const storageFailure = spawnSync(process.execPath, ["scripts/serve.mjs"], {
  env: { ...environment, DATA_DIR: blocked },
  encoding: "utf8",
  timeout: 5000,
});
assert.equal(storageFailure.status, 1);
assert.match(storageFailure.stderr, /not readable\/writable/);
await unlink(blocked);
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  env: environment,
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", (chunk) => {
  logs += chunk;
});
server.stderr.on("data", (chunk) => {
  logs += chunk;
});
const exited = new Promise((resolve) => server.on("exit", resolve));
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Server exited during startup");
    try {
      ready = (await fetch(origin)).status === 401;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "Production server starts with password gate");
  for (const route of [
    "/",
    "/studio",
    "/projects",
    "/artists",
    "/billing",
    "/admin",
    "/api/cms/staff",
    "/api/cms/cms-assets/file/example.webp",
    "/cms-preview/home",
    "/api/session",
    "/api/studio-live",
    "/api/admin/studio-activation",
    "/api/studio-live?id=unknown&video=1",
    "/api/assets/example",
    "/media/demo.mp4",
    "/favicon.ico",
    "/_next/static/missing.js",
    "/_next/image?url=%2Fmedia%2Fdemo.mp4&w=64&q=75",
    "/studio?_rsc=test",
  ]) {
    const response = await fetch(origin + route, {
      headers: {
        "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy",
        RSC: "1",
        Range: "bytes=0-20",
      },
    });
    assert.equal(response.status, 401, route);
    assert.match(response.headers.get("www-authenticate"), /Basic/);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS", "HEAD"]) {
    assert.equal(
      (await fetch(origin + "/api/uploads", { method })).status,
      401,
    );
  }
  assert.equal(
    (
      await fetch(origin, {
        headers: { authorization: "Basic d3Jvbmc6d3Jvbmc=" },
      })
    ).status,
    401,
  );
  const page = await fetch(origin + "/studio", { headers: { authorization } });
  assert.equal(page.status, 200);
  assert.match(page.headers.get("cache-control"), /no-store/);
  const html = await page.text();
  const asset = html.match(/src="([^\"]*\/_next\/static\/[^\"]+)"/)?.[1];
  assert.ok(asset, "Rendered page has a real Next asset");
  assert.equal((await fetch(origin + asset)).status, 401);
  assert.equal(
    (await fetch(origin + asset, { headers: { authorization } })).status,
    200,
  );
  const media = await fetch(origin + "/media/demo.mp4", {
    headers: { authorization, Range: "bytes=0-31" },
  });
  assert.equal(media.status, 206);
  assert.match(media.headers.get("cache-control"), /no-store/);
  assert.equal((await media.arrayBuffer()).byteLength, 32);
  const session = await fetch(origin + "/api/session", {
    method: "POST",
    headers: { authorization, origin },
  });
  assert.equal(session.status, 200);
  assert.match(session.headers.get("set-cookie"), /Secure/i);
  const cookie = session.headers.get("set-cookie").split(";")[0];
  const disabled = await fetch(origin + "/api/jobs", {
    method: "POST",
    headers: {
      authorization,
      origin,
      cookie,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(disabled.status, 503, "Generation remains disabled");
  assert.equal(
    (
      await fetch(origin + "/api/session", {
        method: "POST",
        headers: { authorization, origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  const heartbeat = Number(
    await readFile(path.join(directory, "worker-heartbeat"), "utf8"),
  );
  assert.ok(Date.now() - heartbeat < 5000, "Demo worker is running");
  console.log(
    "Staging production checks passed: auth, static/media/range, API, secure cookies, CSRF, generation lock and worker heartbeat.",
  );
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  server.kill("SIGTERM");
  await exited;
  await rm(directory, { recursive: true, force: true });
}
