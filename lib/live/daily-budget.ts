import type { DatabaseSync } from "node:sqlite";
import type { EuroBudget } from "./studio-budget.ts";
/** Calendar date in Berlin, not a rolling 24h period (DST safe). */
export function berlinDay(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((k) => parts.find((p) => p.type === k)!.value)
    .join("-");
}
/** Called inside the existing BEGIN IMMEDIATE authorization transaction.
 * Historical USD entries are not reclassified or released at midnight.
 * The existing cumulative gate remains stricter until verified settlement exists. */
export function reserveDaily(
  db: DatabaseSync,
  id: string,
  usd: number,
  review: EuroBudget,
  now = Date.now(),
) {
  if (!Number.isSafeInteger(usd) || usd <= 0)
    throw Error("DAILY_BUDGET_INVALID");
  const eur = Number(
    (BigInt(usd) * BigInt(review.eurPerUsdUpperPpm) + 999999n) / 1000000n,
  );
  const day = berlinDay(now);
  const prior = db
    .prepare(
      "SELECT * FROM live_daily_reservations WHERE attempt_id=? AND day=?",
    )
    .get(id, day);
  if (prior) {
    if (prior.micro_usd !== usd) throw Error("DAILY_BUDGET_BINDING_CHANGED");
    return;
  }
  const used = Number(
    db
      .prepare(
        "SELECT COALESCE(SUM(micro_eur),0) AS n FROM live_daily_reservations WHERE day=?",
      )
      .get(day)!.n,
  );
  const fees = Math.max(
    review.fxFeesMaxMicroEur,
    Number(
      db
        .prepare(
          "SELECT COALESCE(MAX(fee_bound),0) AS n FROM live_daily_reservations WHERE day=?",
        )
        .get(day)!.n,
    ),
  );
  if (!Number.isSafeInteger(eur) || used + eur + fees > 50000000)
    throw Error("BERLIN_DAILY_EUR50_LIMIT");
  db.prepare("INSERT INTO live_daily_reservations VALUES (?,?,?,?,?,?,?)").run(
    id,
    day,
    usd,
    eur,
    review.fxFeesMaxMicroEur,
    JSON.stringify(review),
    now,
  );
}
export function dailyBudgetSnapshot(db: DatabaseSync, now = Date.now()) {
  const day = berlinDay(now);
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(micro_eur),0) AS reserved, COALESCE(MAX(fee_bound),0) AS fees FROM live_daily_reservations WHERE day=?",
    )
    .get(day)!;
  return {
    day,
    timeZone: "Europe/Berlin",
    limitMicroEur: 50000000,
    reservedMicroEur: Number(row.reserved),
    feeBoundMicroEur: Number(row.fees),
  };
}
