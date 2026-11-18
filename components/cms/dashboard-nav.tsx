import Link from "next/link";
import { LayoutDashboard, AudioLines, UsersRound } from "lucide-react";
import type {AdminViewServerProps} from "payload";
import {hasRole} from "../../cms/policy";

/** This appears inside the *actual* Payload sidebar on every CMS page,
 * not only on the custom dashboard. Native collection links retain RBAC.
 */
export function DashboardNav({user}:Pick<AdminViewServerProps,"user">) {
 return <div className="sm-cms-sidebar-intro" aria-label="SingMotion CMS Navigation">
   <div className="sm-cms-sidebar-brand"><AudioLines size={19} strokeWidth={2}/>
    <span>SingMotion <strong>AI</strong></span><span className="sm-cms-sidebar-tag">CMS</span></div>
   <Link href="/admin" className="sm-cms-sidebar-dashboard">
     <LayoutDashboard size={18} strokeWidth={1.9}/>
     <span>Dashboard</span>
     <span className="sm-cms-sidebar-arrow" aria-hidden="true">↗</span>
   </Link>
   {hasRole(user,["super-admin"])&&<Link href="/admin/customer-insights" className="sm-cms-sidebar-dashboard">
     <UsersRound size={18} strokeWidth={1.9}/>
     <span>Customer Insights</span>
     <span className="sm-cms-sidebar-arrow" aria-hidden="true">↗</span>
   </Link>}
  </div>;
}
