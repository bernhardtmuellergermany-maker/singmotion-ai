/** Financial-safety exception for ALREADY CREATED German owner-verification credits.
 * It NEVER creates a new Checkout or authorizes a video job, and cannot
 * settle an unbound/mismatched Stripe session. The signed live webhook and
 * Stripe's paid-session GET are still independently required in the caller.
 */
import type {DatabaseSync} from "node:sqlite";
export function legacyPrivateCreditReceiptBound(db:DatabaseSync,purchaseId:unknown,sessionId:unknown):boolean{
 if(typeof purchaseId!=="string"||!/^[0-9a-f-]{36}$/i.test(purchaseId)||
    typeof sessionId!=="string"||!/^cs_live_[A-Za-z0-9_]+$/.test(sessionId))
  return false;
 const row=db.prepare(`
  SELECT p.id FROM credit_topup_purchases p
  INNER JOIN credit_purchase_tax_context t ON t.purchase_id=p.id
  WHERE p.id=? AND p.stripe_session_id=?
  AND p.status IN ('pending','paid')
  AND t.tax_mode='private-live-verification'
  AND t.country='DE' AND t.buyer_type='consumer'
  LIMIT 1
 `).get(purchaseId,sessionId);
 return !!row;
}
