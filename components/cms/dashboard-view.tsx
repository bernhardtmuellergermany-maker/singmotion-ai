import type {AdminViewServerProps} from "payload";
import {DefaultTemplate} from "@payloadcms/next/templates";
import {Gutter} from "@payloadcms/ui";
import {hasRole} from "../../cms/policy";
import {Operations} from "./operations";
export function CleanDashboardView({initPageResult,params,searchParams,user}:AdminViewServerProps){
 if(!hasRole(initPageResult.req.user,["super-admin","editor","support"]))
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
 ><Gutter><Operations user={initPageResult.req.user}/></Gutter></DefaultTemplate>;
}
