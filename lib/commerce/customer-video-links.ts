/** Public-facing projection only. The actual MP4 endpoint independently checks the
 * current authenticated owner and paid/delivered state on every request. */
export function privateCustomerVideoLinks(order:Record<string,unknown>){
 const ready=order.status==="paid" && order.videoReady===1 &&
   typeof order.orderId==="string" && /^[a-f0-9-]{36}$/.test(order.orderId);
 const link=ready?`/api/customer-video?orderId=${order.orderId}`:null;
 return {videoUrl:link,downloadUrl:link?`${link}&download=1`:null};
}
