import test from "node:test";
import assert from "node:assert/strict";
import { customerLaunchReadiness } from "../lib/commerce/readiness.ts";

test("customer launch stays blocked even if accounts and studio flags are enabled", () => {
  const state = customerLaunchReadiness({ CUSTOMER_ACCOUNTS_ENABLED: "true", BYTEPLUS_STUDIO_ENABLED: "true", GENERATIONS_ENABLED: "true" });
  assert.equal(state.accountsEnabled, true);
  assert.equal(state.readyForPaidOrders, false);
  assert.equal(state.paymentsConnected, false);
  assert.equal(state.customerGenerationEnabled, false);
  assert.ok(state.blockers.length >= 3);
});
test("missing customer accounts are reported without exposing credentials", () => {
  const state = customerLaunchReadiness({ CUSTOMER_ACCOUNTS_ENABLED: "false" });
  assert.equal(state.accountsEnabled, false);
  assert.ok(state.blockers.some((x) => x.includes("accounts")));
  assert.equal(JSON.stringify(state).includes("SECRET"), false);
});
