import { PlanLedger, quotePlanSeconds } from "./plans.ts";
import { PromotionLedger, normalizePromoCode } from "./promotions.ts";
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
 CREATE TABLE IF NOT EXISTS customer_email_verifications(account_id TEXT PRIMARY KEY,verified_at INTEGER,token_hash TEXT UNIQUE,token_expires INTEGER,sent_at INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS customer_orders(id TEXT PRIMARY KEY,account_id TEXT,guest_hash TEXT,guest_expiry INTEGER,email TEXT NOT NULL,project_id TEXT NOT NULL,price_cents INTEGER NOT NULL,currency TEXT NOT NULL,status TEXT NOT NULL,quote_evidence TEXT NOT NULL,request_key TEXT UNIQUE NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_stripe_disputes(order_id TEXT PRIMARY KEY,dispute_id TEXT UNIQUE NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_stripe_refunds(order_id TEXT PRIMARY KEY,refund_id TEXT UNIQUE NOT NULL,amount_cents INTEGER NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_credits(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,delta INTEGER NOT NULL,kind TEXT NOT NULL,evidence TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_holds(order_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,cents INTEGER NOT NULL,state TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS payment_events(event_key TEXT PRIMARY KEY,receipt_hash TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS stripe_checkout_sessions(order_id TEXT PRIMARY KEY,session_id TEXT UNIQUE NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_early_performance_consents(order_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,notice_version TEXT NOT NULL,review_digest TEXT NOT NULL,acknowledged_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_contract_confirmations(order_id TEXT PRIMARY KEY,notice_version TEXT NOT NULL,sent_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_fulfillment_queue(order_id TEXT PRIMARY KEY,state TEXT NOT NULL CHECK(state IN ('pending','processing','delivered','failed')),created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_provider_jobs(order_id TEXT PRIMARY KEY,provider TEXT NOT NULL,job_id TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(provider,job_id));
 CREATE TABLE IF NOT EXISTS customer_video_deliveries(order_id TEXT PRIMARY KEY,asset_id TEXT UNIQUE NOT NULL,evidence_hash TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS free_promo_video_deliveries(order_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_order_inputs(order_id TEXT PRIMARY KEY,input_digest TEXT NOT NULL,review_digest TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_guest_media_owners(order_id TEXT PRIMARY KEY,media_owner TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_prepared_media(order_id TEXT PRIMARY KEY,media_json TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_provider_submissions(order_id TEXT PRIMARY KEY,provider TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('submitted_or_unknown','acknowledged')),created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_provider_cost_reservations(order_id TEXT PRIMARY KEY,inclusive_micro_usd INTEGER NOT NULL,review_hash TEXT NOT NULL,reserved_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS customer_provider_input_leases(order_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,audio_key TEXT UNIQUE NOT NULL,image_key TEXT UNIQUE NOT NULL,expires_at INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('uploading','ready','requires-review')));
 CREATE TABLE IF NOT EXISTS commerce_audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,record TEXT NOT NULL,created INTEGER NOT NULL);`);
  }
  private txDepth = 0;
  private tx<T>(fn: () => T): T {
    // Nested order preparation must be atomic: SQLite cannot BEGIN within BEGIN.
    const nested = this.txDepth > 0;
    const savepoint = `commerce_nested_${this.txDepth}`;
    this.db.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
    this.txDepth++;
    try {
      const result = fn();
      this.db.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT");
      return result;
    } catch (error) {
      if (nested) {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } else {
        this.db.exec("ROLLBACK");
      }
      throw error;
    } finally {
      this.txDepth--;
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
    this.tx(() => {
      this.db.prepare("INSERT INTO customer_accounts VALUES(?,?,?,?)")
        .run(id, email, `${salt}:${digest}`, Date.now());
      // New password accounts must confirm ownership before future paid orders.
      // Missing rows belong to existing pre-migration accounts and retain access.
      this.db.prepare("INSERT INTO customer_email_verifications(account_id,verified_at,sent_at) VALUES(?,NULL,0)").run(id);
    });
    return id;
  }
  googleLogin(subject:string,email:string){
    email=email.trim().toLowerCase();
    if(!/^[^\s@]{1,100}@[^\s@]{1,150}\.[^\s@]{2,30}$/.test(email)||!/^\d{8,32}$/.test(subject))throw Error("Invalid Google account");
    this.db.exec("CREATE TABLE IF NOT EXISTS customer_google_identities(google_sub TEXT PRIMARY KEY,account_id TEXT UNIQUE NOT NULL)");
    const existing=this.db.prepare("SELECT account_id FROM customer_google_identities WHERE google_sub=?").get(subject) as {account_id:string}|undefined;
    let id=existing?.account_id;
    if(!id){
      if(this.db.prepare("SELECT id FROM customer_accounts WHERE email=?").get(email))throw Error("An account with this email already exists. Sign in with its password.");
      id=randomUUID();
      this.db.prepare("INSERT INTO customer_accounts VALUES(?,?,?,?)").run(id,email,"google-only:"+randomBytes(32).toString("hex"),Date.now());
      this.db.prepare("INSERT INTO customer_google_identities VALUES(?,?)").run(subject,id);
    }
    // Google email_verified was validated by the OAuth callback, including
    // audience, issuer, subject and nonce. Never infer it from an email alone.
    this.db.prepare("INSERT INTO customer_email_verifications(account_id,verified_at,sent_at) VALUES(?,?,0) ON CONFLICT(account_id) DO UPDATE SET verified_at=excluded.verified_at,token_hash=NULL,token_expires=NULL")
      .run(id,Date.now());
    const token=randomBytes(32).toString("base64url");
    this.db.prepare("INSERT INTO customer_sessions VALUES(?,?,?)").run(hash(token),id,Date.now()+86400000);
    return {id,token};
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
  changePassword(accountId: string, currentPassword: string, newPassword: string) {
    if (newPassword.length < 20 || newPassword.length > 256 || currentPassword.length > 256)
      throw Error("Invalid password");
    const row=this.db.prepare("SELECT password_hash FROM customer_accounts WHERE id=?").get(accountId) as {password_hash:string}|undefined;
    if(!row)throw Error("Invalid credentials");
    const [salt,digest]=row.password_hash.split(":");
    if(!timingSafeEqual(scryptSync(currentPassword,salt,64),Buffer.from(digest,"hex")))
      throw Error("Invalid credentials");
    const nextSalt=randomBytes(16).toString("hex");
    const nextHash=scryptSync(newPassword,nextSalt,64).toString("hex");
    this.tx(()=>{
      this.db.prepare("UPDATE customer_accounts SET password_hash=? WHERE id=?").run(nextSalt+":"+nextHash,accountId);
      this.db.prepare("DELETE FROM customer_sessions WHERE account_id=?").run(accountId);
    });
    const token=randomBytes(32).toString("base64url");
    this.db.prepare("INSERT INTO customer_sessions VALUES(?,?,?)").run(hash(token),accountId,Date.now()+86400000);
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
  /** Old customer records predate verification and remain grandfathered;
   * only new explicitly pending rows block paid ordering. */
  emailVerified(accountId:string):boolean {
    const row=this.db.prepare("SELECT verified_at FROM customer_email_verifications WHERE account_id=?")
      .get(accountId) as {verified_at:number|null}|undefined;
    return !row || typeof row.verified_at==="number" && row.verified_at>0;
  }
  verificationState(accountId:string):"verified"|"pending"|"legacy"{
    const row=this.db.prepare("SELECT verified_at FROM customer_email_verifications WHERE account_id=?")
      .get(accountId) as {verified_at:number|null}|undefined;
    if(!row)return "legacy";
    return typeof row.verified_at==="number"&&row.verified_at>0?"verified":"pending";
  }
  /** One active, short-lived token; issuing another invalidates its predecessor.
   * A one-minute cooldown controls mail abuse independently of endpoint limits. */
  issueEmailVerification(accountId:string,now=Date.now()):{email:string;token:string}|null {
    return this.tx(()=>{
      const account=this.db.prepare("SELECT email FROM customer_accounts WHERE id=?")
        .get(accountId) as {email:string}|undefined;
      if(!account)return null;
      const row=this.db.prepare("SELECT verified_at,sent_at FROM customer_email_verifications WHERE account_id=?")
        .get(accountId) as {verified_at:number|null;sent_at:number}|undefined;
      if(!row||row.verified_at!==null||row.sent_at>now-60000)return null;
      const token=randomBytes(32).toString("base64url");
      this.db.prepare("UPDATE customer_email_verifications SET token_hash=?,token_expires=?,sent_at=? WHERE account_id=? AND verified_at IS NULL")
        .run(hash(token),now+24*60*60*1000,now,accountId);
      return {email:account.email,token};
    });
  }
  invalidateEmailVerification(token:string):void{
    this.db.prepare("UPDATE customer_email_verifications SET token_hash=NULL,token_expires=NULL WHERE token_hash=? AND verified_at IS NULL")
      .run(hash(token));
  }
  verifyEmailToken(token:string,now=Date.now()):boolean{
    if(!/^[A-Za-z0-9_-]{30,128}$/.test(token))return false;
    const result=this.db.prepare("UPDATE customer_email_verifications SET verified_at=?,token_hash=NULL,token_expires=NULL WHERE token_hash=? AND token_expires>? AND verified_at IS NULL")
      .run(now,hash(token),now);
    return result.changes===1;
  }
  createPasswordReset(email: string) {
    this.db.exec("CREATE TABLE IF NOT EXISTS customer_password_resets(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL,expires INTEGER NOT NULL)");
    this.db.prepare("DELETE FROM customer_password_resets WHERE expires<?").run(Date.now());
    const row=this.db.prepare("SELECT id,password_hash FROM customer_accounts WHERE email=?").get(email.trim().toLowerCase()) as {id:string;password_hash:string}|undefined;
    if(!row||row.password_hash.startsWith("google-only:"))return null;
    const token=randomBytes(32).toString("base64url");
    this.db.prepare("DELETE FROM customer_password_resets WHERE account_id=?").run(row.id);
    this.db.prepare("INSERT INTO customer_password_resets VALUES(?,?,?)").run(hash(token),row.id,Date.now()+30*60*1000);
    return token;
  }
  invalidatePasswordReset(token:string){
    this.db.prepare("DELETE FROM customer_password_resets WHERE token_hash=?").run(hash(token));
  }
  finishPasswordReset(token:string,newPassword:string){
    if(typeof token!=="string"||token.length>256||typeof newPassword!=="string"||newPassword.length<20||newPassword.length>256)throw Error("Invalid reset request");
    this.db.exec("CREATE TABLE IF NOT EXISTS customer_password_resets(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL,expires INTEGER NOT NULL)");
    const row=this.db.prepare("SELECT account_id FROM customer_password_resets WHERE token_hash=? AND expires>?").get(hash(token),Date.now()) as {account_id:string}|undefined;
    if(!row)throw Error("Reset link expired or invalid");
    const salt=randomBytes(16).toString("hex"),digest=scryptSync(newPassword,salt,64).toString("hex");
    this.tx(()=>{
      this.db.prepare("UPDATE customer_accounts SET password_hash=? WHERE id=?").run(salt+":"+digest,row.account_id);
      this.db.prepare("DELETE FROM customer_password_resets WHERE account_id=?").run(row.account_id);
      this.db.prepare("DELETE FROM customer_sessions WHERE account_id=?").run(row.account_id);
    });
  }
  logoutAll(accountId: string) {
    this.db.prepare("DELETE FROM customer_sessions WHERE account_id=?").run(accountId);
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
    if(input.cents!==0)amount(input.cents);
    else if(!input.account)throw Error("Zero-price order requires authenticated customer");
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
          token ? Date.now() + 90*86400000 : null,
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
  /** Trusted customer checkout preparation: create an order and bind the actual
   * validated media to its server-reviewed price as one database transaction. */
  preparedVideoOrder(input: {
    account: string | null;
    email: string;
    project: string;
    cents: number;
    quoteEvidence: string;
    key: string;
    media: PreparedMedia;
    promoCode?: string;
    originalCents?: number;
  }) {
    return this.tx(() => {
      const { media, promoCode, originalCents, ...orderInput } = input;
      const promotions = promoCode ? new PromotionLedger(this.db) : null;
      const normalizedPromo = promoCode ? normalizePromoCode(promoCode) : null;
      // Initialize subscription and reservation schema before every lookup,
      // including first-time and guest order attempts.
      new PlanLedger(this.db);
      // Past orders are an immutable payment/audit history, never a project slot.
      // Video purchases remain governed by server-side pricing, authorization and budgets.

      // Never persist media prepared for another customer, even from a trusted caller.
      if(input.account && media.owner!==`customer-${input.account}`)
        throw Error("Customer media ownership mismatch");
      if(!input.account && !/^[a-f0-9-]{36}$/.test(media.owner))
        throw Error("Guest media must belong to a verified private guest session");
      // Reject unprepared inputs before writing any order.
      reviewedVideoInputDigest(media);
      // An idempotent retry must reuse the committed quote, not reprice
      // against the allowance already reserved by this same request.
      const previous=this.db.prepare("SELECT id,account_id,project_id,price_cents,quote_evidence,status FROM customer_orders WHERE request_key=?").get(input.key) as {id:string;account_id:string|null;project_id:string;price_cents:number;quote_evidence:string;status:string}|undefined;
      if(previous){
        const bound=this.db.prepare("SELECT media_json FROM customer_prepared_media WHERE order_id=?").get(previous.id) as {media_json:string}|undefined;
        const reserved=this.db.prepare("SELECT account_id,seconds,extra_cents,state FROM customer_split_quotes WHERE attempt_id=?").get(previous.id) as {account_id:string;seconds:number;extra_cents:number;state:string}|undefined;
        const promoReservation = promotions ? this.db.prepare("SELECT code,account_id,original_cents,discount_cents,state FROM promo_redemptions WHERE order_id=?").get(previous.id) as
          {code:string;account_id:string;original_cents:number;discount_cents:number;state:string}|undefined : null;
        if(normalizedPromo && (!promoReservation || promoReservation.code!==normalizedPromo ||
          promoReservation.account_id!==input.account || promoReservation.original_cents!==originalCents ||
          promoReservation.original_cents-promoReservation.discount_cents!==input.cents ||
          promoReservation.state==="released"))
          throw Error("Promotion idempotency conflict");
        if(!normalizedPromo && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='promo_redemptions'").get() &&
          this.db.prepare("SELECT 1 FROM promo_redemptions WHERE order_id=?").get(previous.id))
          throw Error("Promotion idempotency conflict");
        if(previous.account_id!==input.account||previous.project_id!==input.project||
           previous.price_cents!==input.cents||previous.quote_evidence!==input.quoteEvidence||
           !bound||bound.media_json!==JSON.stringify(media)||
           (input.account && (!reserved||reserved.account_id!==input.account||
             reserved.seconds!==Math.ceil(media.durationSeconds)||reserved.extra_cents!==(normalizedPromo ? originalCents : input.cents)||
             reserved.state==="released")))
          throw Error("Idempotency conflict");
        return {id:previous.id,guestToken:null};
      }
      // Price and reserve the split inside this SAME write transaction:
      // parallel requests cannot spend the same Hobby seconds twice.
      const ledger=input.account?new PlanLedger(this.db):null;
      const plan=input.account?ledger!.snapshot(input.account):null;
      const split=plan?quotePlanSeconds(plan.code,plan.secondsRemaining,media.durationSeconds):null;
      const originalPrice = normalizedPromo ? originalCents : input.cents;
      if(split && split.extraCents!==originalPrice)
        throw Error("PRICE_CHANGED_REVIEW_AGAIN");
      if(normalizedPromo) {
        if(!input.account || typeof originalPrice!=="number" || originalPrice<=0)
          throw Error("Authenticated paid customer price required for promotion");
        const discounted = promotions!.preview(normalizedPromo,input.account,originalPrice,media.durationSeconds);
        if(discounted.finalCents!==input.cents)
          throw Error("PRICE_CHANGED_REVIEW_AGAIN");
      }
      if(split && split.extraCents===0 && (plan?.code!=="hobby" || split.includedSeconds!==split.seconds))
        throw Error("Hobby allowance verification required");
      const created = this.order(orderInput);
      if(normalizedPromo && input.account)
        promotions!.reserveForOrder({code:normalizedPromo,orderId:created.id,accountId:input.account,
          originalCents:originalPrice!,durationSeconds:media.durationSeconds});
      if(split && input.account){
        const prior=this.db.prepare("SELECT * FROM customer_split_quotes WHERE attempt_id=?").get(created.id) as {account_id:string;seconds:number;included_seconds:number;extra_cents:number;state:string}|undefined;
        if(prior){
          if(prior.account_id!==input.account||prior.seconds!==split.seconds||prior.extra_cents!==split.extraCents||prior.included_seconds!==split.includedSeconds||prior.state!=="reserved")
            throw Error("Existing order reservation conflict");
        }else{
          this.db.prepare("INSERT INTO customer_split_quotes VALUES(?,?,?,?,?,?,?,?,?)").run(created.id,input.account,plan!.period,split.seconds,split.includedSeconds,split.extraSeconds,split.extraCents,"reserved",Date.now());
          if(split.includedSeconds>0)
            this.db.prepare("INSERT INTO customer_plan_usage VALUES(?,?,?,?,?,?,?)").run(randomUUID(),input.account,plan!.period,split.includedSeconds,"reserved",created.id,Date.now());
        }
      }
      this.bindPreparedOrderMedia(created.id, media);
      if(!input.account){
        const priorOwner=this.db.prepare("SELECT media_owner FROM customer_guest_media_owners WHERE order_id=?").get(created.id) as {media_owner:string}|undefined;
        if(priorOwner && priorOwner.media_owner!==media.owner)throw Error("Guest media owner conflict");
        if(!priorOwner)this.db.prepare("INSERT INTO customer_guest_media_owners VALUES(?,?,?)").run(created.id,media.owner,Date.now());
      }
      const snapshot = JSON.stringify(media);
      if (snapshot.length > 16000 || !media.audioPath || !media.imagePath || !media.owner)
        throw Error("Private prepared media snapshot required");
      const prior = this.db.prepare("SELECT media_json FROM customer_prepared_media WHERE order_id=?").get(created.id);
      if (prior && prior.media_json !== snapshot) throw Error("Prepared media snapshot conflict");
      if (!prior) this.db.prepare("INSERT INTO customer_prepared_media VALUES(?,?,?)").run(created.id,snapshot,Date.now());
      // A fully included Hobby order is authorized by reserved paid-period
      // allowance, not a fictitious zero-euro Stripe Checkout.
      if(split && split.extraCents===0 && input.account && !normalizedPromo){
        const updated=this.db.prepare("UPDATE customer_orders SET status='paid' WHERE id=? AND status='awaiting_payment' AND price_cents=0").run(created.id);
        if(updated.changes!==1)throw Error("Included order authorization conflict");
        this.db.prepare("INSERT INTO customer_fulfillment_queue(order_id,state,created) VALUES(?,'pending',?)").run(created.id,Date.now());
        this.audit("hobby-allowance","included-order-authorized",created.id);
      }
      return created;
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
  /** Durable guest media ownership is independent of a mutable browser draft. */
  guestMediaOwner(orderId:string):string|null{
    const row=this.db.prepare(`SELECT g.media_owner FROM customer_guest_media_owners g
      JOIN customer_orders o ON o.id=g.order_id AND o.account_id IS NULL
      WHERE g.order_id=?`).get(orderId) as {media_owner:string}|undefined;
    return row?.media_owner??null;
  }
  /** Authenticated guest capability is checked against the exact order ID,
   * not a site-wide login; no cookie-less checkout or provider call is possible. */
  recordGuestEarlyPerformanceConsent(orderId:string,guestToken:string){
    return this.tx(()=>{
      this.ownedOrder(orderId,null,guestToken);
      if(!this.guestMediaOwner(orderId)||!this.reviewedOrderReadyForCheckout(orderId))
        throw Error("Reviewed guest order required");
      const row=this.db.prepare("SELECT review_digest FROM customer_order_inputs WHERE order_id=?")
        .get(orderId) as {review_digest:string}|undefined;
      if(!row)throw Error("Guest review missing");
      const accountRef="guest:"+orderId,version="early-performance-v1-2026-11-09";
      const prior=this.db.prepare("SELECT account_id,notice_version,review_digest FROM customer_early_performance_consents WHERE order_id=?")
        .get(orderId) as {account_id:string;notice_version:string;review_digest:string}|undefined;
      if(prior){
        if(prior.account_id!==accountRef||prior.notice_version!==version||prior.review_digest!==row.review_digest)
          throw Error("Guest consent snapshot conflict");
        return;
      }
      this.db.prepare("INSERT INTO customer_early_performance_consents(order_id,account_id,notice_version,review_digest,acknowledged_at) VALUES(?,?,?,?,?)")
        .run(orderId,accountRef,version,row.review_digest,Date.now());
      this.audit("guest-early-performance-consent",version,orderId);
    });
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
  /** Cancel a prepared order only when Stripe Checkout was never opened.
   * A Checkout session can be paid later, so never release its allowance here. */
  cancelUnstartedCustomerOrder(orderId:string,accountId:string):boolean {
    return this.tx(()=>{
      new PlanLedger(this.db);
      const order=this.db.prepare("SELECT account_id,status FROM customer_orders WHERE id=?").get(orderId) as {account_id:string|null;status:string}|undefined;
      if(!order||order.account_id!==accountId)throw Error("Order unavailable");
      if(order.status==="cancelled")return false;
      if(order.status!=="awaiting_payment"||
        this.db.prepare("SELECT 1 FROM stripe_checkout_sessions WHERE order_id=?").get(orderId)||
        this.db.prepare("SELECT 1 FROM customer_fulfillment_queue WHERE order_id=?").get(orderId))
        throw Error("Order requires payment reconciliation");
      // A zero-EUR voucher with a separately signed provider cost authorization
      // is no longer an unstarted order. Never release its quota or let another
      // browser tab recycle the same paid-provider budget.
      if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='free_promo_budget_authorizations'").get() &&
         this.db.prepare("SELECT 1 FROM free_promo_budget_authorizations WHERE order_id=?").get(orderId))
        throw Error("Operator-authorized promo requires manual reconciliation");
      const split=this.db.prepare("SELECT state,included_seconds FROM customer_split_quotes WHERE attempt_id=?").get(orderId) as {state:string;included_seconds:number}|undefined;
      if(split){
        if(split.state!=="reserved")throw Error("Allowance requires reconciliation");
        if(split.included_seconds>0){
          const usage=this.db.prepare("UPDATE customer_plan_usage SET state='released' WHERE provider_attempt_id=? AND state='reserved' AND seconds=?").run(orderId,split.included_seconds);
          if(usage.changes!==1)throw Error("Allowance mismatch");
        }
        this.db.prepare("UPDATE customer_split_quotes SET state='released' WHERE attempt_id=? AND state='reserved'").run(orderId);
      }
      this.db.prepare("UPDATE customer_orders SET status='cancelled' WHERE id=? AND status='awaiting_payment'").run(orderId);
      if(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='promo_redemptions'").get() &&
        this.db.prepare("SELECT 1 FROM promo_redemptions WHERE order_id=?").get(orderId))
        new PromotionLedger(this.db).release(orderId);
      this.audit(accountId,"customer-unstarted-order-cancelled",orderId);
      return true;
    });
  }
  /** Record an externally verified full Stripe refund before provider submission.
   * This method does not issue a Stripe refund. Only a trusted reconciliation
   * process may call it after checking Stripe's refund and charge identities.
   * Ambiguous/submitted jobs are deliberately excluded.
   */
  reconcileVerifiedStripeRefund(input:{
    orderId:string;stripeCheckoutId:string;refundId:string;refundedCents:number;
    evidence:string;
  }):boolean {
    if(!/^cs_(?:test|live)_[A-Za-z0-9_]+$/.test(input.stripeCheckoutId)||
       !/^re_[A-Za-z0-9_]+$/.test(input.refundId)||
       !Number.isSafeInteger(input.refundedCents)||input.refundedCents<=0||
       typeof input.evidence!=="string"||input.evidence.length<20||input.evidence.length>2048)
      throw Error("Verified Stripe refund evidence required");
    return this.tx(()=>{
      new PlanLedger(this.db);
      const order=this.db.prepare("SELECT status,price_cents FROM customer_orders WHERE id=?").get(input.orderId) as {status:string;price_cents:number}|undefined;
      const checkout=this.db.prepare("SELECT session_id FROM stripe_checkout_sessions WHERE order_id=?").get(input.orderId) as {session_id:string}|undefined;
      if(!order||!checkout||checkout.session_id!==input.stripeCheckoutId||
         order.price_cents!==input.refundedCents)
        throw Error("Refund amount or Checkout mismatch");
      const prior=this.db.prepare("SELECT refund_id FROM customer_stripe_refunds WHERE order_id=?").get(input.orderId) as {refund_id:string}|undefined;
      if(prior){
        if(prior.refund_id!==input.refundId)throw Error("Refund identity conflict");
        return false;
      }
      // A provider job might already have been submitted, even if its receipt was lost.
      // Do not release the allowance or reopen the job in that state.
      const fulfillment=this.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(input.orderId) as {state:string}|undefined;
      if(order.status!=="paid"||fulfillment?.state!=="pending"||
         this.db.prepare("SELECT 1 FROM customer_provider_submissions WHERE order_id=?").get(input.orderId)||
         this.db.prepare("SELECT 1 FROM customer_provider_jobs WHERE order_id=?").get(input.orderId))
        throw Error("Refund requires manual provider reconciliation");
      const split=this.db.prepare("SELECT state,included_seconds FROM customer_split_quotes WHERE attempt_id=?").get(input.orderId) as {state:string;included_seconds:number}|undefined;
      if(split && split.state!=="reserved")throw Error("Allowance requires reconciliation");
      if(split?.included_seconds){
        const change=this.db.prepare("UPDATE customer_plan_usage SET state='released' WHERE provider_attempt_id=? AND state='reserved' AND seconds=?").run(input.orderId,split.included_seconds);
        if(change.changes!==1)throw Error("Allowance mismatch");
      }
      if(split)this.db.prepare("UPDATE customer_split_quotes SET state='released' WHERE attempt_id=? AND state='reserved'").run(input.orderId);
      this.db.prepare("UPDATE customer_orders SET status='refunded' WHERE id=? AND status='paid'").run(input.orderId);
      if(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='promo_redemptions'").get() &&
        this.db.prepare("SELECT 1 FROM promo_redemptions WHERE order_id=?").get(input.orderId))
        new PromotionLedger(this.db).release(input.orderId);
      this.db.prepare("UPDATE customer_fulfillment_queue SET state='failed' WHERE order_id=? AND state='pending'").run(input.orderId);
      this.db.prepare("INSERT INTO customer_stripe_refunds VALUES(?,?,?,?)").run(input.orderId,input.refundId,input.refundedCents,Date.now());
      this.audit("stripe-refund-reconciliation","verified-full-refund",input.orderId+":"+hash(input.evidence));
      return true;
    });
  }
  /** Trusted, externally verified Stripe dispute notification. This never
   * releases reserved allowance or issues a refund: card disputes can reverse.
   * Stop only work still pending; submitted work requires manual reconciliation. */
  reconcileVerifiedStripeDispute(input:{
    orderId:string;stripeCheckoutId:string;disputeId:string;evidence:string;
  }):boolean {
    if(!/^cs_(?:test|live)_[A-Za-z0-9_]+$/.test(input.stripeCheckoutId)||
       !/^dp_[A-Za-z0-9_]+$/.test(input.disputeId)||
       typeof input.evidence!=="string"||input.evidence.length<20||input.evidence.length>2048)
      throw Error("Verified Stripe dispute evidence required");
    return this.tx(()=>{
      const checkout=this.db.prepare("SELECT session_id FROM stripe_checkout_sessions WHERE order_id=?").get(input.orderId) as {session_id:string}|undefined;
      if(!checkout||checkout.session_id!==input.stripeCheckoutId)throw Error("Dispute Checkout mismatch");
      const previous=this.db.prepare("SELECT dispute_id FROM customer_stripe_disputes WHERE order_id=?").get(input.orderId) as {dispute_id:string}|undefined;
      if(previous){
        if(previous.dispute_id!==input.disputeId)throw Error("Dispute identity conflict");
        return false;
      }
      const order=this.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(input.orderId) as {status:string}|undefined;
      if(order?.status!=="paid")throw Error("Dispute requires payment reconciliation");
      const queue=this.db.prepare("SELECT state FROM customer_fulfillment_queue WHERE order_id=?").get(input.orderId) as {state:string}|undefined;
      if(!queue)throw Error("Paid fulfillment record required");
      // Never turn processing, delivered, or uncertain work into a retryable job.
      if(queue.state==="pending"){
        const changed=this.db.prepare("UPDATE customer_fulfillment_queue SET state='failed' WHERE order_id=? AND state='pending'").run(input.orderId);
        if(changed.changes!==1)throw Error("Dispute queue race");
      }
      this.db.prepare("UPDATE customer_orders SET status='disputed' WHERE id=? AND status='paid'").run(input.orderId);
      this.db.prepare("INSERT INTO customer_stripe_disputes VALUES(?,?,?)").run(input.orderId,input.disputeId,Date.now());
      this.audit("stripe-dispute-reconciliation","verified-dispute",input.orderId+":"+hash(input.evidence));
      return true;
    });
  }
  /** Immutable, account-bound evidence for two separately displayed acknowledgements.
   * This does not itself establish statutory expiry or replace contract confirmation. */
  recordEarlyPerformanceConsent(orderId: string, accountId: string) {
    return this.tx(() => {
      const row = this.db.prepare(`
        SELECT o.status,o.account_id,i.review_digest
        FROM customer_orders o
        JOIN customer_order_inputs i ON i.order_id=o.id
        WHERE o.id=?
      `).get(orderId);
      if(!row || row.status!=="awaiting_payment" || row.account_id!==accountId ||
         typeof row.review_digest!=="string" || !this.reviewedOrderReadyForCheckout(orderId))
        throw Error("Consent requires a reviewed owned order");
      const version="early-performance-v1-2026-11-09";
      const prior=this.db.prepare("SELECT account_id,notice_version,review_digest FROM customer_early_performance_consents WHERE order_id=?").get(orderId);
      if(prior){
        if(prior.account_id!==accountId || prior.notice_version!==version || prior.review_digest!==row.review_digest)
          throw Error("Consent snapshot conflict");
        return;
      }
      this.db.prepare("INSERT INTO customer_early_performance_consents(order_id,account_id,notice_version,review_digest,acknowledged_at) VALUES(?,?,?,?,?)")
        .run(orderId,accountId,version,row.review_digest,Date.now());
      this.audit("customer-early-performance-consent",version,orderId);
    });
  }
  /** A provider dispatch must not rely on client-only acknowledgement. */
  hasEarlyPerformanceConsent(orderId: string): boolean {
    const row=this.db.prepare(`
      SELECT c.notice_version,c.review_digest,i.review_digest AS current_digest
      FROM customer_early_performance_consents c
      JOIN customer_order_inputs i ON i.order_id=c.order_id
      WHERE c.order_id=?
    `).get(orderId);
    return Boolean(row && row.notice_version==="early-performance-v1-2026-11-09" && row.review_digest===row.current_digest);
  }
  /** E-mail on a durable medium must be delivered before starting the costly provider job.
   * A stored consent alone cannot make statutory withdrawal rights expire. */
  markContractConfirmationSent(orderId:string){
    return this.tx(()=>{
      const order=this.db.prepare("SELECT status FROM customer_orders WHERE id=?").get(orderId);
      if(!order || order.status!=="paid" || !this.hasEarlyPerformanceConsent(orderId))
        throw Error("Paid order and valid acknowledgement required");
      this.db.prepare("INSERT OR IGNORE INTO customer_contract_confirmations VALUES(?,?,?)")
        .run(orderId,"early-performance-v1-2026-11-09",Date.now());
      this.audit("contract-confirmation","durable-email-sent",orderId);
    });
  }
  hasContractConfirmation(orderId:string):boolean{
    const record=this.db.prepare("SELECT notice_version FROM customer_contract_confirmations WHERE order_id=?").get(orderId);
    return Boolean(record && record.notice_version==="early-performance-v1-2026-11-09" && this.hasEarlyPerformanceConsent(orderId));
  }
  /** Bind the exact Stripe-created Checkout Session before accepting any payment. */
  bindStripeCheckout(orderId: string, sessionId: string) {
    if (!/^cs_(?:test|live)_[A-Za-z0-9_]+$/.test(sessionId))
      throw Error("Invalid Stripe Checkout Session");
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
    new PlanLedger(this.db); // Ensure split-quote schema exists for legacy customer stores.
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
      if (!o || o.price_cents !== receipt.cents || o.currency !== receipt.currency)
        throw Error("Payment requires reconciliation");
      // A delayed signed Checkout notification after a verified refund must
      // be acknowledged idempotently, never re-authorize fulfillment.
      if (o.status === "refunded" && receipt.provider === "stripe") {
        const refunded=this.db.prepare("SELECT order_id FROM customer_stripe_refunds WHERE order_id=?").get(receipt.orderId);
        if(!refunded)throw Error("Refunded payment needs reconciliation");
        this.db.prepare("INSERT INTO payment_events VALUES(?,?,?)").run(key,digest,Date.now());
        return;
      }
      // Disputed payments may still receive earlier, signed Checkout events.
      // A matching recorded dispute is authoritative; never reopen the order.
      if(o.status==="disputed" && receipt.provider==="stripe"){
        const dispute=this.db.prepare("SELECT dispute_id FROM customer_stripe_disputes WHERE order_id=?").get(receipt.orderId);
        if(!dispute)throw Error("Disputed payment needs reconciliation");
        this.db.prepare("INSERT INTO payment_events VALUES(?,?,?)").run(key,digest,Date.now());
        return;
      }
      // After fulfillment, allowance settlement may already be consumed.
      // Distinct valid Stripe events must remain idempotent even then.
      if (o.status === "paid") {
        const existing = this.db.prepare("SELECT order_id FROM customer_fulfillment_queue WHERE order_id=?").get(receipt.orderId);
        if (!existing) throw Error("Paid order missing fulfillment record");
        this.db.prepare("INSERT INTO payment_events VALUES(?,?,?)").run(key,digest,Date.now());
        return;
      }
      // A mixed Hobby quote, when present, must be bound to this exact order
      // before a signed payment can advance fulfillment. The reservation and
      // payment confirmation share this SQLite transaction.
      const split = this.db.prepare("SELECT account_id,extra_cents,state,included_seconds,period FROM customer_split_quotes WHERE attempt_id=?").get(receipt.orderId) as {account_id:string;extra_cents:number;state:string;included_seconds:number;period:string}|undefined;
      const promo = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='promo_redemptions'").get()
        ? this.db.prepare("SELECT account_id,original_cents,discount_cents,state FROM promo_redemptions WHERE order_id=?").get(receipt.orderId) as
          {account_id:string;original_cents:number;discount_cents:number;state:string}|undefined
        : undefined;
      if(promo && (!o.account_id || promo.account_id!==o.account_id ||
        promo.original_cents-promo.discount_cents!==receipt.cents || promo.state!=="reserved"))
        throw Error("Promotion payment reservation mismatch");
      if(split){
        if(!o.account_id||split.account_id!==o.account_id||split.extra_cents!==(promo?.original_cents ?? receipt.cents)||split.state!=="reserved")
          throw Error("Split payment reservation mismatch");
        if(split.included_seconds>0){
          const usage=this.db.prepare("SELECT account_id,seconds,period,state FROM customer_plan_usage WHERE provider_attempt_id=?").get(receipt.orderId) as {account_id:string;seconds:number;period:string;state:string}|undefined;
          if(!usage||usage.account_id!==o.account_id||usage.seconds!==split.included_seconds||usage.period!==split.period||usage.state!=="reserved")
            throw Error("Split allowance reservation mismatch");
        }
      }
      if (o.status !== "awaiting_payment") throw Error("Payment requires reconciliation");
      this.db
        .prepare("INSERT INTO payment_events VALUES(?,?,?)")
        .run(key, digest, Date.now());
      this.db
        .prepare("UPDATE customer_orders SET status='paid' WHERE id=?")
        .run(receipt.orderId);
      // Enqueue atomically with payment reconciliation. No provider call is made here.
      this.db.prepare("INSERT INTO customer_fulfillment_queue(order_id,state,created) VALUES(?,'pending',?)")
        .run(receipt.orderId, Date.now());
      if(promo) new PromotionLedger(this.db).settle(receipt.orderId);
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
  /** Verify the reviewed price commitment against the current stored order before Checkout.
   * Fail closed for old, missing or tampered review records. */
  reviewedOrderReadyForCheckout(orderId: string): boolean {
    const row = this.db.prepare(`
      SELECT o.status,o.currency,o.price_cents,o.quote_evidence,
             i.input_digest,i.review_digest
      FROM customer_orders o
      LEFT JOIN customer_order_inputs i ON i.order_id=o.id
      WHERE o.id=?
    `).get(orderId);
    if (!row || row.status !== "awaiting_payment" || row.currency !== "EUR" ||
        typeof row.input_digest !== "string" || typeof row.review_digest !== "string")
      return false;
    try {
      return row.review_digest === reviewedVideoQuoteDigest(
        String(row.input_digest), Number(row.price_cents), String(row.quote_evidence),
      );
    } catch {
      return false;
    }
  }
  /** Private paid worker reads the exact reviewed source snapshot, never client input.
   * Original local files must still be revalidated and rehashed before network submission. */
  paidPreparedMedia(orderId: string): PreparedMedia {
    const row = this.db.prepare(`
      SELECT m.media_json FROM customer_prepared_media m
      JOIN customer_orders o ON o.id=m.order_id
      JOIN customer_fulfillment_queue q ON q.order_id=m.order_id
      WHERE m.order_id=? AND o.status='paid' AND q.state='processing'
    `).get(orderId);
    if (!row) throw Error("Claimed paid media snapshot unavailable");
    const media = JSON.parse(String(row.media_json)) as PreparedMedia;
    this.assertPaidOrderMediaUnchanged(orderId,media);
    return media;
  }
  /** Revalidate privately prepared media against the paid order before provider submission.
   * A changed file, prompt, trim or format must never consume a paid BytePlus call. */
  assertPaidOrderMediaUnchanged(orderId: string, media: PreparedMedia): void {
    const row = this.db.prepare(`
      SELECT o.status,o.price_cents,o.quote_evidence,i.input_digest,i.review_digest
      FROM customer_orders o JOIN customer_order_inputs i ON i.order_id=o.id
      JOIN customer_fulfillment_queue q ON q.order_id=o.id
      WHERE o.id=? AND o.status='paid' AND q.state='processing'
    `).get(orderId);
    if (!row) throw Error("Claimed paid order and reviewed inputs required");
    const actual = reviewedVideoInputDigest(media);
    const review = reviewedVideoQuoteDigest(actual, Number(row.price_cents), String(row.quote_evidence));
    if (actual !== row.input_digest || review !== row.review_digest)
      throw Error("Paid order media changed after review");
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
  /** Automatic activation uses a durable cutoff so old sandbox payments do
   * not suddenly trigger real provider charges after a new deployment.
   * Existing acknowledged tasks remain separately eligible for recovery.
   */
  pendingPaidFulfillmentSince(activatedAt:number,limit=5):string[]{
    if(!Number.isSafeInteger(activatedAt)||activatedAt<=0||activatedAt>Date.now()||
       !Number.isSafeInteger(limit)||limit<1||limit>100)
      throw Error("Invalid automatic fulfillment cutoff or batch size");
    const rows=this.db.prepare(`
      SELECT q.order_id FROM customer_fulfillment_queue q
      JOIN customer_orders o ON o.id=q.order_id
      WHERE q.state='pending' AND o.status='paid' AND q.created>=?
      ORDER BY q.created ASC,q.order_id ASC LIMIT ?
    `).all(activatedAt,limit);
    return rows.map(row=>String(row.order_id));
  }
  /** Recovery discovery only: confirmed provider tasks belonging to paid orders.
   * Does not reclaim unknown submissions or queue fresh provider requests. */
  acknowledgedPaidRecovery(limit = 25): string[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw Error("Invalid recovery batch size");
    const rows = this.db.prepare(`
      SELECT q.order_id FROM customer_fulfillment_queue q
      JOIN customer_orders o ON o.id=q.order_id
      JOIN customer_provider_jobs j ON j.order_id=q.order_id AND j.provider='byteplus'
      JOIN customer_provider_submissions s ON s.order_id=q.order_id
        AND s.provider='byteplus' AND s.state='acknowledged'
      WHERE q.state='processing' AND o.status='paid'
      ORDER BY q.created ASC,q.order_id ASC LIMIT ?
    `).all(limit);
    return rows.map(row=>String(row.order_id));
  }
  /** Persist the reviewed *provider* cost ceiling independently of the customer
   * sale price. A timeout/uncertain provider task retains its full reservation.
   * Serializes concurrent workers across all customer accounts in SQLite.
   * Never accepts a price or cap supplied by an HTTP client.
   */
  reservePaidProviderSpend(orderId: string, policy: {
    inclusiveMaxMicroUsd: number;
    dailyCapMicroUsd: number;
    lifetimeCapMicroUsd: number;
    reviewEvidence: string;
  }): boolean {
    const {inclusiveMaxMicroUsd: cost,dailyCapMicroUsd: daily,
      lifetimeCapMicroUsd: lifetime,reviewEvidence: evidence}=policy;
    if (![cost,daily,lifetime].every(n=>Number.isSafeInteger(n)&&n>0&&n<=1_000_000_000) ||
        cost>daily||cost>lifetime||typeof evidence!=="string" ||
        evidence.trim().length<20||evidence.length>2048)
      throw Error("Reviewed inclusive provider cost policy required");
    return this.tx(()=>{
      const fingerprint=hash(evidence);
      const prior=this.db.prepare(
        "SELECT inclusive_micro_usd,review_hash FROM customer_provider_cost_reservations WHERE order_id=?"
      ).get(orderId) as {inclusive_micro_usd:number;review_hash:string}|undefined;
      if(prior){
        if(prior.inclusive_micro_usd!==cost||prior.review_hash!==fingerprint)
          throw Error("Provider cost reservation conflict");
        return false;
      }
      const eligible=this.db.prepare(`
        SELECT 1 FROM customer_fulfillment_queue q
        JOIN customer_orders o ON o.id=q.order_id
        WHERE q.order_id=? AND q.state='processing' AND o.status='paid'
      `).get(orderId);
      if(!eligible)throw Error("Verified paid order claim required for provider budget");
      const since=Date.now()-86400000;
      const totals=this.db.prepare(`
        SELECT COALESCE(SUM(inclusive_micro_usd),0) AS lifetime,
               COALESCE(SUM(CASE WHEN reserved_at>=? THEN inclusive_micro_usd ELSE 0 END),0) AS daily
        FROM customer_provider_cost_reservations
      `).get(since) as {lifetime:number;daily:number};
      if(!Number.isSafeInteger(totals.lifetime)||!Number.isSafeInteger(totals.daily)||
         totals.daily+cost>daily||totals.lifetime+cost>lifetime)
        throw Error("Provider spending budget exhausted");
      this.db.prepare(`
        INSERT INTO customer_provider_cost_reservations(order_id,inclusive_micro_usd,review_hash,reserved_at)
        VALUES(?,?,?,?)
      `).run(orderId,cost,fingerprint,Date.now());
      this.audit("fulfillment-worker","provider-cost-reserved",orderId);
      return true;
    });
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
      // Final verified private delivery consumes the reserved Hobby allowance
      // atomically with the terminal fulfillment state. Failure does not
      // automatically release it: an uncertain provider job may be billable.
      if(outcome.state==="delivered"){
        const split=this.db.prepare("SELECT state,included_seconds FROM customer_split_quotes WHERE attempt_id=?").get(orderId) as {state:string;included_seconds:number}|undefined;
        if(split && split.state==="reserved"){
          if(split.included_seconds>0){
            const used=this.db.prepare("UPDATE customer_plan_usage SET state='consumed' WHERE provider_attempt_id=? AND state='reserved' AND seconds=?").run(orderId,split.included_seconds);
            if(used.changes!==1)throw Error("Hobby allowance settlement mismatch");
          }
          const committed=this.db.prepare("UPDATE customer_split_quotes SET state='consumed' WHERE attempt_id=? AND state='reserved'").run(orderId);
          if(committed.changes!==1)throw Error("Hobby quote settlement mismatch");
        }else if(split && split.state!=="consumed")throw Error("Hobby reservation was released");
      }
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
