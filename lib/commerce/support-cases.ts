import {DatabaseSync} from "node:sqlite";
import {existsSync} from "node:fs";
import {CreditWallet,type VideoReservation} from "./credit-wallet.ts";

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function supportReference(value:string):string{
  const v=value.trim().replace(/^SM-/i,"");
  if(!UUID.test(v))throw Error("Enter a complete order or project ID (UUID).");
  return v.toLowerCase();
}
type OrderRecord={id:string;project_id:string;email:string;account_id:string|null;
  price_cents:number;status:string;created:number;fulfillment:string|null;video_ready:number;
  stripe_session:string|null;provider_submitted:number;provider_job:number;refund_id:string|null};
export type SupportLookup={
  id:string;type:"stripe-order"|"credit-video"|"studio-project"|"credit-topup";
  customerEmail:string|null;state:string;created:number;projectId:string;
  details:Record<string,string|number|boolean|null>;
  refundable:boolean;refundReason:string;caseStatus:"open"|"resolved";
  resolvedAt:number|null;
};
export type LiveEvidence={state:string;failureCode:string|null;outputReady:boolean;owner:string}|null;
export function readStudioEvidence(id:string,liveFile:string):LiveEvidence{
  if(!existsSync(liveFile))return null;
  const live=new DatabaseSync(liveFile,{readOnly:true});
  try{
    const row=live.prepare("SELECT data FROM live_attempts WHERE id=?").get(id) as {data:string}|undefined;
    if(!row)return null;
    const a=JSON.parse(row.data) as {state?:unknown;failureCode?:unknown;outputPath?:unknown;media?:{owner?:unknown}};
    return {state:typeof a.state==="string"?a.state:"unknown",
      failureCode:typeof a.failureCode==="string"&&/^[A-Z][A-Z0-9_]{2,79}$/.test(a.failureCode)?a.failureCode:null,
      outputReady:a.state==="completed"&&typeof a.outputPath==="string"&&a.outputPath.length>0,
      owner:typeof a.media?.owner==="string"&&/^[A-Za-z0-9_-]{1,150}$/.test(a.media.owner)?a.media.owner:""};
  }catch{return null}finally{live.close()}
}
/** Search is exact-ID only, never fuzzy or across another customer's session. Access is exclusively Super Admin API. */
export class SupportCases{
  constructor(private db:DatabaseSync){
    new CreditWallet(db);
    db.exec(`CREATE TABLE IF NOT EXISTS support_cases(
      reference TEXT PRIMARY KEY,case_type TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('open','resolved')),
      note TEXT,actor TEXT,resolved_at INTEGER,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS support_case_events(
      event_key TEXT PRIMARY KEY,reference TEXT NOT NULL,kind TEXT NOT NULL,actor TEXT NOT NULL,
      note TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS support_case_mail_outbox(
      event_key TEXT PRIMARY KEY,reference TEXT NOT NULL,recipient TEXT NOT NULL,
      subject TEXT NOT NULL,body TEXT NOT NULL,
      created_at INTEGER NOT NULL,attempt_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at INTEGER,sent_at INTEGER);
      CREATE TABLE IF NOT EXISTS support_stripe_refund_intents(
      order_id TEXT PRIMARY KEY,checkout_session TEXT NOT NULL,amount_cents INTEGER NOT NULL,
      actor TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('requested','pending','succeeded','failed')),
      refund_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    `);
  }
  private resolveState(id:string){
    return this.db.prepare("SELECT status,resolved_at FROM support_cases WHERE reference=?").get(id) as {status:"open"|"resolved";resolved_at:number|null}|undefined;
  }
  private customerEmail(subject:string):string|null {
    const m=/^customer:([A-Za-z0-9_-]{1,100})$/.exec(subject);
    if(!m)return null;
    return (this.db.prepare("SELECT email FROM customer_accounts WHERE id=?").get(m[1]) as {email:string}|undefined)?.email??null;
  }
  lookup(value:string,liveFile:string):SupportLookup|null{
    const id=supportReference(value),c=this.resolveState(id);
    const order=this.db.prepare(`SELECT o.id,o.project_id,o.email,o.account_id,o.price_cents,o.status,o.created,
      q.state fulfillment,CASE WHEN d.asset_id IS NOT NULL THEN 1 ELSE 0 END video_ready,
      s.session_id stripe_session,
      CASE WHEN x.order_id IS NOT NULL THEN 1 ELSE 0 END provider_submitted,
      CASE WHEN j.order_id IS NOT NULL THEN 1 ELSE 0 END provider_job,
      r.refund_id
      FROM customer_orders o LEFT JOIN customer_fulfillment_queue q ON q.order_id=o.id
      LEFT JOIN customer_video_deliveries d ON d.order_id=o.id
      LEFT JOIN stripe_checkout_sessions s ON s.order_id=o.id
      LEFT JOIN customer_provider_submissions x ON x.order_id=o.id
      LEFT JOIN customer_provider_jobs j ON j.order_id=o.id
      LEFT JOIN customer_stripe_refunds r ON r.order_id=o.id
      WHERE o.id=? OR o.project_id=? ORDER BY o.created DESC LIMIT 1`).get(id,id) as OrderRecord|undefined;
    if(order){
      const intent=this.db.prepare("SELECT status FROM support_stripe_refund_intents WHERE order_id=?").get(order.id) as {status:string}|undefined;
      const refundable=order.status==="paid"&&order.price_cents>0&&!!order.stripe_session&&
        !order.refund_id&&!order.video_ready&&
        (order.fulfillment==="failed"||
          order.fulfillment==="pending"&&!order.provider_submitted&&!order.provider_job);
      return {id:order.id,type:"stripe-order",customerEmail:order.email,state:order.status,
        created:order.created,projectId:order.project_id,
        details:{payment:order.status,fulfillment:order.fulfillment,hasDeliveredVideo:Boolean(order.video_ready),
          chargedEuros:order.price_cents/100,checkoutMode:order.stripe_session?.startsWith("cs_live_")?"live":order.stripe_session?.startsWith("cs_test_")?"test":null,
          providerSubmissionRecorded:Boolean(order.provider_submitted),providerJobRecorded:Boolean(order.provider_job),
          refundStatus:intent?.status??(order.refund_id?"succeeded":null)},
        refundable,refundReason:refundable?"Eligible for explicit full Stripe refund with confirmation.":
          order.video_ready?"Delivered video exists; manual dispute/consumer-rights process required.":
          order.status!=="paid"?"No confirmed paid charge to refund.":
          intent?.status==="pending"?"Stripe refund is being processed.":
          "Provider or payment outcome must be reconciled before refund.",
        caseStatus:c?.status??"open",resolvedAt:c?.resolved_at??null};
    }
    const wallet=new CreditWallet(this.db);
    const hold=wallet.videoReservation(id);
    const live=readStudioEvidence(id,liveFile);
    if(hold){
      const allowed=live?.state==="failed"&&!live.outputReady&&
        ["CONTENT_PREFILTER_REJECTED","PROVIDER_JOB_FAILED","PROVIDER_TASK_CANCELED"].includes(live.failureCode??"");
      const refundable=allowed&&hold.state!=="released";
      return {id,type:"credit-video",customerEmail:this.customerEmail(hold.subject),state:live?.state??"unverified",
        projectId:id,created:hold.created,caseStatus:c?.status??"open",resolvedAt:c?.resolved_at??null,
        details:{creditReservation:hold.state,reservedCredits:hold.credits,
          providerFailureCode:live?.failureCode??null,outputReady:live?.outputReady??false,
          customerSubject:hold.subject},
        refundable,refundReason:hold.state==="released"?"Credits already released.":
          !live?"Provider evidence unavailable; no safe release.":
          live.state!=="failed"?"Original provider task is not terminal; no refund.":
          !allowed?"Output errors and uncertain billing require provider reconciliation.":
          "Super Admin may return the reservation as a goodwill refund; this is a business cost if BytePlus billed the task."};
    }
    if(live){
      return {id,type:"studio-project",customerEmail:null,state:live.state,projectId:id,
        created:0,details:{providerFailureCode:live.failureCode,outputReady:live.outputReady},
        refundable:false,refundReason:"No customer Credit reservation or Stripe order linked.",
        caseStatus:c?.status??"open",resolvedAt:c?.resolved_at??null};
    }
    const topup=wallet.findById(id);
    if(topup){
      return {id,type:"credit-topup",customerEmail:topup.email,state:topup.status,projectId:id,created:topup.created,
        details:{credits:topup.credits,checkoutMode:topup.sessionId?.startsWith("cs_live_")?"live":topup.sessionId?.startsWith("cs_test_")?"test":null},
        refundable:false,refundReason:"Top-up refunds must be reconciled through Stripe webhook to reverse the purchase Credits.",
        caseStatus:c?.status??"open",resolvedAt:c?.resolved_at??null};
    }
    return null;
  }
  /** Must be called after a verified state mutation; an email never claims a refund merely because a button was pressed. */
  enqueue(id:string,type:"credits-returned"|"stripe-refunded"|"resolved"|"delivery-failed",email:string|null,actor:string,note:string):boolean{
    if(!email||!/^([^\s@]+)@([^\s@]+)\.([^\s@]+)$/.test(email))return false;
    if(!/^[a-zA-Z0-9_-]{1,110}$/.test(actor)||note.length<20||note.length>1200)throw Error("Support evidence required");
    const safe=type==="credits-returned"?"The Credits reserved for your video have been returned to your available wallet.":
      type==="stripe-refunded"?"A full refund was confirmed by Stripe for your original payment. Bank processing times may vary.":
      type==="delivery-failed"?"Your video could not be delivered. Your existing order is saved while we verify the payment and provider outcome.":
      "Your support case has been marked resolved.";
    const body=["SingMotion AI – Order / project update","",
      "Reference: "+id,"",safe,
      "Open your account at https://www.singmotion.ai/projects to check the latest verified status.",
      "If you still need help, reply to support@singmotion.ai and include this reference.","",
      "No new payment or video generation was initiated by this notification."].join("\n");
    const eventKey="support-email:"+type+":"+id;
    const changed=this.db.prepare(`INSERT OR IGNORE INTO support_case_mail_outbox
      (event_key,reference,recipient,subject,body,created_at)
      VALUES(?,?,?,?,?,?)`).run(eventKey,id,email,"SingMotion AI – Update "+id.slice(0,8).toUpperCase(),body,Date.now());
    return changed.changes===1;
  }
  refundIntent(orderId:string):{checkout_session:string;amount_cents:number;actor:string;reason:string;status:string;refund_id:string|null}|null{
    return (this.db.prepare("SELECT checkout_session,amount_cents,actor,reason,status,refund_id FROM support_stripe_refund_intents WHERE order_id=?")
      .get(orderId) as {checkout_session:string;amount_cents:number;actor:string;reason:string;status:string;refund_id:string|null}|undefined)??null;
  }
  /** Persist a stable, idempotent refund intent BEFORE contacting Stripe. An
   * unstarted pending fulfillment is atomically stopped to avoid a dispatch race. */
  beginStripeRefund(value:string,actor:string,reason:string,liveFile:string){
    const id=supportReference(value);
    if(!/^[A-Za-z0-9_-]{1,110}$/.test(actor)||reason.trim().length<20||reason.length>1200)
      throw Error("Super Admin refund reason (at least 20 characters) is required");
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const current=this.refundIntent(id);
      if(current){
        if(current.reason!==reason.trim())throw Error("Existing refund intent uses a different reason; review original request.");
        this.db.exec("COMMIT");return current;
      }
      const order=this.db.prepare(`SELECT o.status,o.price_cents,o.currency,s.session_id,
       q.state fulfillment,
       EXISTS(SELECT 1 FROM customer_provider_submissions x WHERE x.order_id=o.id) submitted,
       EXISTS(SELECT 1 FROM customer_provider_jobs j WHERE j.order_id=o.id) job,
       EXISTS(SELECT 1 FROM customer_video_deliveries d WHERE d.order_id=o.id) delivered,
       EXISTS(SELECT 1 FROM customer_stripe_disputes t WHERE t.order_id=o.id) disputed
       FROM customer_orders o JOIN stripe_checkout_sessions s ON s.order_id=o.id
       LEFT JOIN customer_fulfillment_queue q ON q.order_id=o.id WHERE o.id=?`).get(id) as
       {status:string;price_cents:number;currency:string;session_id:string;fulfillment:string;submitted:number;job:number;delivered:number;disputed:number}|undefined;
      if(!order||order.status!=="paid"||order.currency!=="EUR"||order.price_cents<=0||
        order.delivered||order.disputed||
        !(order.fulfillment==="failed"||(order.fulfillment==="pending"&&!order.submitted&&!order.job)))
        throw Error("Refund is blocked until provider job is terminal and video is undelivered.");
      if(order.fulfillment==="pending"){
        const changed=this.db.prepare("UPDATE customer_fulfillment_queue SET state='failed' WHERE order_id=? AND state='pending'").run(id);
        if(changed.changes!==1)throw Error("Fulfillment changed during refund; try status lookup again.");
      }
      this.db.prepare(`INSERT INTO support_stripe_refund_intents(
       order_id,checkout_session,amount_cents,actor,reason,status,created_at,updated_at)
       VALUES(?,?,?,?,?,'requested',?,?)`)
        .run(id,order.session_id,order.price_cents,actor,reason.trim(),Date.now(),Date.now());
      this.db.prepare("INSERT OR IGNORE INTO support_case_events VALUES(?,?,?,?,?,?)")
        .run("stripe-refund-request:"+id,id,"stripe-refund-requested",actor,reason.trim(),Date.now());
      this.db.exec("COMMIT");
      return this.refundIntent(id)!;
    }catch(e){this.db.exec("ROLLBACK");throw e}
  }
  updateRefundIntent(orderId:string,refundId:string,status:"pending"|"failed"){
    if(!/^re_[A-Za-z0-9_]+$/.test(refundId))throw Error("Invalid Stripe refund identity");
    const intent=this.refundIntent(orderId);
    if(!intent||intent.status==="succeeded"||intent.refund_id&&intent.refund_id!==refundId)
      throw Error("Stripe refund intent mismatch");
    this.db.prepare("UPDATE support_stripe_refund_intents SET refund_id=?,status=?,updated_at=? WHERE order_id=? AND status!='succeeded'")
      .run(refundId,status,Date.now(),orderId);
  }
  markResolved(value:string,actor:string,note:string,liveFile:string):SupportLookup{
    const id=supportReference(value),target=this.lookup(id,liveFile);
    if(!target)throw Error("Order or project ID not found");
    if(!/^[a-zA-Z0-9_-]{1,110}$/.test(actor)||note.trim().length<20||note.length>1200)
      throw Error("A specific resolution reason (at least 20 characters) is required.");
    if(target.type==="stripe-order" && target.state==="paid" &&
      target.details.fulfillment==="failed" && target.details.refundStatus!=="succeeded")
      throw Error("Paid undelivered video cannot be closed as resolved until refund or verified delivery.");
    if(target.type==="credit-video" &&
      ["reserved","review"].includes(String(target.details.creditReservation)) &&
      ["failed","uncertain"].includes(target.state))
      throw Error("Unsettled Credit reservation cannot be marked resolved before reconciliation.");
    const key="resolved:"+target.id;
    this.db.exec("BEGIN IMMEDIATE");
    try{
      if(!this.resolveState(target.id)){
        this.db.prepare("INSERT INTO support_cases(reference,case_type,status,note,actor,resolved_at,updated_at) VALUES(?,?, 'resolved',?,?,?,?)")
          .run(target.id,target.type,note.trim(),actor,Date.now(),Date.now());
      }else{
        this.db.prepare("UPDATE support_cases SET status='resolved',note=?,actor=?,resolved_at=COALESCE(resolved_at,?),updated_at=? WHERE reference=?")
          .run(note.trim(),actor,Date.now(),Date.now(),target.id);
      }
      this.db.prepare("INSERT OR IGNORE INTO support_case_events VALUES(?,?,?,?,?,?)")
        .run(key,target.id,"resolved",actor,note.trim(),Date.now());
      this.enqueue(target.id,"resolved",target.customerEmail,actor,note);
      this.db.exec("COMMIT");
    }catch(e){this.db.exec("ROLLBACK");throw e}
    return this.lookup(target.id,liveFile)!;
  }
  refundCredit(value:string,actor:string,note:string,liveFile:string):SupportLookup {
    const target=this.lookup(value,liveFile);
    if(!target||target.type!=="credit-video")throw Error("No matching prepaid video Credit reservation.");
    if(!target.refundable)throw Error(target.refundReason);
    const wallet=new CreditWallet(this.db);
    const evidence=readStudioEvidence(target.id,liveFile);
    if(!evidence||evidence.state!=="failed"||evidence.outputReady||
      !["CONTENT_PREFILTER_REJECTED","PROVIDER_JOB_FAILED","PROVIDER_TASK_CANCELED"].includes(evidence.failureCode??""))
      throw Error("Terminal provider failure evidence required");
    wallet.supportRefundVideo(target.id,actor,note,evidence.failureCode!);
    this.db.prepare("INSERT OR IGNORE INTO support_case_events VALUES(?,?,?,?,?,?)")
      .run("refund-credit:"+target.id,target.id,"credits-returned",actor,note.trim(),Date.now());
    this.enqueue(target.id,"credits-returned",target.customerEmail,actor,note);
    return this.lookup(target.id,liveFile)!;
  }
}
