import type {Metadata} from "next";
import {SiteHeader} from "@/components/site-header";
import {AccountPanel} from "@/components/account-panel";
import {StagingStaffSignIn} from "@/components/staging-staff-signin";
import Link from "next/link";
import "./standalone-login.css";

export const metadata:Metadata={
 title:"Sign in",
 description:"Sign in to generate AI music videos or create an account for your private SingMotion AI studio, drafts and Credits."
};

export default async function LoginPage({searchParams}:{searchParams:Promise<{staff?:string}>}){
 const params=await searchParams;
 const stagingStaff=process.env.RAILWAY_ENVIRONMENT_ID==="dfaeabed-03df-43ed-aa71-50f343a75041"&&process.env.CMS_ENABLED==="true";
 return <div className="sm-standalone-auth">
  <SiteHeader/>
  <main id="content" className="sm-standalone-auth-main">
   <div className="sm-standalone-auth-form">
    {stagingStaff&&params.staff==="1"?<StagingStaffSignIn/>:<>
   <AccountPanel active={true}/>
   {stagingStaff&&<p style={{textAlign:"center",marginTop:18,fontSize:14}}><Link style={{color:"#dfc8ff"}} href="/login?staff=1">Super Admin? Mit dem CMS-Konto anmelden</Link></p>}
  </>}
   </div>
  </main>
 </div>;
}
