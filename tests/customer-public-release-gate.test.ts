import { test } from "node:test";
import assert from "node:assert/strict";
import {
  productionCustomerReleaseApproved,
  productionPrivateCustomerPreviewEnabled,
  customerAccountSettingsAccessible,
  PRODUCTION_CUSTOMER_PROOFS,
  PRODUCTION_RAILWAY_ENVIRONMENT_ID,
} from "../lib/commerce/customer-live-config.ts";
import { customerLaunchReadiness } from "../lib/commerce/readiness.ts";
import { customerWorkerEnabled } from "../lib/commerce/customer-paid-worker.ts";
import { stagingEnabled, stagingAccess } from "../lib/staging.ts";

const prod = PRODUCTION_RAILWAY_ENVIRONMENT_ID;
const staging = "dfaeabed-03df-43ed-aa71-50f343a75041";
const safePrivate = {
  RAILWAY_ENVIRONMENT_ID: prod,
  PRODUCTION_PRIVATE_CUSTOMER_PREVIEW_ENABLED: "true",
  STAGING_AUTH_ENABLED: "true",
  STAGING_PASSWORD: "synthetic-only-long-private-gate-key-not-for-production",
  PRODUCTION_PUBLIC_ACCESS_ENABLED: "false",
  PUBLIC_CUSTOMER_LAUNCH_APPROVED: "false",
  STRIPE_LIVE_CHECKOUT_ENABLED: "false",
  HOBBY_SUBSCRIPTIONS_ENABLED: "false",
  CUSTOMER_PAID_WORKER_ENABLED: "false",
  CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED: "false",
  CUSTOMER_ACCOUNTS_ENABLED: "true",
  DEMO_MODE: "true",
  GENERATIONS_ENABLED: "false",
  ADMIN_DEMO_ENABLED: "false",
};

test("a private production preview cannot turn public or charge customers just because accounts exist", () => {
  assert.equal(productionPrivateCustomerPreviewEnabled(safePrivate), true);
  assert.equal(stagingEnabled(safePrivate), true);
  assert.equal(stagingAccess(null, safePrivate), 401);
  assert.equal(productionCustomerReleaseApproved(safePrivate), false);
  assert.equal(customerWorkerEnabled(safePrivate), false);
  assert.equal(customerLaunchReadiness(safePrivate).readyForPaidOrders, false);
});

test("every required human review must block public release independently, including refund, provider, cost, CMS, backup and legal", () => {
  const partial = {
    ...safePrivate,
    PRODUCTION_PUBLIC_ACCESS_ENABLED: "true",
    STAGING_AUTH_ENABLED: "false",
    STRIPE_LIVE_CHECKOUT_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_live_synthetic_fixture_only",
    STRIPE_WEBHOOK_SECRET: "whsec_fixture_not_a_real_webhook",
    CUSTOMER_PAID_WORKER_ENABLED: "true",
    CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED: "true",
    CUSTOMER_GENERATION_ENABLED: "true",
    CUSTOMER_FULFILLMENT_ENABLED: "true",
    CUSTOMER_DELIVERY_ENABLED: "true",
    CUSTOMER_R2_STORAGE_ENABLED: "true",
  };
  for (const gate of PRODUCTION_CUSTOMER_PROOFS) {
    assert.equal(productionCustomerReleaseApproved({ ...partial, [gate]: "false" }), false, gate);
    assert.equal(stagingEnabled({ ...partial, [gate]: "false" }), true, gate);
  }
  assert.equal(productionCustomerReleaseApproved(partial), false);
  assert.equal(stagingEnabled(partial), true);
  assert.equal(customerLaunchReadiness(partial).readyForPaidOrders, false);
});

test("staging cannot inherit a public production flag or a live Stripe key", () => {
  const wrongEnv = {
    ...safePrivate,
    RAILWAY_ENVIRONMENT_ID: staging,
    PRODUCTION_PUBLIC_ACCESS_ENABLED: "true",
    STAGING_AUTH_ENABLED: "false",
    PUBLIC_CUSTOMER_LAUNCH_APPROVED: "true",
    STRIPE_LIVE_CHECKOUT_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_live_fake",
    CUSTOMER_PAID_WORKER_ENABLED: "true",
    CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED: "true",
  };
  assert.equal(stagingEnabled(wrongEnv), true);
  assert.equal(productionCustomerReleaseApproved(wrongEnv), false);
  assert.equal(customerWorkerEnabled(wrongEnv), false);
  assert.equal(customerLaunchReadiness(wrongEnv).readyForPaidOrders, false);
});

test("private Production account settings allow signed-in customers without unlocking launch or payment",()=>{
 assert.equal(customerAccountSettingsAccessible(safePrivate),true);
 assert.equal(customerAccountSettingsAccessible({...safePrivate,CUSTOMER_ACCOUNTS_ENABLED:"false"}),false);
 assert.equal(customerAccountSettingsAccessible({...safePrivate,PRODUCTION_PRIVATE_CUSTOMER_PREVIEW_ENABLED:"false"}),false);
 assert.equal(customerAccountSettingsAccessible({...safePrivate,STAGING_AUTH_ENABLED:"false"}),false);
 assert.equal(customerAccountSettingsAccessible({...safePrivate,PRODUCTION_PUBLIC_ACCESS_ENABLED:"true"}),false);
 assert.equal(customerAccountSettingsAccessible({...safePrivate,RAILWAY_ENVIRONMENT_ID:"invalid-environment"}),false);
 assert.equal(customerAccountSettingsAccessible({...safePrivate,RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041"}),true);
 assert.equal(productionCustomerReleaseApproved(safePrivate),false);
 assert.equal(customerLaunchReadiness(safePrivate).readyForPaidOrders,false);
});
