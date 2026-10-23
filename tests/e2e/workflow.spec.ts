import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
const dir = mkdtempSync(path.join(tmpdir(), "singmotion-browser-"));
const song = path.join(dir, "my-song.wav"),
  image = path.join(dir, "reference.png");
test.beforeAll(async () => {
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
  await sharp({
    create: { width: 500, height: 650, channels: 3, background: "#b8b1a4" },
  })
    .png()
    .toFile(image);
});
test("complete private demo workflow, persistent artist and project, preview and download", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/studio");
  await expect(page.getByText("€12.50")).toBeVisible();
  await page.screenshot({
    path: `/tmp/singmotion-${info.project.name}-studio.png`,
    fullPage: true,
  });
  await page.getByLabel("Upload song").setInputFiles(song);
  await expect(page.getByText("my-song.wav")).toBeVisible();
  await page.getByLabel("Start seconds").fill("2");
  await page.getByLabel("End seconds").fill("9");
  await expect(page.getByText("7.00s", { exact: true })).toBeVisible();
  // Exercise keyboard selection handles as well as precise numeric inputs.
  await page.getByRole("slider", { name: "Start of selection" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("Start seconds")).toHaveValue("2.1");
  await page.getByLabel("Start seconds").fill("2");
  await page.getByRole("button", { name: "Preview selection" }).click();
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime),
    )
    .toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Preview selection" }).click();
  await page.getByRole("button", { name: "Who’s taking the stage?" }).click();
  await page.getByRole("button", { name: "Add artist", exact: true }).click();
  await page.getByLabel("Artist name").fill("Test Artist");
  await page.locator("dialog input[type=file]").setInputFiles(image);
  await page.getByRole("button", { name: "Save artist", exact: true }).click();
  await expect(
    page.getByText("Test Artist", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Advanced settings" }).click();
  await page
    .getByLabel("Custom Performance Prompt")
    .fill("Sing softly. Keep the camera static and the background stable.");
  await page.getByText("View composed prompt").click();
  await expect(page.locator(".prompt-preview p")).toHaveText(
    "Sing softly. Keep the camera static and the background stable.",
  );
  await page.getByRole("checkbox").check();
  await expect(page.getByText("€2.10", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Generate demo video" }).click();
  await expect(page).toHaveURL(/\/projects\//);
  await expect(
    page.getByRole("heading", { name: "Your demo is ready." }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByText("Demo sample, not an AI generation.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("video")).toHaveJSProperty("videoWidth", 1280);
  await page.locator("video").evaluate((v: HTMLVideoElement) => v.play());
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(0);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download demo" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("singmotion-demo.mp4");
  const downloaded = await download.path();
  expect(readFileSync(downloaded!).length).toBeGreaterThan(1000);
  await page.getByRole("button", { name: "Save to projects" }).click();
  await expect(
    page.getByRole("button", { name: "Saved to projects" }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Saved to projects" }),
  ).toBeVisible();
  await page.goto("/artists");
  await expect(
    page.getByRole("heading", { name: "Test Artist" }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.evaluate(() => window.innerWidth),
  );
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Artist name").fill("Renamed Artist");
  await page.locator(".artist-form input[type=file]").setInputFiles(image);
  await expect(page.locator(".reference-tile")).toHaveCount(2);
  await page.getByLabel("Reference view 2").selectOption("Side");
  await page.getByRole("button", { name: "Save artist", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Renamed Artist" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("2 reference images")).toBeVisible();
  await page.goto("/settings");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete all my demo data" }).click();
  await expect(page).toHaveURL("/");
  await page.getByRole("link", { name: "Create your music video" }).click();
  await expect(page.getByText("€12.50")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Drop your song here" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("API rejects unauthenticated, cross-user, spoofed files, CSRF, missing consent and production admin", async ({
  playwright,
}) => {
  const baseURL = "http://127.0.0.1:3100",
    headers = { Origin: baseURL };
  const a = await playwright.request.newContext({ baseURL }),
    b = await playwright.request.newContext({ baseURL });
  expect((await a.get("/api/jobs")).status()).toBe(401);
  expect((await a.post("/api/session")).status()).toBe(403);
  expect((await a.post("/api/session", { headers })).status()).toBe(200);
  await b.post("/api/session", { headers });
  const invalid = await a.post("/api/assets", {
    headers,
    multipart: {
      kind: "audio",
      file: {
        name: "fake.mp3",
        mimeType: "audio/mpeg",
        buffer: Buffer.from("not an mp3"),
      },
    },
  });
  expect(invalid.status()).toBe(400);
  const response = await a.post("/api/assets", {
    headers,
    multipart: {
      kind: "audio",
      file: {
        name: "song.wav",
        mimeType: "audio/wav",
        buffer: readFileSync(song),
      },
    },
  });
  expect(response.status()).toBe(201);
  const asset = await response.json();
  expect(asset.path).toBeUndefined();
  expect((await b.get(`/api/assets/${asset.id}`)).status()).toBe(404);
  expect(
    (
      await a.post("/api/jobs", {
        headers,
        data: { songId: asset.id, consent: false },
      })
    ).status(),
  ).toBe(400);
  expect((await a.get("/api/admin")).status()).toBe(403);
  expect(
    (
      await a.post("/api/admin/login", {
        headers,
        data: { key: "not-a-secret" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await a.post("/api/artists", {
        headers: { Origin: "https://evil.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  await a.dispose();
  await b.dispose();
});
