import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {erasureJobByToken} from "@/lib/commerce/customer-erasure-job";
import {stagingDenial} from "@/lib/staging";
import {dataDir} from "@/lib/db";

export const runtime="nodejs";
export const dynamic="force-dynamic";
/** Read-only proof of progress via the HTTPS-only, HttpOnly, account-bound
 * opaque status cookie. No account email, Stripe IDs or media names returned.
 */
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));
 if(denied)return denied;
 const headers={"Cache-Control":"private, no-store","Vary":"Cookie","Referrer-Policy":"no-referrer"};
 if(process.env.CUSTOMER_AUTOMATED_ERASURE_ENABLED!=="true")
  return NextResponse.json({error:"Account erasure status is unavailable."},{status:404,headers});
 const token=req.cookies.get("sm_erasure_status")?.value||"";
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const job=erasureJobByToken(store.db,token);
  if(!job)return NextResponse.json({error:"Deletion receipt expired or unavailable."},{status:401,headers});
  const table=!!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='customer_erasure_refund_intents'").get();
  const payments=table?store.db.prepare("SELECT state,COALESCE(SUM(cents),0) AS cents FROM customer_erasure_refund_intents WHERE account_id=? GROUP BY state")
   .all(job.accountId) as {state:string;cents:number}[]:[];
  const refundedCents=payments.filter(p=>p.state==="succeeded").reduce((s,p)=>s+p.cents,0);
  const pendingCents=payments.filter(p=>p.state!=="succeeded").reduce((s,p)=>s+p.cents,0);
  return NextResponse.json({state:job.state,issue:job.issue,
   requestedAt:job.createdAt,completedAt:job.completedAt,
   refundedCents,pendingCents,
   done:job.state==="completed"},{headers});
 }catch{
  return NextResponse.json({error:"Deletion status is temporarily unavailable."},{status:503,headers});
 }finally{store.close()}
}
