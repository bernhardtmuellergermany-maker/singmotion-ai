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
        <p>Dein Credit-Guthaben, Guthaben aufladen und die Übersicht deiner bereits bezahlten Aufträge. Live-Zahlungen und Credit-Abrechnung für Videos sind noch nicht aktiviert.</p>
      </header>
      <CreditsDashboard mode="buy"/>
    </main>
  </div>;
}
