/** Explicitly gated staging-only verified *local* free-video settlement.
 * No provider POST, Stripe receipt or payment state is created. Production and
 * all ordinary Staging installations fail closed unless the separate operator
 * feature switch is set. Cloud-only durability is a separate release gate.
 */
import type {CommerceStore} from "./store.ts";
import type {OutputValidationContract} from "../live/output.ts";
import {verifyPreparedFreeOutput} from "./free-promo-verified-output.ts";
import {verifyOperatorFreePromoApproval,type Approval} from "./free-promo-budget.ts";

const STAGING="dfaeabed-03df-43ed-aa71-50f343a75041";
export function freePromoPrivateDeliveryEnabled(){
 return process.env.RAILWAY_ENVIRONMENT_ID===STAGING &&
  process.env.FREE_PROMO_PRIVATE_SETTLEMENT_ENABLED==="true";
}
export async function settleVerifiedFreePromoVideo(
 store:CommerceStore,approval:Approval,secret:string,
 dataDir:string,contract:OutputValidationContract,operatorEnabled:boolean,now=Date.now(),
){
 if(!freePromoPrivateDeliveryEnabled()||operatorEnabled!==true)
  throw Error("Private free-video settlement requires separately enabled Staging operator");
 verifyOperatorFreePromoApproval(approval,secret,now);
 const proof=await verifyPreparedFreeOutput(store,approval.orderId,approval.accountId,dataDir,contract,now);
 const db=store.db;
 db.exec("BEGIN IMMEDIATE");
 try{
  const row=db.prepare(`SELECT a.state,o.status,o.account_id,o.price_cents,
   p.state AS promo_state,c.kind,c.free_videos,c.max_video_seconds
   FROM free_promo_budget_authorizations a
   JOIN customer_orders o ON o.id=a.order_id AND o.account_id=a.account_id
   JOIN promo_redemptions p ON p.order_id=a.order_id AND p.account_id=a.account_id
   JOIN promo_codes c ON c.code=a.code AND c.code=p.code
   WHERE a.order_id=?`).get(approval.orderId) as
   {state:string;status:string;account_id:string;price_cents:number;
    promo_state:string;kind:string;free_videos:number;max_video_seconds:number}|undefined;
  if(!row||row.account_id!==approval.accountId||row.state!=="submitted_or_unknown"||
   row.status!=="awaiting_payment"||row.price_cents!==0||row.promo_state!=="reserved"||
   row.kind!=="free_videos"||row.free_videos!==3||row.max_video_seconds!==10)
   throw Error("Verified reserved free-video order is not eligible for settlement");
  if(db.prepare("SELECT 1 FROM free_promo_video_deliveries WHERE order_id=?").get(approval.orderId))
   throw Error("Existing free-video delivery requires operator reconciliation");
  db.prepare("INSERT INTO free_promo_video_deliveries VALUES(?,?,?,?,?)")
   .run(approval.orderId,approval.accountId,proof.sha256,proof.bytes,now);
  const promo=db.prepare("UPDATE promo_redemptions SET state='redeemed',updated_at=? WHERE order_id=? AND account_id=? AND state='reserved'")
   .run(now,approval.orderId,approval.accountId);
  const auth=db.prepare("UPDATE free_promo_budget_authorizations SET state='delivered',updated=? WHERE order_id=? AND account_id=? AND state='submitted_or_unknown'")
   .run(now,approval.orderId,approval.accountId);
  const order=db.prepare("UPDATE customer_orders SET status='free_delivered' WHERE id=? AND account_id=? AND status='awaiting_payment' AND price_cents=0")
   .run(approval.orderId,approval.accountId);
  if(promo.changes!==1||auth.changes!==1||order.changes!==1)
   throw Error("Atomic free-video settlement unavailable");
  db.prepare("INSERT INTO commerce_audit(actor,action,record,created) VALUES(?,?,?,?)")
   .run("verified-promo-operator","free-video-private-delivery-settled",approval.orderId,now);
  db.exec("COMMIT");
  return proof;
 }catch(error){db.exec("ROLLBACK");throw error}
}
