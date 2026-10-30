/** Server-only payment/account groundwork. No production adapter or automatic provider dispatch. */
import { DatabaseSync } from "node:sqlite";
import type { PreparedMedia } from "../live/store.ts";
import { reviewedVideoInputDigest, reviewedVideoQuoteDigest } from "./reviewed-video.ts";
import {
  randomBytes,
  randomUUID,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const amount = (n: number) => {
  if (!Number.isSafeInteger(n) || n <= 0 || n > 10000000)
    throw Error("Invalid monetary amount");
  return n;
};
export interface VerifiedPayment {
  eventId: string;
  provider: string;
  orderId: string;
  cents: number;
  currency: "EUR";
  evidence: string;
}
/** Adapter must verify the ORIGINAL webhook signature before returning this receipt.
 * No HTTP endpoint accepts a receipt object from an untrusted browser. */
export interface PaymentAdapter {
  verify(raw: Uint8Array, signature: string): Promise<VerifiedPayment>;
}
export class CommerceStore {
  readonly db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS customer_accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_orders(id TEXT PRIMARY KEY,account_id TEXT,guest_hash TEXT,guest_expiry INTEGER,email TEXT NOT NULL,project_id TEXT NOT NULL,price_cents INTEGER NOT NULL,currency TEXT NOT NULL,status TEXT NOT NULL,quote_evidence TEXT NOT NULL,request_key TEXT UNIQUE NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_credits(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,delta INTEGER NOT NULL,kind TEXT NOT NULL,evidence TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_holds(order_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,cents INTEGER NOT NULL,state TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS payment_events(event_key TEXT PRIMARY KEY,receipt_hash TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS stripe_checkout_sessions(order_id TEXT PRIMARY KEY,session_id TEXT UNIQUE NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_fulfillment_queue(order_id TEXT PRIMARY KEY,state TEXT NOT NULL CHECK(state IN ('pending','processing','delivered','failed')),created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_provider_jobs(order_id TEXT PRIMARY KEY,provider TEXT NOT NULL,job_id TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(provider,job_id));
 CREATE TABLE IF NOT EXISTS customer_video_deliveries(order_id TEXT PRIMARY KEY,asset_id TEXT UNIQUE NOT NULL,evidence_hash TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_order_inputs(order_id TEXT PRIMARY KEY,input_digest TEXT NOT NULL,review_digest TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_provider_submissions(order_id TEXT PRIMARY KEY,provider TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('submitted_or_unknown','acknowledged')),created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS commerce_audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,record TEXT NOT NULL,created INTEGER NOT NULL);`);
  }
  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  private audit(actor: string, action: string, record: string) {
    this.db
      .prepare(
        "INSERT INTO commerce_audit(actor,action,record,created) VALUES(?,?,?,?)",
      )
      .run(actor, action, record, Date.now());
  }
  register(email: string, password: string) {
    email = email.trim().toLowerCase();
    if (
      !/^[^\s@]{1,100}@[^\s@]{1,150}\.[^\s@]{2,30}$/.test(email) ||
      password.length < 20 ||
      password.length > 256
    )
      throw Error("Valid email and a password of 20–256 characters required");
    const salt = randomBytes(16).toString("hex"),
      id = randomUUID(),
      digest = scryptSync(password, salt, 64).toString("hex");
    this.db
      .prepare("INSERT INTO customer_accounts VALUES(?,?,?,?)")
      .run(id, email, `${salt}:${digest}`, Date.now());
    return id;
  }
  login(email: string, password: string) {
    if (password.length > 256) throw Error("Invalid credentials");
    const row = this.db
      .prepare("SELECT * FROM customer_accounts WHERE email=?")
      .get(email.trim().toLowerCase());
    const [salt, digest] = String(
      row?.password_hash || `${"0".repeat(32)}:${"0".repeat(128)}`,
    ).split(":");
    const valid = timingSafeEqual(
      scryptSync(password, salt, 64),
      Buffer.from(digest, "hex"),
    );
    if (!row || !valid) throw Error("Invalid credentials");
    const token = randomBytes(32).toString("base64url");
    this.db
      .prepare("INSERT INTO customer_sessions VALUES(?,?,?)")
      .run(hash(token), row.id, Date.now() + 86400000);
    return token;
  }
  session(token: string, now = Date.now()) {
    const s = this.db
      .prepare(
        "SELECT account_id FROM customer_sessions WHERE token_hash=? AND expires>?",
      )
      .get(hash(token), now);
    return s ? String(s.account_id) : null;
  }
  logout(token: string) {
    this.db
      .prepare("DELETE FROM customer_sessions WHERE token_hash=?")
      .run(hash(token));
  }
  balance(account: string) {
    return (
      Number(
        this.db
          .prepare(
            "SELECT COALESCE(SUM(delta),0) AS n FROM customer_credits WHERE account_id=?",
          )
          .get(account)!.n,
      ) -
      Number(
        this.db
          .prepare(
            "SELECT COALESCE(SUM(cents),0) AS n FROM customer_holds WHERE account_id=? AND state='reserved'",
          )
          .get(account)!.n,
      )
    );
  }
  /** Only a protected operator action may call this method. Deliberately no public endpoint. */
  grant(
    account: string,
    cents: number,
    actor: { id: string; role: string },
    evidence: string,
    key: string,
  ) {
    if (
      actor.role !== "super-admin" ||
      !actor.id ||
      evidence.trim().length < 20
    )
      throw Error("Protected operator evidence required");
    amount(cents);
    return this.tx(() => {
      const prior = this.db
        .prepare("SELECT * FROM customer_credits WHERE id=?")
        .get(key);
      if (prior) {
        if (prior.account_id !== account || prior.delta !== cents)
          throw Error("Idempotency conflict");
        return;
      }
      if (
        !this.db
          .prepare("SELECT 1 FROM customer_accounts WHERE id=?")
          .get(account)
      )
        throw Error("Account unavailable");
      this.db
        .prepare("INSERT INTO customer_credits VALUES(?,?,?,?,?,?)")
        .run(key, account, cents, "operator-grant", evidence, Date.now());
      this.audit(actor.id, "credit-grant", key);
    });
  }
  /** Server-reviewed inclusive SALES price, never a BytePlus estimate or browser price. */
  order(input: {
    account: string | null;
    email: string;
    project: string;
    cents: number;
    quoteEvidence: string;
    key: string;
  }) {
    amount(input.cents);
    if (input.quoteEvidence.trim().length < 20 || !input.project || !input.key)
      throw Error("Reviewed inclusive sale quote required");
    return this.tx(() => {
      const old = this.db
        .prepare("SELECT * FROM customer_orders WHERE request_key=?")
        .get(input.key);
      if (old) {
        if (
          old.account_id !== input.account ||
          old.project_id !== input.project ||
          old.price_cents !== input.cents
        )
          throw Error("Idempotency conflict");
        return { id: String(old.id), guestToken: null };
      }
      const id = randomUUID(),
        token = input.account ? null : randomBytes(32).toString("base64url");
      this.db
        .prepare("INSERT INTO customer_orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          id,
          input.account,
          token ? hash(token) : null,
          token ? Date.now() + 86400000 : null,
          input.email,
          input.project,
          input.cents,
          "EUR",
          "awaiting_payment",
          input.quoteEvidence,
          input.key,
          Date.now(),
        );
      return { id, guestToken: token };
    });
  }
  ownedOrder(id: string, account: string | null, guestToken?: string) {
    const o = this.db
      .prepare("SELECT * FROM customer_orders WHERE id=?")
      .get(id);
    if (
      !o ||
      !(
        (account && o.account_id === account) ||
        (!o.account_id &&
          guestToken &&
          o.guest_hash === hash(guestToken) &&
          Number(o.guest_expiry) > Date.now())
      )
    )
      throw Error("Order unavailable");
    return o;
  }
  reserveCredit(id: string, account: string) {
    return this.tx(() => {
      const o = this.ownedOrder(id, account);
      const hold = this.db
        .prepare("SELECT * FROM customer_holds WHERE order_id=?")
        .get(id);
      if (hold) return;
      if (
        o.status !== "awaiting_payment" ||
        this.balance(account) < Number(o.price_cents)
      )
        throw Error("Insufficient credit or order unavailable");
      this.db
        .prepare("INSERT INTO customer_holds VALUES(?,?,?,'reserved')")
        .run(id, account, o.price_cents);
      this.db
        .prepare(
          "UPDATE customer_orders SET status='funds_reserved' WHERE id=?",
        )
        .run(id);
      this.audit(account, "credit-reserved", id);
    });
  }
  captureCredit(id: string, account: string) {
    return this.tx(() => {
      const o = this.ownedOrder(id, account),
        h = this.db
          .prepare("SELECT * FROM customer_holds WHERE order_id=?")
          .get(id);
      if (h?.state === "captured") return;
      if (o.status !== "funds_reserved" || h?.state !== "reserved")
        throw Error("No reserved funds");
      this.db
        .prepare("INSERT INTO customer_credits VALUES(?,?,?,?,?,?)")
        .run(
          `capture:${id}`,
          account,
          -Number(h.cents),
          "order",
          id,
          Date.now(),
        );
      this.db
        .prepare("UPDATE customer_holds SET state='captured' WHERE order_id=?")
        .run(id);
      this.db
        .prepare("UPDATE customer_orders SET status='paid' WHERE id=?")
        .run(id);
    });
  }
  /** Explicit protected reconciliation, never an automatic reaction to provider failure. */
  refundCredit(
    id: string,
    actor: { id: string; role: string },
    evidence: string,
  ) {
    if (
      actor.role !== "super-admin" ||
      !actor.id ||
      evidence.trim().length < 20
    )
      throw Error("Protected refund evidence required");
    return this.tx(() => {
      const hold = this.db
        .prepare("SELECT * FROM customer_holds WHERE order_id=?")
        .get(id);
      if (!hold)
        throw Error(
          "No credit reservation; external payment needs provider reconciliation",
        );
      if (hold.state === "released") return;
      if (hold.state === "captured")
        this.db
          .prepare("INSERT INTO customer_credits VALUES(?,?,?,?,?,?)")
          .run(
            `refund:${id}`,
            hold.account_id,
            hold.cents,
            "verified-refund",
            evidence,
            Date.now(),
          );
      else if (hold.state !== "reserved")
        throw Error("Refund state unavailable");
      this.db
        .prepare("UPDATE customer_holds SET state='released' WHERE order_id=?")
        .run(id);
      this.db
        .prepare("UPDATE customer_orders SET status='refunded' WHERE id=?")
        .run(id);
      this.audit(actor.id, "credit-refund", id);
    });
  }
  /** Bind the exact Stripe-created Checkout Session before accepting any payment. */
  bindStripeCheckout(orderId: string, sessionId: string) {
    if (!/^cs_test_[A-Za-z0-9_]+$/.test(sessionId))
      throw Error("Invalid Stripe sandbox Checkout Session");
    return this.tx(() => {
      const order = this.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(orderId);
      if (!order || order.status !== "awaiting_payment")
        throw Error("Checkout order is not awaiting payment");
      const prior = this.db.prepare("SELECT session_id FROM stripe_checkout_sessions WHERE order_id=?").get(orderId);
      if (prior) {
        if (prior.session_id !== sessionId) throw Error("Checkout Session conflict");
        return;
      }
      this.db.prepare("INSERT INTO stripe_checkout_sessions VALUES(?,?,?)")
        .run(orderId, sessionId, Date.now());
    });
  }
  async webhook(raw: Uint8Array, signature: string, adapter: PaymentAdapter) {
    const receipt = await adapter.verify(raw, signature);
    amount(receipt.cents);
    if (
      receipt.currency !== "EUR" ||
      !receipt.eventId ||
      !receipt.provider ||
      !receipt.evidence
    )
      throw Error("Invalid verified receipt");
    return this.tx(() => {
      const key = `${receipt.provider}:${receipt.eventId}`,
        digest = hash(JSON.stringify(receipt));
      const prior = this.db
        .prepare("SELECT receipt_hash FROM payment_events WHERE event_key=?")
        .get(key);
      if (prior) {
        if (prior.receipt_hash !== digest)
          throw Error("Conflicting payment event");
        return;
      }
      if (receipt.provider === "stripe") {
        const checkout = this.db.prepare("SELECT session_id FROM stripe_checkout_sessions WHERE order_id=?").get(receipt.orderId);
        if (!checkout || checkout.session_id !== receipt.evidence)
          throw Error("Stripe Checkout Session does not match order");
      }
      const o = this.db
        .prepare("SELECT * FROM customer_orders WHERE id=?")
        .get(receipt.orderId);
      if (
        !o ||
        o.price_cents !== receipt.cents ||
        o.currency !== receipt.currency ||
        o.status !== "awaiting_payment"
      )
        throw Error("Payment requires reconciliation");
      this.db
        .prepare("INSERT INTO payment_events VALUES(?,?,?)")
        .run(key, digest, Date.now());
      this.db
        .prepare("UPDATE customer_orders SET status='paid' WHERE id=?")
        .run(receipt.orderId);
      // Enqueue atomically with payment reconciliation. No provider call is made here.
      this.db.prepare("INSERT INTO customer_fulfillment_queue(order_id,state,created) VALUES(?,'pending',?)")
        .run(receipt.orderId, Date.now());
      this.audit(receipt.provider, "verified-payment", receipt.orderId);
    });
  }
  /** Immutable server-reviewed input snapshot commitment. This does not authorize
   * the browser to supply hashes: only a trusted server preparation flow may call it. */
  bindReviewedOrderInputs(orderId: string, inputDigest: string, reviewDigest: string): boolean {
    if (!/^[a-f0-9]{64}$/.test(inputDigest) || !/^[a-f0-9]{64}$/.test(reviewDigest))
      throw Error("Invalid reviewed input digest");
    return this.tx(() => {
      const order = this.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(orderId);
      if (!order || order.status !== "awaiting_payment")
        throw Error("Order is not awaiting payment");
      const prior = this.db.prepare("SELECT input_digest,review_digest FROM customer_order_inputs WHERE order_id=?").get(orderId);
      if (prior) {
        if (prior.input_digest !== inputDigest || prior.review_digest !== reviewDigest)
          throw Error("Reviewed order inputs conflict");
        return false;
      }
      this.db.prepare("INSERT INTO customer_order_inputs VALUES(?,?,?,?)").run(orderId,inputDigest,reviewDigest,Date.now());
      this.audit("checkout-preparation","reviewed-order-inputs",orderId);
      return true;
    });
  }
  /** Only a trusted server flow can bind actual prepared media to the stored order quote.
   * The customer cannot override the paid amount or reviewed quote evidence. */
  bindPreparedOrderMedia(orderId: string, media: PreparedMedia): boolean {
    const order = this.db.prepare("SELECT price_cents,quote_evidence,status FROM customer_orders WHERE id=?").get(orderId);
    if (!order || order.status !== "awaiting_payment") throw Error("Order is not awaiting payment");
    const inputDigest = reviewedVideoInputDigest(media);
    const reviewDigest = reviewedVideoQuoteDigest(inputDigest, Number(order.price_cents), String(order.quote_evidence));
    return this.bindReviewedOrderInputs(orderId, inputDigest, reviewDigest);
  }
  /** Read-only queue discovery for a future authorized fulfillment worker.
   * Only verified-paid orders are eligible. This method never dispatches a provider task. */
  pendingPaidFulfillment(limit = 25): string[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw Error("Invalid fulfillment batch size");
    const rows = this.db.prepare(`
      SELECT q.order_id FROM customer_fulfillment_queue q
      JOIN customer_orders o ON o.id=q.order_id
      WHERE q.state='pending' AND o.status='paid'
      ORDER BY q.created ASC, q.order_id ASC LIMIT ?
    `).all(limit);
    return rows.map(row => String(row.order_id));
  }
  /** Reserve a paid job once. Never reclaim an ambiguous processing job automatically. */
  claimPaidFulfillment(orderId: string): boolean {
    return this.tx(() => {
      const changed = this.db.prepare(`
        UPDATE customer_fulfillment_queue SET state='processing'
        WHERE order_id=? AND state='pending'
          AND EXISTS (SELECT 1 FROM customer_orders WHERE id=? AND status='paid')
      `).run(orderId, orderId);
      if (changed.changes !== 1) return false;
      this.audit("fulfillment-worker", "claim-paid-order", orderId);
      return true;
    });
  }
  /** Write the durable submission barrier BEFORE any paid provider network request.
   * An unknown outcome is NEVER automatically eligible for a second submission. */
  beginPaidProviderSubmission(orderId: string): boolean {
    return this.tx(() => {
      const eligible = this.db.prepare(`
        SELECT 1 FROM customer_fulfillment_queue q
        JOIN customer_orders o ON o.id=q.order_id
        WHERE q.order_id=? AND q.state='processing' AND o.status='paid'
      `).get(orderId);
      if (!eligible) throw Error("Paid fulfillment claim required");
      const changed = this.db.prepare(`
        INSERT OR IGNORE INTO customer_provider_submissions(order_id,provider,state,created)
        VALUES(?,'byteplus','submitted_or_unknown',?)
      `).run(orderId, Date.now());
      if (changed.changes !== 1) return false;
      this.audit("fulfillment-worker","provider-submission-barrier",orderId);
      return true;
    });
  }
  paidSubmissionStatus(orderId: string): "submitted_or_unknown" | "acknowledged" | null {
    const row = this.db.prepare("SELECT state FROM customer_provider_submissions WHERE order_id=?").get(orderId);
    return row ? String(row.state) as "submitted_or_unknown" | "acknowledged" : null;
  }
  /** Persist an acknowledged provider job exactly once, after exclusive claim.
   * Never call the provider here. An ambiguous submission remains processing for manual review. */
  recordPaidProviderJob(orderId: string, provider: string, jobId: string): boolean {
    if (provider !== "byteplus" || !/^[A-Za-z0-9_-]{1,512}$/.test(jobId))
      throw Error("Invalid provider job reference");
    return this.tx(() => {
      const current = this.db.prepare("SELECT provider,job_id FROM customer_provider_jobs WHERE order_id=?").get(orderId);
      if (current) {
        if (current.provider !== provider || current.job_id !== jobId)
          throw Error("Provider job conflict");
        return false;
      }
      const barrier = this.db.prepare("SELECT state FROM customer_provider_submissions WHERE order_id=? AND provider='byteplus'").get(orderId);
      if (!barrier) throw Error("Provider submission barrier required");
      this.db.prepare("INSERT INTO customer_provider_jobs(order_id,provider,job_id,created) VALUES(?,?,?,?)")
        .run(orderId,provider,jobId,Date.now());
      this.db.prepare("UPDATE customer_provider_submissions SET state='acknowledged' WHERE order_id=?").run(orderId);
      this.audit("fulfillment-worker","provider-job-recorded",orderId);
      return true;
    });
  }
  paidProviderJob(orderId: string): { provider: string; jobId: string } | null {
    const row = this.db.prepare("SELECT provider,job_id FROM customer_provider_jobs WHERE order_id=?").get(orderId);
    return row ? { provider: String(row.provider), jobId: String(row.job_id) } : null;
  }
  /** Record private, verified output asset ownership before a paid order may be delivered.
   * This stores only an opaque asset ID, never a public URL or secret. */
  recordPaidVideoDelivery(orderId: string, assetId: string, evidence: string): boolean {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(assetId) ||
        typeof evidence !== "string" || evidence.trim().length < 20 || evidence.length > 2048)
      throw Error("Verified private video delivery evidence required");
    return this.tx(() => {
      const claim = this.db.prepare(`
        SELECT 1 FROM customer_fulfillment_queue q
        JOIN customer_orders o ON o.id=q.order_id
        JOIN customer_provider_jobs j ON j.order_id=q.order_id AND j.provider='byteplus'
        WHERE q.order_id=? AND q.state='processing' AND o.status='paid'
      `).get(orderId);
      if (!claim) throw Error("Confirmed paid provider job required");
      const existing = this.db.prepare("SELECT asset_id,evidence_hash FROM customer_video_deliveries WHERE order_id=?").get(orderId);
      const digest = hash(evidence);
      if (existing) {
        if (existing.asset_id !== assetId || existing.evidence_hash !== digest)
          throw Error("Private delivery reference conflict");
        return false;
      }
      this.db.prepare("INSERT INTO customer_video_deliveries VALUES(?,?,?,?)")
        .run(orderId, assetId, digest, Date.now());
      this.audit("fulfillment-worker", "delivery-recorded", orderId);
      return true;
    });
  }
  /** Authorize access to the delivered asset by the order's account or guest token.
   * Never expose the provider URL, storage path or unsigned download location. */
  ownedDeliveredVideoAsset(orderId: string, account: string | null, guestToken?: string): string | null {
    this.ownedOrder(orderId, account, guestToken);
    const row = this.db.prepare(`
      SELECT d.asset_id FROM customer_video_deliveries d
      JOIN customer_fulfillment_queue q ON q.order_id=d.order_id
      JOIN customer_orders o ON o.id=d.order_id
      WHERE d.order_id=? AND q.state='delivered' AND o.status='paid'
    `).get(orderId);
    return row ? String(row.asset_id) : null;
  }
  /** Only a claimed job may be finalized. Never silently retry a failed/unknown provider outcome. */
  finalizePaidFulfillment(
    orderId: string,
    outcome: { state: "delivered"; deliveryEvidence: string } | { state: "failed"; failureEvidence: string },
  ): boolean {
    const evidence = outcome.state === "delivered" ? outcome.deliveryEvidence : outcome.failureEvidence;
    if (typeof evidence !== "string" || evidence.trim().length < 20 || evidence.length > 2048)
      throw Error("Verified fulfillment evidence required");
    return this.tx(() => {
      if (outcome.state === "delivered") {
        const job = this.db.prepare(`
          SELECT 1 FROM customer_provider_jobs
          WHERE order_id=? AND provider='byteplus'
        `).get(orderId);
        if (!job) throw Error("Confirmed provider job required before delivery");
        const delivery = this.db.prepare("SELECT 1 FROM customer_video_deliveries WHERE order_id=?").get(orderId);
        if (!delivery) throw Error("Verified private video delivery required before completion");
      }
      const changed = this.db.prepare(`
        UPDATE customer_fulfillment_queue SET state=?
        WHERE order_id=? AND state='processing'
          AND EXISTS (SELECT 1 FROM customer_orders WHERE id=? AND status='paid')
      `).run(outcome.state, orderId, orderId);
      if (changed.changes !== 1) return false;
      this.audit("fulfillment-worker", `fulfillment-${outcome.state}`, orderId + ":" + hash(evidence));
      return true;
    });
  }
  close() {
    this.db.close();
  }
}
/** Default and only shipped adapter: impossible to mark an order paid via mocks in production. */
export const disabledPayments: PaymentAdapter = {
  async verify() {
    throw Error(
      "Payment provider is not configured. No payment or generation was started.",
    );
  },
};
