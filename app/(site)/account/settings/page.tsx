"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {Shell} from "@/components/shell";
import {UserRound,ShieldCheck,CreditCard,FileText,Trash2} from "lucide-react";
import "./account-settings.css";
type Data={staffPreview?:boolean;emailVerification?:"verified"|"pending"|"legacy";plan?:{code:"free"|"hobby";monthlyPriceCents:number;uploadStorageBytes:number;monthlySeconds:number;secondsUsed:number;secondsRemaining:number;period:string;renewsAt?:number|null};profile:{email:string;created:number};orders:{id:string;project_id:string;price_cents:number;currency:string;status:string;created:number}[];sessions:number;credits:number;invoiceDownloadsAvailable:boolean;accountDeletionAvailable:boolean};
export default function AccountSettings(){
 const [storageUsage,setStorageUsage]=useState<{usedBytes:number;limitBytes:number}|null>(null);
 const [portalAvailable,setCheckoutAvailable]=useState(false),[data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[oldPassword,setOldPassword]=useState(""),[newPassword,setNewPassword]=useState(""),[confirm,setConfirm]=useState(""),[notice,setNotice]=useState("");
 useEffect(()=>{fetch("/api/customer-plan",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>setStorageUsage(d?.storage||null)).catch(()=>{});},[]);
 useEffect(()=>{fetch("/api/hobby-portal",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>setCheckoutAvailable(d?.enabled===true)).catch(()=>{});},[]);
 async function resendVerification(){setNotice("");setBusy(true);try{
  const response=await fetch("/api/customer-email-verification",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"resend"})});
  const body=await response.json();if(!response.ok)throw Error(body.error||"Could not send verification email");
  setNotice(body.message||"Check your inbox for a new confirmation link.");
 }catch(e){setNotice(e instanceof Error?e.message:"Could not resend verification email");}finally{setBusy(false)}}
 async function manageBilling(){setNotice("");setBusy(true);try{const r=await fetch("/api/hobby-portal",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});const d=await r.json();if(!r.ok||typeof d.url!=="string")throw Error(d.error||"Billing unavailable");window.location.assign(d.url)}catch(e){setNotice((e as Error).message)}finally{setBusy(false)}}
 useEffect(()=>{fetch("/api/customer-settings",{cache:"no-store"}).then(async r=>{if(r.status===401)throw Error("Please sign in with your customer account first.");if(!r.ok)throw Error("Could not load account settings.");return r.json()}).then(setData).catch(e=>setError(e.message));},[]);
 async function action(kind:"change-password"|"logout-all"){
  setNotice("");
  if(kind==="change-password"&&(newPassword.length<20||newPassword!==confirm)){setNotice("Use at least 20 characters and matching passwords.");return;}
  if(kind==="logout-all"&&!window.confirm("Sign out on every device, including this one?"))return;
  setBusy(true);
  try{const response=await fetch("/api/customer-auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:kind,password:oldPassword,newPassword})});const json=await response.json();if(!response.ok)throw Error(json.error||"Request failed");if(kind==="logout-all"){location.href="/?card=login";return;}setOldPassword("");setNewPassword("");setConfirm("");setNotice("Password updated. Other customer sessions have been signed out.");}
  catch(e){setNotice((e as Error).message)}finally{setBusy(false)}
 }
 return <Shell hideWorkspaceNav><div className="sm-settings-page">
 <header className="sm-settings-header"><h1>Account settings</h1><p>Manage your SingMotion AI customer account.</p></header>
 <div className="sm-settings-layout">
  <nav aria-label="Settings sections" className="sm-settings-nav"><a href="#profile"><UserRound size={17}/> Account</a><a href="#security"><ShieldCheck size={17}/> Security</a><a href="#billing"><CreditCard size={17}/> Payments</a><a href="#invoices"><FileText size={17}/> Invoices</a><a href="#privacy"><Trash2 size={17}/> Privacy & deletion</a></nav>
  <div className="sm-settings-content">
   {data?.staffPreview&&<section className="sm-settings-section" role="status"><strong>Super-admin preview</strong><p className="sm-settings-muted">Read-only layout preview. No customer orders, balance or sessions are shown. Sign in with a test customer account to test password changes and payment history.</p></section>}
   {error&&<section role="alert" className="sm-settings-section"><p>{error}</p><Link href="/?card=login">Go to sign in</Link></section>}
   {data&&<>
    <section id="profile" className="sm-settings-section"><h2>Account information</h2><label>Email address<input readOnly value={data.profile.email}/></label>
    {!data.staffPreview&&<div className="sm-settings-verification" role="status" aria-live="polite">
     {data.emailVerification==="verified"?<span className="sm-settings-verification-ok">✓ Email verified</span>
      :data.emailVerification==="pending"?<><span className="sm-settings-verification-pending">Email not yet verified</span><button className="sm-settings-secondary" type="button" disabled={busy} onClick={()=>void resendVerification()}>{busy?"Sending…":"Resend verification email"}</button></>
      :data.emailVerification==="legacy"?<span className="sm-settings-muted">Existing account: email confirmation not required</span>
      :<span className="sm-settings-muted">Email verification status unavailable</span>}
    </div>}
    <p className="sm-settings-muted">Member since {new Date(data.profile.created).toLocaleDateString("en-GB")}. Email changes will require verification and are not enabled yet.</p></section>
    {!data.staffPreview&&<section id="security" className="sm-settings-section sm-security-section">
      <div className="sm-security-heading"><div><h2>Security</h2><p className="sm-settings-muted">Manage your password and devices that have access to your account.</p></div></div>
      <div className="sm-security-panel">
        <div className="sm-security-panel-intro"><div className="sm-security-icon"><ShieldCheck size={20}/></div><div><h3>Password</h3><p className="sm-settings-muted">Choose a unique password with at least 20 characters.</p></div></div>
        <details className="sm-security-password-disclosure">
          <summary>Change password</summary>
          <form onSubmit={e=>{e.preventDefault();void action("change-password");}}>
            <label>Current password<input type="password" autoComplete="current-password" required value={oldPassword} onChange={e=>setOldPassword(e.target.value)}/></label>
            <label>New password<input type="password" autoComplete="new-password" minLength={20} maxLength={256} required value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></label>
            <label>Confirm new password<input type="password" autoComplete="new-password" minLength={20} maxLength={256} required value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
            <button disabled={busy} type="submit">Save new password</button>
          </form>
        </details>
      </div>
      <div className="sm-security-panel">
        <div className="sm-security-panel-intro"><div className="sm-security-icon"><UserRound size={20}/></div><div><h3>Active sessions</h3><p className="sm-settings-muted">{data.sessions} active customer {data.sessions===1?"session":"sessions"}. Sign out everywhere if you suspect unauthorized access.</p></div></div>
        <button className="sm-settings-secondary" type="button" disabled={busy} onClick={()=>void action("logout-all")}>Sign out on all devices</button>
      </div>
      {notice&&<p className="sm-security-notice" role="status">{notice}</p>}
    </section>}
    <section id="billing" className="sm-settings-section">
      <h2>Credits & payments</h2>
      <div className="sm-plan-summary">
        <strong>{data.plan?.code==="hobby"?"Existing Hobby subscription (legacy)":"Prepaid Credits"}</strong>
        {data.plan?.code==="hobby"?<>
          <p>{data.plan.secondsRemaining} included seconds remaining for your existing billing period{data.plan?.renewsAt?" · Period ends "+new Date(data.plan.renewsAt).toLocaleDateString("en-GB"):""}.</p>
          <p className="sm-settings-muted">Your existing contractual benefits remain in place; new Hobby subscriptions are no longer offered. Manage or cancel your existing subscription through its original billing channel.</p>
          {!data.staffPreview&&portalAvailable&&<button type="button" disabled={busy} onClick={()=>void manageBilling()}>Manage existing subscription & invoices</button>}
        </>:<>
          <p>One-time top-ups will replace per-video payments. No new monthly subscription.</p>
          <p className="sm-settings-muted">Credit purchases are not available yet. You can preview amounts and see your recorded credit balance.</p>
        </>}
        <p><Link href="/credits">{data.staffPreview?"Preview Credit purchasing":"Credits & top-up options"}</Link> · <Link href="/usage">Usage history</Link> · <Link href="/plans">Pricing information</Link></p>
      </div>
      {storageUsage&&<p className="sm-settings-muted">Uploaded sources: {(storageUsage.usedBytes/1048576).toFixed(1)} / {(storageUsage.limitBytes/1048576).toFixed(0)} MB. Existing purchased video downloads remain separate.</p>}
      <p>Recorded credit ledger balance: <strong>{data.staffPreview?"Not available in staff preview":data.credits}</strong></p>
      <p className="sm-settings-muted">Existing paid orders and entitlements are preserved during the credit migration. The amounts below reflect recorded account orders, not necessarily settled charges.</p>
      {data.orders.length?<div className="sm-settings-orders">{data.orders.map(o=><div key={o.id}><strong>{o.project_id}</strong><span>{new Date(o.created).toLocaleDateString("en-GB")}</span><span>{(o.price_cents/100).toLocaleString("en-GB",{style:"currency",currency:o.currency||"EUR"})}</span><span>{o.status}</span></div>)}</div>:<p className="sm-settings-muted">No account orders recorded.</p>}
    </section>
    <section id="invoices" className="sm-settings-section"><h2>Invoices & receipts</h2><p className="sm-settings-muted">Invoice download is not available yet. No invoices are generated from this page. Billing addresses, tax information, and downloadable receipts are planned for the verified payment flow.</p></section>
    <section id="privacy" className="sm-settings-section"><h2>Privacy & account deletion</h2>
      <p className="sm-settings-muted">You can request deletion of your account and personal data. Existing orders and legally required payment records may need to be retained.</p>
      {!data.staffPreview&&<button className="sm-settings-danger" type="button" onClick={()=>{
       if(!window.confirm("Request deletion of your SingMotion AI account? This opens an email to support. Your account will NOT be deleted automatically."))return;
       const subject=encodeURIComponent("Account deletion request – SingMotion AI");
       const body=encodeURIComponent("Please review and process deletion of my SingMotion AI customer account: "+data.profile.email+"\\n\\nI understand that any legally required billing records may need to be retained.");
       window.location.href="mailto:support@singmotion.ai?subject="+subject+"&body="+body;
      }}>Delete account</button>}
      <p className="sm-settings-muted">Deletion is reviewed by support. Clicking the button opens an email request; it does not delete anything immediately.</p>
     </section>
   </>}
  </div></div></div></Shell>;
}
