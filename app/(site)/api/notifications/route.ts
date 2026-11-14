import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {CreditWallet} from "@/lib/commerce/credit-wallet";
import {NotificationInbox} from "@/lib/commerce/notifications";
import {resolveCreditWalletIdentity} from "@/lib/commerce/credit-wallet-auth";
import {dataDir} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","Vary":"Cookie","X-Content-Type-Options":"nosniff"};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
async function withAccount(req:NextRequest,fn:(inbox:NotificationInbox,subject:string)=>unknown){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try {
  const identity=await resolveCreditWalletIdentity(req,store);
  if(!identity)return json({error:"Login required."},401);
  new CreditWallet(store.db); // Initialize ledger for an account with no purchases.
  return json(fn(new NotificationInbox(store.db),identity.subject));
 }catch(e){console.error("Notifications unavailable",{category:e instanceof Error?e.name:"unknown"});return json({error:"Notifications temporarily unavailable."},503)}
 finally{store.close();}
}
export async function GET(req:NextRequest){return withAccount(req,(inbox,subject)=>inbox.list(subject));}
export async function POST(req:NextRequest){
 const origin=applicationOrigin(req.url,req.headers.get("host"));
 if(!origin||req.headers.get("origin")!==origin)return json({error:"Invalid request origin."},403);
 if(Number(req.headers.get("content-length"))>600)return json({error:"Request too large."},413);
 let input:unknown;
 try{const raw=await req.text();if(Buffer.byteLength(raw)>600)return json({error:"Request too large."},413);input=JSON.parse(raw);}
 catch{return json({error:"Invalid request."},400);}
 if(typeof input!=="object"||input===null)return json({error:"Invalid request."},400);
 const data=input as {action?:unknown;id?:unknown};
 if(!["read","unread","delete","read-all","clear-all"].includes(String(data.action)))return json({error:"Invalid action."},400);
 if(data.id!==undefined&&(typeof data.id!=="string"||data.id.length>160))return json({error:"Invalid notification."},400);
 return withAccount(req,(inbox,subject)=>{
  inbox.mutate(subject,data.action as "read"|"unread"|"delete"|"read-all"|"clear-all",data.id as string|undefined);
  return inbox.list(subject);
 });
}
