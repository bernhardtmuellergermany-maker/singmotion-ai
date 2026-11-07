import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
const moduleUrl = new URL("../lib/db.ts", import.meta.url).href;
function child(directory: string, code: string) {
  execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    env: { ...process.env, DATA_DIR: directory },
    timeout: 10000,
    stdio: "pipe",
  });
}
test("build-time imports neither create storage nor open a locked runtime SQLite file", () => {
  const root = mkdtempSync(path.join(tmpdir(), "sm-db-import-"));
  try {
    const absent = path.join(root, "absent");
    child(absent, `await import(${JSON.stringify(moduleUrl)});`);
    assert.equal(existsSync(absent), false);
    const locked = new DatabaseSync(path.join(root, "demo.sqlite"));
    try {
      locked.exec(
        "CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES ('keep'); BEGIN EXCLUSIVE;",
      );
      child(root, `await import(${JSON.stringify(moduleUrl)});`);
      assert.equal(existsSync(path.join(root, "media")), false);
      locked.exec("ROLLBACK");
      assert.equal(
        locked.prepare("SELECT value FROM preserved").get()!.value,
        "keep",
      );
    } finally {
      locked.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("first runtime access initializes once, preserves existing data and uses WAL with a busy timeout", () => {
  const root = mkdtempSync(path.join(tmpdir(), "sm-db-runtime-"));
  try {
    const existing = new DatabaseSync(path.join(root, "demo.sqlite"));
    existing.exec(
      "CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES ('keep');",
    );
    existing.close();
    child(
      root,
      `
      import assert from 'node:assert/strict';
      const { db } = await import(${JSON.stringify(moduleUrl)});
      assert.equal(db.prepare('SELECT value FROM preserved').get().value, 'keep');
      assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
      assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000);
      db.prepare("INSERT INTO audit VALUES ('test','owner','test',0)").run();
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit').get().n, 1);
      db.close();
    `,
    );
    assert.equal(existsSync(path.join(root, "media")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
