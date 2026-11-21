"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {Shell} from "@/components/shell";
import {notifyAuthTransition} from "@/lib/client";
import {AdminAccountDashboard} from "@/components/admin-account-dashboard";
import {AdminAnnouncements} from "@/components/admin-announcements";
import type {AdminSupportOverview} from "@/lib/commerce/admin-support-overview";
import {UserRound,ShieldCheck,CreditCard,FileText,Trash2,Download,ExternalLink,LifeBuoy,HardDrive,LockKeyhole,LayoutDashboard,Bell,Mail} from "lucide-react";
import "./account-settings.css";
type Invoice={id:string;number:string;created:number;amount:number;currency:string;pdf:string|null;hosted:string|null;paymentStatus?:"paid"|"refunded"};
type Data={staffPreview?:boolean;emailVerification?:"verified"|"pending"|"legacy";plan?:{code:"free"|"hobby";monthlyPriceCents:number;uploadStorageBytes:number;monthlySeconds:number;secondsUsed:number;secondsRemaining:number;period:string;renewsAt?:number|null};profile:{email:string;created:number};orders:{id:string;project_id:string;price_cents:number;currency:string;status:string;created:number}[];sessions:number;idleMinutes?:number;credits:number;invoiceDownloadsAvailable:boolean;accountDeletionAvailable:boolean};
export default function AccountSettings(){
 const [invoices,setInvoices]=useState<Invoice[]>([]),[invoiceMessage,setInvoiceMessage]=useState(""),[invoicesLoading,setInvoicesLoading]=useState(true);
 const [removeOrderId,setRemoveOrderId]=useState<string|null>(null);
 const [removePassword,setRemovePassword]=useState("");
 const [removeBusy,setRemoveBusy]=useState(false);
 const [removeNotice,setRemoveNotice]=useState("");
 const [erasure,setErasure]=useState<{eligible:boolean;automatic?:boolean;googleOnly?:boolean;googleReauthenticated?:boolean;code:string;message:string}|null>(null);
 const [erasureLoading,setErasureLoading]=useState(false);
 const [deleteOpen,setDeleteOpen]=useState(false),[deleteBusy,setDeleteBusy]=useState(false);
 const [deletePassword,setDeletePassword]=useState(""),[deleteConfirmation,setDeleteConfirmation]=useState("");
 const [deleteNotice,setDeleteNotice]=useState("");
 const [storageUsage,setStorageUsage]=useState<{usedBytes:number;unlimited?:boolean;limitBytes:number|null;provider?:string}|null>(null);
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[oldPassword,setOldPassword]=useState(""),[newPassword,setNewPassword]=useState(""),[confirm,setConfirm]=useState(""),[notice,setNotice]=useState("");
 const [adminOverview,setAdminOverview]=useState<AdminSupportOverview|null>(null);
 const [adminStatusBusy,setAdminStatusBusy]=useState(true);
 const [adminStatusError,setAdminStatusError]=useState("");
 const [adminDenied,setAdminDenied]=useState(false);
 const [videoEmailEnabled,setVideoEmailEnabled]=useState<boolean|null>(null);
 const [videoEmailSaving,setVideoEmailSaving]=useState(false);
 const [videoEmailNotice,setVideoEmailNotice]=useState("");
 const [idleMinutes,setIdleMinutes]=useState(30),[idleSaving,setIdleSaving]=useState(false),[idleNotice,setIdleNotice]=useState("");
 useEffect(()=>{
  if(!data||data.staffPreview)return;
  let live=true;
  fetch("/api/customer-email-preferences",{cache:"no-store",credentials:"same-origin"})
   .then(async r=>{if(!r.ok)throw Error("Could not load email preferences.");return r.json() as Promise<{videoReadyEmailEnabled:boolean}>})
   .then(x=>{if(live)setVideoEmailEnabled(x.videoReadyEmailEnabled)})
   .catch(()=>{if(live)setVideoEmailNotice("Email preferences could not be loaded.")});
  return()=>{live=false};
 },[data?.profile.email,data?.staffPreview]);
 async function changeVideoEmail(enabled:boolean){
  if(videoEmailSaving)return;
  setVideoEmailSaving(true);setVideoEmailNotice("");
  try{
   const response=await fetch("/api/customer-email-preferences",{
    method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({videoReadyEmailEnabled:enabled})
   });
   const data=await response.json() as {videoReadyEmailEnabled?:boolean;error?:string};
   if(!response.ok||data.videoReadyEmailEnabled!==enabled)throw Error(data.error||"Could not update email preferences.");
   setVideoEmailEnabled(enabled);setVideoEmailNotice("Email notification preference saved.");
  }catch(e){setVideoEmailNotice(e instanceof Error?e.message:"Could not save preference.")}
  finally{setVideoEmailSaving(false)}
 }

 async function refreshAdminStatus(){
  setAdminStatusBusy(true);setAdminStatusError("");
  try{
   const reply=await fetch("/api/support-admin/overview",{cache:"no-store",credentials:"same-origin"});
   if(reply.status===401||reply.status===403){
    setAdminDenied(true);setAdminOverview(null);return;
   }
   if(!reply.ok)throw Error("Support status is temporarily unavailable. Use the consoles directly.");
   const body=await reply.json() as {overview?:AdminSupportOverview};
   if(!body.overview||!Array.isArray(body.overview.messages))throw Error("Invalid support status response.");
   setAdminDenied(false);setAdminOverview(body.overview);
  }catch(e){
   setAdminOverview(null);
   setAdminStatusError(e instanceof Error?e.message:"Support status unavailable.");
  }finally{setAdminStatusBusy(false)}
 }
 useEffect(()=>{void refreshAdminStatus();},[]);
 const canShowAdmin=!adminDenied&&(adminOverview!==null||data?.staffPreview===true);
 // The Account sections render after account authentication, so a hash from
 // a different page can arrive before its target exists. Reapply the deep
 // link after hydration, without changing unrelated routes or user settings.
 useEffect(()=>{
  if(!data)return;
  const target=window.location.hash.slice(1);
  if(!["profile","security","billing","invoices","privacy","admin-console","announcements","email-notifications"].includes(target))return;
  if(target==="admin-console"&&!canShowAdmin)return;
  if(target==="announcements"&&!canShowAdmin)return;
  const frame=window.requestAnimationFrame(()=>{
   const section=document.getElementById(target);
   if(!section)return;
   const reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
   section.scrollIntoView({behavior:reduce?"instant":"smooth",block:"start"});
  });
  return()=>window.cancelAnimationFrame(frame);
 },[data,canShowAdmin]);
 useEffect(()=>{fetch("/api/customer-invoices",{cache:"no-store"}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||"Could not load invoices.");setInvoices(Array.isArray(d.invoices)?d.invoices:[]);setInvoiceMessage(d.message||"");}).catch(e=>setInvoiceMessage(e instanceof Error?e.message:"Invoices unavailable")).finally(()=>setInvoicesLoading(false));},[]);
 useEffect(()=>{fetch("/api/customer-plan",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>setStorageUsage(d?.storage||null)).catch(()=>{});},[]);
 async function resendVerification(){setNotice("");setBusy(true);try{
  const response=await fetch("/api/customer-email-verification",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"resend"})});
  const body=await response.json();if(!response.ok)throw Error(body.error||"Could not send verification email");
  setNotice(body.message||"Check your inbox for a new confirmation link.");
 }catch(e){setNotice(e instanceof Error?e.message:"Could not resend verification email");}finally{setBusy(false)}}
 useEffect(()=>{fetch("/api/customer-settings",{cache:"no-store"}).then(async r=>{if(r.status===401)throw Error("Please sign in with your customer account first.");if(!r.ok)throw Error("Could not load account settings.");return r.json()}).then((loaded:Data)=>{setData(loaded);setIdleMinutes(loaded.idleMinutes??30);}).catch(e=>setError(e.message));},[]);
 async function saveIdleMinutes(){
  if(idleSaving||!data||data.staffPreview)return;
  setIdleSaving(true);setIdleNotice("");
  try{
   const response=await fetch("/api/customer-session-activity",{
    method:"PATCH",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({idleMinutes})
   });
   const result=await response.json() as {idleMinutes?:number;error?:string};
   if(!response.ok||typeof result.idleMinutes!=="number")throw Error(result.error||"Could not save inactivity setting.");
   setData(old=>old?{...old,idleMinutes:result.idleMinutes}:old);
   setIdleNotice(result.idleMinutes===0?"Automatic sign-out after inactivity disabled.":"Automatic sign-out setting saved for all devices.");
  }catch(e){setIdleNotice(e instanceof Error?e.message:"Could not save inactivity setting.");}
  finally{setIdleSaving(false);}
 }
 async function action(kind:"change-password"|"logout-all"){
  setNotice("");
  if(kind==="change-password"&&(newPassword.length<8||newPassword!==confirm)){setNotice("Use at least 8 characters and matching passwords.");return;}
  if(kind==="logout-all"&&!window.confirm("Sign out on every device, including this one?"))return;
  setBusy(true);
  try{const response=await fetch("/api/customer-auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:kind,password:oldPassword,newPassword})});const json=await response.json();if(!response.ok)throw Error(json.error||"Request failed");if(kind==="logout-all"){notifyAuthTransition();location.href="/login";return;}setOldPassword("");setNewPassword("");setConfirm("");setNotice("Password updated. Other customer sessions have been signed out.");}
  catch(e){setNotice((e as Error).message)}finally{setBusy(false)}
 }
 useEffect(()=>{
  if(!data||data.staffPreview)return;
  let active=true;
  setErasureLoading(true);
  fetch("/api/customer-account-erasure",{cache:"no-store",credentials:"same-origin"})
   .then(async r=>{const result=await r.json() as {eligible?:boolean;automatic?:boolean;googleOnly?:boolean;googleReauthenticated?:boolean;code?:string;message?:string};if(!r.ok)throw Error(result.message||"Deletion eligibility unavailable.");return result;})
   .then(result=>{if(active)setErasure({eligible:result.eligible===true,automatic:result.automatic===true,googleOnly:result.googleOnly===true,googleReauthenticated:result.googleReauthenticated===true,code:result.code||"",message:result.message||""});})
   .catch(()=>{if(active)setErasure({eligible:true,automatic:true,code:"CHECK_PENDING",message:"You can still request deletion. Verification of outstanding transactions follows your request."});})
   .finally(()=>{if(active)setErasureLoading(false);});
  return()=>{active=false;};
 },[data?.profile.email,data?.staffPreview]);
 async function deleteMyAccount(){
  if(deleteBusy||deleteConfirmation!=="DELETE MY ACCOUNT"||(!erasure?.googleOnly&&!deletePassword)|| (erasure?.googleOnly&&!erasure?.googleReauthenticated))return;
  if(!window.confirm("Permanently delete your SingMotion customer account? This cannot be undone."))return;
  setDeleteBusy(true);setDeleteNotice("");
  try{
   const response=await fetch("/api/customer-account-erasure",{
    method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({password:erasure?.googleOnly?"":deletePassword,confirmation:deleteConfirmation})
   });
   const result=await response.json() as {deleted?:boolean;pending?:boolean;error?:string;message?:string;eligible?:boolean;code?:string};
   if(response.ok&&result.pending===true){
    setDeletePassword("");setDeleteConfirmation("");
    notifyAuthTransition();
    window.location.assign("/account/deletion-status");
    return;
   }
   if(!response.ok||result.deleted!==true)
    throw Error(result.error||result.message||"Deletion request could not be accepted.");
   setDeletePassword("");setDeleteConfirmation("");
   notifyAuthTransition();
   window.location.assign("/login?account_deleted=1");
  }catch(e){setDeleteNotice(e instanceof Error?e.message:"Deletion could not be completed.");}
  finally{setDeleteBusy(false);}
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
  <nav aria-label="Settings sections" className="sm-settings-nav"><a href="#profile"><UserRound size={17}/> Account</a><a href="#security"><ShieldCheck size={17}/> Security</a>{data&&!data.staffPreview&&<a href="#email-notifications"><Mail size={17}/> Email notifications</a>}<a href="#billing"><CreditCard size={17}/> Payments</a><a href="#invoices"><FileText size={17}/> Invoices</a><a href="#privacy"><Trash2 size={17}/> Privacy & deletion</a>{canShowAdmin&&<a href="#admin-console"><LayoutDashboard size={17}/> Admin consoles</a>}{canShowAdmin&&<a href="#announcements"><Bell size={17}/> Notifications · Broadcast</a>}</nav>
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
    <p className="sm-settings-muted">Member since {new Date(data.profile.created).toLocaleDateString("en-GB")}.</p></section>
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
        <div className="sm-security-panel-intro"><div className="sm-security-icon"><ShieldCheck size={20}/></div><div><h3>Password</h3><p className="sm-settings-muted">Choose a unique password with at least 8 characters.</p></div></div>
        <details className="sm-security-password-disclosure">
          <summary>Change password</summary>
          <form onSubmit={e=>{e.preventDefault();void action("change-password");}}>
            <label>Current password<input type="password" autoComplete="current-password" required value={oldPassword} onChange={e=>setOldPassword(e.target.value)}/></label>
            <label>New password<input type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></label>
            <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
            <button disabled={busy} type="submit">Save new password</button>
          </form>
        </details>
      </div>
      <div className="sm-security-panel sm-idle-security-panel">
        <div className="sm-security-panel-intro"><div className="sm-security-icon"><ShieldCheck size={20}/></div><div><h3>Automatic sign-out</h3><p className="sm-settings-muted">When nobody uses your account on any device for the chosen period, all customer sessions are signed out. Background updates do not keep you signed in.</p></div></div>
        <form className="sm-idle-form" onSubmit={e=>{e.preventDefault();void saveIdleMinutes();}}>
          <label htmlFor="sm-idle-minutes">Sign out after inactivity
            <select id="sm-idle-minutes" value={idleMinutes} onChange={e=>{setIdleMinutes(Number(e.target.value));setIdleNotice("");}}>
              <option value={5}>5 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes (default)</option>
              <option value={60}>1 hour</option>
              <option value={120}>2 hours</option>
              <option value={240}>4 hours</option>
              <option value={480}>8 hours</option>
              <option value={0}>Off — no inactivity sign-out</option>
            </select>
          </label>
          <button type="submit" disabled={idleSaving||idleMinutes===data.idleMinutes}>{idleSaving?"Saving…":"Save sign-out preference"}</button>
        </form>
        <p className="sm-settings-muted sm-idle-note">This setting applies to all customer devices. Turning it off does not disable the separate 24-hour login session expiry.</p>
        {idleNotice&&<p className="sm-security-notice" role="status">{idleNotice}</p>}
      </div>
      <div className="sm-security-panel">
        <div className="sm-security-panel-intro"><div className="sm-security-icon"><UserRound size={20}/></div><div><h3>Active sessions</h3><p className="sm-settings-muted">{data.sessions} active customer {data.sessions===1?"session":"sessions"}. Sign out everywhere if you suspect unauthorized access.</p></div></div>
        <button className="sm-settings-secondary" type="button" disabled={busy} onClick={()=>void action("logout-all")}>Sign out on all devices</button>
      </div>
      {notice&&<p className="sm-security-notice" role="status">{notice}</p>}
    </section>}
    {!data.staffPreview&&<section id="email-notifications" className="sm-settings-section">
     <h2><Mail size={21} aria-hidden="true"/> Email notifications</h2>
     <p className="sm-settings-muted">Choose whether to receive an email when your generated video is ready. This applies to future video completions on your account.</p>
     <label className="sm-settings-email-toggle">
      <input type="checkbox" checked={videoEmailEnabled===true}
       disabled={videoEmailEnabled===null||videoEmailSaving}
       onChange={e=>void changeVideoEmail(e.target.checked)}/>
      <span>Send me an email when my video is ready</span>
     </label>
     <p className="sm-settings-muted">Security verification emails, receipts and essential billing notifications are not affected.</p>
     {videoEmailNotice&&<p role="status" className="sm-settings-muted">{videoEmailNotice}</p>}
    </section>}
    <section id="billing" className="sm-settings-section">
      <h2>Credits & payments</h2>
      <div className="sm-plan-summary">
        <strong>Prepaid Credits</strong>
        <p>Buy credits once when Checkout is available, monitor your wallet and track each transaction. There is no monthly plan or automatic top-up.</p>
        <p className="sm-settings-muted">Automatic recharge is currently off. No payment method is charged without explicit authorization. Any available Stripe invoices appear below.</p>
        <p><Link href="/credits">Credits & top-up options</Link> · <Link href="/credits#usage">Usage history</Link> · <Link href="/plans">Pricing information</Link></p>
      </div>
      {storageUsage&&<p className="sm-settings-muted">Your uploaded audio and photos: {(storageUsage.usedBytes/1048576).toFixed(1)} MB stored{storageUsage.provider==="cloudflare-r2"?" privately on Cloudflare R2":""}. No cumulative account upload quota. Individual file-size and security limits still apply. Finished videos are stored separately.</p>}
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
         <div><strong>{invoice.number}</strong><p className="sm-settings-muted">{new Date(invoice.created).toLocaleDateString("en-GB")} · {(invoice.amount/100).toLocaleString("en-GB",{style:"currency",currency:invoice.currency.toUpperCase()})}{invoice.paymentStatus==="refunded"?" · Refunded":""}</p></div>
         <a href={invoice.pdf||invoice.hosted||"#"} rel="noopener noreferrer" target="_blank" className="sm-settings-invoice-link"><Download size={16}/> {invoice.pdf?"Download PDF":"View invoice"}</a>
       </div>)}</div>:<div className="sm-settings-empty"><FileText size={22}/><div><strong>No invoices available</strong><p className="sm-settings-muted">{invoiceMessage||"Invoices will appear here when Stripe has issued them for your paid orders."}</p></div></div>}
      <p className="sm-settings-muted">Need a receipt or invoice correction? <a href="mailto:support@singmotion.ai?subject=Billing%20document%20request">Contact billing support</a>. </p>
    </section>
    <section id="privacy" className="sm-settings-section"><h2>Privacy & account deletion</h2>
      <div className="sm-settings-info-grid"><div><LockKeyhole size={20}/><strong>Privacy</strong><Link href="/privacy">Privacy policy <ExternalLink size={13}/></Link></div><div><HardDrive size={20}/><strong>Your files</strong><Link href="/projects">My projects <ExternalLink size={13}/></Link></div></div>
      {data.staffPreview?<p className="sm-settings-muted">Staff and Super Admin accounts require a protected administrator handover. Do not use a customer password to close a staff account. <a href="mailto:support@singmotion.ai?subject=Staff%20account%20closure">Contact support</a>.</p>:<>
       
       {erasure?.message&&<p className="sm-settings-deletion-status" role="status" aria-live="polite">{erasure.message}</p>}
       <details open={deleteOpen} onToggle={e=>setDeleteOpen(e.currentTarget.open)} className="sm-settings-deletion-disclosure">
        <summary>Delete account permanently</summary>
        <form className="sm-settings-order-confirm" onSubmit={e=>{e.preventDefault();void deleteMyAccount();}}>
         <p className="sm-settings-muted sm-settings-delete-warning"><strong>This cannot be undone.</strong> You can request deletion even while payment or file verification is still pending. Account access is frozen immediately. Verified unused purchased Credits are refunded to the original payment method before data removal. A confirmation email follows successful completion. Required financial records are retained as required.</p>
         {erasure?.googleOnly?
           <div className="sm-settings-deletion-google">
             <p>Für die Löschung deines Google-Kontos bestätige deine Identität durch eine erneute Google-Anmeldung. Nach der Rückkehr kannst du die Löschung endgültig bestätigen.</p>
             {erasure.googleReauthenticated?
               <p role="status">Google-Anmeldung bestätigt. Du kannst die Löschung jetzt abschließen.</p>:
               <a className="sm-settings-secondary" href="/api/google-auth?start=1&returnTo=%2Faccount%2Fsettings%23privacy">Mit Google erneut anmelden</a>}
           </div>:
           <label>Account password<input type="password" autoComplete="current-password" required maxLength={256} value={deletePassword} onChange={e=>setDeletePassword(e.target.value)}/></label>}
         <label>Type DELETE MY ACCOUNT<input type="text" autoComplete="off" spellCheck={false} required value={deleteConfirmation} onChange={e=>setDeleteConfirmation(e.target.value)} placeholder="DELETE MY ACCOUNT"/></label>
         <button className="sm-settings-danger" type="submit" disabled={deleteBusy||(!erasure?.googleOnly&&!deletePassword)||(erasure?.googleOnly&&!erasure?.googleReauthenticated)||deleteConfirmation!=="DELETE MY ACCOUNT"}>{deleteBusy?"Submitting deletion request…":"Permanently delete my account"}</button>
         {deleteNotice&&<p role="alert" className="sm-settings-muted">{deleteNotice}</p>}
        </form>
       </details>
      </>}
      <p className="sm-settings-support"><LifeBuoy size={17}/> <a href="mailto:support@singmotion.ai">Need help? Contact support</a></p>
     </section>
   {canShowAdmin&&<AdminAnnouncements/>}
   {canShowAdmin&&<AdminAccountDashboard overview={adminOverview} busy={adminStatusBusy} error={adminStatusError} refresh={()=>void refreshAdminStatus()}/>}
   </>}
  </div></div></div></Shell>;
}
