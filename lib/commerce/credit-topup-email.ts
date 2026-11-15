import type {CommerceStore} from "./store.ts";

/** Payment confirmation, not a tax invoice. Never sent before a signed Stripe
 * Checkout has been reconciled into the account-bound paid Credits ledger.
 * Resend's idempotency key prevents duplicate sends on webhook retries; our
 * durable sent marker prevents later replays after the provider key expires. */
export async function ensurePaidCreditEmail(
 store:CommerceStore,purchaseId:string,
 env:Record<string,string|undefined>=process.env,
 sender:typeof fetch=fetch,
):Promise<boolean>{
 if(!/^[0-9a-f-]{36}$/i.test(purchaseId))return false;
 if(!env.RESEND_API_KEY||!env.ACCOUNT_EMAIL_FROM)return false;
 store.db.exec(`CREATE TABLE IF NOT EXISTS credit_topup_email_notifications(
  purchase_id TEXT PRIMARY KEY,sent_at INTEGER NOT NULL)`);
 const row=store.db.prepare(`SELECT id,email,credits,cents,status FROM credit_topup_purchases WHERE id=?`)
  .get(purchaseId) as {id:string;email:string;credits:number;cents:number;status:string}|undefined;
 if(!row||row.status!=="paid"||!Number.isSafeInteger(row.credits)||
    !Number.isSafeInteger(row.cents)||row.cents!==row.credits||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))return false;
 if(store.db.prepare("SELECT 1 FROM credit_topup_email_notifications WHERE purchase_id=?")
   .get(purchaseId))return true;
 const subject="SingMotion AI – Payment received · "+row.credits+" Credits";
 const text=[
  "Thank you for your SingMotion AI purchase.","",
  "Payment received: EUR "+(row.cents/100).toFixed(2),
  "Credits added to your wallet: "+row.credits.toLocaleString("en-GB"),
  "Payment reference: "+row.id,"",
  "View your balance, receipt and available invoices in your private account:",
  "https://www.singmotion.ai/account/settings#invoices","",
  "This is a payment confirmation, not a tax invoice. A separate invoice PDF",
  "appears in Account Settings after Stripe has issued it.","",
  "Questions? support@singmotion.ai",
 ].join("\n");
 try{
  const result=await sender("https://api.resend.com/emails",{
   method:"POST",
   headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,
    "Content-Type":"application/json",
    "Idempotency-Key":"singmotion-credit-payment/"+row.id},
   body:JSON.stringify({from:env.ACCOUNT_EMAIL_FROM,to:[row.email],subject,text}),
   cache:"no-store",signal:AbortSignal.timeout(10000),
  });
  if(!result.ok)return false;
  store.db.prepare("INSERT OR IGNORE INTO credit_topup_email_notifications VALUES(?,?)")
   .run(row.id,Date.now());
  return true;
 }catch{return false;}
}
