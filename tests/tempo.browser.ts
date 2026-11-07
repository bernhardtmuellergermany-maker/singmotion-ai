// Synthetic local media and intercepted HTTP only. Never reaches BytePlus/R2.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, firefox, webkit, expect } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { trimAudio } from "../lib/media.ts";
import { slowExcerpt, restoreTempoOutput } from "../lib/live/tempo.ts";
import { sha256File } from "../lib/live/media.ts";
const root = await mkdtemp(path.join(tmpdir(), "tempo browser "));
await mkdir(path.join(root, "media"));
const ff = (args: string[]) =>
  execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", ...args]);
let browser;
try {
  const original = path.join(root, "media", "original.mp3");
  const source = path.join(root, "source.wav");
  ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=7", source]);
  const durationSeconds = await trimAudio(source, original, 1, 6);
  const media = await slowExcerpt(
    {
      sourceJobId: "browser",
      owner: "owner",
      audioPath: original,
      audioSha256: await sha256File(original),
      imagePath: "unused",
      imageSha256: "unused",
      durationSeconds,
      prompt: "Synthetic offline",
      promptLanguageConfirmed: true,
    },
    root,
    "song",
    { sourceSha256: await sha256File(source), digest: "mock-authorization" },
    10,
  );
  const raw = path.join(root, "raw.mp4"),
    final = path.join(root, "final.mp4");
  ff([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=720x720:rate=25",
    "-i",
    media.audioPath,
    "-t",
    String(media.durationSeconds),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    raw,
  ]);
  await restoreTempoOutput(raw, final, media, {
    revision: "synthetic-browser-only",
    model: "OmniHuman 2.0",
    documentationUrl: "https://offline.test/mock",
    maxDurationSeconds: 10,
    promptSupported: true,
    inputFetchWindowSeconds: null,
    generatedDurationBound: null,
    billing: {
      microUsdPerSecond: 70000,
      minimumBillableMs: null,
      billingQuantumMs: null,
      minimumChargeMicroUsd: null,
      fixedFeeMicroUsd: null,
      taxBasisPointsUpperBound: null,
    },
    outputHosts: ["offline.test"],
    output: {
      width: 720,
      height: 720,
      fps: 25,
      durationToleranceSeconds: 0.2,
    },
  });
  const video = await readFile(final);
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {Studio} from './components/studio';createRoot(document.getElementById('root')).render(<Studio/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    plugins: [
      {
        name: "offline-next",
        setup(b) {
          b.onResolve(
            { filter: /^next\/(navigation|link|dynamic)$/ },
            (args) => ({ path: args.path, namespace: "mock" }),
          );
          b.onLoad({ filter: /.*/, namespace: "mock" }, ({ path: name }) => ({
            contents: name.endsWith("navigation")
              ? "export function useRouter(){return {push(){}}}"
              : name.endsWith("dynamic")
                ? "export default function dynamic(){return function Wave(){return null}}"
                : 'import React from "react";export default function Link(props){return React.createElement("a",props)}',
            loader: "js",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  const engine = process.env.TEMPO_BROWSER || "chromium";
  if (!["chromium", "firefox", "webkit"].includes(engine))
    throw Error("Unsupported test browser");
  browser = await { chromium, firefox, webkit }[
    engine as "chromium" | "firefox" | "webkit"
  ].launch(
    engine === "chromium"
      ? {
          executablePath:
            process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
            "/usr/bin/chromium",
          args: ["--no-sandbox"],
        }
      : {},
  );
  for (const mobile of [false, true]) {
    const page = await browser.newPage({
      viewport: { width: mobile ? 390 : 1440, height: 900 },
      isMobile: engine !== "firefox" && mobile,
      hasTouch: mobile,
    });
    let terms = "terms-v1",
      saved = false;
    const draft = {
      song: { id: "song", duration: 7, name: "original.mp3" },
      imageId: "image",
      artistName: "Singer",
      start: 1,
      end: 6,
      performance: "Natural",
      camera: "Static Close-Up",
      customPrompt: "",
    };
    await page.addInitScript(
      (draft) =>
        localStorage.setItem("singmotion-studio", JSON.stringify(draft)),
      draft,
    );
    await page.route("**/*", async (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p === "/")
        return route.fulfill({
          contentType: "text/html",
          body: '<div id="root"></div><script src="/bundle.js"></script><video id="playback" controls playsinline src="/synthetic.mp4"></video><button id="play" onclick="document.querySelector(&quot;video&quot;).play()">Play export</button>',
        });
      if (p === "/bundle.js")
        return route.fulfill({
          contentType: "application/javascript",
          body: bundle.outputFiles[0].text,
        });
      if (p === "/synthetic.mp4")
        return route.fulfill({ contentType: "video/mp4", body: video });
      if (p === "/api/rights")
        return route.fulfill({ json: { version: terms } });
      if (p === "/api/session")
        return route.fulfill({ json: { owner: "owner" } });
      if (p === "/api/quote") return route.fulfill({ json: { cents: 0 } });
      if (p === "/api/artists") return route.fulfill({ json: [] });
      if (p === "/api/studio-live")
        return route.fulfill({
          json:
            route.request().method() === "POST"
              ? {
                  confirmed:
                    saved &&
                    terms === "terms-v1" &&
                    !route.request().postDataJSON().selection.customPrompt,
                }
              : { available: false, pilot: false },
        });
      return route.fulfill({ status: 404, body: "Offline fixture only" });
    });
    await page.goto("http://offline.test/");
    const rights = page.getByRole("checkbox", {
      name: /I own or have all necessary permissions/,
    });
    await expect(rights).not.toBeChecked();
    await expect(
      page.getByRole("link", { name: "AGB / Terms" }),
    ).toHaveAttribute("href", "/terms");
    await rights.check();
    await expect(rights).toBeChecked();
    // Changing content invalidates confirmation immediately, even before server roundtrip.
    await page.locator(".advanced-toggle").click();
    const prompt = page.getByPlaceholder(/Describe how your artist/);
    await prompt.fill("New scene");
    await expect(rights).not.toBeChecked();
    saved = true;
    await page.reload();
    await expect(rights).toBeChecked(); // authenticated server receipt for exact unchanged content
    terms = "terms-v2";
    await page.reload();
    await expect(rights).not.toBeChecked();
    await page.locator("#play").click();
    const result = await page.locator("#playback").evaluate(async (element) => {
      const v = element as HTMLVideoElement;
      await v.play();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Playback did not finish")),
          15000,
        );
        v.addEventListener(
          "ended",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        v.addEventListener(
          "error",
          () => {
            clearTimeout(timer);
            reject(Error("Decode failed"));
          },
          { once: true },
        );
      });
      return {
        duration: v.duration,
        time: v.currentTime,
        width: v.videoWidth,
        error: v.error?.code,
      };
    });
    assert.equal(result.error, undefined);
    assert.equal(result.width, 720);
    assert.ok(Math.abs(result.duration - 5) < 0.2);
    assert.ok(result.time >= 4.9);
    console.log(
      `${engine} ${mobile ? "mobile viewport" : "desktop"}: original MP3 in MP4 playback + content/Terms consent binding passed`,
    );
    await page.close();
  }
} finally {
  await browser?.close();
  await rm(root, { recursive: true, force: true });
}
