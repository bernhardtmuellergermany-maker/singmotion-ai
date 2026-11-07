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
      reconciliationRequired: true,
      budget: {
        currency: "USD",
        capMicroUsd: 1000000,
        reservedMicroUsd: 500000,
        unreservedMicroUsd: 500000,
        actualPreviousChargeMicroUsd: null,
        eurBudgetVerified: false,
      },
      startBlockers: [
        "BYTEPLUS_FIRST_TEST_PLAN_ID must match the displayed plan ID.",
        "Approve an exact output hostname before starting.",
      ],
    }),
    contentType: "application/json",
  };
  let statusReply: object = { plan: null, blocker: null };
  let posts = 0;
  let costBody: Record<string, unknown> | null = null;
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
        if (
          route
            .request()
            .headers()
            ["content-type"]?.includes("application/json")
        )
          costBody = route.request().postDataJSON();
        return route.fulfill(reply);
      }
      return route.fulfill({ json: statusReply });
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
    .getByRole("region", { name: "Test spending reservations" })
    .waitFor();
  assert.ok(
    (
      await page
        .getByRole("region", { name: "Test spending reservations" })
        .innerText()
    ).includes("including after HTTP 500 / 50510"),
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
  await page
    .getByRole("checkbox", {
      name: "Use one evidence-backed inclusive USD maximum",
      exact: false,
    })
    .check();
  await page.getByLabel("Inclusive maximum USD", { exact: true }).fill("0.42");
  await page
    .getByRole("button", {
      name: "Approve evidence-backed cost review — offline",
    })
    .click();
  await page.getByRole("button", { name: "Refresh saved status" }).waitFor();
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === "Refresh saved status",
      )?.disabled,
  );
  const review = (costBody as unknown as { review: Record<string, unknown> })
    .review;
  assert.equal(review.inclusiveMaxMicroUsd, 420000);
  assert.equal(review.taxMaxMicroUsd, null);
  assert.equal(review.feesMaxMicroUsd, null);
  assert.equal(review.acknowledgment, "INCLUSIVE_TOTAL_BOUND_FOR_EXACT_INPUT");
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
  assert.equal(posts, 7);
  statusReply = {
    plan: { ...plan, testNumber: 2, costDigest: "mock-cost" },
    blocker: null,
    startBlockers: ["Save second budget evidence"],
    secondTestAvailable: true,
  };
  reply = {
    status: 200,
    body: JSON.stringify(statusReply),
    contentType: "application/json",
  };
  await page
    .getByRole("button", { name: "Refresh saved status", exact: true })
    .click();
  await page
    .getByText("EUR 50 total-budget authorization for test #2", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("eurPerUsdUpperPpm", { exact: true }).inputValue(),
    "",
  );
  assert.equal(
    await page.getByLabel("fxFeesMaxMicroEur", { exact: true }).inputValue(),
    "",
  );
  await page
    .getByRole("button", {
      name: "Accept planning assumptions and reserve within EUR 50 — no paid request",
      exact: true,
    })
    .click();
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === "Refresh saved status",
      )?.disabled,
  );
  assert.equal(costBody!.action, "second-planning-review");
  assert.equal(
    (costBody as unknown as { acknowledgment: string }).acknowledgment,
    "ACCEPT_FX_PLANNING_ASSUMPTIONS_NOT_A_FEE_GUARANTEE",
  );
  await page
    .getByText("Advanced: documented settlement-rate and fee bounds", {
      exact: true,
    })
    .click();
  await page.getByLabel("eurPerUsdUpperPpm", { exact: true }).fill("1000000");
  await page.getByLabel("fxFeesMaxMicroEur", { exact: true }).fill("10000");
  await page
    .getByLabel("validUntil", { exact: true })
    .fill(new Date(Date.now() + 86400000).toISOString());
  const currencySection = page.locator("details").filter({
    has: page.getByText("EUR 50 total-budget authorization for test #2", {
      exact: true,
    }),
  });
  await currencySection
    .getByLabel("evidence", { exact: true })
    .fill("Mock-only currency/fee upper-bound evidence.");
  await page
    .getByRole("button", {
      name: "Approve second-test total budget — no paid request",
      exact: true,
    })
    .click();
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent === "Refresh saved status",
      )?.disabled,
  );
  assert.equal(costBody!.action, "second-review");
  const secondReview = (
    costBody as unknown as { review: Record<string, unknown> }
  ).review;
  assert.equal(secondReview.eurPerUsdUpperPpm, 1000000);
  assert.equal(secondReview.fxFeesMaxMicroEur, 10000);
  assert.equal(
    secondReview.acknowledgment,
    "AUTHORIZE_SECOND_WITH_FULL_FIRST_RESERVATION",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Start ONE paid generation", exact: true })
      .isDisabled(),
    true,
  );

  console.log(
    "PASS: saved plan feedback, malformed success, server errors, non-JSON errors, retained files/plan and disabled paid start.",
  );
} finally {
  await browser.close();
}
