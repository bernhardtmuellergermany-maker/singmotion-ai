import type {Metadata} from "next";
import Link from "next/link";
import {Check, Music2, Sparkles, ShieldCheck} from "lucide-react";
import {OutputProjectSearch} from "@/components/output-project-search";
import {SiteHeader} from "@/components/site-header";
import "./plans.css";
export const metadata:Metadata={
 title:"Plans & Pricing — SingMotion AI",
 description:"Compare SingMotion AI Free and the planned Hobby subscription. Clear project limits and monthly included video seconds."
};
export default function PlansPage(){
 return <div className="sm-carousel-page sm-plans-page">
  <SiteHeader search={<OutputProjectSearch/>} />
  <main className="sm-plans">
  <div className="sm-plans-glow" aria-hidden="true"/>
  <section className="sm-plans-intro">
   <span className="sm-plans-kicker"><Sparkles size={15}/> YOUR MUSIC. YOUR PERFORMANCE.</span>
   <h1>Find your rhythm.</h1>
   <p>Free has no subscription fee: pay only for the video seconds you generate. Hobby adds 30 included video seconds each paid billing period and a lower price for extra seconds.</p>
  </section>
  <section className="sm-plans-grid" aria-label="Compare subscriptions">
   <article className="sm-plan-card">
    <div className="sm-plan-top"><span className="sm-plan-icon"><Music2 size={24}/></span><span className="sm-plan-status">Available</span></div>
    <h2>Free</h2><p className="sm-plan-caption">Your creative starting point.</p>
    <div className="sm-plan-price">€0 <span>/ month</span></div>
    <div className="sm-plan-rule"/>
    <ul><li><Check size={18}/> Up to 3 projects</li><li><Check size={18}/> Private project workspace</li><li><Check size={18}/> No included video seconds</li><li><Check size={18}/> Video generation: €0.25 per generated second (pay as you go, VAT included)</li></ul>
    <Link className="sm-plan-action sm-plan-action-outline" href="/">Start with Free</Link>
   </article>
   <article className="sm-plan-card sm-plan-featured">
    <div className="sm-plan-top"><span className="sm-plan-icon"><Sparkles size={24}/></span><span className="sm-plan-status sm-plan-soon">Coming soon</span></div>
    <h2>Hobby</h2><p className="sm-plan-caption">More room to bring your music to life.</p>
    <div className="sm-plan-price">€4.99 <span>/ month, VAT included</span></div>
    <div className="sm-plan-rule"/>
    <ul><li><Check size={18}/> Up to 10 projects</li><li><Check size={18}/> 30 video seconds included per paid billing period</li><li><Check size={18}/> Minimum 5 seconds per video</li><li><Check size={18}/> Extra video seconds after your allowance: €0.20 per second (VAT included)</li></ul>
    <span className="sm-plan-action sm-plan-action-disabled" aria-disabled="true">Subscriptions coming soon</span>
   </article>
  </section>
  <div className="sm-plans-footnote"><ShieldCheck size={18}/> Hobby is not available for purchase yet. 30 seconds can fund up to six 5-second videos. Further generation is billed per second; the included allowance resets with the paid Stripe billing period, not the calendar month. Prices shown include VAT.</div>
  <footer className="sm-plans-footer"><Link href="/">Home</Link><Link href="/help">Help</Link><Link href="/legal">Legal</Link></footer>
 </main></div>;
}
