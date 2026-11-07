import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
const b = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {StudioActivation} from './components/cms/studio-activation';createRoot(document.getElementById('root')).render(<StudioActivation/>);`,
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
  const page = await browser.newPage();
  let writes = 0,
    body: Record<string, unknown> | undefined;
  await page.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === "/")
      return r.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div><script src="/bundle.js"></script>',
      });
    if (u.pathname === "/bundle.js")
      return r.fulfill({
        contentType: "application/javascript",
        body: b.outputFiles[0].text,
      });
    if (u.pathname === "/api/admin/studio-activation") {
      if (r.request().method() === "POST") {
        writes++;
        body = r.request().postDataJSON();
        return r.fulfill({ json: { saved: true, expiresAt: "2099-01-01" } });
      }
      return r.fulfill({
        json: {
          staffId: "17",
          allowlisted: false,
          recoveryEnabled: true,
          health: { healthy: true, status: "ready" },
          evidence: {
            reservedMicroUsd: 840000,
            digest: "mock-digest",
            hostname: "cdn.example.test",
            inputSeconds: 4.872,
            outputSeconds: 5,
            sha256: "a".repeat(64),
            output: {
              width: 1280,
              height: 720,
              fps: 25,
              videoCodec: "h264",
              audioCodec: "aac",
            },
          },
          blocker: null,
        },
      });
    }
    return r.abort();
  });
  await page.goto("http://activation.test/");
  await page
    .getByText("Studio pilot activation — offline only", { exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Inspect successful task / my staff ID / recovery health",
      exact: true,
    })
    .click();
  const save = page.getByRole("button", {
    name: "Save private Studio policy — no paid request",
    exact: true,
  });
  await save.waitFor();
  assert.equal(await save.isDisabled(), true);
  assert.equal(writes, 0);
  assert.match(
    await page.locator("body").innerText(),
    /NOT verified BytePlus tax/,
  );
  await page
    .getByLabel("Separate reviewed inclusive ceiling (USD)", { exact: true })
    .fill("1.00");
  await page
    .getByLabel(
      "Basis for the inclusive ceiling and short-clip acceptance range; do not invent tax/fee evidence",
      { exact: true },
    )
    .fill(
      "Mock independently reviewed inclusive admission bound for this range.",
    );
  assert.equal(await save.isDisabled(), true);
  await page.getByRole("checkbox").check();
  await save.click();
  await page.getByRole("status").waitFor();
  assert.equal(writes, 1);
  assert.equal(body!.ceilingMicroUsd, 1000000);
  assert.equal(body!.digest, "mock-digest");
  assert.equal(
    body!.confirmation,
    "APPROVE_SHORT_STUDIO_POLICY_WITH_PROVISIONAL_UPLIFT",
  );
  assert.ok(!("staffId" in body!));
  let durationBody: Record<string, unknown> | undefined;
  await page.route("**/api/admin/studio-activation*", (route) => {
    if (route.request().method() === "POST") {
      durationBody = route.request().postDataJSON();
      return route.fulfill({ json: { saved: true } });
    }
    return route.fulfill({
      json: {
        digest: "duration-digest",
        bands: [],
        shortRange: { minInputSeconds: 4, maxInputSeconds: 5 },
        shortExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        limits: {
          enabled: true,
          maxDurationSeconds: 5,
          maxJobMicroUsd: 1000000,
          maxTotalMicroUsd: 2000000,
        },
      },
    });
  });
  await page
    .getByRole("button", { name: "Load duration bands", exact: true })
    .click();
  const section = page.getByRole("region", { name: "Video duration & budget" });
  await section
    .getByText("Server duration cap is below this band.", { exact: false })
    .waitFor();
  const bandSave = section.getByRole("button", {
    name: "Save reviewed duration band — no paid request",
    exact: true,
  });
  assert.equal(await bandSave.isDisabled(), true);
  assert.equal(
    await section
      .getByLabel("Reviewed maximum generated video (seconds)", { exact: true })
      .inputValue(),
    "",
  );
  await section
    .getByLabel("Reviewed maximum generated video (seconds)", { exact: true })
    .fill("16");
  await section
    .getByLabel("Separate inclusive spending ceiling (USD)", { exact: true })
    .fill("2");
  await section
    .getByLabel("Reviewed duration evidence covering the entire band", {
      exact: true,
    })
    .fill("Mock reviewed range evidence only.");
  await section.getByRole("checkbox").check();
  await bandSave.click();
  await section.getByRole("status").waitFor();
  assert.equal(durationBody!.action, "save-duration-band");
  assert.equal(durationBody!.digest, "duration-digest");
  assert.equal(
    (durationBody!.review as Record<string, unknown>).maxGeneratedSeconds,
    16,
  );
  assert.equal(
    (durationBody!.review as Record<string, unknown>).billingEvidence,
    "",
  );
  assert.ok(!("reviewedBy" in durationBody!));
  await section
    .getByLabel("Review basis", { exact: true })
    .selectOption("experimental");
  await section
    .getByLabel(
      "Finite per-video planning reservation (USD; not a guaranteed inclusive charge)",
      { exact: true },
    )
    .fill("3");
  assert.equal(await bandSave.isDisabled(), true);
  await section
    .getByLabel(
      "Generated duration is unknown; the entered cap is only a validation/planning assumption.",
      { exact: true },
    )
    .check();
  await section
    .getByLabel(
      "Fees and taxes are unknown; the finite reservation is not a guaranteed inclusive provider charge.",
      { exact: true },
    )
    .check();
  assert.equal(await bandSave.isDisabled(), true);
  await section
    .getByLabel(
      "Media properties are unknown; mismatched codecs, FPS, dimensions or oversized output will fail validation.",
      { exact: true },
    )
    .check();
  await section
    .getByLabel(
      "I approve these labeled planning assumptions, finite reservation and strict output acceptance limits for private exploratory testing only.",
      { exact: true },
    )
    .check();
  await bandSave.click();
  await page.waitForFunction(
    () =>
      !!document.querySelector(
        '[aria-label="Video duration & budget"] [role="status"]',
      ),
  );
  assert.equal(
    durationBody!.confirmation,
    "APPROVE_EXPERIMENTAL_PLANNING_BAND",
  );
  const experimental = (durationBody!.review as Record<string, unknown>)
    .experimental as Record<string, unknown>;
  assert.equal(experimental.unknownDurationAccepted, true);
  assert.equal(experimental.unknownFeesAccepted, true);
  assert.equal(experimental.unknownMediaAccepted, true);
  console.log(
    "PASS: explicit offline inspection and separate bound confirmation; no automatic submission or identity override.",
  );
} finally {
  await browser.close();
}
