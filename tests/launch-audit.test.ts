import {test} from "node:test";
import assert from "node:assert/strict";
import {auditSingMotionLaunch} from "../lib/launch-audit.ts";

const staging="dfaeabed-03df-43ed-aa71-50f343a75041";
const production="36adc41d-7e54-4396-ad1a-fd432ba0441d";
function verified(envId:string){
 return {
  RAILWAY_ENVIRONMENT_ID:envId,CUSTOMER_R2_STORAGE_ENABLED:"true",
  R2_ACCOUNT_ID:"0".repeat(32),R2_BUCKET:"private-cloud",
  R2_ACCESS_KEY_ID:"fictional-id",R2_SECRET_ACCESS_KEY:"fictional-secret",
  CUSTOMER_CLOUD_E2E_VERIFIED:"true",
  BYTEPLUS_BILLING_AND_TAX_APPROVED:"true",
  BYTEPLUS_OUTPUT_HOSTS_APPROVED:"true",
  CUSTOMER_PAID_PROVIDER_E2E_VERIFIED:"true",
  STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED:"true",
  STRIPE_LIVE_CUSTOMER_CHECKOUT_AUDIT_ID:"example-sandbox-audit",
  STRIPE_REFUND_DISPUTE_E2E_VERIFIED:"true",
  FREE_PROMO_FULFILLMENT_E2E_VERIFIED:"true",
  LEGAL_REVIEW_APPROVED:"true",
  SUPPORT_CONTACT_VERIFIED:"support@example.invalid",
  BACKUP_RESTORE_EXERCISE_VERIFIED:"true",
  MEDIA_RETENTION_NOTICE_FLOW_VERIFIED:"true",
  COST_ALERTS_AND_KILL_SWITCH_VERIFIED:"true",
  PRODUCTION_MEDIA_MIGRATION_VERIFIED:"true",
  CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED:"true",
  PUBLIC_CUSTOMER_LAUNCH_APPROVED:"true",
  CMS_ENABLED:"true",CMS_DATABASE_URL:"postgresql://test.invalid/fake-audit",
  PAYLOAD_SECRET:"fictional-mock-only-cms-secret",
  PRODUCTION_CMS_MIGRATION_VERIFIED:"true",
  PRODUCTION_CMS_BACKUP_RESTORE_VERIFIED:"true",
  PRODUCTION_CMS_RBAC_AND_PUBLISH_E2E_VERIFIED:"true",
  CMS_PUBLISHED_CONTENT_RECONCILED:"true",
 };
}
test("modern CMS is a hard production release gate even when other human flags are green",()=>{
 const env:Record<string,string|undefined>=verified(production);
 delete env.PRODUCTION_CMS_MIGRATION_VERIFIED;
 delete env.PRODUCTION_CMS_BACKUP_RESTORE_VERIFIED;
 delete env.PRODUCTION_CMS_RBAC_AND_PUBLISH_E2E_VERIFIED;
 delete env.CMS_PUBLISHED_CONTENT_RECONCILED;
 const audit=auditSingMotionLaunch(env,"production");
 assert.equal(audit.gates.find(g=>g.id==="production-cms")?.ready,false);
 assert.equal(audit.gates.find(g=>g.id==="cms-page-retention")?.ready,false);
 env.PRODUCTION_CMS_MIGRATION_VERIFIED="true";
 env.PRODUCTION_CMS_BACKUP_RESTORE_VERIFIED="true";
 env.PRODUCTION_CMS_RBAC_AND_PUBLISH_E2E_VERIFIED="true";
 env.CMS_PUBLISHED_CONTENT_RECONCILED="true";
 const after=auditSingMotionLaunch(env,"production");
 assert.equal(after.gates.find(g=>g.id==="production-cms")?.ready,true);
 assert.equal(after.gates.find(g=>g.id==="cms-page-retention")?.ready,true);
 assert.equal(after.ready,false,"human CMS evidence never bypasses disconnected paid runtime");
 assert.ok(!JSON.stringify(after).includes(env.PAYLOAD_SECRET!));
});
test("CMS migration approval never passes for disabled CMS or missing credentials",()=>{
 const env:Record<string,string|undefined>=verified(production);
 Object.assign(env,{
  CMS_ENABLED:"false",PRODUCTION_CMS_MIGRATION_VERIFIED:"true",
  PRODUCTION_CMS_BACKUP_RESTORE_VERIFIED:"true",
  PRODUCTION_CMS_RBAC_AND_PUBLISH_E2E_VERIFIED:"true",
  CMS_PUBLISHED_CONTENT_RECONCILED:"true",
 });
 assert.equal(auditSingMotionLaunch(env,"production").gates.find(g=>g.id==="production-cms")?.ready,false);
 env.CMS_ENABLED="true";
 delete env.CMS_DATABASE_URL;
 assert.equal(auditSingMotionLaunch(env,"production").gates.find(g=>g.id==="production-cms")?.ready,false);
});
test("production launch blocks absent credentials, human signoffs and test evidence",()=>{
 const audit=auditSingMotionLaunch({RAILWAY_ENVIRONMENT_ID:production},"production");
 assert.equal(audit.ready,false);
 assert.ok(audit.gates.length>=9);
 for(const gate of audit.gates)if(gate.id!=="environment")assert.equal(gate.ready,false,gate.id);
});
test("staging approvals never authorize production and no secrets are echoed",()=>{
 const env=verified(staging);
 const audit=auditSingMotionLaunch(env,"production");
 assert.equal(audit.ready,false);
 assert.equal(audit.gates.find(g=>g.id==="environment")?.ready,false);
 const report=JSON.stringify(audit);
 assert.ok(!report.includes(env.R2_SECRET_ACCESS_KEY));
 assert.ok(!report.includes(env.R2_ACCESS_KEY_ID));
});
test("production requires separately approved R2 and verified media migration",()=>{
 const env=verified(production);
 delete (env as Record<string,string|undefined>).CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED;
 const audit=auditSingMotionLaunch(env,"production");
 assert.equal(audit.gates.find(g=>g.id==="private-r2")?.ready,false);
 assert.equal(audit.ready,false);
 env.CUSTOMER_R2_PRODUCTION_RELEASE_APPROVED="true";
 delete (env as Record<string,string|undefined>).PRODUCTION_MEDIA_MIGRATION_VERIFIED;
 assert.equal(auditSingMotionLaunch(env,"production").gates.find(g=>g.id==="production-media-migration")?.ready,false);
});
test("independent no-go states cannot be bypassed with mere Stripe credentials",()=>{
 const env:Record<string,string|undefined>=verified(production);
 delete env.BYTEPLUS_BILLING_AND_TAX_APPROVED;
 delete (env as Record<string,string|undefined>).STRIPE_ACCOUNT_LIVE_REVIEW_APPROVED;
 env.STRIPE_SECRET_KEY="sk_live_credential_never_proves_launch";
 const audit=auditSingMotionLaunch(env,"production");
 assert.equal(audit.gates.find(g=>g.id==="provider-contract")?.ready,false);
 assert.equal(audit.gates.find(g=>g.id==="stripe")?.ready,false);
});
test("synthetic green approval flags never override disconnected payment and provider runtime",()=>{
 const audit=auditSingMotionLaunch(verified(production),"production");
 assert.equal(audit.ready,false);
 assert.equal(audit.gates.find(g=>g.id==="code-runtime-readiness")?.ready,false);
 assert.ok(audit.gates.filter(g=>g.id!=="code-runtime-readiness").every(g=>g.ready));
});
test("staging operator approvals alone cannot enable public customer checkout",()=>{
 const audit=auditSingMotionLaunch(verified(staging),"staging");
 assert.equal(audit.ready,false);
 assert.equal(audit.gates.find(g=>g.id==="code-runtime-readiness")?.ready,false);
});
