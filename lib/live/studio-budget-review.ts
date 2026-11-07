/** Studio-only renewals. Never mutates operator slots or any reservation. */
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { euroBudget, type EuroBudget } from "./studio-budget.ts";
import {
  fetchFxReference,
  planningAcknowledgment,
  planningReview,
  FxReferenceError,
} from "./fx-reference.ts";
export const studioBudgetAcknowledgment =
  "AUTHORIZE_EUR50_STUDIO_PLANNING_NOT_A_FEE_GUARANTEE";
export function studioReservedUsd(db: DatabaseSync): number {
  return Number(
    db
      .prepare(
        "SELECT COALESCE(SUM(reserved_micro_usd),0) n FROM live_attempts",
      )
      .get()!.n,
  );
}
export function latestStudioBudget(db: DatabaseSync): EuroBudget | undefined {
  if (
    !db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='live_studio_budget_reviews'",
      )
      .get()
  )
    return undefined;
  const row = db
    .prepare(
      "SELECT review_json FROM live_studio_budget_reviews ORDER BY id DESC LIMIT 1",
    )
    .get() as { review_json: string } | undefined;
  // An expired latest review must fail closed, never fall back to a stale policy.
  return row ? JSON.parse(row.review_json) : undefined;
}
function schema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS live_studio_budget_offers (
    id TEXT PRIMARY KEY, actor TEXT NOT NULL, owner TEXT NOT NULL, expires INTEGER NOT NULL,
    offer_json TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0
  ); CREATE TABLE IF NOT EXISTS live_studio_budget_reviews (
    id INTEGER PRIMARY KEY, offer_id TEXT NOT NULL UNIQUE, actor TEXT NOT NULL, owner TEXT NOT NULL,
    review_json TEXT NOT NULL, reserved_micro_usd INTEGER NOT NULL, created_at INTEGER NOT NULL
  );`);
}
export async function offerStudioBudget(
  db: DatabaseSync,
  actor: string,
  owner: string,
  usdCap: number,
  http: typeof fetch = fetch,
) {
  const reference = await fetchFxReference(http);
  const now = Date.now();
  const planning = planningReview(reference, planningAcknowledgment, now);
  const review: EuroBudget = {
    budgetBasis: planning.budgetBasis,
    eurPerUsdUpperPpm: planning.eurPerUsdUpperPpm,
    fxFeesMaxMicroEur: planning.fxFeesMaxMicroEur,
    evidence: planning.evidence,
    reviewedBy: actor,
    reviewedAt: new Date(now).toISOString(),
    validUntil: planning.validUntil,
  };
  const budget = euroBudget(review, studioReservedUsd(db), usdCap);
  const offer = {
    id: randomUUID(),
    reference,
    review,
    budget,
    configuredUsdCap: usdCap,
    expiresAt: new Date(
      Math.min(now + 600000, Date.parse(review.validUntil)),
    ).toISOString(),
  };
  schema(db);
  db.prepare(
    "INSERT INTO live_studio_budget_offers (id,actor,owner,expires,offer_json) VALUES (?,?,?,?,?)",
  ).run(
    offer.id,
    actor,
    owner,
    Date.parse(offer.expiresAt),
    JSON.stringify(offer),
  );
  return offer;
}
export function authorizeStudioBudget(
  db: DatabaseSync,
  actor: string,
  owner: string,
  usdCap: number,
  id: unknown,
  acknowledgment: unknown,
) {
  if (typeof id !== "string" || acknowledgment !== studioBudgetAcknowledgment)
    throw new FxReferenceError(
      "Explicit EUR 50 planning-assumptions confirmation is required. No generation was started.",
    );
  schema(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        "SELECT * FROM live_studio_budget_offers WHERE id=? AND actor=? AND owner=?",
      )
      .get(id, actor, owner) as
      { expires: number; used: number; offer_json: string } | undefined;
    if (!row || row.used || row.expires <= Date.now())
      throw new FxReferenceError(
        "Budget review is expired, already used or not yours. Load a fresh exchange-rate review.",
      );
    const offer = JSON.parse(row.offer_json) as Awaited<
      ReturnType<typeof offerStudioBudget>
    >;
    const reserved = studioReservedUsd(db);
    if (
      reserved !== offer.budget.reservedMicroUsd ||
      usdCap !== offer.configuredUsdCap
    )
      throw new FxReferenceError(
        "Reservations or the server USD cap changed. Review the current budget again; nothing was reset.",
      );
    const budget = euroBudget(offer.review, reserved, usdCap);
    db.prepare(
      "INSERT INTO live_studio_budget_reviews (offer_id,actor,owner,review_json,reserved_micro_usd,created_at) VALUES (?,?,?,?,?,?)",
    ).run(id, actor, owner, JSON.stringify(offer.review), reserved, Date.now());
    db.prepare("UPDATE live_studio_budget_offers SET used=1 WHERE id=?").run(
      id,
    );
    db.exec("COMMIT");
    return { budget, validUntil: offer.review.validUntil };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
