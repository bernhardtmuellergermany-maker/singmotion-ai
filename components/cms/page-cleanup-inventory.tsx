import Link from "next/link";
import {getPayload} from "payload";
import config from "@payload-config";
import {planCmsPageCleanup,type CmsPageInventory} from "../../cms/page-cleanup-policy";

/** Server-rendered inventory visible exclusively to verified super-admins.
 * No mutable CMS actions, external requests or exposure to other roles.
 */
export async function CmsPageCleanupInventory(){
 try{
  if(process.env.CMS_ENABLED!=="true"||
   process.env.RAILWAY_ENVIRONMENT_ID!=="dfaeabed-03df-43ed-aa71-50f343a75041")
   return null;
  const payload=await getPayload({config});
  const result=await payload.find({collection:"pages",limit:100,depth:0,
   draft:true,overrideAccess:true,sort:"slug"});
  if(result.hasNextPage)
   throw Error("CMS inventory too large for a complete status report");
  const items:CmsPageInventory[]=[];
  for(const doc of result.docs){
   const versions=await payload.findVersions({collection:"pages",where:{parent:{equals:doc.id}},
    limit:100,depth:0,overrideAccess:true});
   const hasPublishedVersion=versions.docs.some(record=>record.version?._status==="published");
   items.push({id:doc.id,slug:doc.slug,title:doc.title,status:doc._status,
    hasPublishedVersion,versionsComplete:!versions.hasNextPage});
  }
  const rows=planCmsPageCleanup(items);
  const online=rows.filter(x=>x.status==="published").length;
  const protectedHistory=rows.filter(x=>x.status!=="published"&&x.hasPublishedVersion).length;
  const drafts=rows.filter(x=>x.action==="remove-unpublished").length;
  const unresolved=rows.filter(x=>x.action==="manual-review").length;
  return <section className="sm-cms-page-inventory" aria-labelledby="sm-cms-pages-heading">
   <div className="sm-cms-section-heading">
    <div><span className="sm-cms-eyebrow">05 / INHALTE BEREINIGEN</span>
     <h2 id="sm-cms-pages-heading">Welche Seiten sind tatsächlich veröffentlicht?</h2>
     <p>Aktueller Stand der privaten Staging-CMS-Datenbank. Öffentliche Seiten außerhalb des CMS werden hier nicht gezählt.</p>
    </div>
    <Link href="/admin/collections/pages" className="sm-cms-text-link">Seitenverwaltung öffnen ↗</Link>
   </div>
   <div className="sm-cms-inventory-counters" aria-label="CMS-Veröffentlichungsstatus">
    <span><strong>{online}</strong> Veröffentlicht</span>
    <span><strong>{protectedHistory}</strong> Früher veröffentlicht</span>
    <span><strong>{drafts}</strong> Nur Entwurf</span>
    <span><strong>{unresolved}</strong> Unklar</span>
   </div>
   <div className="sm-cms-inventory-table-wrap">
    <table className="sm-cms-inventory-table">
     <thead><tr><th>CMS-Seite</th><th>URL</th><th>Status</th><th>Bearbeiten</th></tr></thead>
     <tbody>{rows.map(page=><tr key={String(page.id)}>
      <td>{page.title}</td>
      <td><code>/{page.slug==="home"?"":page.slug}</code></td>
      <td><span className={`sm-cms-inventory-state sm-cms-inventory-state-${page.action}`}>
       {page.status==="published"?"Veröffentlicht":page.hasPublishedVersion?"Historisch veröffentlicht":
        page.action==="remove-unpublished"?"Nie veröffentlicht":"Prüfung nötig"}
      </span></td>
      <td><Link href={`/admin/collections/pages/${encodeURIComponent(String(page.id))}`}>Öffnen</Link></td>
     </tr>)}</tbody>
    </table>
   </div>
   <p className="sm-cms-inventory-hint">Ein bestehender öffentlicher Link beweist nicht, dass sein Inhalt aus dem CMS stammt.
    Nie veröffentlichte Entwürfe können nach einer gesicherten Prüfung entfernt werden; früher veröffentlichte Versionen bleiben geschützt.
    Diese Übersicht führt selbst keine Löschung aus.</p>
  </section>;
 }catch{
  return <section className="sm-cms-page-inventory" role="status">
   <h2>CMS-Veröffentlichungsstatus nicht verfügbar</h2>
   <p>Die vollständige Veröffentlichungshistorie konnte nicht überprüft werden. Es wird nichts gelöscht.</p>
  </section>;
 }
}
