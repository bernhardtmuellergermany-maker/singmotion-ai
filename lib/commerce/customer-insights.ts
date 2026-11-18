import {DatabaseSync} from "node:sqlite";
import {lstatSync} from "node:fs";
import path from "node:path";

/**
 * Private, read-only operator projection of already-collected transactional
 * customer data. No tracking, guessed visit duration, IP lookup, profile
 * enrichment, behavioral marketing flags or write/migration side effects.
 *
 * All amounts are stored in euro cents; these are application-ledger estimates,
 * not Stripe settlements, accounting revenue, VAT or profit.
 */
export type CustomerInsight={
 id:string;email:string;joinedAt:number;verification:"verified"|"pending"|"legacy";
 orders:number;unpaidOrders:number;videos:number;creditVideos:number;historicalVideos:number;
 boughtCredits:number;promotionalCredits:number;availableCredits:number;
 reservedCredits:number;creditsSpent:number;paidTopups:number;
 topupCents:number;legacyGrossCents:number;knownRefundCents:number;
 lastTransactionAt:number|null;pendingTopups:number;reviewVideos:number;
};
export type CustomerInsightsSummary={
 customers:number;registeredLast30Days:number;verifiedCustomers:number;
 verifiedVideoResults:number;creditVideos:number;historicalVideos:number;
 creditTopupCents:number;legacyGrossCents:number;knownRefundCents:number;
 creditsRemaining:number;creditsReserved:number;
 checkoutPending:number;creditVideoReviews:number;
};
export type CustomerInsightEvent={
 id:string;kind:"order"|"credit-topup"|"video"|"wallet";
 at:number;status:string;credits?:number;cents?:number;reference?:string;
};
export type CustomerInsightsList={
 summary:CustomerInsightsSummary;rows:CustomerInsight[];
 page:number;total:number;pageSize:number;hasNext:boolean;search:string;
};
export type CustomerInsightsProfile={customer:CustomerInsight;events:CustomerInsightEvent[]};

const PAGE_SIZE=25;
function hasTable(db:DatabaseSync,table:string):boolean {
 return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
}
function required(db:DatabaseSync){
 if(!hasTable(db,"customer_accounts"))throw Error("Customer insight source unavailable");
}
function n(value:unknown):number {
 const number=Number(value??0);
 return Number.isFinite(number) && Number.isSafeInteger(number)?number:0;
}
function count(db:DatabaseSync,sql:string,...args:(string|number)[]):number {
 return n((db.prepare(sql).get(...args) as {n?:number}|undefined)?.n);
}
function single(db:DatabaseSync,sql:string,...args:(string|number)[]):Record<string,unknown> {
 return (db.prepare(sql).get(...args) as Record<string,unknown>|undefined)??{};
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function customerInsightsSummary(db:DatabaseSync,now=Date.now()):CustomerInsightsSummary{
 required(db);
 const customers=count(db,"SELECT COUNT(*) n FROM customer_accounts");
 const registeredLast30Days=count(db,"SELECT COUNT(*) n FROM customer_accounts WHERE created>=?",now-30*86400000);
 const verifiedCustomers=hasTable(db,"customer_email_verifications")?count(db,
  "SELECT COUNT(*) n FROM customer_email_verifications WHERE verified_at IS NOT NULL"):0;
 const reservation=hasTable(db,"credit_video_reservations")?single(db,`
  SELECT
   COALESCE(SUM(CASE WHEN state='settled' THEN 1 ELSE 0 END),0) settled,
   COALESCE(SUM(CASE WHEN state='review' THEN 1 ELSE 0 END),0) reviews,
   COALESCE(SUM(CASE WHEN state IN ('reserved','review') THEN credits ELSE 0 END),0) reserved
  FROM credit_video_reservations WHERE subject LIKE 'customer:%'`):{};
 const creditVideos=n(reservation.settled);
 let historicalVideos=0;
 if(hasTable(db,"customer_video_deliveries")&&hasTable(db,"customer_orders"))
  historicalVideos+=count(db,`SELECT COUNT(DISTINCT d.order_id) n FROM customer_video_deliveries d
   JOIN customer_orders o ON o.id=d.order_id WHERE o.account_id IS NOT NULL`);
 if(hasTable(db,"free_promo_video_deliveries")&&hasTable(db,"customer_orders"))
  historicalVideos+=count(db,`SELECT COUNT(DISTINCT f.order_id) n FROM free_promo_video_deliveries f
   JOIN customer_orders o ON o.id=f.order_id WHERE o.account_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM customer_video_deliveries d WHERE d.order_id=f.order_id)`);
 const topups=hasTable(db,"credit_topup_purchases")?single(db,`SELECT
   COALESCE(SUM(CASE WHEN status='paid' THEN cents ELSE 0 END),0) paid,
   COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0) pending
   FROM credit_topup_purchases WHERE subject LIKE 'customer:%'`):{};
 const legacy=hasTable(db,"customer_orders")?single(db,`SELECT
   COALESCE(SUM(CASE WHEN status IN ('paid','delivered') AND price_cents>0 THEN price_cents ELSE 0 END),0) gross
   FROM customer_orders WHERE account_id IS NOT NULL`):{};
 const refunds=hasTable(db,"customer_stripe_refunds")&&hasTable(db,"customer_orders")
  ?count(db,`SELECT COALESCE(SUM(r.amount_cents),0) n FROM customer_stripe_refunds r
     JOIN customer_orders o ON o.id=r.order_id WHERE o.account_id IS NOT NULL`):0;
 const balance=hasTable(db,"credit_wallet_ledger")?single(db,`SELECT
  COALESCE(SUM(delta),0) total
  FROM credit_wallet_ledger WHERE subject LIKE 'customer:%'`):{};
 return {
  customers,registeredLast30Days,verifiedCustomers,
  verifiedVideoResults:creditVideos+historicalVideos,creditVideos,historicalVideos,
  creditTopupCents:n(topups.paid),legacyGrossCents:n(legacy.gross),knownRefundCents:refunds,
  creditsRemaining:Math.max(0,n(balance.total)-n(reservation.reserved)),
  creditsReserved:n(reservation.reserved),checkoutPending:n(topups.pending),
  creditVideoReviews:n(reservation.reviews)
 };
}

export function customerInsight(db:DatabaseSync,id:string):CustomerInsight|null{
 required(db);
 if(!uuid.test(id))return null;
 const row=db.prepare("SELECT id,email,created FROM customer_accounts WHERE id=?")
  .get(id) as {id:string;email:string;created:number}|undefined;
 if(!row)return null;
 const subject="customer:"+id;
 const verification=hasTable(db,"customer_email_verifications")?
   db.prepare("SELECT verified_at FROM customer_email_verifications WHERE account_id=?")
   .get(id) as {verified_at:number|null}|undefined:undefined;
 const orders=hasTable(db,"customer_orders")?single(db,`SELECT
   COUNT(*) orders,
   COALESCE(SUM(CASE WHEN status IN ('awaiting_payment','pending') THEN 1 ELSE 0 END),0) unpaid,
   COALESCE(SUM(CASE WHEN status IN ('paid','delivered') AND price_cents>0 THEN price_cents ELSE 0 END),0) gross,
   MAX(created) last
   FROM customer_orders WHERE account_id=?`,id):{};
 const knownRefundCents=hasTable(db,"customer_stripe_refunds")&&hasTable(db,"customer_orders")
  ?count(db,`SELECT COALESCE(SUM(r.amount_cents),0) n FROM customer_stripe_refunds r
    JOIN customer_orders o ON o.id=r.order_id WHERE o.account_id=?`,id):0;
 const ledger=hasTable(db,"credit_wallet_ledger")?single(db,`SELECT
   COALESCE(SUM(delta),0) total,
   COALESCE(SUM(CASE WHEN kind='video' AND delta<0 THEN -delta ELSE 0 END),0) spent,
   COALESCE(SUM(CASE WHEN kind='beta-welcome' THEN delta ELSE 0 END),0) gift
   FROM credit_wallet_ledger WHERE subject=?`,subject):{};
 const video=hasTable(db,"credit_video_reservations")?single(db,`SELECT
   COALESCE(SUM(CASE WHEN state='settled' THEN 1 ELSE 0 END),0) settled,
   COALESCE(SUM(CASE WHEN state='review' THEN 1 ELSE 0 END),0) review,
   COALESCE(SUM(CASE WHEN state IN ('reserved','review') THEN credits ELSE 0 END),0) reserved,
   MAX(updated) last FROM credit_video_reservations WHERE subject=?`,subject):{};
 const topups=hasTable(db,"credit_topup_purchases")?single(db,`SELECT
   COALESCE(SUM(CASE WHEN status='paid' THEN credits ELSE 0 END),0) bought,
   COALESCE(SUM(CASE WHEN status='paid' THEN cents ELSE 0 END),0) cents,
   COALESCE(SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END),0) purchases,
   COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0) pending,
   MAX(created) last FROM credit_topup_purchases WHERE subject=?`,subject):{};
 let historicalVideos=0;
 if(hasTable(db,"customer_video_deliveries")&&hasTable(db,"customer_orders"))
  historicalVideos+=count(db,`SELECT COUNT(DISTINCT d.order_id) n FROM customer_video_deliveries d
    JOIN customer_orders o ON o.id=d.order_id WHERE o.account_id=?`,id);
 if(hasTable(db,"free_promo_video_deliveries")&&hasTable(db,"customer_orders"))
  historicalVideos+=count(db,`SELECT COUNT(DISTINCT f.order_id) n FROM free_promo_video_deliveries f
    JOIN customer_orders o ON o.id=f.order_id WHERE o.account_id=?
    AND NOT EXISTS(SELECT 1 FROM customer_video_deliveries d WHERE d.order_id=f.order_id)`,id);
 const last=Math.max(n(orders.last),n(video.last),n(topups.last));
 return {
  id:row.id,email:row.email,joinedAt:n(row.created),
  verification:!verification?"legacy":verification.verified_at?"verified":"pending",
  orders:n(orders.orders),unpaidOrders:n(orders.unpaid),
  videos:n(video.settled)+historicalVideos,creditVideos:n(video.settled),historicalVideos,
  boughtCredits:n(topups.bought),promotionalCredits:n(ledger.gift),
  availableCredits:Math.max(0,n(ledger.total)-n(video.reserved)),
  reservedCredits:n(video.reserved),creditsSpent:n(ledger.spent),
  paidTopups:n(topups.purchases),topupCents:n(topups.cents),
  legacyGrossCents:n(orders.gross),knownRefundCents,
  lastTransactionAt:last||null,pendingTopups:n(topups.pending),reviewVideos:n(video.review),
 };
}

/** Search and paging happen in SQLite. Do not load the full customer table into JS. */
export function listCustomerInsights(db:DatabaseSync,input:{search?:string;page?:number},now=Date.now()):CustomerInsightsList{
 required(db);
 const search=(input.search||"").trim().slice(0,80);
 const page=Number.isSafeInteger(input.page)&&input.page!>=1&&input.page!<=10000?input.page!:1;
 const where="(? = '' OR instr(lower(email),lower(?)) > 0 OR id = ?)";
 const total=count(db,`SELECT COUNT(*) n FROM customer_accounts WHERE ${where}`,search,search,search);
 const rows=db.prepare(`SELECT id FROM customer_accounts WHERE ${where}
   ORDER BY created DESC,id DESC LIMIT ? OFFSET ?`)
   .all(search,search,search,PAGE_SIZE,(page-1)*PAGE_SIZE) as {id:string}[];
 return {summary:customerInsightsSummary(db,now),rows:rows
   .map(r=>customerInsight(db,r.id)).filter((r):r is CustomerInsight=>r!==null),
  page,total,pageSize:PAGE_SIZE,hasNext:page*PAGE_SIZE<total,search};
}

export function customerInsightProfile(db:DatabaseSync,id:string):CustomerInsightsProfile|null{
 const customer=customerInsight(db,id);
 if(!customer)return null;
 const subject="customer:"+id;
 const events:CustomerInsightEvent[]=[];
 if(hasTable(db,"customer_orders")){
  const orders=db.prepare(`SELECT id,status,price_cents,created FROM customer_orders WHERE account_id=?
    ORDER BY created DESC LIMIT 25`).all(id) as
    Array<{id:string;status:string;price_cents:number;created:number}>;
  for(const o of orders)events.push({id:"order:"+o.id,kind:"order",status:o.status,
    cents:n(o.price_cents),at:n(o.created),reference:o.id});
 }
 if(hasTable(db,"credit_topup_purchases")){
  const topups=db.prepare(`SELECT id,status,credits,cents,created FROM credit_topup_purchases
    WHERE subject=? ORDER BY created DESC LIMIT 25`).all(subject) as
    Array<{id:string;status:string;credits:number;cents:number;created:number}>;
  for(const t of topups)events.push({id:"topup:"+t.id,kind:"credit-topup",status:t.status,
    credits:n(t.credits),cents:n(t.cents),at:n(t.created)});
 }
 if(hasTable(db,"credit_video_reservations")){
  const videos=db.prepare(`SELECT project_id,state,credits,updated FROM credit_video_reservations
    WHERE subject=? ORDER BY updated DESC LIMIT 25`).all(subject) as
    Array<{project_id:string;state:string;credits:number;updated:number}>;
  for(const v of videos)events.push({id:"video:"+v.project_id,kind:"video",status:v.state,
    credits:n(v.credits),at:n(v.updated),reference:v.project_id});
 }
 if(hasTable(db,"credit_wallet_ledger")){
  const wallet=db.prepare(`SELECT id,kind,delta,created FROM credit_wallet_ledger
    WHERE subject=? AND kind IN ('beta-welcome','support-video-refund','refund','dispute')
    ORDER BY created DESC LIMIT 25`).all(subject) as
    Array<{id:string;kind:string;delta:number;created:number}>;
  for(const v of wallet)events.push({id:"wallet:"+v.id,kind:"wallet",
    status:v.kind,credits:n(v.delta),at:n(v.created)});
 }
 return {customer,events:events.sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id)).slice(0,35)};
}

/** Read-only opening is deliberately separate from CommerceStore constructor:
 * it must never run migrations, create tables or mutate customer records. */
export function openCustomerInsightsReadOnly(directory:string):DatabaseSync{
 const file=path.join(directory,"commerce.sqlite");
 const stat=lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error("Customer insights unavailable");
 return new DatabaseSync(file,{readOnly:true});
}
