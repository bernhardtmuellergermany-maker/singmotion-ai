// All endpoints intercepted; no provider, R2 or CMS network access.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {StudioLiveControl,LiveProjects} from './components/studio-live';createRoot(document.getElementById('root')).render(location.search ? <LiveProjects/> : <StudioLiveControl selection={{version:1,owner:'owner',songId:'song',imageId:'image',start:0,end:location.hash?12.384:4.7,performance:'Natural',camera:'Static Close-Up',customPrompt:''}} artistName="Singer" consent={true} disabled={false}/>);`,
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
    let hidden = false;
    await page.route("**/api/studio-live", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({
          json: {
            pilot: true,
            projects: hidden
              ? []
              : [
                  {
                    id: "blocked",
                    state: "uncertain",
                    artistName: "Test singer",
                    durationSeconds: 4.7,
                    ceilingMicroUsd: 420000,
                    imageId: "image",
                  },
                ],
          },
        });
      const body = route.request().postDataJSON();
      posts.push(body);
      if (body.action === "hide") {
        hidden = true;
        return route.fulfill({ json: { hidden: true } });
      }
      return route.fulfill({
        json: {
          ready: false,
          blockers: [
            {
              projectId: "blocked",
              message: "Outcome unverified. Reservation retained.",
            },
          ],
        },
      });
    });
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto("http://studio.test/?projects");
    await page
      .getByRole("button", { name: "Delete project", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Start fresh test", exact: true })
      .click();
    const recovery = page.getByRole("link", {
      name: "Recover / reconcile previous task",
    });
    await recovery.waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Delete project", exact: true })
        .count(),
      0,
    );
    assert.equal(await recovery.getAttribute("href"), "/projects/live_blocked");
    assert.equal(posts.filter((p) => p.action === "submit").length, 1);
    await page.route("**/api/studio-live", async (route) => {
      const body = route.request().postDataJSON();
      posts.push(body);
      return route.fulfill({
        json:
          body.action === "acknowledge-operator-risk"
            ? { ready: true, exceptionExposure: true, blockers: [] }
            : {
                ready: false,
                blockers: [
                  {
                    projectId: null,
                    attemptId: "operator-plan",
                    taskId: "1660608639",
                    workflow: "operator",
                    state: "processing",
                    canAcknowledge: true,
                    message:
                      "Retained evidence does not establish terminal rejection.",
                  },
                ],
              },
      });
    });
    await page
      .getByRole("button", { name: "Start fresh test", exact: true })
      .click();
    await page
      .getByText("operator task 1660608639 · processing.", { exact: true })
      .waitFor();
    await page
      .getByRole("button", {
        name: "Acknowledge operator-task risk — permit private testing",
        exact: true,
      })
      .click();
    await page
      .getByRole("link", {
        name: "Open Studio to select inputs and explicitly approve a new test",
      })
      .waitFor();
    assert.equal(
      posts.at(-1)?.confirmation,
      "ACCEPT OVERLAPPING BILLING operator-plan 1660608639",
    );
    assert.equal(posts.filter((p) => p.action === "submit").length, 1);
    await page.close();
  }

  const page = await browser.newPage();
  let reviews = 0,
    approvals = 0;
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
    if (url.pathname !== "/api/studio-live") return route.abort();
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { available: true, pilot: true, blockers: [] },
      });
    const body = route.request().postDataJSON();
    if (body.action === "submit") {
      approvals++;
      assert.match(
        body.confirmation,
        /ACCEPT EXPERIMENTAL UNKNOWN DURATION FEES MEDIA$/,
      );
      if (reviews === 1)
        return route.fulfill({
          status: 409,
          json: {
            error:
              "Policy changed. Click Review real video cost again to create a new unapproved review.",
          },
        });
      assert.equal(body.id, "review-2");
      return route.fulfill({ json: { state: "submitted" } });
    }
    reviews++;
    return route.fulfill({
      json: {
        id: `review-${reviews}`,
        digest: `digest-${reviews}`,
        experimental: true,
        state: "prepared",
        stage: "New unapproved review",
        durationSeconds: 12.384,
        prompt: "Sing",
        ceilingMicroUsd: 1500000,
        estimatedBaseMicroUsd: 866880,
        selection: body.selection,
        budget: {
          remainingMicroUsd: 2000000,
          remainingMicroEur: 48000000,
          basis: "reviewed-bound",
        },
      },
    });
  });
  await page.goto("http://studio.test/#experimental");
  await page.getByLabel("The composed prompt is English.").check();
  const reviewButton = page.getByRole("button", {
    name: "Review real video cost — no paid request",
    exact: true,
  });
  await reviewButton.click();
  const approval = page.getByLabel(
    /I explicitly approve one experimental paid generation/,
  );
  await approval.check();
  await page
    .getByRole("button", { name: "Generate ONE real video", exact: true })
    .click();
  await page.getByRole("alert").waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Generate ONE real video", exact: true })
      .count(),
    0,
  );
  assert.equal(approvals, 1);
  await reviewButton.click();
  await approval.waitFor();
  assert.equal(await approval.isChecked(), false);
  assert.equal(
    await page
      .getByRole("button", { name: "Generate ONE real video", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(approvals, 1);
  await approval.check();
  await page
    .getByRole("button", { name: "Generate ONE real video", exact: true })
    .click();
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __route: string }).__route),
  );
  assert.equal(approvals, 2);
  await page.close();
  console.log(
    "PASS: desktop/mobile pilot review and separate explicit paid confirmation; mock HTTP only.",
  );
} finally {
  await browser.close();
}
