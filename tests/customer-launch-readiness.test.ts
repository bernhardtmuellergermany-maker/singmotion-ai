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

test("owner-confirmed 0.07 USD rule unlocks sandbox checkout only with bounded real worker and private delivery",()=>{
 const env={
  RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041",
  DATA_DIR:"/nonexistent-offline-customer-price-test-data",
  CUSTOMER_ACCOUNTS_ENABLED:"true",
  CUSTOMER_GENERATION_ENABLED:"true",
  CUSTOMER_DELIVERY_ENABLED:"true",
  CUSTOMER_PAID_WORKER_ENABLED:"true",
  CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"true",
  CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING:"true",
  CUSTOMER_PAID_WORKER_ACTIVATED_AT:"1",
  CUSTOMER_R2_STORAGE_ENABLED:"true",
  R2_ACCOUNT_ID:"0".repeat(32),
  R2_BUCKET:"private-review",
  R2_ACCESS_KEY_ID:"synthetic-access",
  R2_SECRET_ACCESS_KEY:"synthetic-secret",
  BYTEPLUS_ACCESS_KEY_ID:"synthetic-key",
  BYTEPLUS_SECRET_ACCESS_KEY:"synthetic-secret",
  STRIPE_CHECKOUT_ENABLED:"true",
  STRIPE_SECRET_KEY:"sk_test_synthetic",
  STRIPE_WEBHOOK_SECRET:"whsec_synthetic",
 };
 const enabled=customerLaunchReadiness(env);
 assert.equal(enabled.readyForPaidOrders,true);
 assert.equal(enabled.paymentsConnected,true);
 assert.equal(enabled.deliveryConnected,true);
 assert.deepEqual(enabled.blockers,[]);
 for(const field of [
  "CUSTOMER_PAID_WORKER_ENABLED","CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED",
  "CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING","CUSTOMER_PAID_WORKER_ACTIVATED_AT",
  "CUSTOMER_DELIVERY_ENABLED","CUSTOMER_GENERATION_ENABLED",
  "CUSTOMER_ACCOUNTS_ENABLED","R2_ACCOUNT_ID","BYTEPLUS_ACCESS_KEY_ID",
  "STRIPE_SECRET_KEY","STRIPE_WEBHOOK_SECRET",
 ]){
  const denied=customerLaunchReadiness({...env,[field]:"false"});
  assert.equal(denied.readyForPaidOrders,false,field+" must fail closed");
 }
 assert.equal(customerLaunchReadiness({...env,
  RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
  STRIPE_SECRET_KEY:"sk_live_fake"}).readyForPaidOrders,false);
});
