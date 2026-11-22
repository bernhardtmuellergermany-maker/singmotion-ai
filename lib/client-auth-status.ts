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
/** Auth transition must never reuse a response started under the old cookies. */
export function invalidateCustomerAuthStatus(){pending=null;}
export function readCustomerAuthStatus():Promise<CustomerAuthStatus|null>{
 if(pending)return pending;
 const request=fetch("/api/customer-auth",{cache:"no-store",credentials:"same-origin"})
  .then(async response=>{
   const customer=response.ok?await response.json() as CustomerAuthStatus:null;
   if(customer?.authenticated)return customer;
   // Staging-only: a verified CMS identity may be shown on the website without
   // turning a staff token into a customer session. Production returns 404.
   const staff=await fetch("/api/staff-website-session",{cache:"no-store",credentials:"same-origin"});
   if(staff.ok){const identity=await staff.json() as CustomerAuthStatus;
    if(identity.authenticated===true&&identity.kind==="staff")return identity;}
   return customer;
  })
  .catch(()=>null);
 pending=request;
 void request.finally(()=>{if(pending===request)pending=null;});
 return request;
}
