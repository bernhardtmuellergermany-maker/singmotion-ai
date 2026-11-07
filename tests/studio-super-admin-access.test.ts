import test from "node:test";
import assert from "node:assert/strict";
import { studioStaff } from "../cms/studio-access.ts";
const env = { CMS_ENABLED: "true", CMS_ORIGIN: "https://singmotion.example", BYTEPLUS_STUDIO_ALLOWED_STAFF_IDS: "" };
const headers = new Headers({ origin: env.CMS_ORIGIN });
test("super-admin must also be explicitly allowlisted before paid Studio operations", () => {
  assert.throws(() => studioStaff({ collection:"staff", role:"super-admin", id: 8 }, "POST", headers, env), /allowlisted/);
  assert.equal(studioStaff({ collection:"staff", role:"super-admin", id: 8 }, "POST", headers,
    { ...env, BYTEPLUS_STUDIO_ALLOWED_STAFF_IDS:"8" }), "cms-staff-8");
});
test("editor still requires explicit allowlist", () => {
  assert.throws(() => studioStaff({ collection:"staff", role:"editor", id: 8 }, "POST", headers, env), /allowlisted/);
  assert.equal(studioStaff({ collection:"staff", role:"editor", id: 8 }, "POST", headers, { ...env, BYTEPLUS_STUDIO_ALLOWED_STAFF_IDS:"8" }), "cms-staff-8");
});
test("super-admin still needs authenticated staff identity and correct origin", () => {
  assert.throws(() => studioStaff({ collection:"staff", role:"super-admin", id: 8 }, "POST", new Headers({origin:"https://evil.example"}), env), /exact Origin/);
  assert.throws(() => studioStaff({ collection:"staff", role:"super-admin", id: "invalid id" }, "POST", headers, env), /identity/);
});

test("private Production super-admin may enter Studio without a Stripe receipt or allowlist", () => {
 const production = {
  ...env,
  RAILWAY_ENVIRONMENT_ID: "36adc41d-7e54-4396-ad1a-fd432ba0441d",
  SUPER_ADMIN_PRIVATE_GENERATION_ENABLED: "true",
  STAGING_AUTH_ENABLED: "true",
  PRODUCTION_PUBLIC_ACCESS_ENABLED: "false",
 };
 assert.equal(studioStaff({ collection:"staff", role:"super-admin", id:8 }, "POST", headers, production), "cms-staff-8");
 for (const field of ["SUPER_ADMIN_PRIVATE_GENERATION_ENABLED","STAGING_AUTH_ENABLED"]) {
  assert.throws(() => studioStaff({ collection:"staff", role:"super-admin", id:8 }, "POST", headers, {...production,[field]:"false"}), /allowlisted/);
 }
 assert.throws(() => studioStaff({ collection:"staff", role:"super-admin", id:8 }, "POST", headers, {...production,PRODUCTION_PUBLIC_ACCESS_ENABLED:"true"}), /allowlisted/);
 assert.throws(() => studioStaff({ collection:"staff", role:"editor", id:8 }, "POST", headers, production), /allowlisted/);
 assert.throws(() => studioStaff({ collection:"customer", role:"super-admin", id:8 }, "POST", headers, production), /authenticated/i);
 assert.throws(() => studioStaff({ collection:"staff", role:"super-admin", id:8 }, "POST", new Headers({origin:"https://untrusted.example"}), production), /exact Origin/);
 assert.throws(() => studioStaff({ collection:"staff", role:"super-admin", id:8 }, "POST", headers, {...production,RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041"}), /allowlisted/);
});
