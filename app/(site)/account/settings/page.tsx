"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {Shell} from "@/components/shell";
import {UserRound,ShieldCheck,CreditCard,FileText,Trash2,Download,ExternalLink,LifeBuoy,HardDrive,LockKeyhole} from "lucide-react";
import "./account-settings.css";
type Invoice={id:string;number:string;created:number;amount:number;currency:string;pdf:string|null;hosted:string|null};
type Data={staffPreview?:boolean;emailVerification?:"verified"|"pending"|"legacy";plan?:{code:"free"|"hobby";monthlyPriceCents:number;uploadStorageBytes:number;monthlySeconds:number;secondsUsed:number;secondsRemaining:number;period:string;renewsAt?:number|null};profile:{email:string;created:number};orders:{id:string;project_id:string;price_cents:number;currency:string;status:string;created:number}[];sessions:number;credits:number;invoiceDownloadsAvailable:boolean;accountDeletionAvailable:boolean};
export default function AccountSettings(){
 const [invoices,setInvoices]=useState<Invoice[]>([]),[invoiceMessage,setInvoiceMessage]=useState(""),[invoicesLoading,setInvoicesLoading]=useState(true);
 const [removeOrderId,setRemoveOrderId]=useState<string|null>(null);
 const [removePassword,setRemovePassword]=useState("");
 const [removeBusy,setRemoveBusy]=useState(false);
 const [removeNotice,setRemoveNotice]=useState("");
 const [storageUsage,setStorageUsage]=useState<{usedBytes:number;unlimited?:boolean;limitBytes:number|null;provider?:string}|null>(null);
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[oldPassword,setOldPassword]=useState(""),[newPassword,setNewPassword]=useState(""),[confirm,setConfirm]=useState(""),[notice,setNotice]=useState("");
 useEffect(()=>{fetch("/api/customer-invoices",{cache:"no-store"}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||"Could not load invoices.");setInvoices(Array.isArray(d.invoices)?d.invoices:[]);setInvoiceMessage(d.message||"");}).catch(e=>setInvoiceMessage(e instanceof Error?e.message:"Invoices unavailable")).finally(()=>setInvoicesLoading(false));},[]);
 useEffect(()=>{fetch("/api/customer-plan",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>setStorageUsage(d?.storage||null)).catch(()=>{});},[]);
 async function resendVerification(){setNotice("");setBusy(true);try{
  const response=await fetch("/api/customer-email-verification",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"resend"})});
  const body=await response.json();if(!response.ok)throw Error(body.error||"Could not send verification email");
  setNotice(body.message||"Check your inbox for a new confirmation link.");
 }catch(e){setNotice(e instanceof Error?e.message:"Could not resend verification email");}finally{setBusy(false)}}
 useEffect(()=>{fetch("/api/customer-settings",{cache:"no-store"}).then(async r=>{if(r.status===401)throw Error("Please sign in with your customer account first.");if(!r.ok)throw Error("Could not load account settings.");return r.json()}).then(setData).catch(e=>setError(e.message));},[]);
 async function action(kind:"change-password"|"logout-all"){
  setNotice("");
  if(kind==="change-password"&&(newPassword.length<20||newPassword!==confirm)){setNotice("Use at least 20 characters and matching passwords.");return;}
  if(kind==="logout-all"&&!window.confirm("Sign out on every device, including this one?"))return;
  setBusy(true);
  try{const response=await fetch("/api/customer-auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:kind,password:oldPassword,newPassword})});const json=await response.json();if(!response.ok)throw Error(json.error||"Request failed");if(kind==="logout-all"){location.href="/?card=login";return;}setOldPassword("");setNewPassword("");setConfirm("");setNotice("Password updated. Other customer sessions have been signed out.");}
  catch(e){setNotice((e as Error).message)}finally{setBusy(false)}
 }
 async function removePaidOrder(){
  if(!removeOrderId||!removePassword||removeBusy)return;
  setRemoveBusy(true);setRemoveNotice("");
  try{
   const response=await fetch("/api/customer-hide-paid-order",{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({orderId:removeOrderId,password:removePassword})
   });
   const result=await response.json() as {hidden?:boolean;error?:string};
   if(!response.ok||result.hidden!==true)throw Error(result.error||"Could not remove this order.");
   setData(previous=>previous?{...previous,orders:previous.orders.filter(order=>order.id!==removeOrderId)}:previous);
   window.dispatchEvent(new Event("customer-orders-changed"));
   setRemoveOrderId(null);setRemovePassword("");
   setRemoveNotice("Order removed from your list. Invoices and payment records remain available.");
  }catch(error){setRemoveNotice(error instanceof Error?error.message:"Could not remove the order.");}
  finally{setRemoveBusy(false);}
 }
 return <Shell hideWorkspaceNav><div className="sm-settings-page">
 <header className="sm-settings-header"><span className="sm-settings-eyebrow">YOUR WORKSPACE</span><h1>Account settings</h1><p>Manage your profile, security, payments and privacy in one place.</p></header>
 <div className="sm-settings-layout">
  <nav aria-label="Settings sections" className="sm-settings-nav"><a href="#profile"><UserRound size={17}/> Account</a><a href="#security"><ShieldCheck size={17}/> Security</a><a href="#billing"><CreditCard size={17}/> Payments</a><a href="#invoices"><FileText size={17}/> Invoices</a><a href="#privacy"><Trash2 size={17}/> Privacy & deletion</a></nav>
  <div className="sm-settings-content">
   {data?.staffPreview&&<section className="sm-settings-section" role="status"><strong>Super Admin account</strong><p className="sm-settings-muted">You can view your own real credits and purchases under Credits, just like a customer. Account security and staff management remain in the admin area.</p></section>}
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
    {data.staffPreview&&<section id="security" className="sm-settings-section sm-security-section">
      <div className="sm-security-heading"><h2>Security</h2><p className="sm-settings-muted">Super Admin accounts use Payload CMS authentication. Do not enter your administrator password into the customer password form.</p></div>
      <div className="sm-security-panel">
        <div className="sm-security-panel-intro"><div className="sm-security-icon"><ShieldCheck size={20}/></div><div><h3>Password</h3><p className="sm-settings-muted">Change your own Super Admin password using the protected CMS account screen. The current minimum is 20 characters. Other staff sessions are revoked when your password changes.</p></div></div>
        <Link className="sm-settings-admin-action" href="/admin/account">Change password in Admin</Link>
      </div>
    </section>}
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
        <strong>Prepaid Credits</strong>
        <p>Buy credits once when Checkout is available, monitor your wallet and track each transaction. There is no monthly plan or automatic top-up.</p>
        <p className="sm-settings-muted">Automatic recharge is currently off. No payment method is charged without explicit authorization. Any available Stripe invoices appear below.</p>
        <p><Link href="/credits">Credits & top-up options</Link> · <Link href="/credits#usage">Usage history</Link> · <Link href="/plans">Pricing information</Link></p>
      </div>
      {storageUsage&&<p className="sm-settings-muted">Your uploaded audio and photos: {(storageUsage.usedBytes/1048576).toFixed(1)} MB stored. No cumulative account upload quota. Individual file-size and security limits still apply. Finished videos are stored separately.</p>}
      <div className="sm-settings-credit-balance"><CreditCard size={19}/><span>Available credits</span><strong>{data.credits.toLocaleString("en-GB")}</strong></div>
      <p className="sm-settings-muted">Historical order records, if any, appear below. Only completed Stripe payments create invoice documents.</p>
      {data.orders.length?<div className="sm-settings-orders">{data.orders.map(o=><div key={o.id}><strong>{o.project_id}</strong><span>{new Date(o.created).toLocaleDateString("en-GB")}</span><span>{(o.price_cents/100).toLocaleString("en-GB",{style:"currency",currency:o.currency||"EUR"})}</span><span>{o.status}</span>{o.status==="paid"&&<button type="button" className="sm-settings-remove-order" onClick={()=>{setRemoveOrderId(o.id);setRemovePassword("");setRemoveNotice("");}}>Remove</button>}</div>)}</div>:<p className="sm-settings-muted">No account orders recorded.</p>}
      {removeOrderId&&<form className="sm-settings-order-confirm" onSubmit={e=>{e.preventDefault();void removePaidOrder();}}>
       <div><strong>Remove this paid order from your list?</strong><p className="sm-settings-muted">Confirm with your account password. This hides the order from your account history; it does not cancel a charge, issue a refund, delete your video or erase an invoice.</p></div>
       <label>Account password<input type="password" autoComplete="current-password" value={removePassword} maxLength={256} required onChange={e=>setRemovePassword(e.target.value)}/></label>
       <div className="sm-settings-order-actions"><button type="button" className="sm-settings-secondary" disabled={removeBusy} onClick={()=>{setRemoveOrderId(null);setRemovePassword("");setRemoveNotice("");}}>Cancel</button><button type="submit" className="sm-settings-danger" disabled={removeBusy||!removePassword}>{removeBusy?"Checking password…":"Confirm removal"}</button></div>
      </form>}
      {removeNotice&&<p role="status" className="sm-settings-order-notice">{removeNotice}</p>}
    </section>
    <section id="invoices" className="sm-settings-section"><h2>Invoices & receipts</h2>
      <p className="sm-settings-muted">Download available Stripe invoices for completed purchases. Only documents actually issued by Stripe appear here; an order confirmation is not automatically a tax invoice.</p>
      {invoicesLoading?<p className="sm-settings-muted" role="status">Checking available invoices…</p>:invoices.length?
       <div className="sm-settings-invoice-list">{invoices.map(invoice=><div className="sm-settings-invoice" key={invoice.id}>
         <div><strong>{invoice.number}</strong><p className="sm-settings-muted">{new Date(invoice.created).toLocaleDateString("en-GB")} · {(invoice.amount/100).toLocaleString("en-GB",{style:"currency",currency:invoice.currency.toUpperCase()})}</p></div>
         <a href={invoice.pdf||invoice.hosted||"#"} rel="noopener noreferrer" target="_blank" className="sm-settings-invoice-link"><Download size={16}/> {invoice.pdf?"Download PDF":"View invoice"}</a>
       </div>)}</div>:<div className="sm-settings-empty"><FileText size={22}/><div><strong>No invoices available</strong><p className="sm-settings-muted">{invoiceMessage||"Invoices will appear here when Stripe has issued them for your paid orders."}</p></div></div>}
      <p className="sm-settings-muted">Need a receipt or invoice correction? <a href="mailto:support@singmotion.ai?subject=Billing%20document%20request">Contact billing support</a>. </p>
    </section>
    <section id="privacy" className="sm-settings-section"><h2>Privacy & account deletion</h2>
      <div className="sm-settings-info-grid"><div><LockKeyhole size={20}/><strong>Your personal information</strong><p className="sm-settings-muted">Account details and payments are restricted to authenticated access. Payment card details are handled by Stripe, not stored on this page.</p><Link href="/privacy">Read privacy policy <ExternalLink size={13}/></Link></div><div><HardDrive size={20}/><strong>Projects & uploads</strong><p className="sm-settings-muted">Review your saved projects and uploads. Project files and payment records follow different retention requirements.</p><Link href="/projects">Open my projects <ExternalLink size={13}/></Link></div></div>
      <p className="sm-settings-muted">You can request deletion of your account and personal data. Existing orders and legally required payment records may need to be retained.</p>
      <button className="sm-settings-danger" type="button" onClick={()=>{
       const kind=data.staffPreview?"Super Admin / staff":"customer";
       if(!window.confirm("Request deletion of your "+kind+" account? This opens your email application; nothing will be deleted automatically."))return;
       const subject=encodeURIComponent("Account deletion request – SingMotion AI");
       const body=encodeURIComponent("Please review deletion of my SingMotion AI "+kind+" account associated with: "+data.profile.email+"\\n\\nI understand that my identity must be verified and legally required billing and security records may need to be retained.");
       window.location.href="mailto:support@singmotion.ai?subject="+subject+"&body="+body;
      }}>Request account deletion</button>
      <p className="sm-settings-muted">Deletion is reviewed by support after identity verification. The button opens a draft email; you must send it yourself. Super Admin deletion requires an administrator handover and cannot be performed automatically. Legally required financial and security records may need to be retained.</p>
      <p className="sm-settings-support"><LifeBuoy size={17}/> Questions about account access, payments or privacy? <a href="mailto:support@singmotion.ai">Contact support</a>.</p>
     </section>
   </>}
  </div></div></div></Shell>;
}
