/** Public-facing projection only. The actual MP4 endpoint independently checks the
 * current authenticated owner and paid/delivered state on every request. */
export function privateCustomerVideoLinks(order:Record<string,unknown>){
 const ownedReady=order.videoReady===1 && typeof order.orderId==="string" &&
   /^[a-f0-9-]{36}$/.test(order.orderId);
 const paid=ownedReady && order.status==="paid";
 const free=ownedReady && order.status==="free_delivered";
 const link=paid?`/api/customer-video?orderId=${order.orderId}`:
  free?`/api/customer-free-video?orderId=${order.orderId}`:null;
 return {videoUrl:link,downloadUrl:link?`${link}&download=1`:null};
}

/** A single RFC 9110 byte range for a private MP4 response.
 * Multi-ranges and malformed or unsatisfiable requests are rejected rather than
 * creating ambiguous or unexpectedly large streams. */
export function customerVideoByteRange(header:string|null,size:number):
 {start:number;end:number;status:200|206}|null {
 if(!Number.isSafeInteger(size)||size<=0)return null;
 if(header===null)return {start:0,end:size-1,status:200};
 const match=/^bytes=(\d*)-(\d*)$/.exec(header);
 if(!match || (!match[1] && !match[2]))return null;
 if(match[1]){
  const start=Number(match[1]);
  const requestedEnd=match[2]?Number(match[2]):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(requestedEnd)||
     start>=size||start>requestedEnd)return null;
  return {start,end:Math.min(requestedEnd,size-1),status:206};
 }
 const suffix=Number(match[2]);
 if(!Number.isSafeInteger(suffix)||suffix<1)return null;
 return {start:Math.max(0,size-suffix),end:size-1,status:206};
}

/** Customer-safe display text for the existing output card, not a payment claim.
 * Refunds/disputes must never be presented as unpaid or processing videos. */
export function customerPaidVideoLabel(
 order:{status:string;fulfillmentState:string|null;videoReady:number}|null,
 loaded:boolean,
):string {
 if(!loaded)return "Loading video";
 if(!order)return "Video unavailable";
 if(order.status==="refunded")return "Payment refunded";
 if(order.status==="disputed")return "Payment requires review";
 if(order.status==="free_delivered"&&order.videoReady===1)return "Completed";
 if(order.status==="free_delivered")return "Requires review";
 if(order.status==="paid"&&order.fulfillmentState==="delivered"&&order.videoReady===1)
  return "Completed";
 if(order.fulfillmentState==="failed")return "Requires review";
 if(order.status==="paid")return "Preparing video";
 if(order.status==="awaiting_payment")return "Awaiting payment";
 return "Video unavailable";
}
