import type { DatabaseSync } from "node:sqlite";
import { AppError } from "./domain.ts";
export const rightsText =
  "I have the rights or permission to use this music and person’s likeness, including the processing described in the AGB / Terms.";
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
) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS rights_confirmations (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, project TEXT NOT NULL, confirmed_at INTEGER NOT NULL, terms_version TEXT NOT NULL, statement TEXT NOT NULL)",
  );
  db.prepare(
    "INSERT INTO rights_confirmations (actor,project,confirmed_at,terms_version,statement) VALUES (?,?,?,?,?)",
  ).run(actor, project, Date.now(), version, rightsText);
}
