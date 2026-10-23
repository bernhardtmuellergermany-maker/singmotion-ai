import { test } from "node:test";
import assert from "node:assert/strict";
import { applicationOrigin } from "../lib/request-origin.ts";
const deployed = {
  NODE_ENV: "production",
  STAGING_AUTH_ENABLED: "true",
  CMS_ENABLED: "true",
  CMS_ORIGIN: "https://stage.example.test",
};
test("Studio uses explicit public CMS origin behind HTTPS-to-HTTP proxy", () => {
  assert.equal(
    applicationOrigin(
      "http://0.0.0.0:3000/api/session",
      "stage.example.test",
      deployed,
    ),
    "https://stage.example.test",
  );
  assert.equal(
    applicationOrigin("http://0.0.0.0:3000/api/session", "evil.test", deployed),
    "https://stage.example.test",
  );
  assert.equal(
    applicationOrigin("http://internal/api/session", "evil.test", {
      ...deployed,
      APP_ORIGIN: "https://app.example.test",
    }),
    "https://app.example.test",
  );
});
test("staging fails closed without valid configured origin", () => {
  for (const value of [
    "https://stage.example.test/",
    "https://user:pass@stage.example.test",
    "http://stage.example.test",
    "not-a-url",
  ])
    assert.equal(
      applicationOrigin("http://internal/api/session", "evil.test", {
        ...deployed,
        APP_ORIGIN: value,
      }),
      null,
    );
  assert.equal(
    applicationOrigin("http://internal/api/session", "evil.test", {
      NODE_ENV: "production",
      RAILWAY_ENVIRONMENT_ID: "test",
    }),
    null,
  );
  assert.equal(
    applicationOrigin("http://internal/api/session", "evil.test", {
      ...deployed,
      CMS_ENABLED: "false",
    }),
    null,
  );
});
test("direct development and explicitly configured loopback remain supported", () => {
  assert.equal(
    applicationOrigin("http://localhost:3000/api/session", "localhost:3000", {
      STAGING_AUTH_ENABLED: "false",
    }),
    "http://localhost:3000",
  );
  assert.equal(
    applicationOrigin("http://internal/api/session", "internal", {
      APP_ORIGIN: "http://127.0.0.1:3197",
    }),
    "http://127.0.0.1:3197",
  );
});

test("Railway Studio rejects a stale APP_ORIGIN and accepts only its corrected HTTPS origin", () => {
  const origin = "https://singmotion-ai-staging.up.railway.app";
  const internal = "http://0.0.0.0:3000/api/session";
  const configured = {
    ...deployed,
    CMS_ORIGIN: origin,
    APP_ORIGIN: "http://localhost:3000",
  };
  // This produces the reported 403 even when CMS_ORIGIN is correct.
  assert.notEqual(
    applicationOrigin(internal, "internal.railway", configured),
    origin,
  );
  for (const env of [
    { ...configured, APP_ORIGIN: origin },
    { ...configured, APP_ORIGIN: "" },
  ]) {
    const expected = applicationOrigin(internal, "attacker.example", env);
    assert.equal(expected, origin);
    for (const untrusted of [
      null,
      "null",
      "https://attacker.example",
      origin + ".attacker.example",
    ])
      assert.notEqual(untrusted, expected);
  }
});
