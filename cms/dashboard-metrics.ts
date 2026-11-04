import {DatabaseSync} from "node:sqlite";
import {lstatSync} from "node:fs";
import path from "node:path";

export type CommerceDashboardSnapshot={
 accounts:number;orders:number;freeDeliveries:number;paidOrders:number;
 uncertainFreeAttempts:number;freeReviews:number;
};
/** Super Admin aggregate only, no rows/customer identities and no schema writes.
 * A missing or legacy commerce DB is "unavailable", never fake zero activity.
 */
export function readCommerceDashboard(directory:string):CommerceDashboardSnapshot|null{
 const file=path.join(directory,"commerce.sqlite");
 let db:DatabaseSync|undefined;
 try{
  const info=lstatSync(file);
  if(!info.isFile()||info.isSymbolicLink())return null;
  db=new DatabaseSync(file,{readOnly:true});
  const tables=new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(r=>r.name));
  if(!tables.has("customer_accounts")||!tables.has("customer_orders"))return null;
  const accountRow=db.prepare("SELECT COUNT(*) AS total FROM customer_accounts").get() as {total:number};
  const orders=db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status='free_delivered' THEN 1 ELSE 0 END) AS free_deliveries,
    SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid
    FROM customer_orders`).get() as {total:number;free_deliveries:number|null;paid:number|null};
  const claims=tables.has("free_promo_budget_authorizations")?
   db.prepare(`SELECT
    SUM(CASE WHEN state='submitted_or_unknown' THEN 1 ELSE 0 END) AS uncertain,
    SUM(CASE WHEN state='requires_review' THEN 1 ELSE 0 END) AS review
    FROM free_promo_budget_authorizations`).get() as {uncertain:number|null;review:number|null}:
   {uncertain:0,review:0};
  const result={accounts:accountRow.total,orders:orders.total,
   freeDeliveries:orders.free_deliveries??0,paidOrders:orders.paid??0,
   uncertainFreeAttempts:claims.uncertain??0,freeReviews:claims.review??0};
  if(!Object.values(result).every(n=>Number.isSafeInteger(n)&&n>=0))return null;
  return result;
 }catch{return null}
 finally{db?.close()}
}
