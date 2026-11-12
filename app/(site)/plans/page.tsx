import type { Metadata } from "next";
import Link from "next/link";
import { Check, Music2, Sparkles, ShieldCheck, Wallet } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { CreditAmountPicker } from "@/components/credit-amount-picker";
import "./plans.css";

export const metadata: Metadata = {
  title: "Credits & Pricing — SingMotion AI",
  description: "SingMotion AI prepaid credit pricing: choose preset amounts or enter your own number of credits. Purchases are not yet enabled."
};

export default function PlansPage() {
 return <div className="sm-carousel-page sm-plans-page">
  <SiteHeader/>
  <main id="content" className="sm-plans">
   <section className="sm-plans-intro">
    <span className="sm-plans-kicker"><Sparkles size={15}/> YOUR MUSIC. YOUR PERFORMANCE.</span>
    <h1>Credits & Pricing<span className="sm-plans-accent">.</span></h1>
    <p>One simple model: top up your account with the credits you choose, then use them to create AI performance videos. No new Hobby subscription or monthly fee.</p>
   </section>
   <div className="sm-plans-preview-notice" role="status"><strong>Credit payments are coming soon.</strong> These rates and amounts explain the proposed model. No purchase or video payment can be completed from this page.</div>
   <section className="sm-plans-grid" aria-label="Prepaid credit information">
    <article className="sm-plan-card sm-plan-featured">
     <div className="sm-plan-top"><span className="sm-plan-icon"><Music2 size={24}/></span><span className="sm-plan-status sm-plan-soon">Prepaid · planned</span></div>
     <h2>Pay with Credits</h2>
     <p className="sm-plan-caption">Choose the credit quantity that suits your videos. No new recurring subscription.</p>
     <div className="sm-plan-price">25 Credits <span>/ billable video second · proposed</span></div>
     <p className="sm-plan-price-note">1 Credit = €0.01 of internal video credit. 10 seconds = 250 Credits (€2.50), 30 seconds = 750 Credits (€7.50), including VAT.</p>
     <div className="sm-plan-rule"/>
     <ul>
      <li><Check size={18}/> Customer account and sufficient credits required before generation</li>
      <li><Check size={18}/> The credit cost is shown before processing</li>
      <li><Check size={18}/> Credits are reserved for BytePlus, then consumed after validated delivery</li>
      <li><Check size={18}/> Confirmed provider failures release the reservation; uncertain jobs stay reserved pending review</li>
     </ul>
     <Link className="sm-plan-action sm-plan-action-outline" href="/credits">Open credit wallet</Link>
    </article>
    <article className="sm-plan-card">
     <div className="sm-plan-top"><span className="sm-plan-icon"><Wallet size={24}/></span><span className="sm-plan-status">No subscription</span></div>
     <h2>Only what you need</h2>
     <p className="sm-plan-caption">Enter a custom credit quantity or choose a popular amount to estimate your one-time top-up.</p>
     <div className="sm-plan-rule"/>
     <ul>
      <li><Check size={18}/> 2,000 / 4,000 / 10,000 Credit shortcuts</li>
      <li><Check size={18}/> Custom whole-credit amount from 500 to 100,000</li>
      <li><Check size={18}/> Credit balance and usage history in the account menu</li>
      <li><Check size={18}/> Previous Hobby subscriptions are not sold anew; existing contracts retain their rights and management options</li>
     </ul>
     <Link className="sm-plan-action sm-plan-action-outline" href="/login">Sign in or create an account</Link>
    </article>
   </section>
   <section className="sm-plans-credit-custom" aria-label="Choose proposed credit amount"><CreditAmountPicker/></section>
   <div className="sm-plans-footnote"><ShieldCheck size={18}/> Credits are account-bound internal video credits, not cash or transferable funds. Euro refunds, withdrawal rights and statutory consumer protections remain separate. Rates, taxes and limits require approval before launch. Existing contractual Hobby subscriptions are not automatically changed.</div>
  </main>
 </div>;
}
