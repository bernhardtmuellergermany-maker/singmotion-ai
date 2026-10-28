import test from "node:test";
import assert from "node:assert/strict";
import { studioStaff } from "../cms/studio-access.ts";
const env = { CMS_ENABLED: "true", CMS_ORIGIN: "https://singmotion.example", BYTEPLUS_STUDIO_ALLOWED_STAFF_IDS: "" };
const headers = new Headers({ origin: env.CMS_ORIGIN });
test("super-admin has private Studio operator access without separate ID allowlist", () => {
  assert.equal(studioStaff({ collection:"staff", role:"super-admin", id: 8 }, "POST", headers, env), "cms-staff-8");
});
test("editor still requires explicit allowlist", () => {
  assert.throws(() => studioStaff({ collection:"staff", role:"editor", id: 8 }, "POST", headers, env), /allowlisted/);
  assert.equal(studioStaff({ collection:"staff", role:"editor", id: 8 }, "POST", headers, { ...env, BYTEPLUS_STUDIO_ALLOWED_STAFF_IDS:"8" }), "cms-staff-8");
});
test("super-admin still needs authenticated staff identity and correct origin", () => {
  assert.throws(() => studioStaff({ collection:"staff", role:"super-admin", id: 8 }, "POST", new Headers({origin:"https://evil.example"}), env), /exact Origin/);
  assert.throws(() => studioStaff({ collection:"staff", role:"super-admin", id: "invalid id" }, "POST", headers, env), /identity/);
});
