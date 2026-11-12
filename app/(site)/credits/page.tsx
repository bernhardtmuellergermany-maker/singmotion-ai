import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { CreditsDashboard } from "@/components/credits-dashboard";
import "./credits.css";

export const metadata: Metadata = {
  title: "Credits — SingMotion AI",
  description: "View your real account balance, buy Stripe test credits on staging and review usage.",
};

export default function CreditsPage() {
  return <div className="sm-carousel-page sm-plans-page sm-credits-page">
    <SiteHeader/>
    <main id="content" className="sm-credits-main">
      <header className="sm-credits-intro"><span className="sm-plans-kicker">SINGMOTION AI · ACCOUNT</span>
        <h1>Your credits<span>.</span></h1>
        <p>See your available credits, top up your wallet, and review your past orders. Live credit payments and credit-based video generation are not yet enabled.</p>
      </header>
      <CreditsDashboard mode="buy"/>
    </main>
  </div>;
}
