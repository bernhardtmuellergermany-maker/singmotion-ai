import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stagingAccess,
  stagingEnabled,
  validateStaging,
} from "../lib/staging.ts";
const env = {
  STAGING_AUTH_ENABLED: "true",
  STAGING_PASSWORD: "test-only-password-32-characters-long",
  DEMO_MODE: "true",
  GENERATIONS_ENABLED: "false",
  ADMIN_DEMO_ENABLED: "false",
};
const basic = (value: string) =>
  `Basic ${Buffer.from(value).toString("base64")}`;
test("staging rejects missing, wrong, malformed and oversized credentials", () => {
  for (const header of [
    null,
    "",
    "Bearer test",
    "Basic !!!",
    basic("staging:wrong"),
    basic(`other:${env.STAGING_PASSWORD}`),
    "Basic " + "A".repeat(5000),
  ])
    assert.equal(stagingAccess(header, env), 401);
  assert.equal(
    stagingAccess(basic(`staging:${env.STAGING_PASSWORD}`), env),
    200,
  );
});
test("staging fails closed for unsafe flags and absent/weak password", () => {
  for (const override of [
    { STAGING_PASSWORD: "" },
    { STAGING_PASSWORD: "weak" },
    { DEMO_MODE: "false" },
    { GENERATIONS_ENABLED: "true" },
    { ADMIN_DEMO_ENABLED: "true" },
    { BYTEPLUS_LIVE_TEST_ENABLED: "true" },
  ]) {
    assert.throws(() => validateStaging({ ...env, ...override }));
    assert.equal(stagingAccess(null, { ...env, ...override }), 503);
  }
});
test("Railway always gates access; production defaults to protected", () => {
  assert.equal(
    stagingEnabled({
      RAILWAY_ENVIRONMENT_ID: "test",
      STAGING_AUTH_ENABLED: "false",
    }),
    true,
  );
  assert.equal(stagingAccess(null, { NODE_ENV: "production" }), 503);
  assert.equal(stagingAccess(null, { NODE_ENV: "development" }), 200);
});
