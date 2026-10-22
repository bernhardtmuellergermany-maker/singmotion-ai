import { test, expect } from "@playwright/test";

test("empty waveform preserves identical pixel styles through hydration and client navigation", async ({
  browser,
  page,
  baseURL,
}) => {
  // Read the actual server output without allowing React to hydrate or repair it.
  const serverContext = await browser.newContext({ javaScriptEnabled: false });
  let serverStyles: (string | null)[];
  try {
    const serverPage = await serverContext.newPage();
    await serverPage.goto(`${baseURL}/studio`);
    const bars = serverPage.locator(".empty-wave i");
    await expect(bars).toHaveCount(66);
    serverStyles = await bars.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("style")),
    );
    for (const style of serverStyles) expect(style).toMatch(/^height:\d+px;?$/);
  } finally {
    await serverContext.close();
  }

  const hydrationMessages: string[] = [];
  page.on("console", (message) => {
    if (
      ["error", "warning"].includes(message.type()) &&
      /hydrat|didn't match|did not match|server rendered/i.test(message.text())
    ) {
      hydrationMessages.push(message.text());
    }
  });
  page.on("pageerror", (error) => hydrationMessages.push(error.message));
  await page.goto("/studio");
  await expect(
    page.getByRole("button", { name: "Drop your song here" }),
  ).toBeEnabled();
  const hydratedStyles = await page
    .locator(".empty-wave i")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("style")),
    );
  expect(hydratedStyles).toEqual(serverStyles);

  // A client-only navigation must create the same CSS values, rather than merely
  // leaving server attributes untouched after a hydration mismatch.
  await page.getByRole("link", { name: "SingMotion AI", exact: true }).click();
  await page.getByRole("link", { name: "Explore the studio" }).click();
  await expect(
    page.getByRole("button", { name: "Drop your song here" }),
  ).toBeEnabled();
  const clientHeights = await page
    .locator(".empty-wave i")
    .evaluateAll((elements) =>
      elements.map((element) => (element as HTMLElement).style.height),
    );
  expect(clientHeights).toEqual(
    serverStyles.map((style) =>
      style!.replace(/^height:\s*/, "").replace(/;$/, ""),
    ),
  );
  expect(hydrationMessages).toEqual([]);
});
