import type {AdminViewServerProps} from "payload";
import {DefaultTemplate} from "@payloadcms/next/templates";
import {Gutter} from "@payloadcms/ui";
import {hasRole} from "../../cms/policy";
import {CustomerInsightsClient} from "./customer-insights-client";

/**
 * Real Payload CMS root view. Never trust read-filtered client user fields for
 * authorisation: access is decided using the server principal. The API repeats
 * the same CMS Super Admin check for every request.
 */
export function CustomerInsightsView({initPageResult,params,searchParams,user}:AdminViewServerProps){
 if(!hasRole(initPageResult.req.user,["super-admin"]))
  return <div role="alert">Customer Insights requires a CMS Super Admin session.</div>;
 return <DefaultTemplate
  i18n={initPageResult.req.i18n}
  locale={initPageResult.locale}
  params={params}
  payload={initPageResult.req.payload}
  permissions={initPageResult.permissions}
  searchParams={searchParams}
  user={user}
  visibleEntities={initPageResult.visibleEntities}
 ><Gutter>
   <CustomerInsightsClient/>
 </Gutter></DefaultTemplate>;
}
