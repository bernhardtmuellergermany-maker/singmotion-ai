import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {PlanLedger,PLAN_RULES} from "@/lib/commerce/plans";
import {dataDir} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {productionCustomerReleaseApproved} from "@/lib/commerce/customer-live-config";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 const denial=stagingDenial(req.headers.get("authorization"));if(denial)return denial;
 if((process.env.RAILWAY_ENVIRONMENT_ID!=="dfaeabed-03df-43ed-aa71-50f343a75041" && !productionCustomerReleaseApproved(process.env))||process.env.CUSTOMER_ACCOUNTS_ENABLED!=="true")return NextResponse.json({error:"Unavailable"},{status:403});
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const id=store.session(req.cookies.get("sm_customer")?.value||"");
  if(!id){
   if(process.env.CMS_ENABLED==="true"){
    const {getPayload}=await import("payload");
    const {default:config}=await import("@payload-config");
    const {hasRole}=await import("@/cms/policy");
    const payload=await getPayload({config});
    const {user}=await payload.auth({headers:req.headers});
    if(user&&hasRole(user,["super-admin"])){
     return NextResponse.json({staffPreview:true,plan:{...PLAN_RULES.free,period:"",secondsUsed:0,secondsRemaining:0},profile:{email:typeof user.email==="string"?user.email:"Staff account",created:Date.now()},orders:[],sessions:0,credits:0,invoiceDownloadsAvailable:false,accountDeletionAvailable:false},{headers:{"Cache-Control":"private, no-store"}});
    }
   }
   return NextResponse.json({error:"Customer login required"},{status:401});
  }
  const profile=store.db.prepare("SELECT email,created FROM customer_accounts WHERE id=?").get(id) as {email:string;created:number}|undefined;
  if(!profile)return NextResponse.json({error:"Account unavailable"},{status:404});
  const orders=store.db.prepare("SELECT id,project_id,price_cents,currency,status,created FROM customer_orders WHERE account_id=? ORDER BY created DESC LIMIT 50").all(id);
  const sessions=store.db.prepare("SELECT COUNT(*) AS count FROM customer_sessions WHERE account_id=? AND expires>?").get(id,Date.now()) as {count:number};
  const credits=store.db.prepare("SELECT COALESCE(SUM(delta),0) AS balance FROM customer_credits WHERE account_id=?").get(id) as {balance:number};
  const plan=new PlanLedger(store.db).snapshot(id);
  return NextResponse.json({plan,profile,orders,sessions:sessions.count,credits:credits.balance,invoiceDownloadsAvailable:false,accountDeletionAvailable:false},{headers:{"Cache-Control":"private, no-store"}});
 }finally{store.close();}
}
