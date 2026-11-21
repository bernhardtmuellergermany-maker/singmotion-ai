import Link from "next/link";
import {ArrowUpRight, UsersRound, LifeBuoy, Film, Gift, Settings, Megaphone} from "lucide-react";
import {hasRole} from "../../cms/policy";

type Entry={label:string;description:string;href:string;icon:typeof UsersRound};
function Links({items}:{items:Entry[]}){
 return <div className="sm-cms-quick-grid">{items.map(item=>{
  const Icon=item.icon;
  return <Link key={item.href} href={item.href} className="sm-cms-quick-link">
   <span className="sm-cms-quick-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.9}/></span>
   <span className="sm-cms-quick-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
   <ArrowUpRight size={18} className="sm-cms-quick-arrow" aria-hidden="true"/>
  </Link>;
 })}</div>;
}

/** Removed modules stay registered for data preservation, but no longer occupy
 * the dashboard or native sidebar. All navigation remains inside /admin.
 */
export function Operations({user}:{user:unknown}){
 const superAdmin=hasRole(user,["super-admin"]);
 const editor=hasRole(user,["super-admin","editor"]);
 const support=hasRole(user,["super-admin","support"]);
 if(!superAdmin&&!editor&&!support)return <p>CMS-Zugang erforderlich.</p>;
 const customers:Entry[]=[
  ...(superAdmin?[{label:"Kunden & Credits",description:"Konten, Videos und Guthaben",href:"/admin/customer-insights",icon:UsersRound}]:[]),
  ...(superAdmin?[{label:"Kundensupport",description:"Bestellungen, Anfragen und Erstattungen",href:"/admin/support",icon:LifeBuoy}]:[]),
  ...(!superAdmin&&support?[{label:"Supportfälle",description:"Anfragen und Bearbeitungsstatus",href:"/admin/collections/support-cases",icon:LifeBuoy}]:[]),
 ];
 const management:Entry[]=superAdmin?[
  {label:"Marketing & Aktionen",description:"Kampagnen und Aktionspreise",href:"/admin/marketing-actions",icon:Megaphone},
  {label:"Gutscheine",description:"Rabattcodes verwalten",href:"/admin/promotions",icon:Gift},
  {label:"Showcase-Videos",description:"Videos auf der Startseite auswählen",href:"/admin/showcase",icon:Film},
 ]:[];
 return <main className="sm-cms-clean" aria-label="SingMotion CMS Übersicht">
  <header className="sm-cms-clean-hero">
   <span className="sm-cms-clean-eyebrow">SINGMOTION AI · CMS</span>
   <h1>Übersicht</h1>
   <p>Alle aktuell benötigten CMS-Funktionen an einem Ort.</p>
  </header>
  {customers.length>0&&<section className="sm-cms-clean-section" aria-labelledby="sm-cms-customers">
   <h2 id="sm-cms-customers">Kunden & Support</h2><Links items={customers}/>
  </section>}
  {management.length>0&&<section className="sm-cms-clean-section" aria-labelledby="sm-cms-management">
   <h2 id="sm-cms-management">Verwaltung & Marketing</h2><Links items={management}/>
  </section>}
  {editor&&!management.length&&!customers.length&&<p className="sm-cms-clean-hint">Inhaltsmodule sind derzeit ausgeblendet.</p>}
  {superAdmin&&<details className="sm-cms-clean-advanced">
   <summary><Settings size={16} aria-hidden="true"/> Technische Werkzeuge (nur Admin)</summary>
   <p>Nur für Diagnosen und Prüfprotokolle.</p>
   <Link href="/admin/advanced">Systemdiagnose öffnen <ArrowUpRight size={15}/></Link>
  </details>}
 </main>;
}
