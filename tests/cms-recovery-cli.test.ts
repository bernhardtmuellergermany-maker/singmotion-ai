import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("recovery CLI rejects redirected input and password arguments without exposing them", () => {
  const marker = "never-print-this-test-password-12345";
  for (const args of [[], [`--password=${marker}`]]) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/cms-recover-admin.ts", ...args],
      {
        encoding: "utf8",
        input: marker,
        env: {
          ...process.env,
          CMS_ENABLED: "true",
          CMS_RECOVERY_ENABLED: "true",
        },
        timeout: 10000,
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Recovery stopped/);
    assert.ok(!(result.stdout + result.stderr).includes(marker));
  }
});
