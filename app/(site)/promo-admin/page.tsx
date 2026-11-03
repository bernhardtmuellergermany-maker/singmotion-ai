import { headers } from "next/headers";
import { getPayload } from "payload";
import config from "@payload-config";
import { hasRole } from "@/cms/policy";
import { PromotionAdmin } from "@/components/promotion-admin";
import { ProductHeader } from "@/components/product-header";
export const dynamic="force-dynamic";
export const metadata={title:"SingMotion · Promotions (Super Admin)",robots:{index:false,follow:false}};
export default async function Page(){
  if(process.env.CMS_ENABLED!=="true")return <main><p>Super Admin promotion management is not available.</p></main>;
  const payload=await getPayload({config});
  const {user}=await payload.auth({headers:await headers()});
  if(!hasRole(user,["super-admin"]))return <main><p>Super Admin login required.</p></main>;
  return <div className="product-theme"><ProductHeader/><main id="content">
    <PromotionAdmin/>
  </main></div>;
}
