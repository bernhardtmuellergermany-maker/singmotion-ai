"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "./site-header";

const topics = [
  {value:"general",label:"General question"},
  {value:"generation",label:"Video generation & quality"},
  {value:"upload",label:"Audio, image or upload problem"},
  {value:"orders",label:"Orders, billing & refunds"},
  {value:"account",label:"Account & access"},
  {value:"privacy",label:"Privacy & data deletion"},
  {value:"rights",label:"Copyright, likeness & abuse report"},
  {value:"other",label:"Other request"},
] as const;

export function ContactForm(){
 const [config,setConfig]=useState<{available:boolean;siteKey:string}>({available:false,siteKey:""});
 const [topic,setTopic]=useState<string>("general");
 const [name,setName]=useState("");
 const [email,setEmail]=useState("");
 const [reference,setReference]=useState("");
 const [message,setMessage]=useState("");
 const [consent,setConsent]=useState(false);
 const [humanToken,setHumanToken]=useState("");
 const [busy,setBusy]=useState(false);
 const [result,setResult]=useState("");
 const [error,setError]=useState("");
 useEffect(()=>{let active=true;void fetch("/api/contact",{cache:"no-store"}).then(r=>r.json()).then(v=>{if(active)setConfig({available:v?.available===true,siteKey:typeof v?.siteKey==="string"?v.siteKey:""});}).catch(()=>{});return()=>{active=false};},[]);
 useEffect(()=>{
   if(!config.siteKey||!config.available)return;
   let active=true;
   const container=document.getElementById("sm-contact-turnstile");
   let widgetId:string|undefined;
   let script:HTMLScriptElement|null=null;
   type Turnstile={render:(el:HTMLElement,options:{sitekey:string;action:string;callback:(token:string)=>void;"expired-callback":()=>void;"error-callback":()=>void})=>string;remove:(id:string)=>void};
   const w=window as typeof window & {turnstile?:Turnstile};
   const render=()=>{if(active&&container&&w.turnstile&&!widgetId)widgetId=w.turnstile.render(container,{sitekey:config.siteKey,action:"singmotion_contact",callback:t=>{if(active)setHumanToken(t);},"expired-callback":()=>setHumanToken(""),"error-callback":()=>setHumanToken("")});};
   if(w.turnstile)render();
   else {script=document.createElement("script");script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";script.async=true;script.defer=true;script.onload=render;document.head.appendChild(script);}
   return()=>{active=false;if(widgetId&&w.turnstile)w.turnstile.remove(widgetId);if(script)script.remove();};
 },[config.siteKey,config.available]);
 async function submit(event:React.FormEvent<HTMLFormElement>){
   event.preventDefault();if(busy||!config.available)return;
   setBusy(true);setError("");setResult("");
   try{
    const res=await fetch("/api/contact",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({topic,name,email,reference,message,consent,humanToken,website:(event.currentTarget.elements.namedItem("website") as HTMLInputElement|null)?.value||""})});
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body.error||"Your message could not be sent.");
    setResult(body.confirmationSent===true ? "Your message was sent. A confirmation email with a copy of your message has been requested for your inbox. Please also check your spam folder." : "Your message was sent to support, but the confirmation email could not be sent. Please keep a copy of your message.");setMessage("");setHumanToken("");
   }catch(e){setError(e instanceof Error?e.message:"Sending failed. Please try again later.");}
   finally{setBusy(false);}
 }
 return <div className="sm-legal sm-contact-page">
   <SiteHeader/>
   <main id="content" className="sm-legal-main">
     <div className="sm-legal-intro"><span className="sm-legal-kicker">SINGMOTION AI · SUPPORT</span><h1>Contact & Support</h1><p>Questions about your project, video output, account, billing or rights? Select a topic and describe what happened.</p></div>
     <section className="sm-legal-panel">
       <h2>Send us a message</h2>
       <p>Never include passwords, payment card details, private video URLs or sensitive documents. For order questions, an order reference helps us identify the issue.</p>
       {!config.available&&<p role="status">Secure contact delivery is not available yet. The operator must finish verified mail routing and human verification before messages can be accepted. For guidance, visit <Link href="/help">Help</Link>.</p>}
       <form onSubmit={submit} className="sm-contact-form">
         <label>Topic <select required value={topic} onChange={e=>setTopic(e.target.value)}>{topics.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
         <label>Name <input value={name} maxLength={120} onChange={e=>setName(e.target.value)} autoComplete="name" required/></label>
         <label>Email <input value={email} type="email" maxLength={254} autoComplete="email" onChange={e=>setEmail(e.target.value)} required/></label>
         <label>Order or project reference (optional) <input value={reference} maxLength={120} onChange={e=>setReference(e.target.value)} /></label>
         <label>Message <textarea required minLength={15} maxLength={5000} rows={6} value={message} onChange={e=>setMessage(e.target.value)} placeholder="Explain the issue, expected outcome, and any relevant error message."/></label>
         <label className="sm-contact-honeypot" aria-hidden="true">Website <input name="website" tabIndex={-1} autoComplete="off"/></label>
         <label className="sm-contact-check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} required/><span>I have read the <Link href="/privacy">privacy information</Link> about handling this request.</span></label>
         {config.available&&<div id="sm-contact-turnstile" aria-label="Human verification"/>}
         <button type="submit" disabled={!config.available||!humanToken||!consent||busy}>{busy?"Sending…":"Send message"}</button>
         {result&&<p role="status">{result}</p>}{error&&<p role="alert">{error}</p>}
       </form>
     </section>
     <section className="sm-legal-panel"><h2>Before contacting support</h2><p>Check <Link href="/faq">FAQs</Link> and <Link href="/help">Help & best practices</Link> for upload limits, BytePlus guidance and troubleshooting. If you believe your rights or likeness were used without permission, choose “Copyright, likeness & abuse report” and describe the affected content without publishing another person's private data.</p></section>
   </main>
   <style>{`.sm-contact-form{display:grid;gap:16px;max-width:620px;margin-top:22px}.sm-contact-form label{display:grid;gap:7px;font-weight:600;color:#eeeafc}.sm-contact-form input:not([type="checkbox"]),.sm-contact-form select,.sm-contact-form textarea{width:100%;box-sizing:border-box;border:1px solid #55526e;border-radius:11px;background:#111422;color:#f6f3ff;padding:13px;font:inherit}.sm-contact-form input:focus-visible,.sm-contact-form select:focus-visible,.sm-contact-form textarea:focus-visible{outline:2px solid #bb83f2}.sm-contact-form .sm-contact-check{display:flex;gap:10px;align-items:flex-start;font-weight:400}.sm-contact-form .sm-contact-check input{margin-top:5px}.sm-contact-form a{color:#cda5ff}.sm-contact-form button{background:#b75de8;color:#150c1d;padding:14px;border:0;border-radius:12px;font-weight:700;cursor:pointer}.sm-contact-form button:disabled{opacity:.5;cursor:not-allowed}.sm-contact-honeypot{position:absolute!important;left:-10000px;opacity:0;pointer-events:none}`}</style>
 </div>;
}
