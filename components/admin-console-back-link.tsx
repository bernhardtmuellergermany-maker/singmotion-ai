import Link from "next/link";
import {ArrowLeft} from "lucide-react";
import styles from "./admin-console-back-link.module.css";

/** Stable route back to the Super Admin Account Settings anchor.
 * Unlike browser history it also works after a direct/bookmarked console visit. */
export function AdminConsoleBackLink(){
 return <nav className={styles.toolbar} aria-label="Return to account settings">
  <Link className={styles.back} href="/account/settings#admin-console">
    <ArrowLeft size={17} aria-hidden="true"/>
    <span>Back to Account Settings</span>
  </Link>
 </nav>;
}
