import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {NotificationInbox} from "@/lib/commerce/notifications";
import {resolveCreditWalletIdentity} from "@/lib/commerce/credit-wallet-auth";
import {dataDir} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {applicationOrigin} from "@/lib/request-origin";
import {CreditWallet} from "@/lib/commerce/credit-wallet";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","Vary":"Cookie","X-Content-Type-Options":"nosniff"};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
type Category="update"|"offer"|"important";
type AnnouncementInput={id?:unknown;title?:unknown;message?:unknown;category?:unknown};

async function adminStore(req:NextRequest,fn:(store:CommerceStore,inbox:NotificationInbox)=>unknown){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const identity=await resolveCreditWalletIdentity(req,store);
  // Authorization must be verified on every request, never trust the UI's staffPreview flag.
  if(!identity||!identity.subject.startsWith("super-admin:"))return json({error:"Super Admin access required."},403);
  new CreditWallet(store.db);
  const inbox=new NotificationInbox(store.db);
  return json(fn(store,inbox));
 }catch(e){
  console.error("Admin announcement operation failed",{category:e instanceof Error?e.name:"unknown"});
  return json({error:"Announcement operation unavailable."},503);
 }finally{store.close();}
}
export async function GET(req:NextRequest){
 return adminStore(req,(store)=>{
  const announcements=store.db.prepare(`SELECT id,title,message,category,published_at FROM notification_announcements
   ORDER BY published_at DESC LIMIT 30`).all() as Array<{id:string;title:string;message:string;category:Category;published_at:number}>;
  const recipientCount=(store.db.prepare("SELECT COUNT(*) AS count FROM customer_accounts").get() as {count:number}).count;
  return {announcements,recipientCount};
 });
}
export async function POST(req:NextRequest){
 const origin=applicationOrigin(req.url,req.headers.get("host"));
 if(!origin||req.headers.get("origin")!==origin)return json({error:"Invalid request origin."},403);
 const declaredLength=Number(req.headers.get("content-length")||"0");
 if(declaredLength>6500)return json({error:"Request too large."},413);
 let data:AnnouncementInput;
 try{
  const raw=await req.text();
  if(Buffer.byteLength(raw)>6500)return json({error:"Request too large."},413);
  data=JSON.parse(raw) as AnnouncementInput;
 }catch{return json({error:"Invalid request."},400)}
 if(!data||typeof data!=="object"||typeof data.id!=="string"||
    !/^[a-f0-9-]{36}$/i.test(data.id)||
    typeof data.title!=="string"||typeof data.message!=="string"||
    !["update","offer","important"].includes(String(data.category)))
  return json({error:"Invalid announcement."},400);
 const title=data.title.trim(),message=data.message.trim(),category=data.category as Category;
 if(title.length<4||title.length>100||message.length<10||message.length>2000||
    /[\u0000-\u001f\u007f]/.test(title)||/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(message))
  return json({error:"Announcement title or message length is invalid."},400);
 return adminStore(req,(store)=>{
  // This is an IN-APP broadcast, not an email/SMS campaign.
  // A stable client-generated UUID makes retries idempotent.
  const inserted=store.db.prepare(`INSERT OR IGNORE INTO notification_announcements
   (id,title,message,audience,category,published_at,expires_at)
   VALUES(?,?,?,'all',?,?,NULL)`).run(data.id,title,message,category,Date.now());
  if(!inserted.changes){
   const existing=store.db.prepare("SELECT title,message,category FROM notification_announcements WHERE id=?")
    .get(data.id) as {title:string;message:string;category:string}|undefined;
   if(!existing||existing.title!==title||existing.message!==message||existing.category!==category)
    throw Error("Announcement ID conflict");
  }
  return {published:true,id:data.id,created:inserted.changes===1};
 });
}
