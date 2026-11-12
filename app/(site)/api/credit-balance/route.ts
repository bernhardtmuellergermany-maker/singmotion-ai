import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {CreditWallet,stripeCreditTopupsTestEnabled,stripeCreditTopupsLiveEnabled} from "@/lib/commerce/credit-wallet";
import {resolveCreditWalletIdentity} from "@/lib/commerce/credit-wallet-auth";
import {dataDir} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {customerLaunchReadiness} from "@/lib/commerce/readiness";
import {auditSingMotionLaunch} from "@/lib/launch-audit";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","Vary":"Cookie","X-Content-Type-Options":"nosniff"};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});

/** All accounts, including a CMS super-admin, see only their real own ledger.
 * Historical video EUR payments are displayed separately as equivalents,
 * never counted as newly purchased or consumed wallet credits.
 */
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const identity=await resolveCreditWalletIdentity(req,store);
  if(!identity)return json({error:"Account login required."},401);
  const wallet=new CreditWallet(store.db);
  const purchased=wallet.total(identity.subject);
  // Pending/uncertain video submissions block spendable credits but do not
  // consume the ledger until the deliverable MP4 is validated.
  const videoReserved=wallet.reserved(identity.subject);
  const videoReservations=wallet.videoReservations(identity.subject)
    .filter(row=>row.state==="reserved"||row.state==="review")
    .map(row=>({projectId:row.projectId,credits:row.credits,state:row.state,created:row.created}));
  let legacy=0,reserved=videoReserved;
  let oldEntries:Array<{id:string;credits:number;type:string;created:number;reference:string}>=[];
  let oldOrders:Array<{id:string;projectId:string;credits:number;euros:number;created:number;status:string}>=[];
  if(identity.customerId){
   const accountId=identity.customerId;
   const total=store.db.prepare(
    "SELECT COALESCE(SUM(delta),0) AS total FROM customer_credits WHERE account_id=?"
   ).get(accountId) as {total:number};
   const holds=store.db.prepare(
    "SELECT COALESCE(SUM(cents),0) AS total FROM customer_holds WHERE account_id=? AND state='reserved'"
   ).get(accountId) as {total:number};
   legacy=Number(total.total);reserved=Number(holds.total);
   oldEntries=(store.db.prepare(
    "SELECT id,delta,kind,created FROM customer_credits WHERE account_id=? ORDER BY created DESC,id DESC LIMIT 100"
   ).all(accountId) as Array<{id:string;delta:number;kind:string;created:number}>)
    .map(row=>({id:row.id,credits:row.delta,type:row.kind==="order"?"video":row.kind,
     created:row.created,reference:row.id}));
   // Only actual completed customer purchases; not estimates or unpaid orders.
   oldOrders=(store.db.prepare(`
    SELECT id,project_id,price_cents,created,status FROM customer_orders
    WHERE account_id=? AND price_cents>0 AND status IN ('paid','delivered')
    ORDER BY created DESC LIMIT 100
   `).all(accountId) as Array<{id:string;project_id:string;price_cents:number;created:number;status:string}>)
    .map(row=>({id:row.id,projectId:row.project_id,credits:row.price_cents,euros:row.price_cents,
     created:row.created,status:row.status}));
  }
  const entries=[...wallet.entries(identity.subject),...oldEntries]
   .sort((a,b)=>b.created-a.created).slice(0,150);
  const rawBalance=purchased+legacy-reserved;
  const testCheckout=stripeCreditTopupsTestEnabled(process.env);
  const liveCheckout=stripeCreditTopupsLiveEnabled(process.env)&&
    customerLaunchReadiness().readyForPaidOrders&&
    auditSingMotionLaunch(process.env,"production").ready;
  return json({
   availableCredits:Math.max(0,rawBalance),
   reservedCredits:Math.max(0,reserved),
   outstandingCredits:Math.max(0,-rawBalance),
   currency:"EUR",
   purchaseEnabled:testCheckout||liveCheckout,
   testMode:testCheckout,
   entries,
   legacyOrders:oldOrders,
   purchases:wallet.purchases(identity.subject),
   videoReservations,
  });
 }catch(e){
  console.error("Account credit overview failed",{category:e instanceof Error?e.name:"unknown"});
  return json({error:"Credit balance temporarily unavailable."},503);
 }finally{store.close()}
}
