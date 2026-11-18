import Link from "next/link";
import { LayoutDashboard, AudioLines, UsersRound, LifeBuoy } from "lucide-react";
import type {AdminViewServerProps} from "payload";
import {hasRole} from "../../cms/policy";

/** Compact navigation shortcuts. Remaining native links retain CMS RBAC. */
export function DashboardNav({user}:Pick<AdminViewServerProps,"user">){
 const superAdmin=hasRole(user,["super-admin"]);
 const support=hasRole(user,["super-admin","support"]);
 return <div className="sm-cms-sidebar-intro" aria-label="SingMotion CMS Navigation">
  <div className="sm-cms-sidebar-brand"><AudioLines size={19} strokeWidth={2}/>
   <span>SingMotion <strong>AI</strong></span><span className="sm-cms-sidebar-tag">CMS</span>
  </div>
  <Link href="/admin" className="sm-cms-sidebar-dashboard">
   <LayoutDashboard size={18} strokeWidth={1.8}/><span>Übersicht</span>
  </Link>
  {superAdmin&&<Link href="/admin/customer-insights" className="sm-cms-sidebar-dashboard">
   <UsersRound size={18} strokeWidth={1.8}/><span>Kunden & Credits</span>
  </Link>}
  {support&&<Link href={superAdmin?"/support-admin":"/admin/collections/support-cases"} className="sm-cms-sidebar-dashboard">
   <LifeBuoy size={18} strokeWidth={1.8}/><span>Support</span>
  </Link>}
 </div>;
}
