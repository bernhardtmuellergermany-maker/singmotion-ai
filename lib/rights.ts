import type { DatabaseSync } from "node:sqlite";
import { AppError } from "./domain.ts";
export const rightsText =
  "I own or have all necessary permissions for the music, sound recording, image and likeness, including AI processing described in the AGB / Terms.";
export function termsVersion() {
  return process.env.STUDIO_TERMS_VERSION || "staging-terms-2026-10-26";
}
export function requireRights(consent: unknown, version: unknown) {
  if (consent !== true || version !== termsVersion())
    throw new AppError(
      "Confirm your rights and the current Terms. Reload Studio if the Terms version changed.",
      400,
    );
}
export function recordRights(
  db: DatabaseSync,
  actor: string,
  project: string,
  version: string,
  context?: { session: string; content: string },
) {
  requireRights(true, version);
  db.exec(
    "CREATE TABLE IF NOT EXISTS rights_confirmations (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, project TEXT NOT NULL, confirmed_at INTEGER NOT NULL, terms_version TEXT NOT NULL, statement TEXT NOT NULL)",
  );
  db.prepare(
    "INSERT INTO rights_confirmations (actor,project,confirmed_at,terms_version,statement) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM rights_confirmations WHERE actor=? AND project=? AND terms_version=? AND statement=?)",
  ).run(
    actor,
    project,
    Date.now(),
    version,
    rightsText,
    actor,
    project,
    version,
    rightsText,
  );
  if (context) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS rights_content_confirmations (actor TEXT NOT NULL, session TEXT NOT NULL, project TEXT NOT NULL, terms_version TEXT NOT NULL, content TEXT NOT NULL, confirmed_at INTEGER NOT NULL, PRIMARY KEY(actor,session,project,terms_version,content))",
    );
    db.prepare(
      "INSERT OR IGNORE INTO rights_content_confirmations VALUES (?,?,?,?,?,?)",
    ).run(
      actor,
      context.session,
      project,
      version,
      context.content,
      Date.now(),
    );
  }
}

/** Reuse only a server-recorded confirmation for this actor, session, exact content and Terms. */
export function hasRights(
  db: DatabaseSync,
  actor: string,
  session: string,
  content: string,
) {
  if (
    !db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='rights_content_confirmations'",
      )
      .get()
  )
    return false;
  return !!db
    .prepare(
      "SELECT 1 FROM rights_content_confirmations WHERE actor=? AND session=? AND content=? AND terms_version=?",
    )
    .get(actor, session, content, termsVersion());
}
