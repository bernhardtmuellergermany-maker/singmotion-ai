import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

export type PromotionKind = "percent" | "free_videos";
export type Promotion = {
  code: string;
  kind: PromotionKind;
  percent: number | null;
  freeVideos: number | null;
  maxVideoSeconds: number | null;
  startsAt: number;
  endsAt: number;
  maxUses: number;
  perCustomerLimit: number;
  enabled: boolean;
  status: "active" | "scheduled" | "expired" | "disabled";
  reserved: number;
  redeemed: number;
  released: number;
  createdAt: number;
};
export type PromotionInput = {
  code?: string;
  kind: PromotionKind;
  percent?: number;
  freeVideos?: number;
  maxVideoSeconds?: number;
  startsAt: string;
  endsAt: string;
  maxUses: number;
  perCustomerLimit?: number;
};
type Row = {
 code: string; kind: PromotionKind; percent: number | null;
 free_videos: number | null; max_video_seconds: number | null;
 starts_at: number; ends_at: number; max_uses: number;
 per_customer_limit: number; enabled: number; created_at: number;
};
const codeFormat = /^[A-Z0-9](?:[A-Z0-9-]{4,38}[A-Z0-9])$/;
export function normalizePromoCode(value: string): string {
  if (typeof value !== "string") throw Error("Invalid promotion code");
  const code = value.trim().toUpperCase();
  if (!codeFormat.test(code)) throw Error("Code must contain 6–40 letters, numbers or hyphens");
  return code;
}
function positiveInteger(value: number, ceiling = 1_000_000): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling)
    throw Error("Invalid promotion limit");
  return value;
}
function readDate(value: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    throw Error("Dates must be UTC ISO timestamps");
  const date = Date.parse(value);
  if (!Number.isFinite(date) || new Date(date).toISOString() !== value)
    throw Error("Invalid date");
  return date;
}
export function calculatePromotion(
  kind: PromotionKind, percent: number | null, maxVideoSeconds: number | null,
  originalCents: number, durationSeconds: number,
) {
  if (!Number.isSafeInteger(originalCents) || originalCents < 1 || originalCents > 10_000_000)
    throw Error("Server-reviewed price required");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
    throw Error("Server-reviewed video duration required");
  if (kind === "free_videos") {
    if (!maxVideoSeconds || durationSeconds > maxVideoSeconds)
      throw Error("VIDEO_TOO_LONG_FOR_PROMO");
    return { discountCents: originalCents, finalCents: 0 };
  }
  if (kind === "percent" && percent && Number.isSafeInteger(percent) && percent >= 1 && percent <= 100) {
    const discountCents = Math.floor((originalCents * percent) / 100);
    return { discountCents, finalCents: originalCents - discountCents };
  }
  throw Error("Invalid promotion configuration");
}
/** Promotions share commerce.sqlite with orders. Checkout must call reserve inside
 * its own verified order transaction; preview never spends a promotion.
 * No route in this module can authorize payments or provider work. */
export class PromotionLedger {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        code TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('percent','free_videos')),
        percent INTEGER, free_videos INTEGER, max_video_seconds INTEGER,
        starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
        max_uses INTEGER NOT NULL, per_customer_limit INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS promo_redemptions (
        order_id TEXT PRIMARY KEY, code TEXT NOT NULL REFERENCES promo_codes(code),
        account_id TEXT NOT NULL, state TEXT NOT NULL
        CHECK(state IN ('reserved','redeemed','released')),
        original_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS promo_redemptions_by_code
        ON promo_redemptions(code,state);
      CREATE INDEX IF NOT EXISTS promo_redemptions_by_customer
        ON promo_redemptions(code,account_id,state);
    `);
  }
  private transaction<T>(work: () => T): T {
    // SAVEPOINT also works inside CommerceStore's BEGIN IMMEDIATE transaction.
    // That allows pricing, quota reservation and order creation to commit together.
    this.db.exec("SAVEPOINT promo_redemption");
    try {
      const result = work();
      this.db.exec("RELEASE SAVEPOINT promo_redemption");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK TO SAVEPOINT promo_redemption");
      this.db.exec("RELEASE SAVEPOINT promo_redemption");
      throw error;
    }
  }
  private row(code: string): Row | undefined {
    return this.db.prepare("SELECT * FROM promo_codes WHERE code=?").get(code) as Row | undefined;
  }
  private counts(code: string) {
    const rows = this.db.prepare(
      "SELECT state,COUNT(*) AS n FROM promo_redemptions WHERE code=? GROUP BY state"
    ).all(code) as {state: string; n: number}[];
    return {
      reserved: rows.find(x => x.state === "reserved")?.n || 0,
      redeemed: rows.find(x => x.state === "redeemed")?.n || 0,
      released: rows.find(x => x.state === "released")?.n || 0,
    };
  }
  private display(row: Row): Promotion {
    return {
      code: row.code, kind: row.kind, percent: row.percent,
      freeVideos: row.free_videos, maxVideoSeconds: row.max_video_seconds,
      startsAt: row.starts_at, endsAt: row.ends_at, maxUses: row.max_uses,
      perCustomerLimit: row.per_customer_limit, enabled: row.enabled === 1,
      status: !row.enabled ? "disabled" : Date.now() < row.starts_at ? "scheduled" : Date.now() >= row.ends_at ? "expired" : "active",
      ...this.counts(row.code), createdAt: row.created_at,
    };
  }
  create(input: PromotionInput, now = Date.now()): Promotion {
    if (input.kind !== "percent" && input.kind !== "free_videos")
      throw Error("Unknown promotion type");
    const code = input.code ? normalizePromoCode(input.code) :
      "SM-" + randomBytes(6).toString("hex").toUpperCase();
    const starts = readDate(input.startsAt), ends = readDate(input.endsAt);
    if (starts >= ends) throw Error("Start must be before expiration");
    const maxUses = positiveInteger(input.maxUses);
    const count = input.kind === "free_videos"
      ? positiveInteger(input.freeVideos ?? 3, 100) : null;
    const seconds = input.kind === "free_videos"
      ? positiveInteger(input.maxVideoSeconds ?? 10, 300) : null;
    const percent = input.kind === "percent"
      ? positiveInteger(input.percent ?? 0, 100) : null;
    if (input.kind === "free_videos" && (count !== 3 || seconds !== 10))
      throw Error("This release supports three free videos, max ten seconds each");
    const perCustomerLimit = positiveInteger(input.perCustomerLimit ?? (count ?? 1), 100);
    if (count && perCustomerLimit > count)
      throw Error("Per-customer free-video limit exceeds bundle size");
    this.db.prepare(`INSERT INTO promo_codes
      (code,kind,percent,free_videos,max_video_seconds,starts_at,ends_at,max_uses,per_customer_limit,enabled,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,1,?)`).run(
      code,input.kind,percent,count,seconds,starts,ends,maxUses,perCustomerLimit,now
    );
    return this.display(this.row(code)!);
  }
  list(): Promotion[] {
    return (this.db.prepare("SELECT * FROM promo_codes ORDER BY created_at DESC,code LIMIT 500").all() as Row[])
      .map(row => this.display(row));
  }
  /** Aggregated and bounded administrative audit view. Never exposes an email,
   * payment credential, private media or customer authentication token. */
  report(code: string) {
    const normalized = normalizePromoCode(code);
    const promotion = this.row(normalized);
    if(!promotion) throw Error("Promotion not found");
    const summary = this.display(promotion);
    const activity = this.db.prepare(`
      SELECT order_id,state,original_cents,discount_cents,created_at,updated_at
      FROM promo_redemptions WHERE code=?
      ORDER BY updated_at DESC,order_id DESC LIMIT 500
    `).all(normalized) as {order_id:string;state:"reserved"|"redeemed"|"released";
      original_cents:number;discount_cents:number;created_at:number;updated_at:number}[];
    const daily = this.db.prepare(`
      SELECT strftime('%Y-%m-%d',updated_at/1000,'unixepoch') AS day,
             SUM(CASE WHEN state='reserved' THEN 1 ELSE 0 END) AS reserved,
             SUM(CASE WHEN state='redeemed' THEN 1 ELSE 0 END) AS redeemed,
             SUM(CASE WHEN state='released' THEN 1 ELSE 0 END) AS released,
             SUM(CASE WHEN state='redeemed' THEN discount_cents ELSE 0 END) AS redeemed_discount_cents
      FROM promo_redemptions WHERE code=? GROUP BY day ORDER BY day DESC LIMIT 365
    `).all(normalized) as {day:string;reserved:number;redeemed:number;released:number;redeemed_discount_cents:number}[];
    const totals=this.db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN state='redeemed' THEN discount_cents ELSE 0 END),0) AS redeemed_discount_cents,
             COALESCE(SUM(CASE WHEN state IN ('redeemed','reserved') THEN discount_cents ELSE 0 END),0) AS committed_discount_cents
      FROM promo_redemptions WHERE code=?
    `).get(normalized) as {redeemed_discount_cents:number;committed_discount_cents:number};
    return {
      summary,
      activity: activity.map(a=>({orderId:a.order_id,state:a.state,
        originalCents:a.original_cents,discountCents:a.discount_cents,
        createdAt:a.created_at,updatedAt:a.updated_at})),
      daily:daily.map(d=>({day:d.day,reserved:d.reserved,redeemed:d.redeemed,
        released:d.released,redeemedDiscountCents:d.redeemed_discount_cents})),
      totals:{redeemedDiscountCents:totals.redeemed_discount_cents,
        committedDiscountCents:totals.committed_discount_cents},
      truncated:activity.length===500 || daily.length===365,
    };
  }
  setEnabled(code: string, enabled: boolean): Promotion {
    code = normalizePromoCode(code);
    const changed = this.db.prepare("UPDATE promo_codes SET enabled=? WHERE code=?")
      .run(enabled ? 1 : 0,code);
    if (changed.changes !== 1) throw Error("Promotion not found");
    return this.display(this.row(code)!);
  }
  private eligible(code: string, accountId: string, durationSeconds: number, originalCents: number, now: number) {
    const row = this.row(normalizePromoCode(code));
    if (!row || !row.enabled || now < row.starts_at || now >= row.ends_at)
      throw Error("Promotion unavailable");
    if (typeof accountId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(accountId))
      throw Error("A verified customer account is required");
    const counts = this.counts(row.code);
    if (counts.reserved + counts.redeemed >= row.max_uses)
      throw Error("Promotion use limit reached");
    const customer = this.db.prepare(`SELECT COUNT(*) AS n FROM promo_redemptions
      WHERE code=? AND account_id=? AND state IN ('reserved','redeemed')`)
      .get(row.code,accountId) as {n:number};
    if (customer.n >= row.per_customer_limit)
      throw Error("Customer promotion allowance exhausted");
    return { row, ...calculatePromotion(row.kind,row.percent,row.max_video_seconds,originalCents,durationSeconds) };
  }
  /** Advisory only. No reservation and no price authority; caller supplies a
   * previously server-reviewed quote, never an arbitrary browser price. */
  preview(code: string, accountId: string, originalCents: number, durationSeconds: number, now=Date.now()) {
    const result = this.eligible(code, accountId, durationSeconds, originalCents, now);
    return { kind:result.row.kind, percent:result.row.percent,
      freeVideos:result.row.free_videos, maxVideoSeconds:result.row.max_video_seconds,
      discountCents:result.discountCents, finalCents:result.finalCents };
  }
  /** Atomic order binding. Only trusted checkout code may call this after it
   * has persisted a matching account-owned order and immutable original quote.
   * No public endpoint exposes this method. */
  reserveForOrder(input: {code:string;orderId:string;accountId:string;
    originalCents:number;durationSeconds:number;}, now=Date.now()) {
    return this.transaction(() => {
      const previous = this.db.prepare("SELECT * FROM promo_redemptions WHERE order_id=?")
        .get(input.orderId) as {code:string;account_id:string;original_cents:number;discount_cents:number;state:string}|undefined;
      if (previous) {
        if (previous.code!==normalizePromoCode(input.code) || previous.account_id!==input.accountId ||
          previous.original_cents!==input.originalCents || previous.state==="released")
          throw Error("Promotion idempotency conflict");
        return {discountCents:previous.discount_cents,finalCents:previous.original_cents-previous.discount_cents};
      }
      const order = this.db.prepare("SELECT account_id,price_cents,status FROM customer_orders WHERE id=?")
        .get(input.orderId) as {account_id:string|null;price_cents:number;status:string}|undefined;
      if (!order || order.account_id!==input.accountId || order.status!=="awaiting_payment")
        throw Error("Awaiting-payment owned order required");
      const result = this.eligible(input.code,input.accountId,input.durationSeconds,input.originalCents,now);
      if (order.price_cents!==result.finalCents)
        throw Error("Order price must match promotion-adjusted quote");
      this.db.prepare(`INSERT INTO promo_redemptions
        (order_id,code,account_id,state,original_cents,discount_cents,created_at,updated_at)
        VALUES(?,?,?,'reserved',?,?,?,?)`).run(
        input.orderId,result.row.code,input.accountId,input.originalCents,result.discountCents,now,now
      );
      return {discountCents:result.discountCents,finalCents:result.finalCents};
    });
  }
  /** Only the verified paid-order / completed free-fulfillment path may call this. */
  settle(orderId:string, now=Date.now()) {
    return this.transaction(() => {
      const order = this.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(orderId) as {status:string}|undefined;
      if (!order || order.status!=="paid") throw Error("Verified paid order required");
      const row=this.db.prepare("SELECT state FROM promo_redemptions WHERE order_id=?")
        .get(orderId) as {state:string}|undefined;
      if (!row || row.state==="released") throw Error("Promotion reservation unavailable");
      if (row.state==="redeemed") return false;
      this.db.prepare("UPDATE promo_redemptions SET state='redeemed',updated_at=? WHERE order_id=? AND state='reserved'")
        .run(now,orderId);
      return true;
    });
  }
  /** Only before checkout starts or after verified reversal. */
  release(orderId:string, now=Date.now()) {
    return this.transaction(() => {
      const order = this.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(orderId) as {status:string}|undefined;
      if (!order || !["cancelled","refunded"].includes(order.status))
        throw Error("Promotion cannot be released without verified reversal");
      const row=this.db.prepare("SELECT state FROM promo_redemptions WHERE order_id=?")
        .get(orderId) as {state:string}|undefined;
      if (!row || row.state==="released") return false;
      this.db.prepare("UPDATE promo_redemptions SET state='released',updated_at=? WHERE order_id=?")
        .run(now,orderId);
      return true;
    });
  }
}
