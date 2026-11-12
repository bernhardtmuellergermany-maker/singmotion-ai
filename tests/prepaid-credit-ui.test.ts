import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creditTone } from "../lib/commerce/credit-display.ts";
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("credit colors cover boundaries and missing balances", () => {
  assert.equal(creditTone(null), "unknown");
  assert.equal(creditTone(Number.NaN), "unknown");
  assert.equal(creditTone(0), "critical");
  assert.equal(creditTone(249), "critical");
  assert.equal(creditTone(250), "low");
  assert.equal(creditTone(999), "low");
  assert.equal(creditTone(1000), "healthy");
  assert.equal(creditTone(10000), "healthy");
});

test("balance API is read only and requires account-scoped session", () => {
  const api = read("app/(site)/api/credit-balance/route.ts");
  assert.match(api, /customerAccountSettingsAccessible\(process\.env\)/);
  assert.match(api, /store\.session\(req\.cookies\.get\("sm_customer"\)/);
  assert.match(api, /WHERE account_id=\?/);
  assert.match(api, /store\.balance\(accountId\)/);
  assert.match(api, /private, no-store/);
  assert.doesNotMatch(api, /export async function POST/);
});

test("account menu separates customers and staff and shows real credit balance", () => {
  const menu = read("components/header-account-menu.tsx");
  assert.match(menu, /identity==="customer"\?</);
  assert.match(menu, /fetch\("\/api\/credit-balance"/);
  assert.match(menu, /href="\/credits"/);
  assert.match(menu, /href="\/usage"/);
  assert.match(menu, /creditTone\(/);
  assert.match(menu, /Balance unavailable/);
});

test("pricing and credit packages are informational while checkout is disabled", () => {
  const plans = read("app/(site)/plans/page.tsx");
  const credits = read("components/credits-dashboard.tsx");
  assert.match(plans, /Credit payments are coming soon/);
  assert.match(plans, /25 Credits/);
  assert.match(plans, /Prepaid/);
  assert.match(plans, /href="\/credits"/);
  assert.match(credits, /Stripe credit purchases not yet available/);
  assert.doesNotMatch(credits, /\/api\/stripe-checkout|fetch\(.*checkout/);
});
