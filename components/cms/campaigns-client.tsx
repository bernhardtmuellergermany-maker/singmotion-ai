"use client";

import {useCallback,useEffect,useState} from "react";
import {Rocket,Clock3} from "lucide-react";
import type {Campaign,CampaignStatus,CampaignTheme,PublicTariff} from "@/lib/commerce/campaign-pricing";
import "./campaigns.css";

type ListedCampaign=Campaign&{effectiveStatus:CampaignStatus};
type Summary={settledGenerations:number;settledSeconds:number;discountCredits:number;giftCredits:number};
type FormCampaign=Omit<Campaign,"id"|"revision"|"updated">&{id?:string;revision?:number};
const presets:{theme:CampaignTheme;accent:string;name:string}[]=[
 {theme:"purple",accent:"#af65ef",name:"SingMotion Purple"},
 {theme:"rose",accent:"#ff6ea8",name:"Pink / Rose"},
 {theme:"gold",accent:"#ffd166",name:"Gold"},
 {theme:"ice",accent:"#72c3ed",name:"Ice Blue"},
 {theme:"emerald",accent:"#76d7af",name:"Emerald"},
 {theme:"beta",accent:"#b48aff",name:"BETA · Lilac Glow (Badge-Vorlage)"},
];
const states:{value:CampaignStatus;label:string}[]=[
 {value:"draft",label:"Entwurf"},{value:"scheduled",label:"Geplant / automatisch"},
 {value:"active",label:"Aktiv (innerhalb des Zeitfensters)"},
 {value:"paused",label:"Pausiert"},{value:"expired",label:"Abgelaufen"},
 {value:"archived",label:"Archiviert"},
];
const displayStatus=(v:CampaignStatus)=>states.find(s=>s.value===v)?.label??v;
const berlinParts=(milliseconds:number)=>{
 const parts=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Berlin",year:"numeric",
  month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(milliseconds));
 const values=Object.fromEntries(parts.map(p=>[p.type,p.value]));
 return values.year+"-"+values.month+"-"+values.day+"T"+values.hour+":"+values.minute;
};
/** Reject nonexistent/ambiguous DST hour rather than silently choosing the wrong UTC instant. */
const berlinUtc=(raw:string)=>{
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw))return null;
 const local=Date.parse(raw+":00Z");
 if(!Number.isFinite(local))return null;
 const alternatives=[60,120].map(offset=>local-offset*60000)
  .filter(ts=>berlinParts(ts)===raw);
 return alternatives.length===1?alternatives[0]:null;
};
const date=(m:number)=>new Date(m).toLocaleString("de-DE",{timeZone:"Europe/Berlin",dateStyle:"medium",timeStyle:"short"});
const n=(value:number)=>new Intl.NumberFormat("de-DE").format(value);
function newCampaign():FormCampaign{
 const start=Date.now()+3600000;
 return {identifier:"aktion-"+Date.now().toString(36),status:"draft",
  startUtc:start,endUtc:start+7*86400000,creditsPerSecond:12,
  badgeText:"SPECIAL",heading:"SingMotion Special",description:"",
  actionHint:"",ctaText:"Create your video",theme:"purple",accent:"#af65ef",
  showBadge:true,showBanner:true,comparisonEvidence:null,
  maxCustomerGenerations:null,maxCampaignCredits:null};
}
export function CampaignsClient(){
 const [enabled,setEnabled]=useState<boolean|null>(null);
 const [campaigns,setCampaigns]=useState<ListedCampaign[]>([]);
 const [selected,setSelected]=useState<FormCampaign|null>(null);
 const [preview,setPreview]=useState<"mobile"|"desktop">("desktop");
 const [previewPage,setPreviewPage]=useState<"home"|"pricing"|"credits">("home");
 const [tariff,setTariff]=useState<PublicTariff|null>(null);
 const [summary,setSummary]=useState<Summary|null>(null);
 const [versions,setVersions]=useState<Array<{revision:number;actor:string;created:number}>>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [startInput,setStartInput]=useState("");
 const [endInput,setEndInput]=useState("");
 const reload=useCallback(async()=>{
  const response=await fetch("/api/admin-campaigns",{credentials:"same-origin",cache:"no-store"});
  if(!response.ok)throw Error("Kampagnen können derzeit nicht abgerufen werden.");
  const body=await response.json() as {enabled:boolean;campaigns:ListedCampaign[];tariff:PublicTariff|null};
  setEnabled(body.enabled);setCampaigns(body.campaigns);setTariff(body.tariff);
 },[]);
 useEffect(()=>{void reload().catch(e=>setError(e instanceof Error?e.message:"Kampagnen nicht verfügbar"))},[reload]);
 const choose=async(item:FormCampaign)=>{
  setSelected({...item});setError("");setMessage("");
  setStartInput(berlinParts(item.startUtc));setEndInput(berlinParts(item.endUtc));
  if(!item.id){setSummary(null);setVersions([]);return}
  try{
   const response=await fetch("/api/admin-campaigns?id="+encodeURIComponent(item.id),{cache:"no-store",credentials:"same-origin"});
   if(!response.ok)throw Error("Verlauf nicht abrufbar");
   const body=await response.json() as {stats:Summary;versions:Array<{revision:number;actor:string;created:number}>};
   setSummary(body.stats);setVersions(body.versions);
  }catch{setSummary(null);setVersions([])}
 };
 const edit=<K extends keyof FormCampaign>(field:K,value:FormCampaign[K])=>{
  setMessage("");setSelected(c=>c?{...c,[field]:value}:c);
 };
 const command=async(action:"save"|"duplicate"|"pause"|"archive")=>{
  if(!selected||busy)return;
  setError("");setMessage("");
  const start=berlinUtc(startInput),end=berlinUtc(endInput);
  if(start===null||end===null){setError("Datum ist in Europe/Berlin ungültig oder durch Sommerzeitumstellung mehrdeutig.");return}
  setBusy(true);
  try{
   const campaign={...selected,startUtc:start,endUtc:end};
   const response=await fetch("/api/admin-campaigns",{method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(action==="save"?{action,campaign,expectedRevision:selected.revision}:
      {action,id:selected.id,expectedRevision:selected.revision})});
   const body=await response.json() as {campaign?:Campaign;error?:string};
   if(!response.ok||!body.campaign)throw Error(body.error||"Speichern fehlgeschlagen.");
   setMessage("Kampagnenversion "+body.campaign.revision+" gespeichert · "+date(body.campaign.updated));
   await reload();await choose(body.campaign);
  }catch(e){setError(e instanceof Error?e.message:"Aktion nicht ausgeführt")}
  finally{setBusy(false)}
 };
 const label=selected?.badgeText||"SPECIAL";
 const rate=selected?.creditsPerSecond??25;
 const euro=new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(rate/100);
 const percent=selected?.comparisonEvidence&&selected.comparisonEvidence.length>=20&&rate<25
  ?Math.round((1-rate/25)*100):null;
 return <main className="sm-marketing" aria-label="Marketing & Aktionen">
  <header className="sm-marketing-heading"><span>SUPER ADMIN · VERSIONIERTE TARIFE</span><h1>Marketing & Aktionen</h1>
   <p>Kampagnen, Aktionspreise, Badge-Texte und Laufzeiten verwalten. Speicherung in UTC, Anzeige in Europe/Berlin. Nur eine veröffentlichte Aktion je Zeitraum.</p>
  </header>
  {error&&<p role="alert" className="sm-marketing-error">{error}</p>}
  {message&&<p role="status" className="sm-marketing-ok">{message}</p>}
  {enabled===false&&<p role="status" className="sm-marketing-alert">Kampagnen-Freigabe ist auf dieser Umgebung gesperrt. Vor Aktivierung sind Staging-Tests erforderlich.</p>}
  <div className="sm-marketing-summary"><span>Aktueller Tarif: <strong>{tariff?.creditsPerSecond??25} Credits/Sekunde</strong></span>
   <span>Preisversion: <code>{tariff?.version??"regular-v1"}</code></span>
   <span>Aktive Kampagne: <strong>{tariff?.identifier??"Keine"}</strong></span></div>
  <div className="sm-marketing-layout">
   <section className="sm-marketing-list"><div className="sm-marketing-list-header"><h2>Kampagnen</h2>
    <button type="button" disabled={!enabled} onClick={()=>void choose(newCampaign())}>+ Neue Aktion</button></div>
    {campaigns.length===0?<p>Keine Kampagnen vorhanden.</p>:<div className="sm-marketing-campaign-items">
     {campaigns.map(c=><button type="button" key={c.id} aria-pressed={selected?.id===c.id}
      onClick={()=>void choose(c)}>
      <strong>{c.identifier}</strong><span>{displayStatus(c.effectiveStatus)} · {c.creditsPerSecond} Credits/Sek.</span>
      <small>{date(c.startUtc)} – {date(c.endUtc)}</small></button>)}</div>}
   </section>
   {selected&&<section className="sm-marketing-editor" aria-label="Kampagne bearbeiten">
    <h2>{selected.id?"Kampagne bearbeiten":"Neue Kampagne"}</h2>
    <p className="sm-marketing-edit-note">Ändere jeden Text direkt hier. Die Vorschau aktualisiert sich sofort, ohne Veröffentlichung. Speichern erzeugt eine neue Tarifversion.</p>
    <div className="sm-marketing-form">
     <label>Identifier <input maxLength={50} value={selected.identifier}
      onChange={e=>edit("identifier",e.target.value)}/></label>
     <label>Status <select value={selected.status} onChange={e=>edit("status",e.target.value as CampaignStatus)}>
      {states.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
     <label>Start · Europe/Berlin <input type="datetime-local" value={startInput}
      onChange={e=>setStartInput(e.target.value)}/></label>
     <label>Ende · Europe/Berlin <input type="datetime-local" value={endInput}
      onChange={e=>setEndInput(e.target.value)}/></label>
     <label>Credits pro angefangene Sekunde <input type="number" min={1} max={25} step={1}
      value={selected.creditsPerSecond} onChange={e=>edit("creditsPerSecond",Number(e.target.value))}/></label>
     <label>Badge-Text (z. B. BETA, BLACK WEEK) <input maxLength={32} value={selected.badgeText}
      onChange={e=>edit("badgeText",e.target.value)}/></label>
     <label>Kampagnenüberschrift · Homepage, Pricing, Credits <input maxLength={120} value={selected.heading}
      onChange={e=>edit("heading",e.target.value)}/></label>
     <label>Beschreibung · Homepage, Pricing, Credits <textarea rows={2} maxLength={220} value={selected.description}
      onChange={e=>edit("description",e.target.value)}/></label>
     <label>Aktionshinweis · Homepage, Pricing, Credits <input maxLength={160} value={selected.actionHint}
      onChange={e=>edit("actionHint",e.target.value)}/></label>
     <label>CTA-Text · Angebot / Kaufen <input maxLength={60} value={selected.ctaText}
      onChange={e=>edit("ctaText",e.target.value)}/></label>
     <label>Geprüfte Designvorlage <select value={selected.theme}
      onChange={e=>{const preset=presets.find(p=>p.theme===e.target.value);if(preset)setSelected(c=>c?{...c,theme:preset.theme,accent:preset.accent}:c)}}>
      {presets.map(p=><option key={p.theme} value={p.theme}>{p.name}</option>)}</select></label>
     <label>Maximale Generierungen pro Kunde (optional) <input type="number" min={1}
      value={selected.maxCustomerGenerations??""} onChange={e=>edit("maxCustomerGenerations",e.target.value?Number(e.target.value):null)}/></label>
     <label>Globales Credit-Budget (optional) <input type="number" min={1}
      value={selected.maxCampaignCredits??""} onChange={e=>edit("maxCampaignCredits",e.target.value?Number(e.target.value):null)}/></label>
     <label className="sm-marketing-full">Nachweis zulässiger Preisvergleich (intern; optional)
      <textarea rows={2} maxLength={500} value={selected.comparisonEvidence??""}
       onChange={e=>edit("comparisonEvidence",e.target.value||null)}/>
      <small>Rabattprozente werden nur bei hinterlegtem überprüfbarem Vergleichspreisnachweis angezeigt.</small></label>
     <label className="sm-marketing-check"><input type="checkbox" checked={selected.showBadge}
      onChange={e=>edit("showBadge",e.target.checked)}/> Logo-Badge anzeigen</label>
     <label className="sm-marketing-check"><input type="checkbox" checked={selected.showBanner}
      onChange={e=>edit("showBanner",e.target.checked)}/> Angebotsleiste anzeigen</label>
    </div>
    <div className="sm-marketing-actions"><button type="button" disabled={busy||!enabled}
     onClick={()=>void command("save")}>{busy?"Prüfung läuft…":"Version speichern"}</button>
     {selected.id&&<><button disabled={busy} type="button" onClick={()=>void command("duplicate")}>Duplizieren</button>
     <button disabled={busy} type="button" onClick={()=>void command("pause")}>Pausieren</button>
     <button disabled={busy} type="button" onClick={()=>void command("archive")}>Archivieren</button></>}</div>
    <section className="sm-marketing-preview-area" aria-label="Kampagnenvorschau">
     <div className="sm-marketing-preview-title"><div><h3>Live-Vorschau</h3>
      <p>Alle Werbetexte, das BETA-Badge und die Preisberechnung sind in beiden Ansichten sichtbar.</p></div>
      <div className="sm-marketing-preview-controls" role="group" aria-label="Displaygröße">
       <button type="button" aria-pressed={preview==="mobile"} onClick={()=>setPreview("mobile")}>Mobile · 390 px</button>
       <button type="button" aria-pressed={preview==="desktop"} onClick={()=>setPreview("desktop")}>Desktop · 1440 px</button>
      </div></div>
     <div className="sm-marketing-preview-controls sm-marketing-preview-pages" role="group" aria-label="Vorschauseite">
      <button type="button" aria-pressed={previewPage==="home"} onClick={()=>setPreviewPage("home")}>Homepage</button>
      <button type="button" aria-pressed={previewPage==="pricing"} onClick={()=>setPreviewPage("pricing")}>Pricing</button>
      <button type="button" aria-pressed={previewPage==="credits"} onClick={()=>setPreviewPage("credits")}>Credits kaufen</button>
     </div>
     <div className="sm-marketing-preview-stage">
      <div className={"sm-marketing-preview sm-marketing-preview-"+preview+" sm-marketing-preview-"+previewPage}
       data-theme={selected.theme} style={{"--campaign-accent":selected.accent} as React.CSSProperties}>
       <div className="sm-marketing-preview-header">
        <span className="sm-marketing-preview-brand">SingMotion <strong>AI</strong></span>
        {selected.showBadge&&selected.badgeText&&<em className="sm-marketing-preview-badge" data-theme={selected.theme}>{selected.badgeText}</em>}
        <span className="sm-marketing-preview-menu" aria-hidden="true">☰</span>
       </div>
       {previewPage==="home"?<div className="sm-marketing-preview-hero">
        <strong className="sm-marketing-preview-hero-head">Turn your song into a <span>music video.</span></strong>
        <p>With SingMotion AI — your song, your performance.</p>
        <span className="sm-marketing-preview-primary">Create your music video</span>
        {selected.showBanner&&<div className="sm-marketing-preview-offer-block">
         <div className="sm-marketing-preview-offer">
          <div className="sm-marketing-preview-offer-top">
           <strong className="sm-marketing-preview-offer-name"><Rocket size={17} aria-hidden="true"/>{label} Offer</strong>
           <span className="sm-marketing-preview-offer-divider" aria-hidden="true"/>
           <span className="sm-marketing-preview-offer-price">{euro} / sec</span>
           {percent!==null&&<>
            <b className="sm-marketing-preview-offer-discount">{percent}% OFF</b>
            <del className="sm-marketing-preview-offer-regular">0,25 € / sec</del>
           </>}
          </div>
         </div>
         <div className="sm-marketing-preview-offer-meta">
          {(selected.heading||selected.description)&&<span className="sm-marketing-preview-offer-detail">
           {selected.heading&&<strong>{selected.heading}</strong>}
           {selected.description&&<span>{selected.description}</span>}
          </span>}
          <small className="sm-marketing-preview-offer-hint"><Clock3 size={14} aria-hidden="true"/>{selected.actionHint||"Limited-time offer"}</small>
          {selected.ctaText&&<span className="sm-marketing-preview-offer-cta">{selected.ctaText}</span>}
         </div>
        </div>}
       </div>:<div className="sm-marketing-preview-info">
        <span className="sm-marketing-preview-eyebrow">{previewPage==="pricing"?"YOUR MUSIC. YOUR PERFORMANCE.":"SINGMOTION AI · ACCOUNT"}</span>
        <strong className="sm-marketing-preview-info-title">{previewPage==="pricing"?"Pricing.":"Your credits."}</strong>
        <p>{previewPage==="pricing"?"Simple prepaid credits. No monthly subscription.":"Your wallet, your balance and credit history."}</p>
        {selected.showBanner&&<div className="sm-marketing-preview-offer sm-marketing-preview-info-offer">
         <strong>{label} · LIMITED VIDEO RATE</strong>
         {selected.heading&&<strong className="sm-marketing-preview-campaign-title">{selected.heading}</strong>}
         {selected.description&&<p>{selected.description}</p>}
         <b>{euro} / sec · {rate} Credits</b>
         {percent!==null&&<span>{percent}% OFF</span>}
         {selected.actionHint&&<small>{selected.actionHint}</small>}
         {selected.ctaText&&<span className="sm-marketing-preview-offer-cta">{selected.ctaText}</span>}
        </div>}
        <div className="sm-marketing-preview-pricecard"><strong>{rate} Credits / sec</strong>
         <p>10 sec · {10*rate} Credits</p><p>30 sec · {30*rate} Credits</p></div>
       </div>}
      </div>
     </div>
     <p className="sm-marketing-preview-note">Vorschau ist eine responsive Darstellung, kein Veröffentlichungs-Button. Das gespeicherte Angebot erscheint auf Homepage, Pricing und Credits nur während seiner gültigen Laufzeit.</p>
    </section>
    {summary&&<section className="sm-marketing-metrics"><h3>Kampagnenstatistik · verifizierte Buchungen</h3>
     <p>{n(summary.settledGenerations)} abgeschlossene Generationen · {n(summary.settledSeconds)} Sekunden ·
      {n(summary.discountCredits)} gewährte Rabatt-Credits · {n(summary.giftCredits)} Geschenk-Credits</p>
     <p>Keine unbestätigten Käufe als Umsatz erfasst. Providerkosten nur mit nachweisbarer Kostenquelle.</p></section>}
    {versions.length>0&&<section className="sm-marketing-history"><h3>Revisionsverlauf</h3><ul>
     {versions.map(v=><li key={v.revision}>Version {v.revision} · {date(v.created)} · Administrator {v.actor}</li>)}</ul></section>}
   </section>}
  </div>
 </main>;
}
