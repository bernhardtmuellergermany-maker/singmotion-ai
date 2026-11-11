import Link from "next/link";
import {
  ArrowUpRight, FileText, Image as ImageIcon, Menu, Settings2,
  Activity, ShieldCheck, ClipboardList, LifeBuoy, MonitorPlay,
  ShieldAlert, Clock3, Layers3, Sparkles, ExternalLink,
} from "lucide-react";
import type {AdminViewServerProps} from "payload";
import {hasRole} from "../../cms/policy";
import {readCommerceDashboard} from "../../cms/dashboard-metrics";
import {CmsPageCleanupInventory} from "./page-cleanup-inventory";
import {PrivateLedger} from "./private-ledger";
import {StudioActivation} from "./studio-activation";
import {FirstTestPanel} from "./first-test-panel";
import {ShowcaseManager} from "./showcase-manager";

const STAGING="dfaeabed-03df-43ed-aa71-50f343a75041";
const areas=[
 {name:"Website pages",description:"Edit copy, review drafts and publish approved pages.",
  href:"/admin/collections/pages",icon:FileText,tag:"Content"},
 {name:"Media library",description:"Manage public website images, alt text and assets.",
  href:"/admin/collections/cms-assets",icon:ImageIcon,tag:"Assets"},
 {name:"Site navigation",description:"Update header links, footer and copyright.",
  href:"/admin/globals/site-navigation",icon:Menu,tag:"Global"},
 {name:"Studio content",description:"Review on-screen Studio guidance and suggested prompts.",
  href:"/admin/globals/studio-settings",icon:Settings2,tag:"Global"},
];
const adminAreas=[
 {name:"Support inbox",description:"Investigate support cases without issuing payments.",
  href:"/admin/collections/support-cases",icon:LifeBuoy},
 {name:"Audit history",description:"Read protected application audit metadata.",
  href:"/admin/collections/audit-events",icon:ClipboardList},
 {name:"Private operations",description:"Operator tools and recovery, subject to separate controls.",
  href:"/operator",icon:Activity},
 {name:"Promotions",description:"Manage voucher codes with their existing server-side permissions.",
  href:"/promo-admin",icon:Layers3},
];
type Metrics={activeWorkspaces:number;jobs:number;completed:number;pending:number;failed:number};
async function demoMetrics():Promise<Metrics|null>{
 try{
  const {db}=await import("../../lib/db");
  const row=db.prepare(`SELECT
    (SELECT COUNT(DISTINCT owner) FROM sessions WHERE expires>?) AS active,
    (SELECT COUNT(*) FROM jobs) AS jobs,
    (SELECT COUNT(*) FROM jobs WHERE status='completed') AS completed,
    (SELECT COUNT(*) FROM jobs WHERE status IN ('queued','processing')) AS pending,
    (SELECT COUNT(*) FROM jobs WHERE status='failed') AS failed`)
   .get(Date.now()) as {active:number;jobs:number;completed:number;pending:number;failed:number};
  if(!Object.values(row).every(n=>Number.isSafeInteger(n)&&n>=0))return null;
  return {activeWorkspaces:row.active,jobs:row.jobs,completed:row.completed,
   pending:row.pending,failed:row.failed};
 }catch{
  // A missing or inaccessible local demo database must never break the CMS.
  return null;
 }
}
export async function Operations({user}:Pick<AdminViewServerProps,"user">){
 const privileged=hasRole(user,["super-admin","support"]);
 const canEditContent=hasRole(user,["super-admin","editor"]);
 const superAdmin=hasRole(user,["super-admin"]);
 const metrics=privileged?await demoMetrics():null;
 const commerce=superAdmin?readCommerceDashboard(process.env.DATA_DIR||".data"):null;
 const environment=process.env.RAILWAY_ENVIRONMENT_ID===STAGING?"Private staging":
  process.env.RAILWAY_ENVIRONMENT_ID?"Restricted environment":"Local CMS";
 return <div className="sm-cms" aria-label="SingMotion CMS control center">
  <header className="sm-cms-hero">
   <div className="sm-cms-hero-main">
    <div className="sm-cms-topline"><span className="sm-cms-logo" aria-hidden="true"><Sparkles size={19}/></span>
     <span>SingMotion <strong>AI</strong></span><span className="sm-cms-divider" aria-hidden="true"/>
     <span className="sm-cms-overline">CONTENT & OPERATIONS</span></div>
    <span className="sm-cms-kicker"><span className="sm-cms-dot"/> {environment} · CMS workspace</span>
    <h1>Make the next release<br/><span>look as good as it sounds.</span></h1>
    <p className="sm-cms-hero-copy">Everything you need to shape the SingMotion experience:
      website content, Studio guidance, assets and protected operations — in one place.</p>
    <div className="sm-cms-hero-actions">
     {canEditContent?<Link href="/admin/collections/pages" className="sm-cms-primary-link">Manage website <ArrowUpRight size={17}/></Link>:<Link href="/admin/collections/support-cases" className="sm-cms-primary-link">Review support <ArrowUpRight size={17}/></Link>}
     {canEditContent&&<Link href="/cms-preview/home" className="sm-cms-secondary-link">Preview CMS home <ExternalLink size={16}/></Link>}
    </div>
   </div>
   <div className="sm-cms-hero-art" aria-hidden="true">
    <div className="sm-cms-art-ring sm-cms-art-ring-one"/>
    <div className="sm-cms-art-ring sm-cms-art-ring-two"/>
    <div className="sm-cms-wave"><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/></div>
    <div className="sm-cms-art-caption">YOUR MUSIC. YOUR VISION.</div>
   </div>
  </header>

  {canEditContent&&<section className="sm-cms-section" aria-labelledby="sm-cms-workspace-title">
   <div className="sm-cms-section-heading"><div><span className="sm-cms-eyebrow">01 / EDITORIAL WORKSPACE</span>
    <h2 id="sm-cms-workspace-title">Create & manage</h2>
    <p>Edit your pages and Studio content with the existing secure publishing workflow.</p></div>
    <Link className="sm-cms-text-link" href="/admin/collections/pages">All pages <ArrowUpRight size={16}/></Link>
   </div>
   <div className="sm-cms-actions-grid">
    {areas.map((area,index)=>{
     const Icon=area.icon;
     return <Link href={area.href} key={area.href} className="sm-cms-action">
      <div className="sm-cms-action-top"><span className="sm-cms-action-icon"><Icon size={22} strokeWidth={1.8}/></span>
       <span className="sm-cms-action-number">0{index+1}</span></div>
      <div><span className="sm-cms-action-tag">{area.tag}</span><h3>{area.name}</h3>
       <p>{area.description}</p></div>
      <span className="sm-cms-action-arrow" aria-hidden="true"><ArrowUpRight size={18}/></span>
     </Link>
    })}
   </div>
  </section>}

  {canEditContent&&<section className="sm-cms-section" aria-labelledby="sm-cms-publishing-title">
   <div className="sm-cms-section-heading"><div><span className="sm-cms-eyebrow">02 / PUBLISHING</span>
    <h2 id="sm-cms-publishing-title">Content workflow</h2></div></div>
   <div className="sm-cms-notice">
    <span className="sm-cms-notice-icon"><MonitorPlay size={21}/></span>
    <div><h3>Preview before you publish</h3><p>The CMS manages editable page drafts, assets and navigation.
     The public landing experience currently uses a separate modern homepage component;
     changes to a CMS home draft will <strong>not</strong> automatically replace that landing page.
     Review changes in CMS preview and publish intentionally.</p></div>
    <Link href="/cms-preview/home" className="sm-cms-notice-link">Open preview <ArrowUpRight size={16}/></Link>
   </div>
  </section>}

  {superAdmin&&<section className="sm-cms-section" aria-labelledby="sm-cms-showcase-title"><div className="sm-cms-section-heading"><div><span className="sm-cms-eyebrow">SHOWCASE CURATION</span><h2 id="sm-cms-showcase-title">Publish inspiration videos</h2><p>Separate playlists for mobile, desktop 16:9 and desktop 9:16. Only completed Super Admin videos can be published.</p></div></div><ShowcaseManager/></section>}
  {superAdmin&&<section className="sm-cms-section" aria-labelledby="sm-cms-commerce-title">
   <div className="sm-cms-section-heading"><div><span className="sm-cms-eyebrow">03 / COMMERCE SNAPSHOT</span>
    <h2 id="sm-cms-commerce-title">Customer operations</h2>
    <p>Read-only counts from the persisted customer ledger. Not revenue, billing proof or launch approval.</p></div>
    <span className="sm-cms-snapshot"><Clock3 size={15}/> On-page snapshot</span>
   </div>
   {commerce?<div className="sm-cms-stats">
    {[
     {label:"Registered accounts",value:commerce.accounts,detail:"Persisted customer identities"},
     {label:"Customer orders",value:commerce.orders,detail:"All order states"},
     {label:"Verified free deliveries",value:commerce.freeDeliveries,detail:"Zero-EUR local delivery records"},
     {label:"Free-provider reviews",value:commerce.freeReviews+commerce.uncertainFreeAttempts,
      detail:"Uncertain or operator-held claims"},
    ].map(item=><div className="sm-cms-stat" key={item.label}>
     <span className="sm-cms-stat-label">{item.label}</span><strong>{item.value.toLocaleString("en-US")}</strong>
     <span className="sm-cms-stat-detail">{item.detail}</span></div>)}
   </div>:<div className="sm-cms-unavailable" role="status">Customer commerce snapshot is unavailable in this environment. No placeholder figures are shown.</div>}
  </section>}
  {privileged&&<section className="sm-cms-section" aria-labelledby="sm-cms-operations-title">
   <div className="sm-cms-section-heading"><div><span className="sm-cms-eyebrow">04 / DEMO DATA</span>
    <h2 id="sm-cms-operations-title">Workspace activity</h2>
    <p>Current aggregate counts from the persisted demo ledger, not sample customers or revenue.</p></div>
    <span className="sm-cms-snapshot"><Clock3 size={15}/> On-page snapshot</span>
   </div>
   {metrics?<div className="sm-cms-stats">
    {[
     {label:"Active demo workspaces",value:metrics.activeWorkspaces,detail:"Anonymous sessions"},
     {label:"Persisted demo jobs",value:metrics.jobs,detail:"Total in demo ledger"},
     {label:"Completed demo jobs",value:metrics.completed,detail:"Demo only · no paid output"},
     {label:"Pending demo jobs",value:metrics.pending,detail:"Queued or processing"},
    ].map(item=><div key={item.label} className="sm-cms-stat">
     <span className="sm-cms-stat-label">{item.label}</span><strong>{item.value.toLocaleString("en-US")}</strong>
     <span className="sm-cms-stat-detail">{item.detail}</span></div>)}
   </div>:<div className="sm-cms-unavailable" role="status">Demo activity is unavailable. No placeholder metrics are shown.</div>}
   {metrics&&metrics.failed>0&&<p className="sm-cms-stat-footnote">{metrics.failed} demo jobs have a failed status. Review jobs with the protected operator tools.</p>}
   <div className="sm-cms-utility-grid">
    {adminAreas.filter(area=>superAdmin||area.name==="Support inbox").map(area=>{
     const Icon=area.icon;return <Link key={area.href} href={area.href} className="sm-cms-utility">
      <Icon size={19}/><span>{area.name}</span><ArrowUpRight size={16}/></Link>;
    })}
   </div>
   {superAdmin&&<div className="sm-cms-ledger"><PrivateLedger user={user}/></div>}
   {superAdmin&&<details className="sm-cms-legacy"><summary>Legacy pilot diagnostics <span>Advanced · historical tasks</span></summary>
    <div className="sm-cms-legacy-inner"><p>Older operator tests are preserved for diagnostics.
      They do not automatically enable generation or renew provider budgets.</p><StudioActivation/><FirstTestPanel/></div>
   </details>}
  </section>}
  {superAdmin&&<CmsPageCleanupInventory/>}
  <aside className="sm-cms-release" aria-label="Launch readiness notice">
   <div className="sm-cms-release-head"><ShieldAlert size={22}/><div><span className="sm-cms-eyebrow">RELEASE CONTROL</span>
    <h2>Private by design. Not publicly launched.</h2></div></div>
   <p>CMS publishing does not authorize customer payments, live AI generation, provider costs, email sending
     or access to private customer media. These require separate verified release approvals.</p>
   <div className="sm-cms-release-footer"><span><ShieldCheck size={16}/> Role-based access</span>
    <span><Layers3 size={16}/> Public assets separated</span>
    <span><Activity size={16}/> No implicit paid actions</span></div>
  </aside>
 </div>;
}
