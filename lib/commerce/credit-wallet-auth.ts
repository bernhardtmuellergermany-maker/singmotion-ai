import type {NextRequest} from "next/server";
import type {CommerceStore} from "./store.ts";
import type {WalletIdentity} from "./credit-wallet.ts";

/** The account header already gives a verified Payload staff session precedence
 * over a still-valid customer cookie. Credit Checkout and balance MUST make the
 * same choice; otherwise Super Admin purchases can fund a different wallet.
 * A verified editor must not inherit a customer wallet from a stale cookie.
 */
export function selectWalletPrincipal(
 customerId:string|null,staffRole:"super-admin"|"editor"|null
):"customer"|"super-admin"|null{
 if(staffRole==="editor")return null;
 if(staffRole==="super-admin")return "super-admin";
 return customerId?"customer":null;
}

/** User-controlled email text is never an account-authorization key. */
export async function resolveCreditWalletIdentity(req:NextRequest,store:CommerceStore):Promise<WalletIdentity|null>{
 const id=store.session(req.cookies.get("sm_customer")?.value||"");
 let staffRole:"super-admin"|"editor"|null=null;
 let staffId:unknown=null;
 let staffEmail:unknown=null;
 // Payload authentication is necessary when no customer exists OR when a
 // Payload cookie coexists with a customer cookie. In the latter case, staff
 // wins exactly as in /api/customer-auth, preventing a cross-principal top-up.
 if(process.env.CMS_ENABLED==="true"&&(!id||req.cookies.has("payload-token"))){
  const {getPayload}=await import("payload");
  const {default:config}=await import("@payload-config");
  const {hasRole}=await import("@/cms/policy");
  const payload=await getPayload({config});
  const {user}=await payload.auth({headers:req.headers});
  if(user&&hasRole(user,["super-admin","editor"])){
   staffRole=hasRole(user,["super-admin"])?"super-admin":"editor";
   staffId=user.id;
   staffEmail=user.email;
  }
 }
 const principal=selectWalletPrincipal(id,staffRole);
 if(principal==="super-admin"){
  const userId=String(staffId);
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(userId)||
     typeof staffEmail!=="string"||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staffEmail))return null;
  return {subject:"super-admin:"+userId,customerId:null,email:staffEmail.toLowerCase()};
 }
 if(principal==="customer"){
  const account=store.db.prepare("SELECT email FROM customer_accounts WHERE id=?")
   .get(id) as {email:string}|undefined;
  if(account&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email))
   return {subject:"customer:"+id,customerId:id,email:account.email};
 }
 return null;
}
