import type {AdminViewServerProps} from "payload";
import {Gutter} from "@payloadcms/ui";
import {hasRole} from "../../cms/policy";
import {SupportAdmin} from "../support-admin";
/** Reuse the audited support API without leaving Payload or switching logins. */
export function SupportCmsView({initPageResult}:AdminViewServerProps){
 if(!hasRole(initPageResult.req.user,["super-admin"]))
  return <p role="alert">Super-Admin-Zugang erforderlich.</p>;
 return <Gutter><main className="sm-cms-tool-view sm-cms-uniform-page">
  <SupportAdmin/>
 </main></Gutter>;
}
