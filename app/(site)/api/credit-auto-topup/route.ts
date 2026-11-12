import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {resolveCreditWalletIdentity} from "@/lib/commerce/credit-wallet-auth";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"private, no-store","Vary":"Cookie"}});
const thresholds=[250,500,1000,2000] as const;
const amounts=[2000,4000,10000] as const;
const caps=[2000,10000,20000,40000] as const;
const defaults={threshold:500,amount:2000,monthlyCap:10000};

/** No off-session charges exist yet. In particular the advertised "up to 40%"
 * discount is NOT a valid Stripe offer. Store only user preferences; never
 * issue a payment, grant credits, or mark auto-recharge as active. */
async function handle(req:NextRequest,write:boolean){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(write){
  const origin=applicationOrigin(req.url,req.headers.get("host"));
  if(!origin||req.headers.get("origin")!==origin)return json({error:"Invalid request origin"},403);
 }
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const identity=await resolveCreditWalletIdentity(req,store);
  if(!identity)return json({error:"Sign in to manage credit preferences"},401);
  store.db.exec(`CREATE TABLE IF NOT EXISTS credit_auto_topup_preferences (
   subject TEXT PRIMARY KEY, threshold INTEGER NOT NULL, amount INTEGER NOT NULL,
   monthly_cap INTEGER NOT NULL, updated INTEGER NOT NULL
  )`);
  if(write){
   limit("credit-auto-topup-preference",20,60000);
   if(Number(req.headers.get("content-length"))>1024)return json({error:"Request too large"},413);
   const raw=await req.text();
   if(Buffer.byteLength(raw)>1024)return json({error:"Request too large"},413);
   let body:Record<string,unknown>;
   try{body=JSON.parse(raw) as Record<string,unknown>;}catch{return json({error:"Invalid request"},400);}
   if(body.enabled!==false||!thresholds.includes(body.threshold as typeof thresholds[number])||
    !amounts.includes(body.amount as typeof amounts[number])||
    !caps.includes(body.monthlyCap as typeof caps[number])||
    Number(body.monthlyCap)<Number(body.amount))
    return json({error:"Select a valid preference. Automatic payments are not available."},400);
   store.db.prepare(`INSERT INTO credit_auto_topup_preferences(subject,threshold,amount,monthly_cap,updated)
    VALUES(?,?,?,?,?) ON CONFLICT(subject) DO UPDATE SET threshold=excluded.threshold,
    amount=excluded.amount,monthly_cap=excluded.monthly_cap,updated=excluded.updated`)
    .run(identity.subject,body.threshold,body.amount,body.monthlyCap,Date.now());
  }
  const saved=store.db.prepare("SELECT threshold,amount,monthly_cap FROM credit_auto_topup_preferences WHERE subject=?")
   .get(identity.subject) as {threshold:number;amount:number;monthly_cap:number}|undefined;
  return json({
   enabled:false, available:false, discountPercent:0, recurringChargesEnabled:false,
   preference:{threshold:saved?.threshold??defaults.threshold,amount:saved?.amount??defaults.amount,monthlyCap:saved?.monthly_cap??defaults.monthlyCap},
   message:"Automatic credit purchases and recurring charges are not yet enabled. No discounts have been approved. Saving these preferences does not authorize a payment."
  });
 }catch(error){
  console.error("Auto-topup preference unavailable",{category:error instanceof Error?error.name:"unknown"});
  return json({error:"Auto-topup preferences temporarily unavailable"},503);
 }finally{store.close();}
}
export const GET=(req:NextRequest)=>handle(req,false);
export const PUT=(req:NextRequest)=>handle(req,true);
