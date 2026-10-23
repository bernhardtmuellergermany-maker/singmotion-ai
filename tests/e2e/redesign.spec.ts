import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
const directory = mkdtempSync(path.join(tmpdir(), "sm-design-browser-"));
const song = path.join(directory, "studio-study.wav");
const portrait = path.join(directory, "reference-study.png");
const screenshots = process.env.DESIGN_SCREENSHOTS_DIR || "test-results/design";
async function accessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}
test.beforeAll(async () => {
  mkdirSync(screenshots, { recursive: true });
  execFileSync("ffmpeg", [
    "-nostdin",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=330:duration=12",
    "-y",
    song,
  ]);
  await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="650"><rect width="500" height="650" fill="#d1cde2"/><ellipse cx="250" cy="650" rx="210" ry="230" fill="#575477"/><ellipse cx="250" cy="270" rx="100" ry="135" fill="#e8dace"/><path d="M145 320Q90 90 250 100Q420 100 350 330L325 230Q240 200 205 155Q190 240 145 320" fill="#36364f"/><path d="M210 290h15m50 0h15m-55 55q15 10 30 0" stroke="#575477" stroke-width="6" fill="none"/><text x="250" y="600" font-size="20" text-anchor="middle" fill="white">ILLUSTRATED TEST REFERENCE</text></svg>',
    ),
  )
    .png()
    .toFile(portrait);
});
test("homepage clearly labels availability, stays responsive and passes accessibility checks", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Make your artist sing.",
  );
  await expect(
    page.getByRole("link", { name: "Create your music video", exact: true }),
  ).toHaveAttribute("href", "/studio");
  await expect(
    page.getByText("Live AI rendering is not enabled", { exact: false }),
  ).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.locator(".site-header a")).toHaveCount(2);
  await expect(
    page
      .getByRole("navigation", { name: "Website navigation" })
      .getByRole("link", { name: "Open studio" }),
  ).toBeVisible();
  await expect(page.locator(".concert-artwork img")).toBeVisible();
  await expect(
    page.getByText("Concept artwork · Not a generated SingMotion result", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Future feature · not available.", { exact: false }),
  ).toHaveCount(2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(screenshots, `after-home-${info.project.name}.png`),
    fullPage: true,
  });
  await accessible(page);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  }
});
test("studio has a compact three-step flow with precise mouse/touch trimming and optional settings", async ({
  page,
}, info) => {
  await page.goto("/studio");
  await expect(page.getByText("€12.50")).toBeVisible();
  await expect(
    page.locator(
      ".preview-empty, .preview-frame, .mobile-steps, .studio-heading",
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Performance & camera" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Choose your artist", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(screenshots, `after-studio-${info.project.name}.png`),
    fullPage: true,
  });
  await page.getByLabel("Upload song").setInputFiles(song);
  await page.getByLabel("Start seconds").fill("1.25");
  await page.getByLabel("End seconds").fill("8.75");
  await expect(page.getByText("7.50s", { exact: true })).toBeVisible();
  const handle = page.getByRole("slider", { name: "Start of selection" });
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  const strip = (await page.locator(".wave-strip").boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2,
    target = strip.x + strip.width * (2 / 12);
  if (info.project.name === "mobile") {
    const cdp = await page.context().newCDPSession(page);
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
  expect(
    Number(await page.getByLabel("Start seconds").inputValue()),
  ).toBeCloseTo(2, 1);
  await page.getByLabel("Start seconds").fill("1.25");
  await page.getByRole("button", { name: "Who’s taking the stage?" }).click();
  await page.getByRole("button", { name: "Add artist", exact: true }).click();
  await page.getByLabel("Artist name").fill("Reference study");
  await page.locator("dialog input[type=file]").setInputFiles(portrait);
  await page.getByRole("button", { name: "Save artist", exact: true }).click();
  await expect(page.locator(".artist-selection img")).toBeVisible();
  expect(
    (await page.locator(".artist-selection img").boundingBox())!.height,
  ).toBeLessThanOrEqual(112);
  if (info.project.name === "mobile") {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(screenshots, "after-studio-artist-mobile.png"),
      fullPage: true,
    });
  }
  await expect(page.getByLabel("Custom Performance Prompt")).toBeHidden();
  await expect(page.getByLabel("Camera direction")).toBeHidden();
  await expect(
    page.getByRole("radio", { name: "Natural", exact: true }),
  ).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(screenshots, `after-studio-ready-${info.project.name}.png`),
    fullPage: true,
  });
  if (info.project.name === "mobile") {
    await page.screenshot({
      path: path.join(screenshots, "studio-mobile-editor.png"),
    });
    await page.locator(".generation-summary").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(screenshots, "studio-mobile-summary.png"),
    });
  }
  await accessible(page);
  await page.getByRole("button", { name: "Advanced settings" }).click();
  await page.getByRole("radio", { name: "Custom", exact: true }).check();
  await expect(
    page.getByRole("button", { name: "Advanced settings" }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.getByLabel("Camera direction").selectOption("Static Close-Up");
  await page
    .getByLabel("Custom Performance Prompt")
    .fill("Sing gently with a still camera.");
  await page.getByText("View composed prompt").click();
  await expect(page.locator(".prompt-preview p")).toHaveText(
    "Sing gently with a still camera.",
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  }
  await page.getByRole("button", { name: "Remove song from draft" }).click();
  await expect(
    page.getByRole("button", { name: "Drop your song here", exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate demo video" }),
  ).toBeDisabled();
  await expect(page.locator(".artist-selection img")).toBeVisible();
  await page.getByLabel("Upload song").setInputFiles(song);
  await expect(page.getByLabel("Start seconds")).toHaveValue("0");
});
