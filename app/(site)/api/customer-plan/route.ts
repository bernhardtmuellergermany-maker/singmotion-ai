import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {PlanLedger} from "@/lib/commerce/plans";
import {dataDir, db} from "@/lib/db";
import {uploadedBytes} from "@/lib/upload-storage";
import {stagingDenial} from "@/lib/staging";
export const runtime="nodejs";export const dynamic="force-dynamic";
/** Customer-owned plan status, never Staff Studio access or a video submission. */
export async function GET(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(process.env.RAILWAY_ENVIRONMENT_ID!=="dfaeabed-03df-43ed-aa71-50f343a75041"||process.env.CUSTOMER_ACCOUNTS_ENABLED!=="true")
  return NextResponse.json({error:"Unavailable"},{status:403});
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const accountId=store.session(req.cookies.get("sm_customer")?.value||"");
  if(!accountId)return NextResponse.json({error:"Customer sign-in required"},{status:401,headers:{"Cache-Control":"private, no-store"}});
  const plan=new PlanLedger(store.db).snapshot(accountId);
  // Orders represent purchases, not a quota of currently editable projects.
  const usedBytes=uploadedBytes(db,`customer-${accountId}`);
  return NextResponse.json({plan,projects:{unlimited:true},storage:{usedBytes,limitBytes:plan.uploadStorageBytes,remainingBytes:Math.max(0,plan.uploadStorageBytes-usedBytes)},video:{includedSeconds:plan.monthlySeconds,remainingSeconds:plan.secondsRemaining,minimumSeconds:5,canGenerateFromSubscription:plan.code==="hobby"&&plan.secondsRemaining>=5&&process.env.CUSTOMER_GENERATION_ENABLED==="true"&&process.env.CUSTOMER_FULFILLMENT_ENABLED==="true"&&process.env.CUSTOMER_DELIVERY_ENABLED==="true"}},{headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
 }finally{store.close()}
}
