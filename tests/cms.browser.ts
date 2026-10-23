// Real local HTTP/browser regression. Requires a disposable migrated local PostgreSQL database.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import {
  createServer as createHttpsServer,
  request as httpsRequest,
} from "node:https";
import { request as httpRequest } from "node:http";
import { chromium } from "@playwright/test";
const database = process.env.CMS_TEST_DATABASE_URL;
if (!database) throw new Error("CMS_TEST_DATABASE_URL required.");
const parsed = new URL(database);
if (
  !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
  !parsed.pathname.endsWith("_test")
)
  throw new Error("Disposable local test database required.");
const directory = await mkdtemp(path.join(tmpdir(), "sm-cms-browser-"));
const origin = "https://127.0.0.1:3199",
  backend = "http://127.0.0.1:3198",
  password = randomBytes(24).toString("hex"),
  stagingPassword = randomBytes(24).toString("hex");
Object.assign(process.env, {
  CMS_ENABLED: "true",
  CMS_DATABASE_URL: database,
  PAYLOAD_SECRET: randomBytes(32).toString("hex"),
  CMS_ORIGIN: origin,
  CMS_LOCAL_TEST: "false",
  DATA_DIR: directory,
  STAGING_AUTH_ENABLED: "true",
  STAGING_PASSWORD: stagingPassword,
  DEMO_MODE: "true",
  GENERATIONS_ENABLED: "false",
  ADMIN_DEMO_ENABLED: "false",
  BYTEPLUS_LIVE_TEST_ENABLED: "false",
  BYTEPLUS_FIRST_TEST_ENABLED: "false",
});
// Local TLS termination reproduces Railway HTTPS -> HTTP and retains secure cookies.
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-keyout",
    path.join(directory, "tls.key"),
    "-out",
    path.join(directory, "tls.crt"),
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ],
  { stdio: "ignore" },
);
const gateway = createHttpsServer(
  {
    key: await readFile(path.join(directory, "tls.key")),
    cert: await readFile(path.join(directory, "tls.crt")),
  },
  (req, res) => {
    const upstream = httpRequest(
      backend + req.url,
      {
        method: req.method,
        headers: {
          ...req.headers,
          "x-forwarded-proto": "https",
          "x-forwarded-host": "127.0.0.1:3199",
        },
      },
      (reply) => {
        res.writeHead(reply.statusCode!, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  },
);
await new Promise<void>((resolve) =>
  gateway.listen(3199, "127.0.0.1", resolve),
);
// Self-signed TLS bypass exists only in this loopback-only test helper.
async function fetch(url: string, init: RequestInit = {}): Promise<Response> {
  assert.equal(new URL(url).origin, origin);
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: init.method,
        headers: Object.fromEntries(new Headers(init.headers)),
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (b) => chunks.push(b));
        res.on("end", () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode,
              headers: res.headers as Record<string, string>,
            }),
          ),
        );
      },
    );
    request.on("error", reject);
    request.end(init.body);
  });
}
const { getPayload } = await import("payload");
const { default: config } = await import("../payload.config.ts");
const payload = await getPayload({ config });
const admin = await payload.create({
  collection: "staff",
  context: { provisioning: true },
  data: {
    email: `browser-${randomUUID()}@example.test`,
    password,
    role: "super-admin",
  },
});
await payload.delete({
  collection: "pages",
  where: { slug: { equals: "about" } },
});
const draft = await payload.create({
  collection: "pages",
  draft: true,
  data: {
    slug: "about",
    title: "Draft browser test",
    blocks: [
      {
        blockType: "section",
        heading: "Hello",
        body: "<script>window.cmsXss=true</script>",
      },
    ],
  },
});
// Existing published CMS blocks must retain their editable content in the redesign.
await payload.delete({
  collection: "pages",
  where: { slug: { equals: "home" } },
});
await payload.create({
  collection: "pages",
  data: {
    slug: "home",
    title: "CMS home",
    _status: "published",
    blocks: [
      {
        blockType: "hero",
        heading: "A published artist story",
        body: "Editable introduction",
        buttonLabel: "Start creating",
        url: "/studio",
      },
      {
        blockType: "cta",
        heading: "Learn",
        buttonLabel: "Meet our team",
        url: "/about",
      },
      {
        blockType: "cards",
        heading: "Published cards",
        items: [{ heading: "Your music", body: "Editable card copy" }],
      },
    ],
  },
});
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "-p",
    "3198",
  ],
  {
    env: { ...process.env, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
server.stdout.on("data", (b) => (log += b));
server.stderr.on("data", (b) => (log += b));
const basic = `Basic ${Buffer.from(`staging:${stagingPassword}`).toString("base64")}`;
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin)).status === 401) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  for (const route of [
    "/admin",
    "/api/cms/staff",
    "/cms-preview/about",
    "/api/cms/cms-assets/file/test.webp",
  ])
    assert.equal((await fetch(origin + route)).status, 401);
  assert.equal(
    (
      await fetch(origin + "/api/cms/staff/first-register", {
        method: "POST",
        headers: { authorization: basic, origin },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(origin + "/api/cms/staff", {
        headers: { authorization: basic },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(origin + "/api/cms/staff/login", {
        method: "POST",
        headers: {
          authorization: basic,
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({ email: admin.email, password }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(origin + "/cms-preview/about", {
        headers: { authorization: basic },
      })
    ).status,
    404,
  );
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
  });
  const context = await browser.newContext({
    httpCredentials: { username: "staging", password: stagingPassword },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await page.goto(origin + "/admin/login");
  // RootLayout does not import Payload's CSS for the application.
  const styles = await page
    .locator('link[rel="stylesheet"]')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLLinkElement).href));
  assert.ok(styles.length > 0, "Payload admin stylesheet must be imported");
  for (const stylesheet of styles) {
    assert.equal(
      (await fetch(stylesheet)).status,
      401,
      "Styles remain protected by Basic Auth",
    );
    const response = await context.request.get(stylesheet);
    assert.equal(response.status(), 200);
    assert.match(response.headers()["content-type"], /text\/css/);
  }
  assert.ok(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--base")
        .trim(),
    ),
    "Payload CSS variables must be applied",
  );
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/cms-login-https.png",
    fullPage: true,
  });
  const unauthenticatedLogin = await fetch(origin + "/api/cms/staff/login", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: admin.email, password }),
  });
  assert.equal(unauthenticatedLogin.status, 401);
  assert.match(
    unauthenticatedLogin.headers.get("www-authenticate") || "",
    /^Basic /,
  );
  assert.equal(unauthenticatedLogin.headers.get("x-singmotion-cms-code"), null);
  const rejected = await context.request.post(origin + "/api/cms/staff/login", {
    headers: { origin: "https://evil.example" },
    data: { email: admin.email, password },
  });
  assert.equal(rejected.status(), 403);
  assert.equal(
    rejected.headers()["x-singmotion-cms-code"],
    "CMS_ORIGIN_REJECTED",
  );
  const missing = await fetch(origin + "/api/cms/staff/login", {
    method: "POST",
    headers: { authorization: basic, "content-type": "application/json" },
    body: JSON.stringify({ email: admin.email, password }),
  });
  assert.equal(missing.status, 403);
  assert.equal(
    missing.headers.get("x-singmotion-cms-code"),
    "CMS_ORIGIN_MISSING",
  );
  const wrong = await context.request.post(origin + "/api/cms/staff/login", {
    headers: { origin },
    data: { email: admin.email, password: "deliberately-invalid-password" },
  });
  assert.equal(wrong.status(), 401);
  assert.equal(wrong.headers()["x-singmotion-cms-code"], "CMS_AUTH_REJECTED");
  await page.locator('input[name="email"]').fill(admin.email);
  await page.locator('input[name="password"]').fill(password);
  const loginResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/api/cms/staff/login") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Login", exact: true }).click();
  assert.equal((await loginResponse).status(), 200);
  await page.getByRole("heading", { name: "SingMotion operations" }).waitFor();
  await page.goto(origin + `/admin/collections/pages/${draft.id}`);
  await page.locator('input[name="title"]').fill("Published browser test");
  await page.getByRole("button", { name: /publish changes/i }).click();
  await page
    .getByText(/successfully/i)
    .first()
    .waitFor();
  const publicPage = await context.request.get(origin + "/about");
  assert.equal(publicPage.status(), 200);
  const html = await publicPage.text();
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>window.cmsXss"));
  await page.goto(origin + "/cms-preview/about");
  await page.getByText("Private draft preview — not published.").waitFor();
  // Authenticated CMS staff does not become the owner of private customer files.
  assert.equal(
    (await context.request.get(origin + "/api/admin")).status(),
    401,
  );
  assert.equal(
    (await context.request.get(origin + "/not-a-supported-page")).status(),
    404,
  );
  const cookies = await context.cookies();
  const cookie = cookies.find((c) => c.name === "payload-token");
  assert.ok(cookie?.httpOnly);
  assert.ok(cookie?.secure);
  assert.equal(cookie?.sameSite, "Strict");
  await page.goto(origin + "/");
  await page
    .getByRole("heading", { name: "A published artist story", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "Start creating", exact: true })
      .getAttribute("href"),
    "/studio",
  );
  assert.equal(
    await page
      .getByRole("link", { name: "Meet our team", exact: true })
      .getAttribute("href"),
    "/about",
  );
  await page.getByText("Editable card copy", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "Make your artist sing.", exact: true })
      .count(),
    0,
  );
  await page.goto(origin + "/admin/logout");
  await page.locator('input[name="email"]').waitFor();
  assert.equal(
    (await context.request.get(origin + "/api/cms/staff")).status(),
    403,
  );
  console.log(
    "PASS: HTTPS proxy, protected/applied Payload CSS, exact Origin rejection diagnostics, wrong-password rejection, secure-cookie login, staging protection, registration denial, CSRF, real Payload browser login, publishing, draft preview, XSS escaping, secure session flags and legacy admin isolation.",
  );
} catch (error) {
  console.error(log.slice(-3000));
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
  await payload.destroy();
  await rm(directory, { recursive: true, force: true });
}
process.exit(0);
