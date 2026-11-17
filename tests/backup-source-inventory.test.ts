import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { CreditWallet } from "../lib/commerce/credit-wallet.ts";
import {
  inventoryLocalSources,
  inventoryR2,
  inventoryPostgres,
} from "../lib/ops/backup-source-inventory.ts";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "sm-inventory-"));
  const commerce = new DatabaseSync(path.join(root, "commerce.sqlite"));
  commerce.exec("PRAGMA journal_mode=WAL");
  new CreditWallet(commerce);
  for (const name of ["demo.sqlite", "live-test.sqlite", "unexpected.store"]) {
    const db = new DatabaseSync(path.join(root, name));
    db.exec(
      "CREATE TABLE fixture (secret TEXT); INSERT INTO fixture VALUES ('customer-private@example.invalid')",
    );
    db.close();
  }
  await mkdir(path.join(root, "cms-public"));
  await writeFile(
    path.join(root, "cms-public", "private-customer.jpg"),
    "fixture",
  );
  return {
    root,
    commerce,
    async close() {
      commerce.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
test("discovers extra SQLite by header, includes WAL and CMS files, reports no PII or source paths", async () => {
  const f = await fixture();
  try {
    const before = f.commerce.prepare("PRAGMA data_version").get();
    const report = await inventoryLocalSources(f.root);
    assert.equal(report.databases.length, 4);
    assert.equal(
      report.databases.find((d) => d.name === "commerce.sqlite")?.creditLedger,
      true,
    );
    assert.equal(report.cmsFiles, 1);
    assert.ok(report.walFiles >= 1);
    assert.doesNotMatch(
      JSON.stringify(report),
      /private-customer|customer-private|unexpected.store|sm-inventory/,
    );
    assert.deepEqual(f.commerce.prepare("PRAGMA data_version").get(), before);
    assert.equal(report.atomicAcrossDatabases, false);
  } finally {
    await f.close();
  }
});
test("source symlinks and missing critical databases fail closed", async () => {
  const f = await fixture();
  try {
    await symlink(path.join(f.root, "cms-public"), path.join(f.root, "alias"));
    await assert.rejects(
      inventoryLocalSources(f.root),
      /SOURCE_SYMLINK_REFUSED/,
    );
    await rm(path.join(f.root, "alias"));
    await rm(path.join(f.root, "demo.sqlite"));
    await assert.rejects(
      inventoryLocalSources(f.root),
      /CRITICAL_SQLITE_MISSING/,
    );
  } finally {
    await f.close();
  }
});
test("invalid critical database is never silently counted as an ordinary file", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, "demo.sqlite"), "not a database");
    await assert.rejects(
      inventoryLocalSources(f.root),
      /CRITICAL_SQLITE_INVALID/,
    );
  } finally {
    await f.close();
  }
});
test("R2 inventories all pages including more than 1000 keys and zero-byte objects", async () => {
  const calls: (string | undefined)[] = [];
  const report = await inventoryR2(async (token) => {
    calls.push(token);
    return token
      ? { Contents: [{ Key: "z-private", Size: 0, ETag: '"multipart-2"' }] }
      : {
          Contents: Array.from({ length: 1000 }, (_, i) => ({
            Key: `a${String(i).padStart(4, "0")}`,
            Size: 2,
            ETag: '"etag"',
          })),
          IsTruncated: true,
          NextContinuationToken: "private-token",
        };
  });
  assert.deepEqual(calls, [undefined, "private-token"]);
  assert.equal(report.objects, 1001);
  assert.equal(report.bytes, 2000);
  assert.equal(report.pages, 2);
  assert.equal(report.contentSha256Verified, false);
  assert.doesNotMatch(
    JSON.stringify(report),
    /z-private|private-token|multipart/,
  );
});
test("R2 missing/repeated pagination tokens and duplicate objects refuse incomplete inventory", async () => {
  await assert.rejects(
    inventoryR2(async () => ({ IsTruncated: true })),
    /PAGINATION_STALLED/,
  );
  await assert.rejects(
    inventoryR2(async () => ({
      IsTruncated: true,
      NextContinuationToken: "same",
    })),
    /PAGINATION_STALLED/,
  );
  await assert.rejects(
    inventoryR2(async () => ({
      Contents: [
        { Key: "a", Size: 1, ETag: "e" },
        { Key: "a", Size: 1, ETag: "e" },
      ],
    })),
    /DUPLICATE/,
  );
  await assert.rejects(
    inventoryR2(async () => ({
      Contents: [{ Key: "a", Size: -1, ETag: "e" }],
    })),
    /INVALID_OBJECT/,
  );
});
test("R2 digest changes when object metadata changes, never claims content verification", async () => {
  const a = await inventoryR2(async () => ({
    Contents: [{ Key: "a", Size: 1, ETag: "first" }],
  }));
  const b = await inventoryR2(async () => ({
    Contents: [{ Key: "a", Size: 1, ETag: "second" }],
  }));
  assert.notEqual(a.metadataSha256, b.metadataSha256);
  assert.equal(a.historicalVersionsIncluded, false);
});
test("Postgres uses one read-only repeatable-read transaction and rolls back", async () => {
  const sqls: string[] = [];
  const result = await inventoryPostgres(async (sql) => {
    sqls.push(sql);
    if (sql.startsWith("SHOW"))
      return { rows: [{ server_version_num: "180000" }] };
    if (sql.startsWith("SELECT schemaname"))
      return {
        rows: [
          { schemaname: "public", tablename: "staff" },
          { schemaname: "public", tablename: "payload_migrations" },
          { schemaname: "public", tablename: 'odd"table' },
        ],
      };
    if (sql.startsWith("SELECT count")) return { rows: [{ n: "2" }] };
    return { rows: [] };
  });
  assert.match(sqls[0], /REPEATABLE READ READ ONLY/);
  assert.equal(sqls.at(-1), "ROLLBACK");
  assert.ok(sqls.includes('SELECT count(*) AS n FROM "public"."odd""table"'));
  assert.equal(result.rows, 6);
  assert.equal(result.cms.staff, 2);
  assert.doesNotMatch(JSON.stringify(result), /odd/);
});
test("Postgres failure rolls back and does not silently skip inaccessible tables", async () => {
  const sqls: string[] = [];
  await assert.rejects(
    inventoryPostgres(async (sql) => {
      sqls.push(sql);
      if (sql.startsWith("SHOW")) throw Error("fixture-denied");
      return { rows: [] };
    }),
    /fixture-denied/,
  );
  assert.equal(sqls.at(-1), "ROLLBACK");
});
