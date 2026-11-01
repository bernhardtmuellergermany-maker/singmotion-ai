import type {Metadata} from "next";
import Link from "next/link";
import {ArrowLeft, Check, Music2, Sparkles, ShieldCheck, UserRound} from "lucide-react";
import {SiteHeader} from "@/components/site-header";
import "./plans.css";
export const metadata:Metadata={
 title:"Plans & Pricing — SingMotion AI",
 description:"Compare SingMotion AI Free and the planned Hobby subscription. Clear project limits and monthly included video seconds."
};
export default function PlansPage(){
 return <main className="sm-plans">
  <div className="sm-plans-glow" aria-hidden="true"/>
  <SiteHeader className="sm-plans-header" navigation={<Link href="/" className="sm-plans-back"><ArrowLeft size={17}/> Studio</Link>} />
  <section className="sm-plans-intro">
   <span className="sm-plans-kicker"><Sparkles size={15}/> YOUR MUSIC. YOUR PERFORMANCE.</span>
   <h1>Find your rhythm.</h1>
   <p>Start creating with Free. Hobby is planned for creators who want more projects and included video generation time.</p>
  </section>
  <section className="sm-plans-grid" aria-label="Compare subscriptions">
   <article className="sm-plan-card">
    <div className="sm-plan-top"><span className="sm-plan-icon"><Music2 size={24}/></span><span className="sm-plan-status">Available</span></div>
    <h2>Free</h2><p className="sm-plan-caption">Your creative starting point.</p>
    <div className="sm-plan-price">€0 <span>/ month</span></div>
    <div className="sm-plan-rule"/>
    <ul><li><Check size={18}/> Up to 5 projects</li><li><Check size={18}/> Private project workspace</li><li><Check size={18}/> No included subscription video seconds</li></ul>
    <Link className="sm-plan-action sm-plan-action-outline" href="/">Start with Free</Link>
   </article>
   <article className="sm-plan-card sm-plan-featured">
    <div className="sm-plan-top"><span className="sm-plan-icon"><Sparkles size={24}/></span><span className="sm-plan-status sm-plan-soon">Coming soon</span></div>
    <h2>Hobby</h2><p className="sm-plan-caption">More room to bring your music to life.</p>
    <div className="sm-plan-price">€4.99 <span>/ month, VAT included</span></div>
    <div className="sm-plan-rule"/>
    <ul><li><Check size={18}/> Up to 10 projects</li><li><Check size={18}/> 30 video seconds in total per paid billing period</li><li><Check size={18}/> Minimum 5 seconds per video</li><li><Check size={18}/> No separate video-count limit within your seconds allowance</li></ul>
    <span className="sm-plan-action sm-plan-action-disabled" aria-disabled="true">Subscriptions coming soon</span>
   </article>
  </section>
  <div className="sm-plans-footnote"><ShieldCheck size={18}/> Hobby is not available for purchase yet. Generation depends on available seconds, and the included allowance resets with the paid Stripe billing period, not the calendar month.</div>
  <footer className="sm-plans-footer"><Link href="/">Home</Link><Link href="/help">Help</Link><Link href="/legal">Legal</Link></footer>
 </main>;
}
