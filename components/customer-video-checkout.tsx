"use client";
import Link from "next/link";

/** Historical order pages must not start a new card charge.
 * Previously paid customers retain their old order status and MP4 access.
 */
export function CustomerVideoCheckout({orderId,staging}:{orderId:string;staging:boolean}){
 void orderId;
 return <section aria-label="Customer credit payment" className="sm-confirm-notice">
  <p><strong>Videos are paid with Credits, not with a separate Stripe payment.</strong></p>
  <p>{staging?"Credit purchases use Stripe Test Mode on Staging.":"Buy Credits in your account first; each video is charged from the available wallet after verified delivery."}</p>
  <Link className="product-primary" href="/credits#buy-credits">Buy Credits</Link>
 </section>;
}
