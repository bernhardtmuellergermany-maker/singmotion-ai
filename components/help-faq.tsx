import Link from "next/link";
import { Search, UserRound, ChevronDown } from "lucide-react";
import { GlobalMenu } from "./home-collection";

const groups = [
  {heading:"Getting started",items:[
    ["How do I create a music video?","Start from the Home card, upload your own song, then continue to Studio. Choose an artist image, select your audio segment, review the available performance settings and submit your generation when available."],
    ["Which music files can I upload?","Use MP3 or WAV audio. Select the segment you want in the waveform editor. File size and duration are checked before processing."],
    ["Which images work best?","Use a clear JPEG or PNG portrait with good lighting, a visible face and mouth, and as little obstruction as possible. You must have the rights and permissions needed to use the image."],
    ["How can I get more natural results?","A clear lead vocal, an unobstructed portrait and subtle performance directions are good starting points. Lip-sync, identity and movement quality can vary, and a particular outcome is not guaranteed."]
  ]},
  {heading:"Projects & Showcase",items:[
    ["Where can I find my projects?","Your own projects appear as cards in the carousel. Use the search icon to find a project by name or creation date."],
    ["Can I search the Home, Login and Showcase cards?","Yes. Try terms such as home, create video, upload, login, account, showcase, example or demo."],
    ["What is the SingMotion AI Showcase?","The Showcase displays an example video chosen for public viewing. Other users' private projects are not automatically published."],
    ["Will my project become public?","No. A private project is not made public just because it was created. Only an explicitly selected Showcase video is shared publicly."]
  ]},
  {heading:"Accounts, rights & troubleshooting",items:[
    ["Where do I log in or out?","Customer account functionality may not yet be available. Authorized administrators can access Super-Admin Login or Logout discreetly near the end of the Legals page."],
    ["Can I use someone else's music, voice or photo?","Only if you hold all required rights and permissions, including permission from identifiable people where applicable. You confirm these rights before submitting a video generation."],
    ["Why is my video not playing immediately?","Video loading depends on your connection and browser. Allow a moment for buffering and check whether your browser permits video playback. If a generation failed, check the project status."],
    ["How are my uploads and personal information handled?","Read the Privacy & Cookies section under Legals for information on sessions, uploads, AI providers, retention and your privacy rights."]
  ]}
];
export function HelpFAQ(){
return <div className="sm-legal sm-help-faq">
<header className="home-gallery-header sm-carousel-header"><Link href="/" className="sm-wordmark" aria-label="SingMotion AI home">SingMotion <span>AI</span></Link><div className="sm-header-actions"><Link className="sm-legal-search" href="/?search=1" aria-label="Search projects" title="Search projects"><Search size={19}/></Link><GlobalMenu/><Link href="/?card=login" className="home-gallery-account" aria-label="Login or account" title="Login or account"><UserRound size={21}/></Link></div></header>
<main id="content" className="sm-legal-main">
 <div className="sm-legal-intro"><span className="sm-legal-kicker">SUPPORT & GUIDANCE</span><h1>Help & FAQ<span>.</span></h1><p>Quick answers to common questions about creating videos, finding projects and using SingMotion AI.</p></div>
 {groups.map((group,index)=><section key={group.heading} className="sm-help-group"><div className="sm-help-group-header"><span className="sm-legal-num">0{index+1} / HELP</span><h2>{group.heading}</h2></div><div className="sm-help-questions">{group.items.map(([question,answer])=><details className="sm-help-question" key={question}><summary>{question}<ChevronDown size={18} aria-hidden="true"/></summary><p>{answer}</p></details>)}</div></section>)}
 <div className="sm-help-bottom">Need information about privacy, copyright or AI-generated media? <Link href="/legal">Read Legals</Link></div>
</main>
</div>;
}
