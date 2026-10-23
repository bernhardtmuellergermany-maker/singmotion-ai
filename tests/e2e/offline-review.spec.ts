import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { parseStudioDraft } from "../../lib/studio-draft";

test("restored Studio draft exports locally without posting a job or leaking asset paths", async ({
  page,
}, info) => {
  const owner = "offline-owner";
  const draft = {
    song: {
      id: "offline-song",
      name: "Offline song.mp3",
      kind: "audio",
      duration: 12,
      bytes: 1000,
      mime: "audio/mpeg",
    },
    imageId: "offline-image",
    artistName: "Offline artist",
    start: 2,
    end: 7,
    performance: "Natural",
    camera: "Static Close-Up",
    customPrompt: "Sing softly with a static camera.",
  };
  const unexpected: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3101") {
      unexpected.push(url.hostname);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    if (url.pathname === "/api/session") {
      await route.fulfill({ json: { owner, balance: 1250, demo: true } });
      return;
    }
    if (url.pathname === "/api/quote") {
      await route.fulfill({ json: { cents: 150 } });
      return;
    }
    // Waveform/image preview are not under test; missing fixture data is local.
    if (url.pathname.startsWith("/api/assets/")) {
      await route.fulfill({ status: 404, body: "Offline preview fixture" });
      return;
    }
    unexpected.push(url.pathname);
    await route.abort();
  });
  await page.addInitScript(
    (value) => localStorage.setItem("singmotion-studio", JSON.stringify(value)),
    draft,
  );
  await page.goto("/studio");
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
  }
  const button = page.getByRole("button", {
    name: "Export draft for offline review",
  });
  await expect(button).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await button.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("singmotion-draft.json");
  const value = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(parseStudioDraft(value)).toEqual({
    version: 1,
    owner,
    songId: "offline-song",
    imageId: draft.imageId,
    start: 2,
    end: 7,
    performance: draft.performance,
    camera: draft.camera,
    customPrompt: draft.customPrompt,
  });
  expect(value).not.toHaveProperty("song");
  expect(value).not.toHaveProperty("path");
  expect(value).not.toHaveProperty("price");
  await expect(page).toHaveURL(/\/studio$/);
  expect(unexpected).toEqual([]);
});
