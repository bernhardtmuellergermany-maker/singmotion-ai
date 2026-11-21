import type {AdminViewServerProps} from "payload";
import {Gutter} from "@payloadcms/ui";
import {hasRole} from "../../cms/policy";
import {PromotionAdmin} from "../promotion-admin";
/** Coupon operations stay protected by the existing audited backend API. */
export function PromotionsCmsView({initPageResult}:AdminViewServerProps){
 if(!hasRole(initPageResult.req.user,["super-admin"]))
  return <p role="alert">Super-Admin-Zugang erforderlich.</p>;
 return <Gutter><main className="sm-cms-tool-view sm-cms-uniform-page">
  <PromotionAdmin/>
 </main></Gutter>;
}
