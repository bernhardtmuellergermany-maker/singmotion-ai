// All endpoints intercepted; no provider, R2 or CMS network access.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {StudioLiveControl} from './components/studio-live';createRoot(document.getElementById('root')).render(<StudioLiveControl selection={{version:1,owner:'owner',songId:'song',imageId:'image',start:0,end:4.7,performance:'Natural',camera:'Static Close-Up',customPrompt:''}} artistName="Singer" consent={true} disabled={false}/>);`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  plugins: [
    {
      name: "router-mock",
      setup(b) {
        b.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: "router",
          namespace: "mock",
        }));
        b.onResolve({ filter: /^next\/link$/ }, () => ({
          path: "link",
          namespace: "link-mock",
        }));
        b.onLoad({ filter: /.*/, namespace: "link-mock" }, () => ({
          contents:
            'import React from "react";export default function Link(props){return React.createElement("a",props)}',
          loader: "js",
          resolveDir: process.cwd(),
        }));
        b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents:
            "export function useRouter(){return {push(url){window.__route=url}}}",
          loader: "js",
        }));
      },
    },
  ],
});
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (error) => console.error(error.message));
    const posts: Record<string, unknown>[] = [];
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/")
        return route.fulfill({
          contentType: "text/html",
          body: '<div id="root"></div><script src="/bundle.js"></script>',
        });
      if (url.pathname === "/bundle.js")
        return route.fulfill({
          contentType: "application/javascript",
          body: bundle.outputFiles[0].text,
        });
      if (url.pathname === "/api/session")
        return route.fulfill({ json: { owner: "owner" } });
      if (url.pathname === "/api/studio-live") {
        if (route.request().method() === "GET")
          return route.fulfill({
            json: { available: true, pilot: true, blockers: [] },
          });
        const body = route.request().postDataJSON();
        posts.push(body);
        return route.fulfill({
          json: {
            budget: {
              remainingMicroUsd: 1000000,
              remainingMicroEur: 48000000,
              basis: "reviewed-bound",
            },
            id: "plan",
            state: "prepared",
            durationSeconds: 4.728,
            prompt: "Natural singing performance.",
            estimatedBaseMicroUsd: 330960,
            ceilingMicroUsd: 420000,
            digest: "mock-digest",
            selection: body.selection,
          },
        });
      }
      return route.abort();
    });
    await page.goto("http://studio.test/");
    const review = page.getByRole("button", {
      name: "Review real video cost — no paid request",
      exact: true,
    });
    await review.waitFor();
    assert.equal(await review.isDisabled(), true);
    await page.getByLabel("The composed prompt is English.").check();
    await review.click();
    const submit = page.getByRole("button", {
      name: "Generate ONE real video",
      exact: true,
    });
    await submit.waitFor();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].action, "prepare");
    assert.equal(await submit.isDisabled(), true);
    await page
      .getByLabel(
        "I explicitly approve one paid generation of this exact reviewed selection up to this ceiling.",
      )
      .check();
    await submit.click();
    await page.waitForFunction(() =>
      Boolean((window as unknown as { __route: string }).__route),
    );
    assert.equal(posts.length, 2);
    assert.equal(posts[1].action, "submit");
    assert.equal(
      posts[1].confirmation,
      "CONFIRM PAID STUDIO plan mock-digest 420000",
    );
    await page.close();
  }
  console.log(
    "PASS: desktop/mobile pilot review and separate explicit paid confirmation; mock HTTP only.",
  );
} finally {
  await browser.close();
}
