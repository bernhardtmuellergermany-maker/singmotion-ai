// Local app, synthetic uploads, all generation requests intercepted. No provider/payment calls.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
const origin = process.env.PRODUCT_TEST_ORIGIN || "http://127.0.0.1:3000";
const root = await mkdtemp(path.join(tmpdir(), "product-browser-"));
const screenshots =
  process.env.PRODUCT_SCREENSHOTS || "/tmp/sm-product-screenshots";
await mkdir(screenshots, { recursive: true });
const song = path.join(root, "test.wav"),
  photo = path.join(root, "singer.jpg"),
  landscape = path.join(root, "landscape.jpg");
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=6",
  song,
]);
await sharp({
  create: { width: 720, height: 1280, channels: 3, background: "#9854af" },
})
  .jpeg()
  .toFile(photo);
await sharp({
  create: { width: 1280, height: 720, channels: 3, background: "#7854af" },
})
  .jpeg()
  .toFile(landscape);
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const results: unknown[] = [];
try {
  for (const width of [1440, 1024, 768, 390, 360]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      hasTouch: width <= 600,
    });
    const page = await context.newPage(),
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    await page
      .getByRole("heading", { name: "Add your song", exact: true })
      .waitFor();
    assert.equal(await page.locator(".wizard-steps button").count(), 4);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: path.join(screenshots, `home-${width}.png`),
      fullPage: true,
    });
    await page.getByLabel("Choose audio file").waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLInputElement>(
          'input[aria-label="Choose audio file"]',
        )?.disabled === false,
    );
    await page.getByLabel("Choose audio file").setInputFiles(song);
    await page.getByText("test.wav", { exact: true }).waitFor();
    await page.getByLabel("Start seconds").fill("1.25");
    await page.getByLabel("End seconds").fill("5.25");
    const handle = page.getByRole("slider", { name: "Start of selection" });
    await handle.scrollIntoViewIfNeeded();
    const h = (await handle.boundingBox())!,
      strip = (await page.locator(".wave-strip").boundingBox())!;
    const x = h.x + h.width / 2,
      y = h.y + h.height / 2,
      target = strip.x + strip.width / 3;
    if (width <= 600) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: target, y }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await cdp.detach();
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(target, y, { steps: 8 });
      await page.mouse.up();
    }
    assert.ok(
      Math.abs(
        Number(await page.getByLabel("Start seconds").inputValue()) - 2,
      ) < 0.2,
    );
    await page.getByLabel("Start seconds").fill("1.25");
    const interval = page.getByRole("slider", {
      name: "Move selected audio segment",
    });
    await interval.focus();
    await page.keyboard.press("ArrowLeft");
    assert.ok(
      Math.abs(
        Number(await page.getByLabel("Start seconds").inputValue()) - 1.24,
      ) < 0.001,
    );
    assert.ok(
      Math.abs(
        Number(await page.getByLabel("End seconds").inputValue()) - 5.24,
      ) < 0.001,
    );
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    assert.ok(
      (await page.locator(".wave-strip").boundingBox())!.width >
        (await page.locator(".wave-viewport").boundingBox())!.width,
    );
    await page.getByRole("button", { name: "Later", exact: true }).click();
    assert.ok(
      await page.locator(".wave-viewport").evaluate((el) => el.scrollLeft > 0),
    );
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    await page.getByLabel("Start seconds").fill("1.25");
    await page.getByLabel("End seconds").fill("5.25");
    await page
      .getByRole("button", { name: "Preview selection", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Preview selection", exact: true })
      .click();
    await page.screenshot({
      path: path.join(screenshots, `audio-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Choose photo file").setInputFiles(photo);
    await page
      .getByRole("button", { name: "Remove photo", exact: true })
      .waitFor();
    await page.getByLabel("Choose photo file").setInputFiles(landscape);
    await page.getByText(/Output: 16:9/).waitFor();
    await page.getByRole("button", { name: /16:9 Horizontal/ }).click();
    await page.getByLabel("Choose photo file").setInputFiles(photo);
    await page.waitForFunction(
      () =>
        !document.querySelector<HTMLInputElement>(
          'input[aria-label="Choose photo file"]',
        )?.disabled,
    );
    assert.ok(await page.getByText(/Output: 16:9/).count());
    await page.getByRole("button", { name: /Auto From photo/ }).click();
    await page.getByText(/Output: 9:16/).waitFor();
    await page.getByRole("button", { name: /16:9 Horizontal/ }).click();
    await page.screenshot({
      path: path.join(screenshots, `format-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page
      .getByRole("button", { name: "On a dark stage", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Emotional close-up", exact: true })
      .click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    assert.equal(
      await page
        .getByRole("button", { name: /16:9 Horizontal/ })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    assert.match(
      await page.getByLabel("Your direction").inputValue(),
      /dark cinematic stage.*heartfelt emotion/,
    );
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByText("Draft saved", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: path.join(screenshots, `review-${width}.png`),
      fullPage: true,
    });
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    results.push({
      width,
      violations: accessibility.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
    });
    assert.deepEqual(
      accessibility.violations.map((v) => v.id),
      [],
    );
    let submits = 0,
      prepares = 0;
    await page.route("**/api/studio-live**", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({
          json: { pilot: true, available: true, blockers: [] },
        });
      const body = route.request().postDataJSON();
      if (body.action === "prepare") {
        prepares++;
        assert.equal(body.selection.outputFormat, "16:9");
        assert.equal(body.consent, true);
        return route.fulfill({
          json: {
            id: "mock-plan",
            state: "prepared",
            digest: "mock-policy",
            selection: body.selection,
            ceilingMicroUsd: 1600000,
            estimatedBaseMicroUsd: 420000,
            durationSeconds: 6.7,
            experimental: false,
            budget: {
              remainingMicroUsd: 10000000,
              remainingMicroEur: 20000000,
            },
          },
        });
      }
      assert.equal(body.action, "submit");
      submits++;
      assert.equal(
        body.confirmation,
        "CONFIRM PAID STUDIO mock-plan mock-policy 1600000",
      );
      return route.fulfill({
        status: 409,
        json: {
          error: "OFFLINE TEST: submission intercepted. No provider contacted.",
        },
      });
    });
    await page
      .getByRole("button", { name: "Generate performance", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.getByRole("dialog").count(), 1);
    assert.equal(await page.getByRole("checkbox").isChecked(), false);
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "Confirm & generate", exact: true })
      .waitFor();
    assert.equal(submits, 0);
    assert.equal(prepares, 1);
    await page.screenshot({
      path: path.join(screenshots, `confirmation-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Confirm & generate", exact: true })
      .click();
    await page.getByRole("dialog").getByRole("alert").waitFor();
    assert.equal(submits, 1);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    const draftId = await page.evaluate(() =>
      localStorage.getItem("singmotion-draft-id"),
    );
    await page.goto(`${origin}/studio?draft=${draftId}`);
    await page
      .getByRole("heading", { name: "Generate your performance", exact: true })
      .waitFor();
    assert.ok(await page.getByText("16:9 · fitted export").count());
    assert.deepEqual(errors, []);
    await context.close();
  }
  await writeFile(
    path.join(screenshots, "accessibility.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results));
  console.log(
    "PASS: four-step desktop/mobile, local uploads, saved drafts, format/prompt persistence, rights, explicit single mocked generation, layout checks.",
  );
} finally {
  await browser.close();
  await rm(root, { recursive: true, force: true });
}
