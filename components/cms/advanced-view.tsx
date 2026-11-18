import type {AdminViewServerProps} from "payload";
import {DefaultTemplate} from "@payloadcms/next/templates";
import {Gutter} from "@payloadcms/ui";
import {hasRole} from "../../cms/policy";
import Link from "next/link";
import {PrivateLedger} from "./private-ledger";
import {StudioActivation} from "./studio-activation";
import {FirstTestPanel} from "./first-test-panel";
import {CmsPageCleanupInventory} from "./page-cleanup-inventory";
export async function AdvancedCmsView({initPageResult,params,searchParams,user}:AdminViewServerProps){
 if(!hasRole(initPageResult.req.user,["super-admin"]))
  return <p role="alert">CMS-Zugriff erforderlich.</p>;
 const logs=await initPageResult.req.payload.find({
  collection:"audit-events",limit:15,depth:0,sort:"-createdAt",
  overrideAccess:false,req:initPageResult.req,
 }).catch(()=>null);
 return <DefaultTemplate
  i18n={initPageResult.req.i18n}
  locale={initPageResult.locale}
  params={params}
  payload={initPageResult.req.payload}
  permissions={initPageResult.permissions}
  searchParams={searchParams}
  user={user}
  visibleEntities={initPageResult.visibleEntities}
 ><Gutter><main className="sm-cms-tool-view sm-cms-advanced-view">
 <Link href="/admin" className="sm-cms-tool-back">← Zur Übersicht</Link>
 <span className="sm-cms-clean-eyebrow">NUR SUPER-ADMIN</span>
 <h1>Technische Werkzeuge</h1>
 <p>Prüf- und Diagnosefunktionen, die nicht zur alltäglichen CMS-Bedienung gehören. Bestehende Freigaben und Schutzmaßnahmen bleiben erhalten.</p>
 <section><h2>Protokolle</h2>
  <p>Änderungen und Anmeldungen im CMS werden weiter erfasst.</p>
  {!logs?<p>Protokoll derzeit nicht verfügbar.</p>:
   logs.docs.length===0?<p>Keine Einträge vorhanden.</p>:
   <ul className="sm-cms-audit-list">{logs.docs.map(item=>
    <li key={item.id}><span>{String(item.action)} · {String(item.resource)}</span>
     <time>{new Date(String(item.createdAt)).toLocaleString("de-DE",{timeZone:"Europe/Berlin"})}</time>
    </li>)}</ul>}
 </section>
 <details className="sm-cms-tool-details"><summary>Generierungsprotokoll (nur lesen)</summary><PrivateLedger user={initPageResult.req.user}/></details>
 <details className="sm-cms-tool-details"><summary>Historische Pilotdiagnose</summary><div className="sm-cms-tool-interior">
  <StudioActivation/><FirstTestPanel/>
 </div></details>
 <details className="sm-cms-tool-details"><summary>CMS-Veröffentlichungshistorie (Staging)</summary><div className="sm-cms-tool-interior"><CmsPageCleanupInventory/></div></details>
 <p className="sm-cms-tool-footnote">Keine automatischen Zahlungen, Rückerstattungen oder Produktionsfreigaben.</p>
 </main></Gutter></DefaultTemplate>;
}
