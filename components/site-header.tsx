import type {ReactNode} from "react";
import Link from "next/link";
import {UserRound} from "lucide-react";
import {GlobalMenu} from "./global-menu";
/** Shared navigation geometry for SingMotion pages. */
export function SiteHeader({navigation,actions,search,onBrandClick,onAccountClick,accountHref="/?card=login",className=""}:{navigation?:ReactNode;actions?:ReactNode;search?:ReactNode;onBrandClick?:()=>void;onAccountClick?:()=>void;accountHref?:string;className?:string}){
 return <><header className={["home-gallery-header","sm-carousel-header","sm-site-header",className].filter(Boolean).join(" ")}>
  <Link href="/" className="sm-wordmark" aria-label="SingMotion AI home" onClick={onBrandClick?e=>{e.preventDefault();onBrandClick();}:undefined}>SingMotion <span>AI</span></Link>
  <nav className="sm-header-actions" aria-label="Main navigation">
   {navigation}{search}{actions}<GlobalMenu/>
   <Link href={accountHref} className="home-gallery-account" title="Login or account" aria-label="Login or account" onClick={onAccountClick?e=>{e.preventDefault();onAccountClick();}:undefined}><UserRound size={21}/></Link>
  </nav>
 </header><div className="sm-site-header-space" aria-hidden="true" /></>;
}
