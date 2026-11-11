import type {DatabaseSync} from "node:sqlite";

/** Owner-scoped, read-only projection for the existing customer output card.
 * Single-order lookup bypasses the 50 newest-order page without widening access. */
export function customerOrderStatusFilter(orderId:string|null,projectId:string|null){
 if(orderId!==null && !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(orderId))
  throw new Error("Invalid order reference.");
 if(projectId!==null && !/^[A-Za-z0-9_-]{1,160}$/.test(projectId))
  throw new Error("Invalid project reference.");
 return {orderId,projectId,limit:orderId===null?50:1};
}

export function ownedCustomerOrderStatuses(
 db:DatabaseSync,accountId:string,filter:{orderId:string|null;projectId:string|null;limit:number}
):Record<string,unknown>[] {
 // The owner predicate is mandatory for both the paginated list and direct lookup.
 return db.prepare(`SELECT o.id AS orderId,o.project_id AS projectId,
   o.price_cents AS priceCents,o.currency,o.status,o.created,
   CASE WHEN json_valid(m.media_json) THEN json_extract(m.media_json,'$.outputFormat') ELSE NULL END AS outputFormat,
   CASE WHEN json_valid(m.media_json) THEN json_extract(m.media_json,'$.durationSeconds') ELSE NULL END AS durationSeconds,
   q.state AS fulfillmentState,
   CASE WHEN (q.state='delivered' AND d.asset_id IS NOT NULL AND o.status='paid')
       OR (o.status='free_delivered' AND f.order_id IS NOT NULL) THEN 1 ELSE 0 END AS videoReady
   FROM customer_orders o
   LEFT JOIN customer_guest_order_claims gc ON gc.order_id=o.id
   LEFT JOIN customer_prepared_media m ON m.order_id=o.id
   LEFT JOIN customer_fulfillment_queue q ON q.order_id=o.id
   LEFT JOIN customer_video_deliveries d ON d.order_id=o.id
   LEFT JOIN free_promo_video_deliveries f ON f.order_id=o.id AND f.account_id=o.account_id
   WHERE (o.account_id=? OR gc.account_id=?) AND (? IS NULL OR o.project_id=?) AND (? IS NULL OR o.id=?)
   ORDER BY o.created DESC,o.id DESC LIMIT ?`).all(
    accountId,accountId,filter.projectId,filter.projectId,filter.orderId,filter.orderId,filter.limit
   ) as Record<string,unknown>[];
}
