import type {AdminViewServerProps} from "payload";
import {Gutter} from "@payloadcms/ui";
import {hasRole} from "../../cms/policy";
import {AudioQuickTipsManager} from "./audio-quick-tips-manager";
export function AudioQuickTipsCmsView({initPageResult}:AdminViewServerProps){
 if(!hasRole(initPageResult.req.user,["super-admin"]))return <p role="alert">Super-Admin-Zugang erforderlich.</p>;
 return <Gutter><main className="sm-cms-tool-view">
  <header className="sm-cms-page-hero"><span className="sm-cms-clean-eyebrow">SINGMOTION AI · STUDIO</span>
   <h1>Audio Quick Tips</h1><p>Eigene Audio-Vorlagen für Kunden ohne eigene Musik. Nur freigegebene Vorlagen werden unter dem Suno-Upload angezeigt.</p></header>
  <AudioQuickTipsManager/>
 </main></Gutter>;
}
