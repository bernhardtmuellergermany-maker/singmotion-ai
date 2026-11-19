import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("privacy notice describes real private Production Credit purchases without inventing public release",()=>{
 const policy=source("components/legal-policies.tsx");
 const overview=source("components/legal-overview.tsx");
 const publicGate=source("lib/commerce/public-credit-release.ts");
 assert.doesNotMatch(policy,/Production does not accept new real-money credit purchases/);
 assert.match(policy,/password-protected Production/);
 assert.match(policy,/owner-tested/);
 assert.match(policy,/unrestricted public or worldwide/i);
 assert.match(overview,/Updated November 16, 2026/);
 assert.match(publicGate,/STAGING_AUTH_ENABLED==="false"/);
 assert.match(publicGate,/PRODUCTION_PUBLIC_ACCESS_ENABLED==="true"/);
});

test("media storage disclosure distinguishes signed URL expiry, soft delete and real purge",()=>{
 const policy=source("components/legal-policies.tsx");
 const overview=source("components/legal-overview.tsx");
 const retention=source("docs/PRIVACY_MEDIA_STORAGE_RETENTION_2026-11-16.md");
 const input=source("lib/live/input-policy.ts");
 const worker=source("scripts/worker.ts");
 const trash=source("lib/project-trash.ts");
 const cleanup=source("lib/project-trash-cleanup.ts");
 const r2=source("lib/live/r2.ts");
 assert.match(policy,/implemented link lifetime is 13 hours/);
 assert.match(policy,/Link expiry does not erase/);
 assert.match(policy,/30 days/);
 assert.match(policy,/currently disabled in Production/);
 assert.match(overview,/physical cleanup is not yet activated in Production/);
 assert.match(retention,/no external\/customer data yet/);
 assert.match(retention,/operator report/i);
 assert.match(retention,/NOT a legal compliance certificate/);
 assert.match(retention,/PROJECT_TRASH_PURGE_ENABLED=false/);
 assert.match(input,/leaseSeconds: 13 \* 60 \* 60/);
 assert.match(input,/cleanupGraceSeconds: 60 \* 60/);
 assert.match(worker,/PROJECT_TRASH_PURGE_ENABLED==="true"/);
 assert.match(trash,/PROJECT_TRASH_DAYS=30/);
 assert.match(cleanup,/deleteMirroredPrivateSource/);
 assert.match(cleanup,/Provider still active or unknown/);
 assert.match(r2,/DeleteObjectCommand/);
 assert.match(r2,/cleanupExpired\(attemptId/);
});

test("privacy promise remains truthful about unresolved processor terms and deletion evidence",()=>{
 const policy=source("components/legal-policies.tsx");
 const retention=source("docs/PRIVACY_MEDIA_STORAGE_RETENTION_2026-11-16.md");
 const account=source("app/(site)/account/settings/page.tsx");
 assert.match(policy,/contract.*review|contracts still need review/i);
 assert.match(policy,/complete production deletion and backup-expiry rehearsal is still pending/i);
 assert.match(retention,/bucket public-access setting, object lifecycle rules/i);
 assert.match(retention,/STRATO HiDrive/);
 assert.match(retention,/backup.*restore/i);
 const erasure=source("app/(site)/api/customer-account-erasure/route.ts");
 assert.match(account,/mailto:support@singmotion\.ai/);
 assert.match(policy,/without administrator approval/); // Legal disclosure stays complete; compact UI avoids repeated long explanations.
 assert.match(account,/The deletion safety check is unavailable/);
 assert.match(erasure,/verifyCustomerPassword\(id,input.password\)/);
 assert.match(erasure,/eraseEmptyCustomerAccount\(store,dataDir,id\)/);
});
