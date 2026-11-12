import type {ReactNode} from "react";
import Link from "next/link";
import {HeaderAccountMenu} from "./header-account-menu";
import {GlobalMenu} from "./global-menu";
/** Shared navigation geometry for SingMotion pages. */
export function SiteHeader({leftContent,navigation,actions,search,onBrandClick,onAccountClick,accountHref="/?card=login",className=""}:{leftContent?:ReactNode;navigation?:ReactNode;actions?:ReactNode;search?:ReactNode;onBrandClick?:()=>void;onAccountClick?:()=>void;accountHref?:string;className?:string}){
 return <><header className={["home-gallery-header","sm-carousel-header","sm-site-header",className].filter(Boolean).join(" ")}>
  <div className="sm-site-header-left"><Link href="/" className="sm-wordmark" aria-label="SingMotion AI home" title="Go to homepage" onClick={onBrandClick?e=>{e.preventDefault();onBrandClick();}:undefined}>SingMotion <span>AI</span></Link>{leftContent}</div>
  <nav className="sm-header-actions" aria-label="Main navigation">
   {navigation}{search}{actions}<GlobalMenu/>
   <HeaderAccountMenu onLoginClick={onAccountClick}/>
  </nav>
 </header><div className="sm-site-header-space" aria-hidden="true" /></>;
}
