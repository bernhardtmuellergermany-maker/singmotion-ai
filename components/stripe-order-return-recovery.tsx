"use client";
import {useEffect} from "react";

/**
 * SameSite=Strict cookies from existing logged-in sessions are omitted on the
 * first top-level navigation back from checkout.stripe.com. Retry a single
 * same-origin GET so the server can check the actual session cookie again.
 * No payment mutation or fulfillment request is made.
 */
export function StripeOrderReturnRecovery({orderId}:{orderId:string}){
 useEffect(()=>{
  if(!/^[a-f0-9-]{36}$/.test(orderId))return;
  // Change the query flag to guarantee this only happens once, even if the
  // customer has no valid session and the order remains private.
  const url=new URL(window.location.href);
  if(url.searchParams.get("checkout")!=="success")return;
  url.searchParams.set("checkout","recovered");
  window.location.replace(url.pathname+url.search);
 },[orderId]);
 return <p role="status">Payment return received. Restoring your private order session…</p>;
}
