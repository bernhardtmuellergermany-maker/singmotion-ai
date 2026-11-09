import test from "node:test";
import assert from "node:assert/strict";
import {pausedHobbyWebhookAction} from "../lib/commerce/stripe-hobby-pause-policy.ts";
import {configuredStripePaymentMode,configuredStripeReversalMode} from "../lib/commerce/stripe-payment-mode.ts";
const prod={
 RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d",
 STRIPE_SECRET_KEY:"sk_live_synthetic",
 STRIPE_WEBHOOK_SECRET:"whsec_synthetic",
 STRIPE_HOBBY_WEBHOOK_SECRET:"whsec_synthetic_hobby",
 STRIPE_LIVE_CHECKOUT_ENABLED:"true",
 PUBLIC_CUSTOMER_LAUNCH_APPROVED:"true",
 STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED:"true",
};
test("Hobby webhook still authenticates in correct Stripe mode while customer checkout is stopped",()=>{
 assert.equal(configuredStripePaymentMode(prod),"live");
 for(const change of [
  {STRIPE_LIVE_CHECKOUT_ENABLED:"false"},
  {PUBLIC_CUSTOMER_LAUNCH_APPROVED:"false"},
  {STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED:"false"},
 ]){
  const disabled={...prod,...change};
  assert.equal(configuredStripePaymentMode(disabled),null);
  assert.equal(configuredStripeReversalMode(disabled),"live");
 }
 assert.equal(configuredStripeReversalMode({...prod,RAILWAY_ENVIRONMENT_ID:"wrong"}),null);
 assert.equal(configuredStripeReversalMode({...prod,STRIPE_SECRET_KEY:"sk_test_wrong"}),null);
 assert.equal(configuredStripeReversalMode({...prod,STRIPE_WEBHOOK_SECRET:""}),null);
});
test("Hobby checkout pause permits only verified revocation of an existing matching subscription",()=>{
 const id="sub_customer_existing";
 assert.equal(pausedHobbyWebhookAction(false,"inactive",id,id),"reconcile");
 assert.equal(pausedHobbyWebhookAction(false,"active",id,id),"retry");
 assert.equal(pausedHobbyWebhookAction(false,"active",null,id),"retry");
 assert.equal(pausedHobbyWebhookAction(false,"inactive",null,id),"ignore");
 assert.equal(pausedHobbyWebhookAction(false,"inactive","sub_other",id),"ignore");
 assert.equal(pausedHobbyWebhookAction(false,"inactive","sub_other","malformed"),"ignore");
 assert.equal(pausedHobbyWebhookAction(true,"active",null,id),"reconcile");
 assert.equal(pausedHobbyWebhookAction(true,"inactive",null,id),"reconcile");
});
