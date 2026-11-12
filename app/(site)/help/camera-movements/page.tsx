import Link from "next/link";
import {ArrowLeft,ArrowRight,Camera,CheckCircle2,Clapperboard,Music2,ShieldCheck,TriangleAlert} from "lucide-react";
import {SiteHeader} from "@/components/site-header";
import {cameras,cameraHelp} from "@/lib/domain";
import "./camera-movements.css";

export const metadata={
 title:"Camera Movement Guide · SingMotion AI",
 description:"Learn how to choose a camera direction, write effective 500-character performance prompts, and reduce visual artefacts in BytePlus-powered AI singing videos.",
};

const techniques=[
 {name:"Static / locked-off",where:"Best first test",text:"The singer performs in a steady shot. This is the most useful baseline for checking lip-sync, facial consistency and motion without adding camera changes.",example:"The camera remains stationary while the singer performs naturally. Keep the face clearly visible.",risk:"Low complexity, not a guarantee of a motionless output."},
 {name:"Orbit left",where:"Moderate difficulty",text:"The viewpoint makes a slow, small arc to the left. Leave room around the person's head and shoulders. An extreme orbit can reveal facial regions missing from the reference photo.",example:"Camera: Slowly orbit left around the singer, keeping the face clearly visible and centered.",risk:"May alter facial identity, the background or body shape."},
 {name:"Push in",where:"Emotional close-up",text:"The framing gradually becomes tighter to bring attention to the singer's expression. Start from a wider medium shot so there is room to move closer.",example:"Camera: Slowly push in toward the singer for a closer view, keeping the eyes and mouth visible.",risk:"May crop the chin or introduce unexpected changes in face detail."},
 {name:"Pull out",where:"Reveal a performance scene",text:"The view slowly becomes wider. Include meaningful background context in the source image rather than asking the model to invent a detailed environment from a tightly cropped selfie.",example:"Camera: Move gently backward to reveal more of the singer and the surrounding stage.",risk:"Background details and limbs may be invented or inconsistent."},
 {name:"Tilt up / tilt down",where:"Small framing adjustment",text:"The viewpoint angles gently upward or downward without changing the singer's identity or introducing a dramatic perspective change. Keep the subject in shot.",example:"Camera: Tilt up very slowly while keeping the singer's face visible throughout.",risk:"A strong tilt can cut off the singer or change perspective unnaturally."},
 {name:"Follow singer",where:"Visible walking / tracking",text:"Useful only when the original reference shows enough of the singer's body to support walking. Describe the singer's movement separately from the camera's matching movement.",example:"The singer takes visible steps forward while singing. Camera: Track smoothly backward, keeping the singer framed.",risk:"Full-body action, hands, feet and background are difficult to keep consistent."},
 {name:"Gentle handheld",where:"Subtle live-performance energy",text:"Adds a restrained, human-operated feel. Ask for smooth micro-movement rather than shake or whip pans; use shorter clips first.",example:"Camera: Add very subtle, smooth handheld motion without abrupt shake or focus changes.",risk:"Excessive motion may cause blur, flicker or facial distortion."},
];
const checklist=[
 ["Start with 5–10 seconds","A short excerpt with clear vocals is easier to evaluate before attempting longer, more expensive generation."],
 ["Choose the right reference photo","Use a sharp JPEG or PNG showing the face and mouth. Leave space in the intended movement direction; full-body motion needs the legs visible."],
 ["Write one main camera instruction","Avoid simultaneous orbit, zoom, rapid pan and tracking. The instruction should match the scene and your desired mood."],
 ["Keep the prompt concise","The current SingMotion performance field accepts up to 500 characters. The Quick ideas buttons insert editable text; they do not enable a separate hardware camera controller."],
 ["Review before spending credits","Check the final prompt and account balance. Stripe test credit purchases are only available on staging; customer generation remains subject to separate release controls."],
 ["Inspect the finished video","Check mouth sync, expression, hands, edges, framing, resolution and sound from beginning to end. A technically defective paid delivery is subject to applicable consumer remedies."],
];
const issues=[
 ["The face changes or becomes unfamiliar","Switch to Static, use a well-lit front-facing portrait, reduce head turns and keep the camera move small."],
 ["The singer does not walk or dance","Use a full-body photo that includes legs and surrounding space. Describe visible body movement before asking the camera to follow."],
 ["The camera ignores my instruction","Camera text is a creative hint, not a deterministic API parameter. Try one simpler instruction and a shorter excerpt."],
 ["The background becomes unstable","Avoid orbiting around a cropped portrait. Start from a wider photograph with fewer background details and try a stationary shot."],
 ["The final video is cropped differently","The delivered dimensions are provider-dependent. Choose and prepare the photo for the intended 9:16 or 16:9 composition and review the actual output."],
];
export default function CameraMovementsHelp(){
 return <div className="sm-legal sm-camera-guide">
  <SiteHeader/>
  <main id="content" className="sm-legal-main sm-camera-main">
   <nav className="sm-camera-breadcrumb" aria-label="Guide navigation">
    <Link href="/studio"><ArrowLeft size={16}/> Back to Studio</Link>
    <Link href="/help">Help & best practices</Link>
    <Link href="/faq">FAQ</Link>
   </nav>
   <header className="sm-legal-intro sm-camera-intro">
    <span className="sm-legal-kicker">SINGMOTION AI · CREATIVE GUIDE</span>
    <h1>Camera movements<span>.</span></h1>
    <p>Give your singer a convincing on-screen presence. Learn when to keep the viewpoint steady, when to introduce a gentle move, and how to describe it without confusing the AI.</p>
    <small>Creative guidance, not guaranteed controls. The current Studio uses editable English prompt text, not a physical or deterministic virtual camera.</small>
   </header>
   <div className="sm-camera-callout">
    <Camera size={23} aria-hidden="true"/>
    <div><strong>Best first result: a static, well-framed portrait.</strong><p>Choose a clear 5–10-second vocal passage and a natural performance. Change only one setting at a time to understand what improves your output.</p></div>
   </div>
   <section className="sm-legal-panel">
    <span className="sm-legal-num">01 / HOW IT WORKS</span><h2>How camera guidance works in SingMotion</h2>
    <p>Open <Link href="/studio">Studio</Link>, upload your audio and artist image, then go to the <strong>Performance prompt</strong> step. You can write your own instructions or insert a camera phrase with <strong>Quick ideas</strong>: Orbit left, Push in, Static, Follow singer or Tilt. The inserted text stays editable; use one main camera direction, with a separate description of the singer's actions.</p>
    <p>These directions are sent as part of the user prompt to the generation workflow when provider submission is enabled. A provider may interpret, soften or ignore them. The current OmniHuman integration is an image-and-audio-driven performer model; do not confuse its creative prompt with a guaranteed `camera_fixed` setting from BytePlus's separate Seedance APIs.</p>
    <p><strong>Prompt example:</strong> “The singer faces the camera and sings confidently with small natural gestures. Camera: Slowly push in, keeping the eyes and mouth clearly visible.”</p>
   </section>
   <section className="sm-camera-section">
    <div className="sm-camera-section-title"><span className="sm-legal-num">02 / CHOOSE A MOVEMENT</span><h2>Which camera direction should I use?</h2><p>Choose based on the input photo, not only on the effect you want. These examples are plain English prompts you can adapt in Studio.</p></div>
    <div className="sm-camera-techniques">{techniques.map((t,i)=><article key={t.name} className="sm-camera-technique">
     <div className="sm-camera-technique-top"><span className="sm-camera-number">{String(i+1).padStart(2,"0")}</span><div><h3>{t.name}</h3><small>{t.where}</small></div></div>
     <p>{t.text}</p><blockquote>{t.example}</blockquote><p className="sm-camera-risk"><TriangleAlert size={16} aria-hidden="true"/>{t.risk}</p>
    </article>)}</div>
   </section>
   <section className="sm-legal-panel">
    <span className="sm-legal-num">03 / PREPARE YOUR MEDIA</span><h2>A reliable workflow, from photo to video</h2>
    <div className="sm-camera-checklist">{checklist.map(([heading,body])=><div key={heading}><CheckCircle2 size={19} aria-hidden="true"/><div><h3>{heading}</h3><p>{body}</p></div></div>)}</div>
    <p><Music2 size={17} style={{display:"inline",verticalAlign:"middle",marginRight:6}} aria-hidden="true"/><strong>Current SingMotion uploads:</strong> audio MP3/WAV or audio-only M4A up to 50 MB, JPEG/PNG image up to 30 MB. Selected audio is prepared separately for provider limits; a valid site upload does not automatically mean a valid BytePlus task.</p>
   </section>
   <section className="sm-legal-panel">
    <span className="sm-legal-num">04 / TROUBLESHOOTING</span><h2>When camera motion does not look right</h2>
    <div className="sm-camera-questions">{issues.map(([title,answer])=><details key={title}><summary>{title}</summary><p>{answer}</p></details>)}</div>
   </section>
   <section className="sm-legal-panel">
    <span className="sm-legal-num">05 / PROVIDER REALITY</span><h2>What BytePlus documents—and what it does not promise</h2>
    <p>BytePlus documents image, audio and optional text prompts for OmniHuman-style video generation, including camera-movement descriptions. The cited OmniHuman 2.0 integration reference lists one image, an MP3/WAV audio track under 15 MB and approximately 4–300 seconds of audio; SingMotion applies its own tighter minimum clip length of five seconds. Exact contracted model, availability, input limits and supported output duration must be confirmed for each live workflow.</p>
    <p>Different BytePlus model families have different controls. The <em>Seedance</em> `camera_fixed` option is not evidence that SingMotion's OmniHuman workflow has an equivalent deterministic switch. Camera prompting is a suggestion, and no preset guarantees the output or timing.</p>
    <p>Sources: <a href="https://github.com/byteplus-sa/ark-mcp/blob/main/docs/tools.md" target="_blank" rel="noopener noreferrer">BytePlus OmniHuman 2.0 integration reference</a>.</p>
   </section>
   <section className="sm-legal-panel">
    <span className="sm-legal-num">06 / RIGHTS & SAFETY</span><h2>Use real performers with permission</h2>
    <p>Only animate images, recordings or voices you are allowed to use for synthetic generation and the intended publication. Permission to listen to music or repost a photo is not necessarily permission to produce an AI performance. Clearly disclose artificially generated or manipulated performances where required, especially when a viewer could mistake them for a real event.</p>
    <p>Read <Link href="/rights">Music & likeness rights</Link>, <Link href="/ai-transparency">AI transparency</Link> and <Link href="/privacy">Privacy</Link>. For output questions, consult <Link href="/help">Help & best practices</Link>.</p>
   </section>
   <div className="sm-camera-bottom"><Link href="/studio"><Clapperboard size={18}/> Open Studio <ArrowRight size={17}/></Link><Link href="/help">More help</Link></div>
  </main>
 </div>;
}
