import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectEnvironment } from "../scripts/doctor.mjs";

const good = {
  nodeVersion: "24.1.0",
  env: { DEMO_MODE: "true", GENERATIONS_ENABLED: "false" },
  run: () => ({ status: 0 }),
  makeDirectory: () => {},
  makeTemp: () => "/tmp/probe",
  remove: () => {},
};

test("offline doctor accepts safe local demo prerequisites", () => {
  const checks = inspectEnvironment(good);
  assert.ok(checks.every((check) => check.ok), JSON.stringify(checks));
  assert.equal(checks.length, 6);
});

test("doctor fails closed on missing tools and disabled demo API", () => {
  const checks = inspectEnvironment({
    ...good,
    nodeVersion: "22.4.0",
    env: { DEMO_MODE: "false", GENERATIONS_ENABLED: "true" },
    run: () => ({ error: new Error("ENOENT"), status: null }),
  });
  assert.equal(checks.filter((check) => !check.ok).length, 5);
});

test("production staging requires authentication, without displaying passwords", () => {
  const checks = inspectEnvironment({
    ...good,
    env: { NODE_ENV: "production", DEMO_MODE: "true", STAGING_AUTH_ENABLED: "true", STAGING_PASSWORD: "super-secret" },
  });
  assert.ok(checks.every((check) => check.ok));
  assert.doesNotMatch(JSON.stringify(checks), /super-secret/);
  const blocked = inspectEnvironment({
    ...good,
    env: { NODE_ENV: "production", DEMO_MODE: "true", STAGING_AUTH_ENABLED: "false" },
  });
  assert.equal(blocked.at(-1)?.ok, false);
});

test("storage write failure is reported and not ignored", () => {
  const checks = inspectEnvironment({
    ...good,
    makeTemp: () => { throw new Error("no space"); },
  });
  assert.equal(checks.find((check) => check.label === "Private data directory")?.ok, false);
});
