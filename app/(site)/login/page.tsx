import type {Metadata} from "next";
import Link from "next/link";
import {AccountPanel} from "@/components/account-panel";
import "./standalone-login.css";

export const metadata:Metadata={
 title:"Sign in",
 description:"Sign in or create a SingMotion AI account to access your videos and projects."
};

export default function LoginPage(){
 return <div className="sm-standalone-auth">
  <header className="sm-standalone-auth-header">
   <Link href="/" className="sm-wordmark" aria-label="SingMotion AI home">SingMotion <span>AI</span></Link>
  </header>
  <main id="content" className="sm-standalone-auth-main">
   <div className="sm-standalone-auth-form">
    <AccountPanel active={true}/>
   </div>
  </main>
 </div>;
}
