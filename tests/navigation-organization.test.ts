import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("global menu contains exactly the four clear destinations", () => {
  const source = read("components/global-menu.tsx");
  const links = [...source.matchAll(/\{ href: "(\/[^"]+)", label: "([^"]+)" \}/g)]
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(links, [
    ["/projects", "My Projects"],
    ["/help", "Help"],
    ["/legal", "Legals"],
    ["/contact", "Contact"],
  ]);
});

test("pricing is available from login, not the general menu", () => {
  const menu = read("components/global-menu.tsx");
  const accountMenu = read("components/header-account-menu.tsx");
  const accountPanel = read("components/account-panel.tsx");
  assert.doesNotMatch(menu, /\/plans|Pricing/);
  assert.match(accountMenu, /href="\/plans"[^>]*>Plans & Pricing<\/Link>/);
  assert.match(accountPanel, /href="\/plans">Plans & Pricing<\/Link>/);
});

test("legal topics retain privacy, consumer and AI policies", () => {
  const legal = read("components/legal-policies.tsx");
  for (const label of ["Legal & privacy", "Terms & consumer rights", "AI & media rights"]) {
    assert.ok(legal.includes(label), `missing topic: ${label}`);
  }
  for (const route of ["/privacy", "/cookies", "/terms", "/withdrawal", "/rights", "/ai-transparency"]) {
    assert.ok(legal.includes(`href: "${route}"`), `missing legal route: ${route}`);
  }
  assert.match(legal, /href: "#imprint"/);
});

test("homepage navigation dropdown stays outside isolated video viewport and above moving clips",()=>{
 const page=read("components/immersive-home.tsx");
 const styles=read("app/(site)/site-navigation.css");
 const header=page.indexOf('<SiteHeader className="sm-immersive-header"/>');
 const viewport=page.indexOf('<div ref={firstScreen}');
 assert.ok(header>=0&&viewport>=0&&header<viewport,"Header must precede clipped hero viewport");
 assert.match(styles,/\.sm-immersive-home>\.sm-immersive-header\s*\{/);
 assert.match(styles,/\.sm-site-header \.sm-header-actions>\.sm-global-menu>\.sm-global-menu-list\s*\{/);
 assert.match(styles,/background:#181427!important/);
 assert.match(styles,/position:fixed!important/);
});
