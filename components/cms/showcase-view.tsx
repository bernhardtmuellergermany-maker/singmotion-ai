import type {AdminViewServerProps} from "payload";
import {Gutter} from "@payloadcms/ui";
import {hasRole} from "../../cms/policy";
import Link from "next/link";
import {ShowcaseManager} from "./showcase-manager";
export function ShowcaseCmsView({initPageResult}:AdminViewServerProps){
 if(!hasRole(initPageResult.req.user,["super-admin"]))
  return <p role="alert">CMS-Zugriff erforderlich.</p>;
 // RootPage already owns the Admin header and sidebar. Rendering another
 // DefaultTemplate here produces duplicate mobile toolbars.
 return <Gutter><main className="sm-cms-tool-view">
 <Link href="/admin" className="sm-cms-tool-back">← Zur Übersicht</Link>
 <span className="sm-cms-clean-eyebrow">WEBSITE · VIDEOS</span>
 <h1>Showcase-Videos</h1>
 <p>Hier wählst du die Videos aus, die im Inspiration-Bereich erscheinen. Änderungen werden nur über die bestehenden Freigaben gespeichert.</p>
 <ShowcaseManager/>
 </main></Gutter>;
}
