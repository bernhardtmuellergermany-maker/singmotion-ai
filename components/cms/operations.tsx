import Link from "next/link";
import {
 ArrowUpRight, FileText, Image as ImageIcon, Menu, SlidersHorizontal,
 UsersRound, LifeBuoy, Film, UserRoundCog, Gift, Settings,
} from "lucide-react";
import {hasRole} from "../../cms/policy";

type Entry={label:string;description:string;href:string;icon:typeof FileText};

function Links({items}:{items:Entry[]}){
 return <div className="sm-cms-quick-grid">
  {items.map(item=>{
   const Icon=item.icon;
   return <Link key={item.href} href={item.href} className="sm-cms-quick-link">
    <span className="sm-cms-quick-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.9}/></span>
    <span className="sm-cms-quick-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
    <ArrowUpRight size={18} className="sm-cms-quick-arrow" aria-hidden="true"/>
   </Link>;
  })}
 </div>;
}

/** No demo data, misleading placeholder metrics or duplicate Payload cards.
 * Links go directly to working, permission-checked destinations.
 */
export function Operations({user}:{user:unknown}){
 const superAdmin=hasRole(user,["super-admin"]);
 const editor=hasRole(user,["super-admin","editor"]);
 const support=hasRole(user,["super-admin","support"]);
 if(!superAdmin&&!editor&&!support)return <p>CMS-Zugang erforderlich.</p>;
 const customers:Entry[]=[
  ...(superAdmin?[{label:"Kunden & Credits",description:"Konten, Videos, Guthaben und Käufe",href:"/admin/customer-insights",icon:UsersRound}]:[]),
  ...(superAdmin?[{label:"Kundensupport",description:"Probleme prüfen, Credits und Erstattungen",href:"/support-admin",icon:LifeBuoy}]:[]),
  ...(!superAdmin&&support?[{label:"Supportfälle",description:"Anfragen und Bearbeitungsstatus",href:"/admin/collections/support-cases",icon:LifeBuoy}]:[]),
 ];
 const website:Entry[]=editor?[
  {label:"Seiten & Texte",description:"Inhalte bearbeiten und Entwürfe prüfen",href:"/admin/collections/pages",icon:FileText},
  {label:"Bilder & Medien",description:"Website-Bilder verwalten",href:"/admin/collections/cms-assets",icon:ImageIcon},
  {label:"Navigation & Footer",description:"Menülinks und Fußzeile bearbeiten",href:"/admin/globals/site-navigation",icon:Menu},
  {label:"Studio-Texte",description:"Hinweise und Vorlagen im Studio",href:"/admin/globals/studio-settings",icon:SlidersHorizontal},
  ...(superAdmin?[{label:"Showcase-Videos",description:"Videos für die Startseite auswählen",href:"/admin/showcase",icon:Film}]:[]),
 ]:[];
 const management:Entry[]=superAdmin?[
  {label:"Team & Rechte",description:"CMS-Zugriffe verwalten",href:"/admin/collections/staff",icon:UserRoundCog},
  {label:"Gutscheine",description:"Vorhandene Rabattaktionen verwalten",href:"/promo-admin",icon:Gift},
 ]:[];
 return <main className="sm-cms-clean" aria-label="SingMotion CMS Übersicht">
  <header className="sm-cms-clean-hero">
   <span className="sm-cms-clean-eyebrow">SINGMOTION AI · CMS</span>
   <h1>Übersicht</h1>
   <p>Die wichtigsten Aufgaben – ohne Demo-Zahlen und technische Testkacheln.</p>
  </header>
  {customers.length>0&&<section className="sm-cms-clean-section" aria-labelledby="sm-cms-customers">
   <h2 id="sm-cms-customers">Kunden & Support</h2>
   <Links items={customers}/>
  </section>}
  {website.length>0&&<section className="sm-cms-clean-section" aria-labelledby="sm-cms-website">
   <h2 id="sm-cms-website">Website & Studio</h2>
   <Links items={website}/>
   <p className="sm-cms-clean-hint">Hinweis: Der CMS-Entwurf der Startseite ersetzt die moderne Live-Startseite nicht automatisch. Änderungen vorher in der Vorschau prüfen.</p>
  </section>}
  {management.length>0&&<section className="sm-cms-clean-section" aria-labelledby="sm-cms-management">
   <h2 id="sm-cms-management">Verwaltung</h2>
   <Links items={management}/>
  </section>}
  {superAdmin&&<details className="sm-cms-clean-advanced">
   <summary><Settings size={16} aria-hidden="true"/> Technische Werkzeuge (nur Admin)</summary>
   <p>Nur für Diagnosen, ältere Testläufe und Prüfprotokolle.</p>
   <Link href="/admin/advanced">Systemdiagnose öffnen <ArrowUpRight size={15}/></Link>
  </details>}
 </main>;
}
