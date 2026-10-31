import Link from "next/link";
import { ProductHeader } from "./product-header";
import { GlobalMenu } from "./home-collection";
import { UserRound } from "lucide-react";
import { ProjectHeaderName } from "./project-header-name";
export function Shell({ children, hideWorkspaceNav = false, projectId }: { children: React.ReactNode; hideWorkspaceNav?: boolean; projectId?: string }) {
  return (
    <div className="product-theme unified-app">
      {hideWorkspaceNav ? <header className="flow-header sm-output-header">
        <div className="flow-header-left"><Link href="/" className="sm-wordmark" aria-label="SingMotion AI home">SingMotion <span>AI</span></Link><span className="flow-divider"/>{projectId && <ProjectHeaderName id={projectId}/>}</div>
        <div className="flow-header-right"><GlobalMenu openInNewTab /><Link href="/?card=login" className="flow-profile" aria-label="Login or account" title="Login or account"><UserRound size={21}/></Link></div>
      </header> : <ProductHeader />}
      {!hideWorkspaceNav && <nav className="product-workspace-links" aria-label="Workspace">
        <Link href="/studio">Studio</Link>
        <Link href="/projects">My videos</Link>
        <Link href="/artists">My artists</Link>
        <Link href="/billing">Billing</Link>
        <Link href="/settings">Settings</Link>
      </nav>}
      <main className="app-main">{children}</main>
      {!hideWorkspaceNav && <footer className="wizard-footer">
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/help">Help</Link>
      </footer>}
    </div>
  );
}
