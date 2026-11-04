import Link from "next/link";
import { LayoutDashboard, AudioLines } from "lucide-react";

/** This appears inside the *actual* Payload sidebar on every CMS page,
 * not only on the custom dashboard. Native collection links retain RBAC.
 */
export function DashboardNav() {
 return <div className="sm-cms-sidebar-intro" aria-label="SingMotion CMS Navigation">
   <div className="sm-cms-sidebar-brand"><AudioLines size={19} strokeWidth={2}/>
    <span>SingMotion <strong>AI</strong></span><span className="sm-cms-sidebar-tag">CMS</span></div>
   <Link href="/admin" className="sm-cms-sidebar-dashboard">
     <LayoutDashboard size={18} strokeWidth={1.9}/>
     <span>Dashboard</span>
     <span className="sm-cms-sidebar-arrow" aria-hidden="true">↗</span>
   </Link>
  </div>;
}
