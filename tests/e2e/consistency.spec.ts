import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
const output = process.env.DESIGN_SCREENSHOTS_DIR || "test-results/design";
for (const width of [1440, 1024, 768, 390, 360]) {
  test(`shared geometry and accessible pages at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    mkdirSync(output, { recursive: true });
    await page.setViewportSize({ width, height: 1000 });
    let baseline: {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null = null;
    for (const route of [
      "/",
      "/studio",
      "/projects",
      "/artists",
      "/billing",
      "/settings",
      "/help",
      "/signin",
      "/signup",
      "/pricing",
      "/faq",
      "/about",
      "/contact",
      "/privacy",
      "/terms",
      "/legal",
      "/rights",
    ]) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBe(200);
      await page.evaluate(() => document.fonts.ready);
      const logo = await page.locator(".site-header .brand").boundingBox();
      expect(logo).not.toBeNull();
      if (!baseline) baseline = logo;
      for (const key of ["x", "y", "width", "height"] as const)
        expect(
          Math.abs(logo![key] - baseline![key]),
          `${route} logo ${key}`,
        ).toBeLessThan(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        route,
      ).toBe(width);
      await expect(page.locator("main")).toBeVisible();
      if (route === "/") {
        const hero = await page.locator(".cinematic-hero").boundingBox();
        expect(hero!.x).toBe(0);
        expect(hero!.width).toBe(width);
        expect(hero!.y).toBe(0);
        expect(hero!.height).toBeGreaterThanOrEqual(1000);
        await expect(page.locator(".concert-artwork img")).toHaveCSS(
          "border-radius",
          "0px",
        );
        await expect(page.locator(".site-header a")).toHaveCount(3);
      }
      await page.screenshot({
        path: `${output}/${route === "/" ? "home" : route.slice(1)}-${width}.png`,
        fullPage: true,
      });
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        route,
      ).toEqual([]);
    }
  });
}
