import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {CreditWallet} from "@/lib/commerce/credit-wallet";
import {dataDir} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {customerStripeCredential,stripeSessionIdMatchesMode,type StripePaymentMode} from "@/lib/commerce/stripe-payment-mode";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});
type StripeInvoice={id?:string;livemode?:boolean;status?:string;invoice_pdf?:string;hosted_invoice_url?:string;number?:string;created?:number;total?:number;currency?:string};
type StripeSession={id?:string;livemode?:boolean;payment_status?:string;invoice?:string|{id?:string}|null};
function safeStripeDocument(value:unknown):string|null{
 if(typeof value!=="string")return null;
 try{const url=new URL(value);return url.protocol==="https:"&&(url.hostname==="stripe.com"||url.hostname.endsWith(".stripe.com"))?value:null;}catch{return null;}
}
async function stripe(pathname:string,key:string):Promise<Record<string,unknown>>{
 const response=await fetch("https://api.stripe.com/v1/"+pathname,{headers:{Authorization:"Bearer "+key},cache:"no-store",signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error("Stripe invoice lookup unavailable");
 return await response.json() as Record<string,unknown>;
}
/** Only the authenticated account's own paid Checkout sessions can yield invoice links.
 * Stripe receipts without an invoice PDF are never represented as tax invoices. */
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 // Read-only invoice lookup chooses credentials by the actual paid Checkout
 // environment. The reversal classifier can prefer a historical Production
 // sandbox when both sandbox and LIVE keys are configured.
 const credentials=new Map<StripePaymentMode,string>();
 if(process.env.RAILWAY_ENVIRONMENT_ID==="36adc41d-7e54-4396-ad1a-fd432ba0441d"){
  const live=customerStripeCredential(process.env,"live");
  if(live)credentials.set("live",live);
  const sandbox=customerStripeCredential(process.env,"test");
  if(sandbox)credentials.set("test",sandbox);
 }else if(process.env.RAILWAY_ENVIRONMENT_ID==="dfaeabed-03df-43ed-aa71-50f343a75041"){
  const test=customerStripeCredential(process.env,"test");
  if(test)credentials.set("test",test);
 }
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const accountId=store.session(req.cookies.get("sm_customer")?.value||"");
  let subject=accountId?"customer:"+accountId:null;
  if(!subject&&process.env.CMS_ENABLED==="true"){
   try{
    const {getPayload}=await import("payload");
    const {default:config}=await import("@payload-config");
    const {hasRole}=await import("@/cms/policy");
    const payload=await getPayload({config});
    const {user}=await payload.auth({headers:req.headers});
    if(user&&hasRole(user,["super-admin"]))subject="super-admin:"+String(user.id);
   }catch{/* Auth errors must never bypass account ownership. */}
  }
  if(!subject)return reply({error:"Sign in to view your invoices."},401);
  if(credentials.size===0)return reply({invoices:[],message:"Stripe invoice lookup is not available in this environment."});
  new CreditWallet(store.db);
  const rows=accountId?store.db.prepare(`SELECT o.id,o.created,s.session_id FROM customer_orders o
   JOIN stripe_checkout_sessions s ON s.order_id=o.id
   WHERE o.account_id=? AND o.status='paid'
   ORDER BY o.created DESC LIMIT 20`).all(accountId) as {id:string;created:number;session_id:string}[]:[];
  const topups=store.db.prepare(`SELECT id,created,stripe_session_id AS session_id FROM credit_topup_purchases WHERE subject=? AND status='paid' AND stripe_session_id IS NOT NULL ORDER BY created DESC LIMIT 20`).all(subject) as {id:string;created:number;session_id:string}[];
  const invoices:{id:string;number:string;created:number;amount:number;currency:string;pdf:string|null;hosted:string|null}[]=[];
  for(const row of [...rows,...topups].slice(0,30)){
   const mode:StripePaymentMode|null=stripeSessionIdMatchesMode(row.session_id,"live")?"live":
    stripeSessionIdMatchesMode(row.session_id,"test")?"test":null;
   const key=mode?credentials.get(mode):null;
   if(!mode||!key)continue;
   try{
    const session=await stripe("checkout/sessions/"+encodeURIComponent(row.session_id),key) as StripeSession;
    if(session.id!==row.session_id||session.livemode!==(mode==="live")||session.payment_status!=="paid")continue;
    const invoiceId=typeof session.invoice==="string"?session.invoice:session.invoice?.id;
    if(!invoiceId||!/^in_[A-Za-z0-9_]+$/.test(invoiceId))continue;
    const invoice=await stripe("invoices/"+encodeURIComponent(invoiceId),key) as StripeInvoice;
    if(invoice.id!==invoiceId||invoice.livemode!==(mode==="live")||invoice.status!=="paid")continue;
    const pdf=safeStripeDocument(invoice.invoice_pdf),hosted=safeStripeDocument(invoice.hosted_invoice_url);
    if(!pdf&&!hosted)continue;
    invoices.push({id:row.id,number:invoice.number||"Invoice",created:typeof invoice.created==="number"?invoice.created*1000:row.created,
     amount:typeof invoice.total==="number"?invoice.total:0,currency:invoice.currency||"eur",pdf,hosted});
   }catch{/* An unavailable Stripe record never becomes a downloadable invoice. */}
  }
  return reply({invoices,message:invoices.length?"":"No downloadable Stripe invoices are currently attached to your paid orders."});
 }finally{store.close();}
}
