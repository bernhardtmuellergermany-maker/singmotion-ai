import type {AdminViewServerProps} from "payload";
import {Gutter} from "@payloadcms/ui";
import {hasRole} from "../../cms/policy";
import {Operations} from "./operations";
export function CleanDashboardView({initPageResult}:AdminViewServerProps){
 if(!hasRole(initPageResult.req.user,["super-admin","editor","support"]))
  return <p role="alert">CMS-Zugriff erforderlich.</p>;
 // RootPage already owns the Admin header and sidebar. Rendering another
 // DefaultTemplate here produces duplicate mobile toolbars.
 return <Gutter><Operations user={initPageResult.req.user}/></Gutter>;
}
