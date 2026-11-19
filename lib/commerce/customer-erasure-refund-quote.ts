/**
 * Account-deletion refund quote. READ ONLY. No provider mutation, wallet debit
 * or legal conclusion is made by this module. It is the single source for the
 * preview and a future idempotent payout coordinator.
 *
 * Bought Credits are refunded through their original verified Stripe payments.
 * Free promotional Credits are never returned as money. We allocate Credit
 * spending to promotional Credit first, then to bought Credit, so an account
 * does not lose a purchased Credit while free credit is still available.
 */
import type {DatabaseSync} from "node:sqlite";
export type ErasureRefundLine={
 purchaseId:string; sessionId:string; credits:number; cents:number;
};
export type ErasureRefundQuote={
 ready:boolean;reason:"ready"|"pending-checkout"|"unsettled-video"|"unreconciled-wallet"|
 "missing-wallet-records"|"disputed-or-reversed"|"invalid-paid-purchase";
 purchasedCredits:number;spentCredits:number;refundableCredits:number;
 refundableCents:number;freeCredits:number;lines:ErasureRefundLine[];
};
const table=(db:DatabaseSync,name:string):boolean=>!!db.prepare(
 "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const zero=(reason:ErasureRefundQuote["reason"],total=0):ErasureRefundQuote=>
 ({ready:reason==="ready",reason,purchasedCredits:0,spentCredits:0,
 refundableCredits:0,refundableCents:0,freeCredits:Math.max(0,total),lines:[]});
type Topup={id:string;subject:string;credits:number;cents:number;status:string;stripe_session_id:string|null;created:number};
type Event={delta:number;kind:string;reference:string};
type Reservation={credits:number;state:string};
/**
 * Quote is deliberately conservative: unknown ledger entries or paid purchases
 * with no bound Stripe Checkout are a blocker, not a reason to take money out.
 * 'pending' rows must be settled/expired before payout so an in-flight
 * confirmation can never credit a deleted identity.
 */
export function quoteCustomerErasureRefund(db:DatabaseSync,accountId:string):ErasureRefundQuote{
 if(!/^[a-f0-9-]{36}$/i.test(accountId))return zero("unreconciled-wallet");
 const subject="customer:"+accountId;
 const schema=["credit_topup_purchases","credit_wallet_ledger","credit_video_reservations"];
 const existing=schema.filter(name=>table(db,name));
 if(existing.length===0)return zero("ready");
 if(existing.length!==schema.length)return zero("missing-wallet-records");
 const purchases=db.prepare("SELECT id,subject,credits,cents,status,stripe_session_id,created FROM credit_topup_purchases WHERE subject=? ORDER BY created DESC,id DESC")
   .all(subject) as Topup[];
 const events=db.prepare("SELECT delta,kind,reference FROM credit_wallet_ledger WHERE subject=?")
   .all(subject) as Event[];
 const reservations=db.prepare("SELECT credits,state FROM credit_video_reservations WHERE subject=?")
   .all(subject) as Reservation[];
 if(reservations.some(r=>r.state==="reserved"||r.state==="review"))
  return zero("unsettled-video");
 if(purchases.some(p=>p.status==="pending"))
  return zero("pending-checkout");
 // Disputes, earlier purchase reversals and external refund evidence need
 // explicit reconciliation so Stripe does not issue an accidental duplicate.
 if(purchases.some(p=>p.status==="reversed")||
    events.some(e=>e.kind==="refund"||e.kind==="dispute"))
  return zero("disputed-or-reversed");
 if(events.some(e=>!["beta-welcome","purchase","video","video-release",
 "video-service-refund","support-video-refund"].includes(e.kind)))
  return zero("unreconciled-wallet");
 const paid=purchases.filter(p=>p.status==="paid");
 if(paid.some(p=>!Number.isSafeInteger(p.credits)||p.credits<=0||
   !Number.isSafeInteger(p.cents)||p.cents<=0||p.cents!==p.credits||
   !p.stripe_session_id||!/^cs_(?:live|test)_[A-Za-z0-9_]+$/.test(p.stripe_session_id)))
  return zero("invalid-paid-purchase");
 const purchasesByReference=new Map(paid.map(p=>["credit-topup:"+p.id,p]));
 const matched=new Set<string>();
 for(const event of events){
  if(!Number.isSafeInteger(event.delta))return zero("unreconciled-wallet");
  if(event.kind==="purchase"){
   const purchase=purchasesByReference.get(event.reference);
   if(!purchase||event.delta!==purchase.credits||matched.has(event.reference))
    return zero("unreconciled-wallet");
   matched.add(event.reference);
  }else if(event.kind==="beta-welcome"){
   if(event.reference!=="beta-welcome:v1:"+accountId||event.delta!==250)
    return zero("unreconciled-wallet");
  }else if(event.kind==="video"&&event.delta>=0)
   return zero("unreconciled-wallet");
  else if(event.kind==="support-video-refund"&&event.delta<0)
   return zero("unreconciled-wallet");
  else if((event.kind==="video-release"||event.kind==="video-service-refund")&&event.delta!==0)
   return zero("unreconciled-wallet");
 }
 if(matched.size!==paid.length)return zero("unreconciled-wallet");
 const purchasedCredits=paid.reduce((n,p)=>n+p.credits,0);
 const walletTotal=events.reduce((n,e)=>n+e.delta,0);
 if(!Number.isSafeInteger(walletTotal)||walletTotal<0)
  return zero("unreconciled-wallet");
 const freeGranted=events.filter(e=>e.kind==="beta-welcome").reduce((n,e)=>n+e.delta,0);
 const used=Math.max(0,events.filter(e=>e.kind==="video").reduce((n,e)=>n-e.delta,0)-
   events.filter(e=>e.kind==="support-video-refund").reduce((n,e)=>n+e.delta,0));
 // Free Credits are consumed first (customer-favourable allocation).
 // Cap by *spendable* wallet and actually verified paid credits.
 const refundableCredits=Math.max(0,Math.min(purchasedCredits,walletTotal));
 let remaining=refundableCredits;
 const lines:ErasureRefundLine[]=[];
 for(const p of paid){
  const take=Math.min(remaining,p.credits);
  if(take>0){lines.push({purchaseId:p.id,sessionId:p.stripe_session_id!,credits:take,
   cents:Math.floor(p.cents*take/p.credits)});remaining-=take;}
 }
 if(remaining!==0||lines.some(x=>x.cents<1))
  return zero("unreconciled-wallet");
 return {ready:true,reason:"ready",purchasedCredits,spentCredits:used,
  refundableCredits,refundableCents:lines.reduce((n,l)=>n+l.cents,0),
  freeCredits:Math.max(0,walletTotal-refundableCredits),lines};
}
