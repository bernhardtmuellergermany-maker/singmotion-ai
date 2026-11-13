import type {DatabaseSync} from "node:sqlite";
import {assessProtectedProductionLivePilot} from "./protected-production-live-pilot.ts";
import {customerLaunchReadiness} from "./readiness.ts";

/** Redacted, read-only status feed for the private Super Admin Account Settings.
 * This is intentionally NOT Railway deployment health: it reports locally
 * persisted customer support and financial states from this environment only. */
export type AdminSupportMessage={
  id:string;reference:string;kind:"issue"|"credit"|"refund"|"case"|"email";
  text:string;at:number;emailState?:"sent"|"queued";
};
export type AdminSupportOverview={
  environment:"Staging"|"Production"|"Private environment";
  checkedAt:number;
  counts:{supportAlerts:number;paidUndelivered:number;creditReviews:number;stripeRefundsPending:number;emailsQueued:number};
  messages:AdminSupportMessage[];
  privateLive?:{admissionReady:boolean;checkoutReady:boolean;blockers:string[]};
};
const environmentName=(env:Record<string,string|undefined>):AdminSupportOverview["environment"]=>
  env.RAILWAY_ENVIRONMENT_ID==="dfaeabed-03df-43ed-aa71-50f343a75041"?"Staging":
  env.RAILWAY_ENVIRONMENT_ID==="36adc41d-7e54-4396-ad1a-fd432ba0441d"?"Production":"Private environment";
const eventTexts:Record<string,{kind:AdminSupportMessage["kind"];text:string}>={
  "resolved":{kind:"case",text:"Support case marked resolved"},
  "credits-returned":{kind:"credit",text:"Video Credits returned"},
  "stripe-refund-requested":{kind:"refund",text:"Stripe refund requested — awaiting confirmation"},
};
const mailTexts:Record<string,{kind:AdminSupportMessage["kind"];text:string}>={
  "support-operator:output":{kind:"issue",text:"Invalid MP4 / output failure — support review"},
  "support-operator:paid-output":{kind:"issue",text:"Paid video not delivered — support review"},
  "support-email:credits-returned":{kind:"credit",text:"Credit return notification"},
  "support-email:stripe-refunded":{kind:"refund",text:"Verified Stripe refund notification"},
  "support-email:resolved":{kind:"case",text:"Resolution notification"},
  "support-email:delivery-failed":{kind:"issue",text:"Delivery failure notification"},
};
const refundTexts:Record<string,string>={
  requested:"Stripe refund requested — confirmation outstanding",
  pending:"Stripe refund processing at Stripe",
  succeeded:"Stripe refund confirmed",
  failed:"Stripe refund needs manual review",
};
function count(db:DatabaseSync,sql:string):number{
  const row=db.prepare(sql).get() as {n:number|bigint}|undefined;
  return Number(row?.n??0);
}
/** Call only after authenticated Payload CMS super-admin role check. Does not
 * expose emails, case notes, payment tokens, provider tasks or media locations. */
export function adminSupportOverview(
  db:DatabaseSync,env:Record<string,string|undefined>=process.env,
  checkedAt=Date.now(),
):AdminSupportOverview{
  const counts={
    supportAlerts:count(db,`SELECT COUNT(DISTINCT m.reference) n FROM support_case_mail_outbox m
      WHERE m.event_key LIKE 'support-operator:%'
      AND NOT EXISTS(SELECT 1 FROM support_cases c WHERE c.reference=m.reference AND c.status='resolved')`),
    paidUndelivered:count(db,`SELECT COUNT(*) n FROM customer_orders o
      JOIN customer_fulfillment_queue q ON q.order_id=o.id
      WHERE o.status='paid' AND q.state='failed'
      AND NOT EXISTS(SELECT 1 FROM customer_video_deliveries d WHERE d.order_id=o.id)`),
    creditReviews:count(db,"SELECT COUNT(*) n FROM credit_video_reservations WHERE state='review'"),
    stripeRefundsPending:count(db,"SELECT COUNT(*) n FROM support_stripe_refund_intents WHERE status IN ('requested','pending')"),
    emailsQueued:count(db,"SELECT COUNT(*) n FROM support_case_mail_outbox WHERE sent_at IS NULL"),
  };
  const messages:AdminSupportMessage[]=[];
  const mails=db.prepare(`SELECT reference,event_key,created_at,sent_at
     FROM support_case_mail_outbox ORDER BY created_at DESC LIMIT 24`).all() as
      Array<{reference:string;event_key:string;created_at:number;sent_at:number|null}>;
  for(const m of mails){
    const key=Object.keys(mailTexts).find(k=>m.event_key.startsWith(k+":"));
    const item=key?mailTexts[key]:null;
    if(!item)continue;
    messages.push({id:"mail:"+m.event_key,reference:m.reference,kind:item.kind,
      text:item.text,at:Number(m.created_at),emailState:m.sent_at===null?"queued":"sent"});
  }
  const events=db.prepare(`SELECT event_key,reference,kind,created_at FROM support_case_events
     ORDER BY created_at DESC LIMIT 20`).all() as
      Array<{event_key:string;reference:string;kind:string;created_at:number}>;
  for(const e of events){
    const item=eventTexts[e.kind];
    if(!item)continue;
    messages.push({id:"event:"+e.event_key,reference:e.reference,kind:item.kind,
      text:item.text,at:Number(e.created_at)});
  }
  // Surface pending problems immediately even before the email worker has
  // created a support alert. Never imply the original provider job is retried.
  const paid=db.prepare(`SELECT o.id,o.created FROM customer_orders o
    JOIN customer_fulfillment_queue q ON q.order_id=o.id
    WHERE o.status='paid' AND q.state='failed'
      AND NOT EXISTS(SELECT 1 FROM customer_video_deliveries d WHERE d.order_id=o.id)
    ORDER BY o.created DESC LIMIT 10`).all() as Array<{id:string;created:number}>;
  for(const row of paid){
    if(messages.some(m=>m.reference===row.id&&m.text.startsWith("Paid video not delivered")))continue;
    messages.push({id:"undelivered:"+row.id,reference:row.id,kind:"issue",
      text:"Paid video not delivered — requires review",at:Number(row.created)});
  }
  const reviews=db.prepare(`SELECT project_id,updated FROM credit_video_reservations
    WHERE state='review' ORDER BY updated DESC LIMIT 10`).all() as
    Array<{project_id:string;updated:number}>;
  for(const row of reviews)messages.push({id:"credit-review:"+row.project_id,
    reference:row.project_id,kind:"credit",text:"Video Credits awaiting provider review",
    at:Number(row.updated)});
  const intents=db.prepare(`SELECT order_id,status,updated_at FROM support_stripe_refund_intents
     ORDER BY updated_at DESC LIMIT 12`).all() as
      Array<{order_id:string;status:string;updated_at:number}>;
  for(const item of intents){
    const text=refundTexts[item.status];
    if(!text)continue;
    messages.push({id:"refund:"+item.order_id+":"+item.status,reference:item.order_id,
      kind:"refund",text,at:Number(item.updated_at)});
  }
  // Read-only local checks only. No Stripe network request, provider
  // submission, secret value or automatic approval is exposed here.
  const environment=environmentName(env);
  const privateLive=environment==="Production"?(()=>{
    const admission=assessProtectedProductionLivePilot(env);
    const checkout=customerLaunchReadiness(env);
    return {admissionReady:admission.ready,checkoutReady:checkout.readyForPaidOrders,
      blockers:[...new Set([...admission.blockers,...checkout.blockers])].slice(0,40)};
  })():undefined;
  return {environment,checkedAt,counts,
    ...(privateLive?{privateLive}:{}),
    messages:messages
      .filter(m=>/^[a-z0-9-]{8,64}$/i.test(m.reference)&&Number.isFinite(m.at))
      .sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id))
      .slice(0,10)};
}
