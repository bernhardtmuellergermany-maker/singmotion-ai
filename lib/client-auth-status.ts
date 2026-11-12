"use client";

/** Coalesce concurrent auth reads without persisting account state.
 * Both the header and active account card request the same read-only status.
 * Returning a shared in-flight promise avoids duplicating the expensive
 * server-side identity check, without caching identity across login/logout.
 */
export type CustomerAuthStatus={
 authenticated?:boolean;
 email?:string|null;
 kind?:string;
 staffRole?:"super-admin"|"editor";
};
let pending:Promise<CustomerAuthStatus|null>|null=null;
export function readCustomerAuthStatus():Promise<CustomerAuthStatus|null>{
 if(pending)return pending;
 const request=fetch("/api/customer-auth",{cache:"no-store",credentials:"same-origin"})
  .then(async response=>response.ok?await response.json() as CustomerAuthStatus:null)
  .catch(()=>null);
 pending=request;
 void request.finally(()=>{if(pending===request)pending=null;});
 return request;
}
