import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stagingAccess,
  stagingEnabled,
  validateStaging,
  issuePrivateGateTicket,
  validPrivateGateTicket,
  PRIVATE_GATE_TTL_SECONDS,
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

test("private mobile session survives missing Basic header without bypassing password checks", () => {
  const production = {...env, RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d"};
  const now = Date.UTC(2026,10,5,13,0,0);
  const ticket = issuePrivateGateTicket(production, now);
  assert.equal(validPrivateGateTicket(ticket, production, now), true);
  assert.equal(validPrivateGateTicket(ticket, production, now+(PRIVATE_GATE_TTL_SECONDS-1)*1000), true);
  assert.equal(validPrivateGateTicket(ticket, production, now+(PRIVATE_GATE_TTL_SECONDS+1)*1000), false);
  assert.equal(validPrivateGateTicket(ticket, production, now-61_000), false);
  assert.equal(validPrivateGateTicket(ticket.slice(0,-1)+(ticket.endsWith("a")?"b":"a"), production, now), false);
  assert.equal(validPrivateGateTicket(ticket, {...production,STAGING_PASSWORD:"changed-safe-password-32-characters-2026"}, now), false);
  assert.equal(validPrivateGateTicket(ticket, {...production,RAILWAY_ENVIRONMENT_ID:"dfaeabed-03df-43ed-aa71-50f343a75041"}, now), false);
  assert.equal(stagingAccess(null, production), 401);
});

test("fresh signed session works in the route-level auth check", () => {
  const production = {...env, RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d"};
  const ticket=issuePrivateGateTicket(production);
  assert.equal(stagingAccess("SingMotionSession "+ticket, production),200);
  assert.equal(stagingAccess("SingMotionSession "+ticket+"bad", production),401);
  assert.equal(stagingAccess("Bearer "+ticket, production),401);
});

test("signed preview ticket does not override unsafe Production configuration", () => {
  const prod = {...env, RAILWAY_ENVIRONMENT_ID:"36adc41d-7e54-4396-ad1a-fd432ba0441d"};
  const ticket = issuePrivateGateTicket(prod);
  const header = "SingMotionSession " + ticket;
  for (const patch of [
    { GENERATIONS_ENABLED:"true" },
    { ADMIN_DEMO_ENABLED:"true" },
    { DEMO_MODE:"false" },
    { STAGING_PASSWORD:"short" },
  ]) {
    assert.equal(stagingAccess(header, {...prod,...patch}),503);
  }
});
