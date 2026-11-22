"use client";
import {useEffect,useState} from "react";

type Settings={enabled:boolean;referrerCredits:number;friendCredits:number;
 minimumPurchaseCredits:number;holdDays:number;maxTotalCredits:number;maxPerReferrer:number;revision:number};
type Stats={rewards:number;committedCredits:number;paid:number;reviews:number};
export function ReferralSettingsPanel(){
 const [settings,setSettings]=useState<Settings|null>(null);
 const [stats,setStats]=useState<Stats|null>(null);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 useEffect(()=>{
  let mounted=true;
  void fetch("/api/admin-referrals",{cache:"no-store",credentials:"same-origin"})
   .then(async r=>{if(!r.ok)throw Error("Referral settings unavailable");return r.json();})
   .then((v:{settings:Settings;stats:Stats})=>{if(mounted){setSettings(v.settings);setStats(v.stats);}})
   .catch(e=>{if(mounted)setError(e instanceof Error?e.message:"Settings unavailable");});
  return()=>{mounted=false};
 },[]);
 const set=(key:keyof Settings,value:number|boolean)=>setSettings(current=>current?{...current,[key]:value}:current);
 async function save(){
  if(!settings||busy)return;
  setBusy(true);setError("");setMessage("");
  try{
   const response=await fetch("/api/admin-referrals",{method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},body:JSON.stringify({settings})});
   const result=await response.json() as {settings?:Settings;stats?:Stats;error?:string};
   if(!response.ok||!result.settings)throw Error(result.error||"Could not save");
   setSettings(result.settings);setStats(result.stats||null);
   setMessage("Referral settings saved (version "+result.settings.revision+").");
  }catch(e){setError(e instanceof Error?e.message:"Save failed");}
  finally{setBusy(false);}
 }
 const field=(key:Exclude<keyof Settings,"enabled"|"revision">,label:string,min:number,max:number)=>
  <label key={key} style={{display:"grid",gap:6,marginBottom:12}}>{label}
   <input type="number" step={1} min={min} max={max} value={settings?.[key]??0}
    onChange={event=>set(key,Number(event.target.value))} disabled={busy||!settings}/>
  </label>;
 return <section aria-label="Refer & Earn" className="sm-marketing-editor" style={{margin:"24px 0",padding:20}}>
  <h2>Refer & Earn · Freundschaftsbonus</h2>
  <p>Persönliche Empfehlungslinks und kostenlose Credits für bestätigte Erstkäufe. Standardmäßig AUS. Beträge sind echte Wallet-Credits, keine Stripe-Zahlungen.</p>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {!settings?<p>Lade Einstellungen…</p>:<>
   <label style={{display:"flex",alignItems:"center",gap:12,margin:"16px 0"}}>
    <input type="checkbox" checked={settings.enabled} onChange={e=>set("enabled",e.target.checked)} disabled={busy}/>
    <strong>{settings.enabled?"Programm aktiviert":"Programm deaktiviert"}</strong>
   </label>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:16}}>
    {field("referrerCredits","Bonus für werbenden Kunden · Credits",0,5000)}
    {field("friendCredits","Bonus für neuen Kunden · Credits",0,5000)}
    {field("minimumPurchaseCredits","Mindest-Erstkauf · Credits",500,100000)}
    {field("holdDays","Wartezeit nach Zahlung · Tage",1,90)}
    {field("maxTotalCredits","Globales Credit-Budget",1,1000000)}
    {field("maxPerReferrer","Maximale Prämien je Werber",1,1000)}
   </div>
   <p>Wichtig: Ein bereits zugesagter, offener Bonus bleibt auch bei einer späteren Deaktivierung zur Abrechnung vorgemerkt. Betragsänderungen betreffen nur neue Prämien.</p>
   {stats&&<p>Erfasste Erstkäufe: {stats.rewards} · Zugesagte Credits: {stats.committedCredits} · Ausgezahlt: {stats.paid} · Finanzprüfung: {stats.reviews}</p>}
   <button type="button" onClick={()=>void save()} disabled={busy}>{busy?"Speichere…":"Einstellungen speichern"}</button>
  </>}
 </section>;
}
