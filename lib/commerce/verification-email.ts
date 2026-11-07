import { customerIdentityOrigin, passwordResetReady } from "../customer-identity-origin.ts";

type Env = Record<string,string|undefined>;

/** Verification links never use request headers for their destination.
 * Errors are intentionally not returned to unauthenticated clients.
 */
export async function sendCustomerVerificationEmail(
  email:string,token:string,env:Env=process.env,
  sender:typeof fetch=fetch,
):Promise<boolean>{
  if(!passwordResetReady(env)||!env.RESEND_API_KEY||!env.ACCOUNT_EMAIL_FROM)return false;
  const origin=customerIdentityOrigin(env);
  if(!origin)return false;
  const url=origin+"/account/verify-email?token="+encodeURIComponent(token);
  try{
    const response=await sender("https://api.resend.com/emails",{
      method:"POST",
      headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},
      body:JSON.stringify({
        from:env.ACCOUNT_EMAIL_FROM,to:[email],subject:"Verify your SingMotion AI email",
        text:"Please confirm your SingMotion AI email address within 24 hours:\n"+url+
          "\n\nIf you did not create this account, ignore this email.",
      }),
      signal:AbortSignal.timeout(10000),
      cache:"no-store",
    });
    return response.ok;
  }catch{return false;}
}
