import Link from "next/link";
import {SiteHeader} from "@/components/site-header";
import {SEO_CONTENT,SEO_TOPICS,SEO_GUIDES_HUB,seoPagePath,SITE_ORIGIN,type SeoTopic} from "@/lib/seo/search-pages";

export function SearchLanding({topic}:{topic:SeoTopic}){
 const page=SEO_CONTENT[topic];
 const breadcrumbJson=JSON.stringify({
  "@context":"https://schema.org","@type":"BreadcrumbList",
  itemListElement:[
   {"@type":"ListItem",position:1,name:"Home",item:SITE_ORIGIN},
   {"@type":"ListItem",position:2,name:"Help",item:SITE_ORIGIN+"/help"},
   {"@type":"ListItem",position:3,name:"AI video guides",item:SITE_ORIGIN+SEO_GUIDES_HUB},
   {"@type":"ListItem",position:4,name:page.heading,item:SITE_ORIGIN+seoPagePath(topic)}
  ]
 }).replace(/</g,"\\u003c");
 return <div className="sm-seo-page">
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:breadcrumbJson}}/>
  <SiteHeader/>
  <main id="content" className="sm-seo-main">
   <nav className="sm-seo-breadcrumb" aria-label="Breadcrumb">
    <Link href="/">Home</Link><span aria-hidden="true">/</span>
    <Link href="/help">Help</Link><span aria-hidden="true">/</span>
    <Link href={SEO_GUIDES_HUB}>AI video guides</Link><span aria-hidden="true">/</span>
    <span aria-current="page">{page.eyebrow}</span>
   </nav>
   <header className="sm-seo-hero">
    <p className="sm-seo-kicker">{page.eyebrow}</p>
    <h1>{page.heading}</h1>
    <p className="sm-seo-lead">{page.intro}</p>
    <div className="sm-seo-actions">
     <Link className="sm-seo-primary" href="/studio?new=1">Open SingMotion Studio</Link>
     <Link className="sm-seo-secondary" href={SEO_GUIDES_HUB}>Explore more guides</Link>
    </div>
   </header>
   <section className="sm-seo-section" aria-labelledby="sm-seo-steps">
    <h2 id="sm-seo-steps">How the workflow works</h2>
    <div className="sm-seo-grid">{page.steps.map((step,i)=><article className="sm-seo-panel" key={step.heading}>
     <span className="sm-seo-step">{String(i+1).padStart(2,"0")}</span>
     <h3>{step.heading}</h3><p>{step.body}</p>
    </article>)}</div>
   </section>
   <section className="sm-seo-section" aria-labelledby="sm-seo-benefits">
    <h2 id="sm-seo-benefits">What you can create</h2>
    <div className="sm-seo-grid">{page.benefits.map(item=><article className="sm-seo-panel" key={item.heading}>
     <h3>{item.heading}</h3><p>{item.body}</p>
    </article>)}</div>
   </section>
   <section className="sm-seo-section sm-seo-faq" aria-labelledby="sm-seo-faq">
    <h2 id="sm-seo-faq">Frequently asked questions</h2>
    {page.faq.map(item=><article key={item.question}><h3>{item.question}</h3><p>{item.answer}</p></article>)}
   </section>
   <section className="sm-seo-section" aria-labelledby="sm-seo-related">
    <h2 id="sm-seo-related">Related AI video guides</h2>
    <nav className="sm-seo-related" aria-label="Related video workflows">
     {SEO_TOPICS.filter(t=>t!==topic).map(t=><Link key={t} href={seoPagePath(t)}>
      {SEO_CONTENT[t].heading}<span aria-hidden="true"> →</span>
     </Link>)}
    </nav>
   </section>
   <p className="sm-seo-note">{page.footnote}</p>
   <p className="sm-seo-note">Live credit checkout and AI rendering depend on your account and approved billing country. The Studio checks availability before any purchase.</p>
  </main>
  <footer className="sm-seo-footer">
   <Link href="/">Home</Link><Link href="/help">Help</Link>
   <Link href={SEO_GUIDES_HUB}>AI video guides</Link>
   <Link href="/legal">Legal</Link><Link href="/contact">Contact</Link>
  </footer>
 </div>;
}

export function SearchHub(){
 const webApplicationJson=JSON.stringify({
  "@context":"https://schema.org","@type":"WebApplication",
  "@id":SITE_ORIGIN+"/#application",name:"SingMotion AI",url:SITE_ORIGIN,
  operatingSystem:"Web",applicationCategory:"MultimediaApplication",
  inLanguage:"en",
  description:"AI music performance studio using your own photo and song."
 }).replace(/</g,"\\u003c");
 return <div className="sm-seo-page">
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:webApplicationJson}}/>
  <SiteHeader/>
  <main id="content" className="sm-seo-main">
   <nav className="sm-seo-breadcrumb" aria-label="Breadcrumb"><Link href="/">Home</Link>
    <span aria-hidden="true">/</span><Link href="/help">Help</Link>
    <span aria-hidden="true">/</span><span aria-current="page">AI video guides</span>
   </nav>
   <header className="sm-seo-hero">
    <p className="sm-seo-kicker">SINGMOTION AI · HELP</p>
    <h1>AI music video creation guides</h1>
    <p className="sm-seo-lead">Explore how to create AI singing videos, music clips, short-form content and photo-driven OmniHuman performances. SingMotion uses a track and image you are entitled to use rather than a text-only video prompt.</p>
    <div className="sm-seo-actions">
     <Link className="sm-seo-primary" href="/studio?new=1">Open Studio</Link>
     <Link className="sm-seo-secondary" href="/help">Back to Help</Link>
    </div>
   </header>
   <section className="sm-seo-section" aria-labelledby="sm-seo-hub-list">
    <h2 id="sm-seo-hub-list">Explore video workflows</h2>
    <div className="sm-seo-grid sm-seo-hub-grid">
     {SEO_TOPICS.map(topic=><article className="sm-seo-panel" key={topic}>
      <p className="sm-seo-kicker">{SEO_CONTENT[topic].eyebrow}</p>
      <h3><Link href={seoPagePath(topic)}>{SEO_CONTENT[topic].heading}</Link></h3>
      <p>{SEO_CONTENT[topic].description}</p>
      <Link className="sm-seo-text-link" href={seoPagePath(topic)}>Read guide →</Link>
     </article>)}
    </div>
   </section>
   <section className="sm-seo-section">
    <h2>The SingMotion approach</h2>
    <p>Bring your song, upload a permitted performer image, direct the scene, review the credit quote and access your video in your own project. SingMotion specializes in musical performances, not generic text-to-video or automatic social-media posting.</p>
   </section>
  </main>
  <footer className="sm-seo-footer"><Link href="/">Home</Link><Link href="/help">Help</Link><Link href="/legal">Legal</Link><Link href="/contact">Contact</Link></footer>
 </div>;
}
