import type {NextRequest} from "next/server";
import type {CommerceStore} from "./store.ts";
import type {WalletIdentity} from "./credit-wallet.ts";

/** User-controlled email text is never an account-authorization key. */
export async function resolveCreditWalletIdentity(req:NextRequest,store:CommerceStore):Promise<WalletIdentity|null>{
 const id=store.session(req.cookies.get("sm_customer")?.value||"");
 if(id){
  const account=store.db.prepare("SELECT email FROM customer_accounts WHERE id=?")
   .get(id) as {email:string}|undefined;
  if(account&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email))
   return {subject:"customer:"+id,customerId:id,email:account.email};
 }
 if(process.env.CMS_ENABLED!=="true")return null;
 const {getPayload}=await import("payload");
 const {default:config}=await import("@payload-config");
 const {hasRole}=await import("@/cms/policy");
 const payload=await getPayload({config});
 const {user}=await payload.auth({headers:req.headers});
 if(!user||!hasRole(user,["super-admin"]))return null;
 const userId=String(user.id);
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(userId)||
    typeof user.email!=="string"||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email))return null;
 return {subject:"super-admin:"+userId,customerId:null,email:user.email.toLowerCase()};
}
