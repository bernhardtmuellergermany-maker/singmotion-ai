import type {AdminViewServerProps} from "payload";
import {Gutter} from "@payloadcms/ui";
import {hasRole} from "../../cms/policy";
import {CustomerInsightsClient} from "./customer-insights-client";

/**
 * Real Payload CMS root view. Never trust read-filtered client user fields for
 * authorisation: access is decided using the server principal. The API repeats
 * the same CMS Super Admin check for every request.
 */
export function CustomerInsightsView({initPageResult}:AdminViewServerProps){
 if(!hasRole(initPageResult.req.user,["super-admin"]))
  return <div role="alert">Customer Insights requires a CMS Super Admin session.</div>;
 // RootPage already owns the Admin header and sidebar. Rendering another
 // DefaultTemplate here produces duplicate mobile toolbars.
 return <Gutter>
   <CustomerInsightsClient/>
 </Gutter>;
}
