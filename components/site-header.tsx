import type { ReactNode } from "react";
import { Brand } from "./brand";
/** One geometry for the public site and every customer-app route. */
export function SiteHeader({
  navigation,
  actions,
}: {
  navigation?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <header
      className={`site-header ${navigation ? "with-app-navigation" : ""}`}
    >
      <div className="site-header-inner">
        <Brand />
        {navigation}
        <div className="site-header-actions">{actions}</div>
      </div>
    </header>
  );
}
