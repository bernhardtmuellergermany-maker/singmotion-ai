import type {AdminViewServerProps} from "payload";
import {DefaultTemplate} from "@payloadcms/next/templates";
import {Gutter} from "@payloadcms/ui";
import {hasRole} from "../../cms/policy";
import Link from "next/link";
import {ShowcaseManager} from "./showcase-manager";
export function ShowcaseCmsView({initPageResult,params,searchParams,user}:AdminViewServerProps){
 if(!hasRole(initPageResult.req.user,["super-admin"]))
  return <p role="alert">CMS-Zugriff erforderlich.</p>;
 return <DefaultTemplate
  i18n={initPageResult.req.i18n}
  locale={initPageResult.locale}
  params={params}
  payload={initPageResult.req.payload}
  permissions={initPageResult.permissions}
  searchParams={searchParams}
  user={user}
  visibleEntities={initPageResult.visibleEntities}
 ><Gutter><main className="sm-cms-tool-view">
 <Link href="/admin" className="sm-cms-tool-back">← Zur Übersicht</Link>
 <span className="sm-cms-clean-eyebrow">WEBSITE · VIDEOS</span>
 <h1>Showcase-Videos</h1>
 <p>Hier wählst du die Videos aus, die im Inspiration-Bereich erscheinen. Änderungen werden nur über die bestehenden Freigaben gespeichert.</p>
 <ShowcaseManager/>
 </main></Gutter></DefaultTemplate>;
}
