/** Read-only discovery for #230. This is NOT a backup or a restore attestation. */
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { auditCreditLedger } from "../commerce/credit-ledger-integrity.ts";
import { CRITICAL_SQLITE_NAMES } from "./sqlite-restore-drill.ts";

export class InventoryError extends Error {}
function fail(code: string): never {
  throw new InventoryError(code);
}
const digest = () => createHash("sha256");
const item = (hash: ReturnType<typeof digest>, value: unknown) =>
  hash.update(JSON.stringify(value) + "\n");

export async function inventoryLocalSources(root: string) {
  if (!path.isAbsolute(root) || root === "/")
    fail("EXPLICIT_DATA_DIRECTORY_REQUIRED");
  const st = await lstat(root);
  if (!st.isDirectory() || st.isSymbolicLink()) fail("UNSAFE_DATA_DIRECTORY");
  const resolved = await realpath(root);
  if (resolved !== path.resolve(root)) fail("SYMLINKED_DATA_DIRECTORY");
  const hash = digest();
  let files = 0,
    bytes = 0,
    walFiles = 0,
    localMediaFiles = 0,
    cmsFiles = 0;
  const databases: {
    name: string;
    tables: number;
    rows: number;
    integrity: boolean;
    creditLedger: boolean | null;
  }[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > 64) fail("SOURCE_DEPTH_LIMIT");
    const names = (await readdir(dir)).sort();
    for (const name of names) {
      const file = path.join(dir, name),
        info = await lstat(file);
      if (info.isSymbolicLink()) fail("SOURCE_SYMLINK_REFUSED");
      if (info.isDirectory()) {
        await walk(file, depth + 1);
        continue;
      }
      if (!info.isFile() || info.nlink !== 1) fail("UNSAFE_SOURCE_FILE");
      if (++files > 1000000) fail("SOURCE_FILE_LIMIT");
      const relative = path.relative(resolved, file).split(path.sep).join("/");
      bytes += info.size;
      if (!Number.isSafeInteger(bytes)) fail("SOURCE_SIZE_LIMIT");
      item(hash, [relative, info.size, info.mtimeMs]);
      if (/-(wal|shm)$/.test(name)) walFiles++;
      if (relative.startsWith("media/")) localMediaFiles++;
      if (relative.startsWith("cms-public/")) cmsFiles++;
      const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      let sqlite = false;
      try {
        const opened = await fd.stat();
        if (opened.ino !== info.ino || opened.dev !== info.dev)
          fail("SOURCE_CHANGED_DURING_DISCOVERY");
        const header = Buffer.alloc(16);
        const result = await fd.read(header, 0, 16, 0);
        sqlite =
          result.bytesRead === 16 &&
          header.equals(Buffer.from("SQLite format 3\0"));
      } finally {
        await fd.close();
      }
      if (!sqlite) {
        if (
          CRITICAL_SQLITE_NAMES.includes(
            relative as (typeof CRITICAL_SQLITE_NAMES)[number],
          )
        )
          fail("CRITICAL_SQLITE_INVALID");
        continue;
      }
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN");
        const integrity =
          db.prepare("PRAGMA quick_check(1)").get()?.quick_check === "ok";
        const tables = db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all();
        let rows = 0;
        for (const table of tables) {
          const identifier = String(table.name).replaceAll('"', '""');
          rows += Number(
            db.prepare(`SELECT count(*) AS n FROM "${identifier}"`).get()?.n,
          );
        }
        const creditLedger =
          relative === "commerce.sqlite" ? auditCreditLedger(db).ok : null;
        // Only fixed critical names are emitted. Unexpected databases get anonymous ordinals.
        const label = CRITICAL_SQLITE_NAMES.includes(
          relative as (typeof CRITICAL_SQLITE_NAMES)[number],
        )
          ? relative
          : `additional-sqlite-${databases.length + 1}`;
        databases.push({
          name: label,
          tables: tables.length,
          rows,
          integrity,
          creditLedger,
        });
        db.exec("ROLLBACK");
        if (!integrity || creditLedger === false)
          fail("SQLITE_INTEGRITY_FAILED");
      } finally {
        db.close();
      }
    }
  }
  await walk(resolved, 0);
  for (const name of CRITICAL_SQLITE_NAMES)
    if (!databases.some((d) => d.name === name))
      fail("CRITICAL_SQLITE_MISSING");
  return {
    files,
    bytes,
    walFiles,
    localMediaFiles,
    cmsFiles,
    databases,
    metadataSha256: hash.digest("hex"),
    atomicAcrossDatabases: false,
    plaintextContentHashed: false,
  };
}

type Page = {
  Contents?: {
    Key?: string;
    Size?: number;
    ETag?: string;
    LastModified?: Date;
  }[];
  IsTruncated?: boolean;
  NextContinuationToken?: string;
};
/** Enumerates every current R2 object, without printing keys or treating ETags as SHA-256. */
export async function inventoryR2(
  list: (continuationToken?: string) => Promise<Page>,
) {
  const hash = digest(),
    tokens = new Set<string>();
  let token: string | undefined,
    previousKey: string | undefined,
    objects = 0,
    bytes = 0,
    pages = 0;
  do {
    if (++pages > 100000) fail("R2_PAGE_LIMIT");
    const page = await list(token);
    if (!Array.isArray(page.Contents) && page.Contents !== undefined)
      fail("R2_INVALID_PAGE");
    for (const entry of page.Contents || []) {
      if (
        typeof entry.Key !== "string" ||
        !entry.Key ||
        !Number.isSafeInteger(entry.Size) ||
        entry.Size! < 0 ||
        typeof entry.ETag !== "string"
      )
        fail("R2_INVALID_OBJECT");
      // S3 orders by UTF-8 bytes, not JavaScript UTF-16 lexical ordering.
      if (
        previousKey !== undefined &&
        Buffer.compare(Buffer.from(previousKey), Buffer.from(entry.Key)) >= 0
      )
        fail("R2_UNORDERED_OR_DUPLICATE_OBJECT");
      previousKey = entry.Key;
      objects++;
      bytes += entry.Size!;
      if (!Number.isSafeInteger(bytes)) fail("R2_SIZE_LIMIT");
      item(hash, [
        entry.Key,
        entry.Size,
        entry.ETag,
        entry.LastModified?.toISOString() || null,
      ]);
    }
    if (page.IsTruncated !== undefined && typeof page.IsTruncated !== "boolean")
      fail("R2_INVALID_PAGE");
    if (page.IsTruncated) {
      token = page.NextContinuationToken;
      if (typeof token !== "string" || !token || tokens.has(token))
        fail("R2_PAGINATION_STALLED");
      tokens.add(token);
    } else token = undefined;
  } while (token !== undefined);
  return {
    objects,
    bytes,
    pages,
    metadataSha256: hash.digest("hex"),
    historicalVersionsIncluded: false,
    contentSha256Verified: false,
  };
}

type PgQuery = (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;
export async function inventoryPostgres(query: PgQuery) {
  await query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await query("SET LOCAL statement_timeout = '15s'");
    const version = String(
      (await query("SHOW server_version_num")).rows[0]?.server_version_num ||
        "",
    );
    if (!/^\d{5,6}$/.test(version)) fail("PG_VERSION_UNAVAILABLE");
    const tables = (
      await query(
        "SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname, tablename",
      )
    ).rows;
    const known = new Set([
      "staff",
      "pages",
      "payload_migrations",
      "cms_assets",
      "studio_settings",
    ]);
    const cms: Record<string, number> = {};
    let rows = 0;
    for (const table of tables) {
      const quote = (v: unknown) => '"' + String(v).replaceAll('"', '""') + '"';
      const count = Number(
        (
          await query(
            `SELECT count(*) AS n FROM ${quote(table.schemaname)}.${quote(table.tablename)}`,
          )
        ).rows[0]?.n,
      );
      if (!Number.isSafeInteger(count) || count < 0) fail("PG_COUNT_INVALID");
      rows += count;
      if (table.schemaname === "public" && known.has(String(table.tablename)))
        cms[String(table.tablename)] = count;
    }
    if (cms.staff === undefined || cms.payload_migrations === undefined)
      fail("PG_CMS_SCHEMA_MISSING");
    return {
      version,
      tables: tables.length,
      rows,
      cms,
      transactionConsistent: true,
    };
  } finally {
    await query("ROLLBACK");
  }
}
