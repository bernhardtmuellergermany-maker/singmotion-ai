import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type { Asset, Artist, Job, JobStatus } from "./domain.ts";
import { AppError, canTransition } from "./domain.ts";
export const dataDir = path.resolve(process.env.DATA_DIR || ".data");
// Next imports route modules in parallel during builds. Importing this module must
// not create directories, open the runtime database or initialize its schema.
let connection: DatabaseSync | undefined;
function runtimeDatabase(): DatabaseSync {
  if (connection) return connection;
  mkdirSync(path.join(dataDir, "media"), { recursive: true, mode: 0o700 });
  const opened = new DatabaseSync(path.join(dataDir, "demo.sqlite"));
  try {
    opened.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL, admin INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS artists (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_key TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(owner,request_key));
CREATE TABLE IF NOT EXISTS ledger (id TEXT PRIMARY KEY, owner TEXT NOT NULL, job_id TEXT, kind TEXT NOT NULL, amount INTEGER NOT NULL, created INTEGER NOT NULL, UNIQUE(job_id,kind));
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, owner TEXT NOT NULL, action TEXT NOT NULL, created INTEGER NOT NULL);
`);
    connection = opened;
    return opened;
  } catch (error) {
    opened.close();
    throw error;
  }
}
// Preserve the existing API and bind native SQLite methods to their real receiver.
export const db = new Proxy({} as DatabaseSync, {
  get(_target, property) {
    const database = runtimeDatabase();
    const value = Reflect.get(database, property, database);
    return typeof value === "function" ? value.bind(database) : value;
  },
});
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function demoOnly() {
  if (process.env.DEMO_MODE === "false")
    throw new AppError(
      "Live mode is not available. No paid requests have been made.",
      503,
    );
}
export function createSession() {
  demoOnly();
  const token = randomUUID() + randomUUID(),
    owner = randomUUID();
  db.prepare("INSERT INTO sessions VALUES (?,?,?,0)").run(
    hash(token),
    owner,
    Date.now() + 30 * 86400000,
  );
  const credit = Number(process.env.DEMO_INITIAL_CREDITS_CENTS || 1250);
  if (!Number.isSafeInteger(credit) || credit < 0)
    throw new AppError("Demo credit configuration is invalid.", 503);
  db.prepare("INSERT INTO ledger VALUES (?,?,NULL,?,?,?)").run(
    randomUUID(),
    owner,
    "demo_opening",
    credit,
    Date.now(),
  );
  return { token, owner };
}
/** Called only after customer password verification. No demo or monetary credit is created. */
export function createCustomerMediaSession(accountId: string) {
  if (!/^[a-f0-9-]{36}$/.test(accountId))
    throw new AppError("Invalid account.", 403);
  const token = randomUUID() + randomUUID(),
    owner = `customer-${accountId}`;
  db.prepare("INSERT INTO sessions VALUES (?,?,?,0)").run(
    hash(token),
    owner,
    Date.now() + 86400000,
  );
  return { token, owner };
}
export function revokeMediaSession(token: string) {
  db.prepare("DELETE FROM sessions WHERE token=?").run(hash(token));
}
export function session(token?: string) {
  if (!token) return null;
  return db
    .prepare("SELECT owner,admin FROM sessions WHERE token=? AND expires>?")
    .get(hash(token), Date.now()) as
    { owner: string; admin: number } | undefined;
}
export function grantAdmin(token: string) {
  db.prepare("UPDATE sessions SET admin=1 WHERE token=?").run(hash(token));
}
export function balance(owner: string) {
  return (
    db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) AS value FROM ledger WHERE owner=?",
      )
      .get(owner) as { value: number }
  ).value;
}
export function putAsset(a: Asset) {
  db.prepare("INSERT INTO assets VALUES (?,?,?)").run(
    a.id,
    a.owner,
    JSON.stringify(a),
  );
}
export function asset(id: string, owner: string): Asset {
  const row = db
    .prepare("SELECT data FROM assets WHERE id=? AND owner=?")
    .get(id, owner) as { data: string } | undefined;
  if (!row) throw new AppError("File not found.", 404);
  return JSON.parse(row.data);
}
export function artist(id: string, owner: string): Artist {
  const row = db
    .prepare("SELECT data FROM artists WHERE id=? AND owner=?")
    .get(id, owner) as { data: string } | undefined;
  if (!row) throw new AppError("Artist not found.", 404);
  return JSON.parse(row.data);
}
export function saveArtist(a: Artist) {
  db.prepare(
    "INSERT INTO artists VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE owner=excluded.owner",
  ).run(a.id, a.owner, JSON.stringify(a));
}
export function list<T>(
  table: "artists" | "jobs" | "assets",
  owner: string,
): T[] {
  return (
    db
      .prepare(`SELECT data FROM ${table} WHERE owner=? ORDER BY rowid DESC`)
      .all(owner) as { data: string }[]
  ).map((r) => JSON.parse(r.data));
}
export function job(id: string, owner?: string): Job {
  const row = (
    owner
      ? db
          .prepare("SELECT data FROM jobs WHERE id=? AND owner=?")
          .get(id, owner)
      : db.prepare("SELECT data FROM jobs WHERE id=?").get(id)
  ) as { data: string } | undefined;
  if (!row) throw new AppError("Project not found.", 404);
  return JSON.parse(row.data);
}
export function saveJob(j: Job) {
  db.prepare("UPDATE jobs SET status=?,data=? WHERE id=? AND owner=?").run(
    j.status,
    JSON.stringify(j),
    j.id,
    j.owner,
  );
}
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const v = fn();
    db.exec("COMMIT");
    return v;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function enqueue(j: Job) {
  return transaction(() => {
    const existing = db
      .prepare("SELECT data FROM jobs WHERE owner=? AND request_key=?")
      .get(j.owner, j.requestKey) as { data: string } | undefined;
    if (existing) return JSON.parse(existing.data) as Job;
    if (balance(j.owner) < j.price)
      throw new AppError(
        "Not enough demo credits. Payments are disabled.",
        402,
      );
    const active = db
      .prepare(
        "SELECT COUNT(*) AS count FROM jobs WHERE owner=? AND status IN ('queued','processing')",
      )
      .get(j.owner) as { count: number };
    if (active.count >= 2)
      throw new AppError(
        "Please wait for your current generations to finish.",
        429,
      );
    db.prepare("INSERT INTO jobs VALUES (?,?,?,?,?)").run(
      j.id,
      j.owner,
      j.requestKey,
      j.status,
      JSON.stringify(j),
    );
    db.prepare("INSERT INTO ledger VALUES (?,?,?,?,?,?)").run(
      randomUUID(),
      j.owner,
      j.id,
      "reservation",
      -j.price,
      Date.now(),
    );
    return j;
  });
}
export function transition(
  id: string,
  next: JobStatus,
  patch: Partial<Job> = {},
) {
  return transaction(() => {
    const j = job(id);
    if (!canTransition(j.status, next))
      throw new AppError(`Cannot change ${j.status} to ${next}.`, 409);
    const updated = { ...j, ...patch, status: next, updated: Date.now() };
    saveJob(updated);
    if (next === "failed" || next === "cancelled")
      db.prepare("INSERT INTO ledger VALUES (?,?,?,?,?,?)").run(
        randomUUID(),
        j.owner,
        j.id,
        "restoration",
        j.price,
        Date.now(),
      );
    if (next === "completed")
      db.prepare("INSERT INTO ledger VALUES (?,?,?,?,?,?)").run(
        randomUUID(),
        j.owner,
        j.id,
        "capture",
        0,
        Date.now(),
      );
    return updated;
  });
}
export function limit(key: string, max: number, windowMs = 60000) {
  transaction(() => {
    const now = Date.now();
    const row = db
      .prepare("SELECT count,reset FROM rate_limits WHERE key=?")
      .get(key) as { count: number; reset: number } | undefined;
    if (row && row.reset > now && row.count >= max)
      throw new AppError("Too many requests. Please try again shortly.", 429);
    db.prepare(
      "INSERT INTO rate_limits VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,reset=excluded.reset",
    ).run(
      key,
      row && row.reset > now ? row.count + 1 : 1,
      row && row.reset > now ? row.reset : now + windowMs,
    );
  });
}
