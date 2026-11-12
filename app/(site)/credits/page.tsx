import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { CreditsDashboard } from "@/components/credits-dashboard";
import "./credits.css";

export const metadata: Metadata = {
  title: "Credits — SingMotion AI",
  description: "Track your credit wallet, one-time payments, transaction history and top-up preferences.",
};

export default function CreditsPage() {
  return <div className="sm-carousel-page sm-plans-page sm-credits-page">
    <SiteHeader/>
    <main id="content" className="sm-credits-main">
      <header className="sm-credits-intro"><span className="sm-plans-kicker">SINGMOTION AI · ACCOUNT</span>
        <h1>Your credits<span>.</span></h1>
        <p>Track your balance, purchase credits when available, set safe top-up preferences and review every transaction. No new monthly subscription.</p>
      </header>
      <CreditsDashboard mode="buy"/>
    </main>
  </div>;
}
