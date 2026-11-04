import {DatabaseSync} from "node:sqlite";
import {lstatSync} from "node:fs";
import path from "node:path";

/** Private Staging-only operator inspection. No schema creation, no network,
 * customer identifiers, secrets, provider dispatch or mutable transactions.
 */
export function inspectFreePromoRisk(db:DatabaseSync,now=Date.now()){
 if(!Number.isSafeInteger(now)||now<86400000)throw Error("Invalid inspection timestamp");
 const found=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='free_promo_budget_authorizations'").get();
 if(!found)return {ledgerPresent:false,totalReservedMicroUsd:0,rollingDayReservedMicroUsd:0,
  authorized:0,submittedOrUnknown:0,requiresReview:0,delivered:0,staleUnknown:0};
 const row=db.prepare(`SELECT
  COALESCE(SUM(reserved_micro_usd),0) AS total,
  COALESCE(SUM(CASE WHEN created>=? THEN reserved_micro_usd ELSE 0 END),0) AS daily,
  COUNT(CASE WHEN state='authorized' THEN 1 END) AS authorized,
  COUNT(CASE WHEN state='submitted_or_unknown' THEN 1 END) AS unknown,
  COUNT(CASE WHEN state='requires_review' THEN 1 END) AS review,
  COUNT(CASE WHEN state='delivered' THEN 1 END) AS delivered,
  COUNT(CASE WHEN state='submitted_or_unknown' AND updated<=? THEN 1 END) AS stale
  FROM free_promo_budget_authorizations`).get(now-86400000,now-15*60000) as
  {total:number;daily:number;authorized:number;unknown:number;review:number;delivered:number;stale:number};
 const values=Object.values(row);
 if(!values.every(v=>Number.isSafeInteger(v)&&v>=0))
  throw Error("Corrupt free promo cost ledger");
 return {ledgerPresent:true,totalReservedMicroUsd:row.total,rollingDayReservedMicroUsd:row.daily,
  authorized:row.authorized,submittedOrUnknown:row.unknown,requiresReview:row.review,
  delivered:row.delivered,staleUnknown:row.stale};
}
if(process.argv[1]?.endsWith("inspect-free-promo-risk.ts")){
 if(process.argv.length!==3||process.argv[2]!=="--staging"||
  process.env.RAILWAY_ENVIRONMENT_ID!=="dfaeabed-03df-43ed-aa71-50f343a75041"){
  console.error("Operator Staging environment and --staging are required");
  process.exitCode=2;
 }else{
  const file=path.join(path.resolve(process.env.DATA_DIR||".data"),"commerce.sqlite");
  try{
   if(!lstatSync(file).isFile())throw Error("Invalid commerce database file");
   const db=new DatabaseSync(file,{readOnly:true});
   try{console.log("FREE_PROMO_RISK "+JSON.stringify(inspectFreePromoRisk(db)));}
   finally{db.close();}
  }catch{
   console.error("Read-only free promo inspection unavailable; no data changed");
   process.exitCode=1;
  }
 }
}
