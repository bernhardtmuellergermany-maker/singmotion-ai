import Link from "next/link";
import {SiteHeader} from "@/components/site-header";
import {SEO_CONTENT,SEO_TOPICS,seoPagePath,SITE_ORIGIN,type SeoTopic,type SeoLocale} from "@/lib/seo/search-pages";

export function SearchLanding({locale,topic}:{locale:SeoLocale;topic:SeoTopic}){
 const page=SEO_CONTENT[topic][locale];
 const german=locale==="de";
 const breadcrumbJson=JSON.stringify({
  "@context":"https://schema.org","@type":"BreadcrumbList",itemListElement:[
   {"@type":"ListItem",position:1,name:german?"Startseite":"Home",item:SITE_ORIGIN},
   {"@type":"ListItem",position:2,name:german?"KI-Videos entdecken":"Explore AI video",item:SITE_ORIGIN+"/"+locale},
   {"@type":"ListItem",position:3,name:page.heading,item:SITE_ORIGIN+seoPagePath(topic,locale)}
  ]
 }).replace(/</g,"\\u003c");
 return <div className="sm-seo-page">
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:breadcrumbJson}}/>
  <SiteHeader/>
  <main id="content" className="sm-seo-main" lang={locale}>
   <nav className="sm-seo-breadcrumb" aria-label={german?"Brotkrumennavigation":"Breadcrumb"}>
    <Link href="/">{german?"Startseite":"Home"}</Link><span aria-hidden="true">/</span>
    <Link href={"/"+locale}>{german?"KI-Videos entdecken":"Explore AI video"}</Link>
    <span aria-hidden="true">/</span><span aria-current="page">{page.eyebrow}</span>
   </nav>
   <header className="sm-seo-hero">
    <p className="sm-seo-kicker">{page.eyebrow}</p>
    <h1>{page.heading}</h1>
    <p className="sm-seo-lead">{page.intro}</p>
    <div className="sm-seo-actions">
     <Link className="sm-seo-primary" href="/studio?new=1">{german?"Zum SingMotion-Studio":"Go to SingMotion Studio"}</Link>
     <Link className="sm-seo-secondary" href={"/"+locale}>{german?"Weitere Anwendungen":"Explore more uses"}</Link>
    </div>
   </header>
   <section className="sm-seo-section" aria-labelledby="sm-seo-steps">
    <h2 id="sm-seo-steps">{german?"So funktioniert der Workflow":"How the workflow works"}</h2>
    <div className="sm-seo-grid">
     {page.steps.map((step,i)=><article className="sm-seo-panel" key={step.heading}>
      <span className="sm-seo-step">{String(i+1).padStart(2,"0")}</span>
      <h3>{step.heading}</h3><p>{step.body}</p>
     </article>)}
    </div>
   </section>
   <section className="sm-seo-section" aria-labelledby="sm-seo-benefits">
    <h2 id="sm-seo-benefits">{german?"Wofür du es nutzen kannst":"What you can create"}</h2>
    <div className="sm-seo-grid">{page.benefits.map(item=><article className="sm-seo-panel" key={item.heading}>
     <h3>{item.heading}</h3><p>{item.body}</p>
    </article>)}</div>
   </section>
   <section className="sm-seo-section sm-seo-faq" aria-labelledby="sm-seo-faq">
    <h2 id="sm-seo-faq">{german?"Häufige Fragen":"Frequently asked questions"}</h2>
    {page.faq.map(item=><article key={item.question}><h3>{item.question}</h3><p>{item.answer}</p></article>)}
   </section>
   <section className="sm-seo-section" aria-labelledby="sm-seo-related">
    <h2 id="sm-seo-related">{german?"Das könnte dich auch interessieren":"Related AI video workflows"}</h2>
    <nav className="sm-seo-related" aria-label={german?"Verwandte Anwendungsfälle":"Related workflows"}>
     {SEO_TOPICS.filter(t=>t!==topic).map(t=><Link key={t} href={seoPagePath(t,locale)}>
       {SEO_CONTENT[t][locale].heading}<span aria-hidden="true"> →</span>
      </Link>)}
    </nav>
   </section>
   <p className="sm-seo-note">{page.footnote}</p>
   <p className="sm-seo-note">{german
    ?"Hinweis zur Verfügbarkeit: Echte Credit-Käufe und KI-Renderings werden nur nach der jeweiligen Konto- und Länderfreigabe angeboten. Die aktuelle Verfügbarkeit prüft das Studio. Die Anwendung selbst ist derzeit überwiegend englischsprachig."
    :"Availability: Live credit checkout and AI rendering are offered only after the account and billing country have been approved. The Studio checks actual availability."}</p>
  </main>
  <footer className="sm-seo-footer">
   <Link href="/">{german?"Startseite":"Home"}</Link>
   <Link href={locale==="de"?seoPagePath(topic,"en"):seoPagePath(topic,"de")}>
    {german?"English version":"Deutsche Version"}
   </Link>
   <Link href="/legal">{german?"Rechtliches":"Legal"}</Link>
   <Link href="/contact">{german?"Kontakt":"Contact"}</Link>
  </footer>
 </div>;
}

export function SearchHub({locale}:{locale:SeoLocale}){
 const de=locale==="de";
 const webApplicationJson=JSON.stringify({
  "@context":"https://schema.org","@type":"WebApplication",
  "@id":SITE_ORIGIN+"/#application",name:"SingMotion AI",url:SITE_ORIGIN,
  operatingSystem:"Web",applicationCategory:"MultimediaApplication",
  inLanguage:locale,
  description:de?"Musikvideo-Studio für animierte KI-Performances mit Foto und eigenem Song.":"AI music performance studio using your own photo and song."
 }).replace(/</g,"\\u003c");
 return <div className="sm-seo-page">
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:webApplicationJson}}/>
  <SiteHeader/>
  <main id="content" className="sm-seo-main" lang={locale}>
   <header className="sm-seo-hero">
    <p className="sm-seo-kicker">SINGMOTION AI</p>
    <h1>{de?"KI Video erstellen – Musik, Foto und Performance":"Create AI music videos from your photo and song"}</h1>
    <p className="sm-seo-lead">{de
     ?"Du suchst einen KI-Video-Generator für deinen Song, ein singendes Portrait oder einen Musikclip für TikTok, Reels und Shorts? Entdecke, welcher SingMotion-Workflow zu deiner Idee passt. Die App verwendet eigene beziehungsweise lizenzierte Musik und Fotos statt einer rein textbasierten Videogenerierung."
     :"Explore the SingMotion workflow for AI singing videos, music clips, short-form content and photo-driven OmniHuman performances. Start with music and a photo you are entitled to use, not a text-only video prompt."}</p>
    <div className="sm-seo-actions">
     <Link className="sm-seo-primary" href="/studio?new=1">{de?"Zum Studio":"Open Studio"}</Link>
     <Link className="sm-seo-secondary" href={de?"/en":"/de"}>{de?"English":"Deutsch"}</Link>
    </div>
   </header>
   <section className="sm-seo-section" aria-labelledby="sm-seo-hub-list">
    <h2 id="sm-seo-hub-list">{de?"Entdecke die Möglichkeiten":"Explore the workflows"}</h2>
    <div className="sm-seo-grid sm-seo-hub-grid">
     {SEO_TOPICS.map(topic=><article className="sm-seo-panel" key={topic}>
      <p className="sm-seo-kicker">{SEO_CONTENT[topic][locale].eyebrow}</p>
      <h3><Link href={seoPagePath(topic,locale)}>{SEO_CONTENT[topic][locale].heading}</Link></h3>
      <p>{SEO_CONTENT[topic][locale].description}</p>
      <Link className="sm-seo-text-link" href={seoPagePath(topic,locale)}>{de?"Anleitung & Details":"Workflow & details"} →</Link>
     </article>)}
    </div>
   </section>
   <section className="sm-seo-section">
    <h2>{de?"So läuft es in SingMotion ab":"The SingMotion approach"}</h2>
    <p>{de
     ?"Musik hochladen, ein berechtigtes Portrait auswählen, die Szene beschreiben, den Credit-Preis prüfen und die Videoausgabe im eigenen Projekt ansehen: SingMotion ist auf musikalische KI-Performances fokussiert. Ein separater Text-zu-Video-Generator oder ein Social-Media-Autoposting-Tool gehört nicht dazu."
     :"Bring your song, upload a permitted performer image, direct the scene, review the credit quote and access the video in your own project. SingMotion is focused on musical performances, not generic text-to-video or automatic social posting."}</p>
   </section>
  </main>
  <footer className="sm-seo-footer"><Link href="/">{de?"Startseite":"Home"}</Link><Link href={de?"/en":"/de"}>{de?"English":"Deutsch"}</Link><Link href="/legal">{de?"Rechtliches":"Legal"}</Link><Link href="/contact">{de?"Kontakt":"Contact"}</Link></footer>
 </div>;
}
