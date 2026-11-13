import {headers} from "next/headers";
import {getPayload} from "payload";
import config from "@payload-config";
import {hasRole} from "@/cms/policy";
import {ProductHeader} from "@/components/product-header";
import {SupportAdmin} from "@/components/support-admin";
import {AdminConsoleBackLink} from "@/components/admin-console-back-link";
export const dynamic="force-dynamic";
export const metadata={title:"SingMotion · Customer Recovery (Super Admin)",robots:{index:false,follow:false,noarchive:true}};
export default async function Page(){
 if(process.env.CMS_ENABLED!=="true")return <main><p>Super Admin support unavailable.</p></main>;
 const payload=await getPayload({config});
 const {user}=await payload.auth({headers:await headers()});
 if(!hasRole(user,["super-admin"]))return <main><p>Super Admin login required.</p></main>;
 return <div className="product-theme"><ProductHeader/><main id="content"><AdminConsoleBackLink/><SupportAdmin/></main></div>;
}
