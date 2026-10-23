// Real local HTTP/browser regression. Requires a disposable migrated local PostgreSQL database.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
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
const origin = "http://127.0.0.1:3198",
  password = randomBytes(24).toString("hex"),
  stagingPassword = randomBytes(24).toString("hex");
Object.assign(process.env, {
  CMS_ENABLED: "true",
  CMS_DATABASE_URL: database,
  PAYLOAD_SECRET: randomBytes(32).toString("hex"),
  CMS_ORIGIN: origin,
  CMS_LOCAL_TEST: "true",
  DATA_DIR: directory,
  STAGING_AUTH_ENABLED: "true",
  STAGING_PASSWORD: stagingPassword,
  DEMO_MODE: "true",
  GENERATIONS_ENABLED: "false",
  ADMIN_DEMO_ENABLED: "false",
  BYTEPLUS_LIVE_TEST_ENABLED: "false",
  BYTEPLUS_FIRST_TEST_ENABLED: "false",
});
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
  });
  const page = await context.newPage();
  await page.goto(origin + "/admin");
  await page.locator('input[name="email"]').fill(admin.email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Login", exact: true }).click();
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
    "PASS: staging protection, registration denial, CSRF, real Payload browser login, publishing, draft preview, XSS escaping, secure session flags and legacy admin isolation.",
  );
} catch (error) {
  console.error(log.slice(-3000));
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await payload.destroy();
  await rm(directory, { recursive: true, force: true });
}
process.exit(0);
