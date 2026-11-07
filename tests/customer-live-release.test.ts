import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {customerLaunchReadiness} from "../lib/commerce/readiness.ts";
import {customerWorkerEnabled,loadCustomerWorkerPolicy} from "../lib/commerce/customer-paid-worker.ts";
import {ownerConfirmedBytePlusPolicy} from "../lib/commerce/owner-confirmed-provider-policy.ts";
import {productionCustomerReleaseApproved,PRODUCTION_CUSTOMER_PROOFS,
 PRODUCTION_RAILWAY_ENVIRONMENT_ID} from "../lib/commerce/customer-live-config.ts";
import {CustomerR2PrivateInputDelivery} from "../lib/commerce/customer-r2-inputs.ts";
import {CommerceStore} from "../lib/commerce/store.ts";
import {stagingEnabled,stagingAccess} from "../lib/staging.ts";

const env=(root:string)=>{
 const vars:Record<string,string|undefined>={
  RAILWAY_ENVIRONMENT_ID:PRODUCTION_RAILWAY_ENVIRONMENT_ID,
  DATA_DIR:root,
  STRIPE_SECRET_KEY:"sk_live_fake_private_key_for_offline_tests",
  STRIPE_WEBHOOK_SECRET:"whsec_fake_private_signature_for_offline_tests",
  STRIPE_LIVE_CHECKOUT_ENABLED:"true",
  CUSTOMER_PAID_WORKER_ENABLED:"true",
  CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED:"true",
  CUSTOMER_BYTEPLUS_OWNER_CONFIRMED_PRICING:"true",
  CUSTOMER_PAID_WORKER_ACTIVATED_AT:"1",
  CUSTOMER_ACCOUNTS_ENABLED:"true",
  CUSTOMER_GENERATION_ENABLED:"true",
  CUSTOMER_FULFILLMENT_ENABLED:"true",
  CUSTOMER_DELIVERY_ENABLED:"true",
  CUSTOMER_R2_STORAGE_ENABLED:"true",
  CUSTOMER_PRODUCTION_PROVIDER_BUDGET_APPROVED:"true",
  CMS_ENABLED:"true",
  CMS_DATABASE_URL:"postgresql://synthetic.example.test:5432/isolated",
  PAYLOAD_SECRET:"fictional-long-CMS-secret-for-testing-only",
  SUPPORT_CONTACT_VERIFIED:"support@example.test",
  R2_ACCOUNT_ID:"0".repeat(32),
  R2_BUCKET:"private-production-test",
  R2_ACCESS_KEY_ID:"synthetic_R2_access_key",
  R2_SECRET_ACCESS_KEY:"synthetic_R2_secret_key",
  BYTEPLUS_ACCESS_KEY_ID:"synthetic_byteplus_key",
  BYTEPLUS_SECRET_ACCESS_KEY:"synthetic_byteplus_secret_key",
 };
 for(const flag of PRODUCTION_CUSTOMER_PROOFS)vars[flag]="true";
 return vars;
};

test("Stripe live connection alone cannot enable production paid customer generation",()=>{
 const e=env("/nonexistent");
 for(const flag of [
  "STRIPE_LIVE_CHECKOUT_ENABLED","STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED",
  "CUSTOMER_PAID_PROVIDER_E2E_VERIFIED","PRODUCTION_MEDIA_MIGRATION_VERIFIED",
  "CUSTOMER_PRODUCTION_PROVIDER_BUDGET_APPROVED","STRIPE_REFUND_DISPUTE_E2E_VERIFIED",
  "COST_ALERTS_AND_KILL_SWITCH_VERIFIED","PUBLIC_CUSTOMER_LAUNCH_APPROVED",
  "FREE_PROMO_FULFILLMENT_E2E_VERIFIED","PRODUCTION_CMS_MIGRATION_VERIFIED",
  "PRODUCTION_CMS_BACKUP_RESTORE_VERIFIED","PRODUCTION_CMS_RBAC_AND_PUBLISH_E2E_VERIFIED",
  "CMS_PUBLISHED_CONTENT_RECONCILED","CMS_ENABLED","CMS_DATABASE_URL","SUPPORT_CONTACT_VERIFIED",
  "CUSTOMER_PAID_WORKER_ACTIVATED_AT","STRIPE_WEBHOOK_SECRET","STRIPE_SECRET_KEY",
 ]){
  const wrong={...e,[flag]:"false"};
  assert.equal(productionCustomerReleaseApproved(wrong),false,flag);
  assert.equal(customerWorkerEnabled(wrong),false,flag);
  assert.equal(customerLaunchReadiness(wrong).readyForPaidOrders,false,flag);
 }
 const sandbox={...e,STRIPE_SECRET_KEY:"sk_test_synthetic"};
 assert.equal(customerLaunchReadiness(sandbox).readyForPaidOrders,false);
 assert.equal(customerWorkerEnabled(sandbox),false);
 assert.equal(customerLaunchReadiness({...e,RAILWAY_ENVIRONMENT_ID:"other"}).readyForPaidOrders,false);
});

test("production requires a private real-customer policy on persistent volume, never staging fallback",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"singmotion-live-policy-"));
 try{
  const e=env(root);
  assert.equal(productionCustomerReleaseApproved(e),true);
  assert.equal(customerWorkerEnabled(e),true);
  assert.equal(customerLaunchReadiness(e).readyForPaidOrders,false);
  await assert.rejects(loadCustomerWorkerPolicy(root,e),/private production customer provider policy/);
  const policy=ownerConfirmedBytePlusPolicy();
  await writeFile(path.join(root,"customer-byteplus-policy.json"),JSON.stringify(policy),{mode:0o600});
  await assert.rejects(loadCustomerWorkerPolicy(root,e),
   /Independent production customer provider policy review required/);
  assert.equal(customerLaunchReadiness(e).readyForPaidOrders,false);
  const independent={...policy,reviewedBy:"independent-production-policy-review-offline",
   contract:{...policy.contract,revision:"production-isolated-offline-fixture"}};
  await writeFile(path.join(root,"customer-byteplus-policy.json"),JSON.stringify(independent),{mode:0o600});
  assert.equal((await loadCustomerWorkerPolicy(root,e)).contract.billing.microUsdPerSecond,70000);
  assert.equal(customerLaunchReadiness(e).readyForPaidOrders,true);
  const store=new CommerceStore(":memory:");
  try{
   const adapter=new CustomerR2PrivateInputDelivery(store,"11111111-1111-4111-8111-111111111111",root,e);
   adapter.close();
   assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM customer_provider_input_leases").get()?.n,0);
  }finally{store.close()}
 }finally{await rm(root,{recursive:true,force:true})}
});

test("Production R2 adapter never starts with an unreviewed live account",()=>{
 const root="/nonexistent";
 const store=new CommerceStore(":memory:");
 try{
  assert.throws(()=>new CustomerR2PrivateInputDelivery(
   store,"11111111-1111-4111-8111-111111111111",root,{
    ...env(root),STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED:"false",
   }),/approved production/);
 }finally{store.close()}
});

test("only a separately released Live Production site may stop requiring private Basic Auth",()=>{
 const e={...env("/n/a"),PRODUCTION_PUBLIC_ACCESS_ENABLED:"true"};
 assert.equal(stagingEnabled(e),false);
 assert.equal(stagingAccess(null,e),200);
 for(const [key,value] of [
  ["PRODUCTION_PUBLIC_ACCESS_ENABLED","false"],
  ["PUBLIC_CUSTOMER_LAUNCH_APPROVED","false"],
  ["STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED","false"],
  ["CUSTOMER_PAID_PROVIDER_E2E_VERIFIED","false"],
  ["STRIPE_SECRET_KEY","sk_test_mismatched"],
  ["STAGING_AUTH_ENABLED","true"],
 ]){
  const wrong={...e,[key]:value};
  assert.equal(stagingEnabled(wrong),true,key+" must keep the site private");
  assert.notEqual(stagingAccess(null,wrong),200,key);
 }
 assert.equal(stagingEnabled({...e,RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041"}),true);
 assert.equal(stagingEnabled({...e,RAILWAY_ENVIRONMENT_ID:"unknown-railway"}),true);
});
