import type {AdminViewServerProps} from "payload";
import {Gutter} from "@payloadcms/ui";
import {hasRole} from "../../cms/policy";
import {CampaignsClient} from "./campaigns-client";
import {ReferralSettingsPanel} from "./referral-settings";

/** Native Payload CMS view; API independently verifies the same role. */
export function CampaignsCmsView({initPageResult}:AdminViewServerProps){
 if(!hasRole(initPageResult.req.user,["super-admin"]))
  return <div role="alert">Marketing & Aktionen erfordert Super-Admin-Rechte.</div>;
 return <Gutter><ReferralSettingsPanel/><CampaignsClient/></Gutter>;
}
