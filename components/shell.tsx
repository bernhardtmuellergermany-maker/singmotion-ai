import Link from "next/link";
import { ProductHeader } from "./product-header";
import { SiteHeader } from "./site-header";
import { UserRound } from "lucide-react";
import { OutputProjectSearch } from "./output-project-search";
import { ProjectHeaderName } from "./project-header-name";
export function Shell({ children, hideWorkspaceNav = false, projectId }: { children: React.ReactNode; hideWorkspaceNav?: boolean; projectId?: string }) {
  if (hideWorkspaceNav) return (
    <div className="sm-carousel-page sm-output-page">
      <SiteHeader navigation={projectId ? <ProjectHeaderName id={projectId}/> : undefined} search={<OutputProjectSearch/>}/>
      <main className="sm-carousel-main">{children}</main>
    </div>
  );
  return (
    <div className="product-theme unified-app">
      <ProductHeader />
      <nav className="product-workspace-links" aria-label="Workspace">
        <Link href="/studio">Studio</Link><Link href="/projects">My videos</Link>
        <Link href="/artists">My artists</Link><Link href="/billing">Billing</Link><Link href="/settings">Settings</Link>
      </nav>
      <main className="app-main">{children}</main>
      <footer className="wizard-footer"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/help">Help</Link></footer>
    </div>
  );
}
