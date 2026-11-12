import {NextRequest,NextResponse} from "next/server";
import path from "node:path";
import {CommerceStore} from "@/lib/commerce/store";
import {dataDir,limit} from "@/lib/db";
import {stagingDenial} from "@/lib/staging";
import {customerAccountSettingsAccessible} from "@/lib/commerce/customer-live-config";
import {applicationOrigin} from "@/lib/request-origin";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});

export async function POST(req:NextRequest){
 const denied=stagingDenial(req.headers.get("authorization"));if(denied)return denied;
 if(!customerAccountSettingsAccessible(process.env))return reply({error:"Order management unavailable"},403);
 if(req.headers.get("origin")!==applicationOrigin(req.url,req.headers.get("host")))return reply({error:"Invalid origin"},403);
 const store=new CommerceStore(path.join(dataDir,"commerce.sqlite"));
 try{
  const accountId=store.session(req.cookies.get("sm_customer")?.value||"");
  if(!accountId)return reply({error:"Customer sign-in required"},401);
  try{limit("hide-paid-order:"+accountId,5,15*60*1000);}catch{return reply({error:"Too many attempts. Try again later."},429);}
  if(Number(req.headers.get("content-length"))>1024)return reply({error:"Request too large"},413);
  const raw=await req.text();
  if(Buffer.byteLength(raw)>1024)return reply({error:"Request too large"},413);
  let input:{orderId?:unknown;password?:unknown};
  try{input=JSON.parse(raw) as typeof input;}catch{return reply({error:"Invalid request"},400);}
  if(typeof input.orderId!=="string"||!/^[a-f0-9-]{36}$/.test(input.orderId)||
     typeof input.password!=="string"||input.password.length<1||input.password.length>256)
    return reply({error:"Order and password required"},400);
  const order=store.db.prepare("SELECT id,status FROM customer_orders WHERE id=? AND account_id=?")
    .get(input.orderId,accountId) as {id:string;status:string}|undefined;
  if(!order)return reply({error:"Paid order not found"},404);
  if(order.status!=="paid")return reply({error:"Only completed paid orders can be removed"},409);
  if(!store.verifyCustomerPassword(accountId,input.password))
    return reply({error:"Incorrect password. Google-only accounts do not have a password to confirm."},403);
  store.db.exec(`CREATE TABLE IF NOT EXISTS customer_hidden_paid_orders (
    account_id TEXT NOT NULL,order_id TEXT NOT NULL,hidden_at INTEGER NOT NULL,
    PRIMARY KEY(account_id,order_id)
  )`);
  store.db.prepare(`INSERT OR IGNORE INTO customer_hidden_paid_orders(account_id,order_id,hidden_at)
    VALUES(?,?,?)`).run(accountId,input.orderId,Date.now());
  return reply({hidden:true,message:"Order removed from your visible list. Legally required billing records and invoices are retained."});
 }catch{return reply({error:"Unable to update order right now"},503);}
 finally{store.close();}
}
