import Link from "next/link";
import { UserRound } from "lucide-react";
export function ProductHeader() {
  return (
    <header className="product-header">
      <Link href="/" className="sm-wordmark" aria-label="SingMotion home">
        SingMotion <span>AI</span>
      </Link>
      <nav aria-label="Account navigation">
        <Link href="/my-videos">My videos</Link>
        <Link href="/login" className="product-login account-icon" aria-label="Account" title="Account">
          <UserRound size={20} /><span className="sr-only">Account</span>
        </Link>
      </nav>
    </header>
  );
}
