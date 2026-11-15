import type {Metadata} from "next";
import Link from "next/link";
import {headers} from "next/headers";
import {getPayload} from "payload";
import config from "@payload-config";
import {hasRole} from "@/cms/policy";
import {auditSingMotionLaunch,type ReleaseEnvironment} from "@/lib/launch-audit";
import {customerLaunchReadiness} from "@/lib/commerce/readiness";
import {assessProtectedProductionLivePilot} from "@/lib/commerce/protected-production-live-pilot";
import {ProductHeader} from "@/components/product-header";
import {AdminConsoleBackLink} from "@/components/admin-console-back-link";

export const dynamic="force-dynamic";
export const metadata:Metadata={
 title:"SingMotion · Customer launch readiness (Super Admin)",
 robots:{index:false,follow:false,noarchive:true},
};

/** Every check is a current, local server read. No external payment or
 * BytePlus call is made; booleans never substitute for independent evidence. */
export default async function ReleaseReadinessPage(){
 if(process.env.CMS_ENABLED!=="true")
  return <main><p>Super Admin launch review is unavailable.</p></main>;

 const payload=await getPayload({config});
 const {user}=await payload.auth({headers:await headers()});
 if(!hasRole(user,["super-admin"]))
  return <main><p>Super Admin login required.</p></main>;

 const target:ReleaseEnvironment=process.env.RAILWAY_ENVIRONMENT_ID===
  "36adc41d-7e54-4396-ad1a-fd432ba0441d"?"production":"staging";
 const audit=auditSingMotionLaunch(process.env,target);
 const customer=customerLaunchReadiness(process.env);
 const pilot=target==="production"?assessProtectedProductionLivePilot(process.env):null;
 const production=target==="production";
 return <div className="product-theme">
  <ProductHeader/>
  <main id="content" style={{maxWidth:1080,margin:"0 auto",padding:"32px 20px 80px"}}>
   <AdminConsoleBackLink/>
   <p style={{fontSize:12,fontWeight:700,letterSpacing:2,textTransform:"uppercase"}}>Super Admin · private operational review</p>
   <h1>Customer launch readiness</h1>
   <p>Environment: <strong>{target}</strong>. Current server configuration only; this page never initiates a payment, changes approval flags or submits an AI video task.</p>
   <section aria-label="Release decision" style={{padding:"20px 0",borderBottom:"1px solid currentColor"}}>
    <h2>{audit.ready&&customer.readyForPaidOrders?"Runtime prerequisites passed":"Customer launch is blocked"}</h2>
    <p>{customer.readyForPaidOrders?"The local paid order and delivery checks currently pass. Independent live payment, tax, provider and operational evidence remains mandatory.":"New real-money payments and automatic paid video dispatch must remain disabled until every independent release gate is verified."}</p>
   </section>
   <section aria-label="Customer payment and video pipeline" style={{marginTop:24}}>
    <h2>Customer payments and video delivery</h2>
    <ul>
     <li>Customer accounts: {customer.accountsEnabled?"configured":"not configured"}</li>
     <li>Signed payment mode and approval: {customer.paymentsConnected?"configured":"blocked"}</li>
     <li>Customer generation: {customer.customerGenerationEnabled?"configured":"blocked"}</li>
     <li>Provider fulfillment: {customer.fulfillmentConnected?"configured":"blocked"}</li>
     <li>Private video delivery: {customer.deliveryConnected?"configured":"blocked"}</li>
    </ul>
    {customer.blockers.length>0&&<ul aria-label="Customer blockers">
     {customer.blockers.map(message=><li key={message}>{message}</li>)}
    </ul>}
   </section>
   <section aria-label="Independent release gates" style={{marginTop:24}}>
    <h2>Independent release gates</h2>
    <ul>{audit.gates.map(gate=><li key={gate.id} style={{marginBottom:12}}>
     <strong>{gate.ready?"PASS":"BLOCK"} · {gate.id.replaceAll("-"," ")}</strong>
     <div>{gate.reason}</div>
    </li>)}</ul>
   </section>
   {production&&pilot&&<section aria-label="Private production pilot" style={{marginTop:24}}>
    <h2>Private production live pilot</h2>
    <p>{pilot.ready?"All local pilot checks passed; this is not public-launch approval.":"Private real-money pilot is not admitted."}</p>
    {pilot.blockers.length>0&&<ul>{pilot.blockers.map(blocker=>
     <li key={blocker}>{blocker.replaceAll("_"," ").toLowerCase()}</li>)}</ul>}
   </section>}
   <p style={{marginTop:24}}>This dashboard cannot independently verify external invoices, real provider billing, legal approval, backups or webhook delivery. A green flag is not proof of a completed external acceptance test.</p>
   <p><Link href="/support-admin">Customer support console</Link> · <Link href="/admin">CMS administration</Link></p>
  </main>
 </div>;
}
