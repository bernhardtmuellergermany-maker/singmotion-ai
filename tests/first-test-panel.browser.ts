// Isolated browser regression: every request is intercepted; no database/provider access.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
const bundle = await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {FirstTestPanel} from './components/cms/first-test-panel'; createRoot(document.getElementById('root')).render(<FirstTestPanel/>);`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
});
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 640 } });
  const plan = {
    id: "existing-plan",
    state: "prepared",
    seconds: 4.69,
    costReview: { inclusiveMaxMicroUsd: null },
    costDigest: null,
    prompt: "Natural singing",
    completed: false,
  };
  let reply: { status: number; body: string; contentType: string } = {
    status: 200,
    body: JSON.stringify({
      plan,
      blocker: "Live test disabled",
      startBlockers: [
        "BYTEPLUS_FIRST_TEST_PLAN_ID must match the displayed plan ID.",
        "Approve an exact output hostname before starting.",
      ],
    }),
    contentType: "application/json",
  };
  let posts = 0;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    if (url.pathname === "/api/admin/first-test" && !url.search) {
      if (route.request().method() === "POST") {
        posts++;
        return route.fulfill(reply);
      }
      return route.fulfill({ json: { plan: null, blocker: null } });
    }
    return route.abort();
  });
  await page.goto("http://panel.test/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const button = page.getByRole("button", {
    name: "Prepare offline — no paid request",
  });
  await page.locator('input[name="image"]').setInputFiles({
    name: "singer.png",
    mimeType: "image/png",
    buffer: Buffer.from("mock"),
  });
  await page.locator('input[name="audio"]').setInputFiles({
    name: "clip.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from("mock"),
  });
  await page.locator('input[name="rights"]').check();
  await page.locator('input[name="english"]').check();
  await button.click();
  await page
    .getByText("Prepared offline. Saved plan existing-plan.", { exact: false })
    .waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Plan existing-plan" }).count(),
    1,
  );
  await page
    .getByText("Requirements blocking a paid start", { exact: true })
    .waitFor();
  await page
    .getByText(
      "BYTEPLUS_FIRST_TEST_PLAN_ID must match the displayed plan ID.",
      { exact: true },
    )
    .waitFor();

  assert.equal(
    await page
      .getByRole("button", { name: "Start ONE paid generation" })
      .isDisabled(),
    true,
  );
  for (const bad of [
    {
      status: 200,
      body: "{}",
      contentType: "application/json",
      expected: "did not return a saved plan",
    },
    {
      status: 200,
      body: '{"plan":null}',
      contentType: "application/json",
      expected: "did not return a saved plan",
    },
    {
      status: 400,
      body: '{"error":""}',
      contentType: "application/json",
      expected: "HTTP 400",
    },
    {
      status: 400,
      body: JSON.stringify({
        error: "Actual encoded MP3 duration exceeds the limit.",
      }),
      contentType: "application/json",
      expected: "Actual encoded MP3 duration exceeds the limit.",
    },
    {
      status: 413,
      body: "<html>private upstream details</html>",
      contentType: "text/html",
      expected: "HTTP 413",
    },
  ]) {
    reply = bad;
    await page
      .getByText("1. Upload private test inputs", { exact: true })
      .click();
    await button.click();
    const alert = page.getByRole("alert");
    await alert.waitFor();
    assert.ok((await alert.innerText()).includes(bad.expected));
    assert.ok(!(await alert.innerText()).includes("private upstream details"));
    assert.equal(
      await alert.evaluate((element) => document.activeElement === element),
      true,
    );
    assert.equal(
      await page.getByRole("heading", { name: "Plan existing-plan" }).count(),
      1,
    );
    for (const field of ["image", "audio"])
      assert.equal(
        await page
          .locator(`input[name="${field}"]`)
          .evaluate((input: HTMLInputElement) => input.files?.length),
        1,
      );
    // The failed upload keeps the disclosure open; close it before the next case.
    await page
      .getByText("1. Upload private test inputs", { exact: true })
      .click();
  }
  assert.equal(posts, 6);
  console.log(
    "PASS: saved plan feedback, malformed success, server errors, non-JSON errors, retained files/plan and disabled paid start.",
  );
} finally {
  await browser.close();
}
