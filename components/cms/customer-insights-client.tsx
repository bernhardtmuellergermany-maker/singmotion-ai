"use client";

import {useEffect,useState} from "react";
import type {
 CustomerInsightsList,CustomerInsightsProfile,CustomerInsight,CustomerInsightEvent,
} from "../../lib/commerce/customer-insights";
import "./customer-insights.css";
import type {StorageOverview} from "../../lib/music-video/storage";
import {CustomerCreditGift} from "./customer-credit-gift";

const number=(n:number)=>new Intl.NumberFormat("de-DE").format(n);
const money=(cents:number)=>new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"})
 .format(cents/100);
const date=(time:number|null)=>{
 if(!time)return "—";
 return new Date(time).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric",timeZone:"Europe/Berlin"});
};
const datetime=(time:number|null)=>{
 if(!time)return "—";
 return new Date(time).toLocaleString("de-DE",{dateStyle:"short",timeStyle:"short",timeZone:"Europe/Berlin"});
};
function ErrorMessage({text}:{text:string}){
 return <p className="sm-insights-error" role="alert">{text}</p>;
}
function Stat({label,value,detail}:{label:string;value:string;detail:string}){
 return <div className="sm-insights-stat">
  <span>{label}</span><strong>{value}</strong><small>{detail}</small>
 </div>;
}
function ActivityItem({item}:{item:CustomerInsightEvent}){
 const kind={order:"Bestellung","credit-topup":"Credit-Aufladung",video:"Videogenerierung",wallet:"Wallet-Buchung"}[item.kind];
 return <li><div><strong>{kind}</strong><span className="sm-insights-status">{item.status}</span>
  <small>{datetime(item.at)}{item.reference?" · "+item.reference:""}</small></div>
  <span>{item.credits!==undefined?number(item.credits)+" Credits":item.cents!==undefined?money(item.cents):""}</span></li>;
}
function Detail({data,onClose,onBooked}:{data:CustomerInsightsProfile;onClose:()=>void;onBooked:()=>void}){
 const c=data.customer;
 return <section className="sm-insights-detail" aria-label="Kundendetails">
  <div className="sm-insights-detail-head"><div><span className="sm-insights-kicker">KUNDENPROFIL · NUR SUPER-ADMIN</span>
   <h2>{c.email}</h2><p>Kundennummer: <code>{c.id}</code></p></div>
   <button type="button" onClick={onClose}>Schließen</button></div>
  <div className="sm-insights-detail-grid">
   <p><span>Registriert</span><strong>{date(c.joinedAt)}</strong></p>
   <p><span>E-Mail-Status</span><strong>{c.verification==="verified"?"Verifiziert":c.verification==="pending"?"Ausstehend":"Bestandskonto"}</strong></p>
   <p><span>Videos nachweisbar</span><strong>{number(c.videos)}</strong></p>
   <p><span>Credits verfügbar / reserviert</span><strong>{number(c.availableCredits)} / {number(c.reservedCredits)}</strong></p>
   <p><span>Credits verwendet</span><strong>{number(c.creditsSpent)}</strong></p>
   <p><span>Beta-/Bonus-Credits gebucht</span><strong>{number(c.promotionalCredits)}</strong></p>
   <p><span>Manuell geschenkte Credits</span><strong>{number(c.manualGiftCredits)}</strong></p>
   <p><span>Credit-Käufe · verbucht</span><strong>{number(c.paidTopups)} · {money(c.topupCents)}</strong></p>
   <p><span>Frühere Käufe · brutto</span><strong>{money(c.legacyGrossCents)}</strong></p>
   <p><span>Bekannte Rückerstattungen · früher</span><strong>{money(c.knownRefundCents)}</strong></p>
   <p><span>Offene Aufladungen / Credit-Prüfungen</span><strong>{number(c.pendingTopups)} / {number(c.reviewVideos)}</strong></p>
   <p><span>Letzte Transaktion</span><strong>{datetime(c.lastTransactionAt)}</strong></p>
   <p><span>Marketing-Einwilligung</span><strong>Nicht erfasst</strong></p>
  </div>
  <CustomerCreditGift customer={c} onBooked={onBooked}/>
  <h3>Letzte Buchungen und Video-Status</h3>
  <p>Technische Statuswerte aus den vorhandenen Buchungen; keine Zahlungsbelege oder Besuchsprotokolle.</p>
  {data.events.length===0?<p>Keine Transaktionen vorhanden.</p>:<ul className="sm-insights-events">
   {data.events.map(item=><ActivityItem item={item} key={item.id}/>)}
  </ul>}
  <p className="sm-insights-support">Für Erstattungen, Rechteanfragen oder Support nutze weiterhin
   die <a href="/admin/support">geschützte Support-Konsole</a>. Korrekturbuchungen und Rückerstattungen sind ausdrücklich getrennte, geschützte Vorgänge.</p>
 </section>;
}

const storageSize=(bytes:number)=>(bytes/1e9).toLocaleString("de-DE",{maximumFractionDigits:3})+" GB";
function StoragePanel(){
 const [data,setData]=useState<StorageOverview|null>(null),[error,setError]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{const c=new AbortController();setError(false);
  void fetch("/api/customer-insights?storage=1",{credentials:"same-origin",cache:"no-store",signal:c.signal}).then(async r=>{if(!r.ok)throw Error("Storage unavailable");return await r.json() as {storage:StorageOverview};}).then(r=>{if(!c.signal.aborted)setData(r.storage)}).catch(()=>{if(!c.signal.aborted){setData(null);setError(true)}});return()=>c.abort();
 },[revision]);
 return <section className="sm-insights-area" aria-label="Speicherübersicht"><div className="sm-insights-area-head"><div><h2>Speicherübersicht</h2><p>Railway-Datenträger und registrierte R2-Manifeste in dieser Umgebung.</p></div><button type="button" onClick={()=>setRevision(v=>v+1)}>Aktualisieren</button></div>
 {error?<p role="alert">Speicherübersicht derzeit nicht verfügbar.</p>:!data?<p role="status">Speicher wird geprüft…</p>:<><div className="sm-insights-stats">
 <Stat label="Railway verfügbar" value={storageSize(data.disk.availableBytes)} detail={"Von "+storageSize(data.disk.totalBytes)+" Dateisystemkapazität"}/>
 <Stat label="Lokale Projects-Dateien" value={storageSize(data.projects.totalBytes)} detail={number(data.projects.projects)+" Projekte"+(data.projects.partial?" · Teilmessung":"")}/>
 <Stat label="R2 Projects-Videos" value={storageSize(data.projects.cloudVideoBytes)} detail={number(data.projects.cloudVideoObjects)+" registrierte Objekte"}/>
 <Stat label="R2-Quellen (Manifeste)" value={storageSize(data.cloud.sourceBytes)} detail={number(data.cloud.sourceObjects)+" registrierte Objekte"}/>
 <Stat label="R2-Videos (Manifeste)" value={storageSize(data.cloud.videoBytes)} detail={number(data.cloud.videoObjects)+" registrierte Objekte"}/>
 </div><p>Cloud-Werte sind Manifest-Summen, keine unabhängige Bucket-Belegung. Temporäre Provider-Dateien, Backups und nicht registrierte Objekte sind nicht enthalten.</p><p>Automatische Papierkorb-Bereinigung: {data.trashPurgeEnabled?"konfiguriert":"nicht aktiviert"}.</p></>}
 </section>;
}
export function CustomerInsightsClient(){
 const [input,setInput]=useState("");
 const [search,setSearch]=useState("");
 const [page,setPage]=useState(1);
 const [result,setResult]=useState<CustomerInsightsList|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [selected,setSelected]=useState<string|null>(null);
 const [detail,setDetail]=useState<CustomerInsightsProfile|null>(null);
 const [detailError,setDetailError]=useState("");
 const [detailLoading,setDetailLoading]=useState(false);
 const [detailRevision,setDetailRevision]=useState(0);
 useEffect(()=>{
  const timer=window.setTimeout(()=>{setSearch(input.trim());setPage(1);setSelected(null);setDetail(null)},350);
  return()=>window.clearTimeout(timer);
 },[input]);
 useEffect(()=>{
  const controller=new AbortController();
  setLoading(true);setError("");
  const params=new URLSearchParams({q:search,page:String(page)});
  void fetch("/api/customer-insights?"+params.toString(),{
   credentials:"same-origin",cache:"no-store",signal:controller.signal,
  }).then(async res=>{
   if(!res.ok)throw Error(res.status===403?"Super-Admin-Anmeldung erforderlich.":"Kundenübersicht derzeit nicht verfügbar.");
   return await res.json() as CustomerInsightsList;
  }).then(data=>{if(!controller.signal.aborted)setResult(data)})
   .catch((reason:unknown)=>{
    if(!controller.signal.aborted){setResult(null);setError(reason instanceof Error?reason.message:"Abfrage fehlgeschlagen.")}
   }).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[search,page]);
 useEffect(()=>{
  if(!selected){setDetail(null);setDetailError("");return}
  const controller=new AbortController();
  setDetail(null);setDetailError("");setDetailLoading(true);
  void fetch("/api/customer-insights?id="+encodeURIComponent(selected),{
   cache:"no-store",credentials:"same-origin",signal:controller.signal,
  }).then(async res=>{
   if(!res.ok)throw Error("Kundenprofil ist derzeit nicht abrufbar.");
   return await res.json() as {profile:CustomerInsightsProfile};
  }).then(data=>{if(!controller.signal.aborted)setDetail(data.profile)})
  .catch((reason:unknown)=>{
   if(!controller.signal.aborted)setDetailError(reason instanceof Error?reason.message:"Fehler bei der Detailabfrage");
  }).finally(()=>{if(!controller.signal.aborted)setDetailLoading(false)});
  return()=>controller.abort();
 },[selected,detailRevision]);
 const metrics=result?.summary;
 return <main className="sm-insights" aria-label="Customer Insights">
  <header className="sm-insights-hero"><span className="sm-insights-kicker">SINGMOTION AI · PRIVATE OPERATIONS</span>
   <h1>Customer Insights</h1>
   <p>Kunden, Videos, Credits und vorhandene Zahlungsdaten in dieser Railway-Umgebung. Einzelgutschriften sind separat geschützt.
     Kein Kundentracking und keine Datenweitergabe an Werbenetzwerke.</p>
  </header>
  {error&&<ErrorMessage text={error}/>}
  {loading&&<p role="status">Kundendaten werden sicher geladen…</p>}
  {metrics&&<div className="sm-insights-stats" aria-label="Gesamtüberblick">
   <Stat label="Kundenkonten" value={number(metrics.customers)}
    detail={number(metrics.registeredLast30Days)+" neu in den letzten 30 Tagen"}/>
   <Stat label="Verifizierte Konten" value={number(metrics.verifiedCustomers)}
    detail="E-Mail-Verifizierung dokumentiert"/>
   <Stat label="Videolieferungen / verbuchte Credit-Videos" value={number(metrics.verifiedVideoResults)}
    detail={number(metrics.creditVideos)+" Credit-Videos · "+number(metrics.historicalVideos)+" ältere Lieferungen"}/>
   <Stat label="Verbuchte Credit-Käufe" value={money(metrics.creditTopupCents)}
    detail="Bezahlt, nicht rückgängig gemacht; kein Nettoumsatz"/>
   <Stat label="Ältere bezahlte Aufträge" value={money(metrics.legacyGrossCents)}
    detail={money(metrics.knownRefundCents)+" bekannte Rückerstattungen separat"}/>
   <Stat label="Credit-Guthaben" value={number(metrics.creditsRemaining)}
    detail={number(metrics.creditsReserved)+" Credits zusätzlich reserviert; keine Geldforderung"}/>
   <Stat label="Offene Aufladungen" value={number(metrics.checkoutPending)}
    detail="Pending ist nicht automatisch ein Abbruch"/>
   <Stat label="Videos mit offener Prüfung" value={number(metrics.creditVideoReviews)}
    detail="Support- und Abrechnungsfälle prüfen"/>
  </div>}
  <StoragePanel/>
  <section className="sm-insights-area" aria-label="Kundenliste">
   <div className="sm-insights-area-head"><div><h2>Kundenliste</h2>
    <p>Vollständige E-Mail-Adressen und Einzelbuchungen nur für CMS-Super-Admins.</p></div>
    <label>Suche nach E-Mail oder Kunden-ID
     <input type="search" autoComplete="off" value={input} onChange={e=>setInput(e.target.value)}
      maxLength={80} placeholder="E-Mail oder Konto-ID"/></label>
   </div>
   {result&&!loading&&<><div className="sm-insights-table-scroll"><table>
    <thead><tr><th>Kunde</th><th>Registriert</th><th>Videos</th><th>Credits frei</th>
     <th>Credit-Käufe</th><th>Letzte Transaktion</th><th>Details</th></tr></thead>
    <tbody>{result.rows.length===0?<tr><td colSpan={7}>Keine passenden Kundenkonten.</td></tr>:
     result.rows.map((c:CustomerInsight)=><tr key={c.id}>
      <td><strong>{c.email}</strong><small>{c.verification==="verified"?"E-Mail bestätigt":c.verification==="pending"?"Verifizierung ausstehend":"Bestandskonto"}</small></td>
      <td>{date(c.joinedAt)}</td><td>{number(c.videos)}</td>
      <td>{number(c.availableCredits)}{c.reservedCredits>0?<small>{number(c.reservedCredits)} reserviert</small>:null}</td>
      <td>{money(c.topupCents)}<small>+ frühere Käufe {money(c.legacyGrossCents)}</small></td>
      <td>{date(c.lastTransactionAt)}</td>
      <td><button type="button" aria-expanded={selected===c.id} onClick={()=>setSelected(v=>v===c.id?null:c.id)}>Ansehen</button></td>
     </tr>)}</tbody>
   </table></div>
   <div className="sm-insights-pagination"><span>{number(result.total)} Konten · Seite {result.page}</span>
    <div><button type="button" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Zurück</button>
    <button type="button" disabled={!result.hasNext} onClick={()=>setPage(p=>p+1)}>Weiter</button></div>
   </div></>}
  </section>
  {selected&&<div className="sm-insights-detail-wrap">
   {detailLoading&&<p role="status">Kundenprofil wird geladen…</p>}
   {detailError&&<ErrorMessage text={detailError}/>}
   {detail&&<Detail data={detail} onClose={()=>setSelected(null)} onBooked={()=>setDetailRevision(v=>v+1)}/>}
  </div>}
  <section className="sm-insights-area sm-insights-privacy" aria-label="Nicht erhobene Analysedaten">
   <h2>Was bewusst nicht erfasst wird</h2>
   <div><p><strong>Herkunftsland / Werbequelle</strong> – keine verlässliche Zuordnung vorhanden; nicht aus IP-Adressen abgeleitet.</p>
    <p><strong>Besuchsdauer / Nutzungshäufigkeit</strong> – keine Besuchs- oder Sitzungsprofile. Die gezeigte letzte Aktivität ist ausschließlich die letzte bekannte Transaktion.</p>
    <p><strong>Website- und Checkout-Abbrüche</strong> – keine Besucher-Funnelmessung. Offene Aufladungen sind nur technische Statuswerte, keine nachgewiesenen Abbrüche.</p>
    <p><strong>Marketing</strong> – kein verifiziertes Newsletter-Opt-in vorhanden. E-Mail-Verifizierung und Video-Benachrichtigungen gelten nicht als Werbe-Einwilligung.</p></div>
   <small>Zahlungen sind Anwendungsbuchungen, keine Steuer- oder Bankabrechnung; historische Rückerstattungen werden gesondert ausgewiesen.
    Statistiken umfassen nur zuordenbare Kundenkonten und dokumentierte Credit-/Auftragsereignisse. Gastnutzung wird hier nicht zu einem Profil zusammengeführt.</small>
  </section>
 </main>;
}
