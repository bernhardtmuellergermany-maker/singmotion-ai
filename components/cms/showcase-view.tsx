import type {AdminViewServerProps} from "payload";
import {Gutter} from "@payloadcms/ui";
import {hasRole} from "../../cms/policy";
import {ShowcaseManager} from "./showcase-manager";
export function ShowcaseCmsView({initPageResult}:AdminViewServerProps){
 if(!hasRole(initPageResult.req.user,["super-admin"]))
  return <p role="alert">CMS-Zugriff erforderlich.</p>;
 // RootPage already owns the Admin header and sidebar. Rendering another
 // DefaultTemplate here produces duplicate mobile toolbars.
 return <Gutter><main className="sm-cms-tool-view">
 <header className="sm-cms-page-hero">
  <span className="sm-cms-clean-eyebrow">SINGMOTION AI · SHOWCASE</span>
  <h1>Showcase-Videos</h1>
  <p>Wähle die Videos für den Inspiration-Bereich. Änderungen werden nur über die bestehenden Freigaben gespeichert.</p>
 </header>
 <ShowcaseManager/>
 </main></Gutter>;
}
