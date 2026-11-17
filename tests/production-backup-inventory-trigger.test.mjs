import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  privateInventoryConfig,
  runProductionInventoryOnce,
} from "../lib/ops/production-backup-inventory-trigger.mjs";

const now = Date.parse("2026-11-17T07:00:00Z");
const fixture = () => ({
  RAILWAY_ENVIRONMENT_ID: "36adc41d-7e54-4396-ad1a-fd432ba0441d",
  RAILWAY_SERVICE_NAME: "singmotion-ai",
  DATA_DIR: "/app/.data",
  CMS_DATABASE_URL: "postgres://secret:password@postgres/db",
  R2_ACCOUNT_ID: "account",
  R2_BUCKET: "private",
  R2_ACCESS_KEY_ID: "r2-secret",
  R2_SECRET_ACCESS_KEY: "r2-private",
  STRIPE_SECRET_KEY: "not-for-backup",
  BYTEPLUS_SECRET_ACCESS_KEY: "not-for-backup",
  SUPER_ADMIN_PASSWORD: "not-for-backup",
  PRODUCTION_BACKUP_INVENTORY_EXPIRES_AT: new Date(now + 300_000).toISOString(),
});
const report = {
  ok: true, backupVerified: false, restoreVerified: false,
  local: {
    files: 60, bytes: 45000,
    databases: [
      { name: "commerce.sqlite", integrity: true, creditLedger: true },
      { name: "demo.sqlite", integrity: true, creditLedger: null },
      { name: "live-test.sqlite", integrity: true, creditLedger: null },
    ],
  },
  postgres: { tables: 20, rows: 35 },
  r2: { objects: 1203, bytes: 72000, pages: 2, twoPassStable: true },
};

test("disabled by default; valid activation copies only source credentials into child", () => {
  const disabled = fixture();
  delete disabled.PRODUCTION_BACKUP_INVENTORY_EXPIRES_AT;
  assert.equal(privateInventoryConfig(disabled, now), null);
  const config = privateInventoryConfig(fixture(), now);
  assert.equal(config.deadline, now + 300_000);
  for (const key of ["STRIPE_SECRET_KEY", "BYTEPLUS_SECRET_ACCESS_KEY", "SUPER_ADMIN_PASSWORD", "PRODUCTION_BACKUP_INVENTORY_EXPIRES_AT"]) {
    assert.equal(config.env[key], undefined);
  }
  assert.equal(config.env.DATA_DIR, "/app/.data");
  assert.equal(config.env.R2_SECRET_ACCESS_KEY, "r2-private");
});

test("wrong runtime, source credentials, invalid and unbounded dates fail closed", () => {
  const changes = [
    { RAILWAY_SERVICE_NAME: "singmotion-backup" },
    { RAILWAY_ENVIRONMENT_ID: "staging" },
    { R2_SECRET_ACCESS_KEY: undefined },
    { PRODUCTION_BACKUP_INVENTORY_EXPIRES_AT: "tomorrow" },
    { PRODUCTION_BACKUP_INVENTORY_EXPIRES_AT: new Date(now - 10).toISOString() },
    { PRODUCTION_BACKUP_INVENTORY_EXPIRES_AT: new Date(now + 60 * 60_000).toISOString() },
  ];
  for (const change of changes) {
    assert.throws(() => privateInventoryConfig({ ...fixture(), ...change }, now), /INVENTORY_ACTIVATION_/);
  }
});

function fakeChild(output, code = 0) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  queueMicrotask(() => {
    child.stdout.end(output);
    child.stderr.end();
    queueMicrotask(() => child.emit("close", code));
  });
  return child;
}

test("isolated process only executes fixed inventory script and emits safe counts", async (t) => {
  if (process.getuid?.() === 0) return t.skip("runner is root; guard requires non-root");
  const calls = [], logs = [], warnings = [];
  const result = await runProductionInventoryOnce(fixture(), {
    now: () => now,
    spawn: (...args) => {
      calls.push(args);
      return fakeChild("BACKUP_SOURCE_INVENTORY " + JSON.stringify(report) + "\n");
    },
    log: (...args) => logs.push(args),
    warn: (...args) => warnings.push(args),
    nodePath: "/test/node",
    cwd: "/app",
  });
  assert.equal(result.status, "success");
  assert.deepEqual(calls[0][1], [
    "--experimental-strip-types",
    "scripts/backup-source-inventory.ts",
    "--read-only-no-transfer",
  ]);
  assert.equal(calls[0][2].timeout, 120_000);
  assert.equal(calls[0][2].cwd, "/app");
  assert.deepEqual(Object.keys(calls[0][2].env).sort(), [
    "CMS_DATABASE_URL", "DATA_DIR", "R2_ACCESS_KEY_ID", "R2_ACCOUNT_ID", "R2_BUCKET",
    "R2_SECRET_ACCESS_KEY", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_SERVICE_NAME",
  ].sort());
  assert.equal(result.summary.r2Objects, 1203);
  assert.equal(logs.length, 1);
  assert.deepEqual(warnings, []);
  assert.ok(!JSON.stringify(logs).includes("password"));
  assert.ok(!JSON.stringify(logs).includes("r2-private"));
});

test("bad, partial and sensitive output fails closed without logging source lines", async (t) => {
  if (process.getuid?.() === 0) return t.skip("runner is root; guard requires non-root");
  for (const output of ["sensitive-private-data", "BACKUP_SOURCE_INVENTORY " + JSON.stringify({ ...report, r2: { ...report.r2, twoPassStable: false } }), "BACKUP_SOURCE_INVENTORY " + JSON.stringify({ ...report, local: { ...report.local, databases: [{ integrity: false }] } })]) {
    const logs = [], warns = [];
    const result = await runProductionInventoryOnce(fixture(), {
      now: () => now,
      spawn: () => fakeChild(output + "\n"),
      log: (...x) => logs.push(x), warn: (...x) => warns.push(x),
    });
    assert.equal(result.status, "failed");
    assert.equal(logs.length, 0);
    assert.deepEqual(warns, [["PRODUCTION_BACKUP_INVENTORY_FAILED"]]);
  }
});
