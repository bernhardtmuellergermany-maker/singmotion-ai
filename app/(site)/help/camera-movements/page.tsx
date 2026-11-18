import Link from "next/link";
import {ArrowRight,Camera,CheckCircle2,Clapperboard,Music2,TriangleAlert} from "lucide-react";
import {SiteHeader} from "@/components/site-header";
import {PromptCopyButton} from "@/components/prompt-copy-button";
import "./camera-movements.css";
import {cameraMovements} from "@/lib/studio-camera-movements";

export const metadata={
 title:"Camera Movements & Prompt Guide · SingMotion AI",
 description:"Practical prompts for continuous actions, singing, speaking, camera movements and creative video ideas. Copy examples directly into SingMotion Studio.",
};

/** Studio presets are distinguished from exploratory language instructions.
 * Prompts are creative guidance: model adherence, trajectory and timing are not guaranteed. */
// The same 22 reviewed movements power the Studio camera chips.
const techniques=cameraMovements;
const useCases=[
  {
    "name": "Original songs & music videos",
    "description": "Animate your own singer, rapper or illustrated character to a vocal excerpt.",
    "prompt": "Medium shot. The singer performs the original chorus with emotion, first holding one hand over the heart, then opening both arms as the camera gently pushes in."
  },
  {
    "name": "TikTok Shop & product showcases",
    "description": "Explain a product with a clearly labeled synthetic presenter. Use real product claims and follow advertising rules.",
    "prompt": "Static medium shot. The presenter speaks energetically, first holding the product at chest height, then pointing out one practical feature and smiling to camera."
  },
  {
    "name": "User-generated-style advertisements",
    "description": "Create a natural social ad from your authorized portrait and recorded voice.",
    "prompt": "Gentle handheld camera feel. The creator speaks to camera with a friendly smile, then lifts the product slightly and nods while explaining its value."
  },
  {
    "name": "News & community updates",
    "description": "A clearly labeled AI presenter for checked facts, local bulletins or updates; never impersonate a real journalist.",
    "prompt": "Static eye-level medium shot. The virtual news presenter speaks clearly with a serious, neutral expression, briefly nods, then looks directly into the camera."
  },
  {
    "name": "Voiceovers made with ElevenLabs",
    "description": "Use an exported audio recording from a speech tool; an upload is not a native integration. Have rights to the voice.",
    "prompt": "Static medium shot. The digital narrator speaks warmly and clearly, makes a small welcoming gesture, then holds steady eye contact."
  },
  {
    "name": "Podcasts turned into video",
    "description": "Visualize a single speaker's licensed podcast or commentary track.",
    "prompt": "Slow push-in from a medium shot. The podcast host speaks thoughtfully, first glances down briefly, then looks back at the camera and smiles."
  },
  {
    "name": "Explainer & educational clips",
    "description": "Teach a lesson, demonstrate a concept or introduce a class.",
    "prompt": "Static medium shot. The educator speaks confidently, counts two key points on their fingers, then opens one hand toward the viewer."
  },
  {
    "name": "Audiobooks & storytelling",
    "description": "Give an original or properly licensed story a visual narrator.",
    "prompt": "Slow, gentle orbit left. The storyteller speaks softly, pauses for emphasis, then smiles slightly while the camera settles on a front view."
  },
  {
    "name": "Company onboarding & training",
    "description": "Introduce employees, welcome new customers and explain procedures.",
    "prompt": "Static eye-level medium shot. The presenter greets the viewer warmly, offers one short open-hand gesture, then nods as the message ends."
  },
  {
    "name": "Multilingual information videos",
    "description": "Record an authorized voice track in the target language and animate a speaker accordingly.",
    "prompt": "Static medium close-up. The presenter speaks clearly and naturally to camera with relaxed shoulders and a friendly expression, ending with a small nod."
  },
  {
    "name": "Game characters & virtual hosts",
    "description": "Animate licensed fictional characters, mascots or game announcers.",
    "prompt": "Gentle push-in. The fictional host speaks with playful excitement, first raises a hand in greeting, then turns slightly toward the viewer."
  },
  {
    "name": "Real estate & local businesses",
    "description": "Welcome prospective visitors or explain the features of a business.",
    "prompt": "Eye-level medium shot. The host speaks warmly, makes one small inviting gesture toward the room, then returns their gaze to camera."
  },
  {
    "name": "Event announcements & invitations",
    "description": "Announce performances, launches, community events or celebrations.",
    "prompt": "Slow push-in from a medium shot. The host speaks excitedly, first smiles and gestures toward the audience, then looks into the lens at the end."
  },
  {
    "name": "Nonprofit & awareness campaigns",
    "description": "Communicate a message using properly authorized portraits and fact-checked claims.",
    "prompt": "Static medium shot. The presenter speaks sincerely, places one hand over the heart for a moment, then addresses the viewer with steady eye contact."
  },
  {
    "name": "Personal messages & celebrations",
    "description": "Create original greetings, birthday videos or private announcements.",
    "prompt": "Gentle handheld medium shot. The speaker smiles as they talk, briefly waves hello, then looks back into the camera and laughs softly."
  }
];
const steps=[
 ["Choose your image first","A sharp, well-lit face with visible mouth works best for spoken or sung lines. A wide/full-body action needs more of the body visible."],
 ["Use clear audio","Choose an original or properly licensed MP3/WAV or supported M4A with a clear speaking or singing voice. Trim a short 5–10-second segment first."],
 ["Write a short scene, not keywords","Describe camera, emotion, 'speaks' or 'sings', and up to two or three visible actions in natural English. Avoid describing clothes or details already in the image."],
 ["Give movements an order","Write 'first', 'then' and 'finally' to choreograph continuous actions. Say whether the gesture comes before, during or after the line."],
 ["Describe the final framing","Specify speed and where the camera should finish: for example, 'slowly move forward and settle on a medium close-up of the face'."],
 ["Keep the first attempt simple","Prefer one main camera move per short clip; rapidly stacking zoom, pan, orbit and walking can reduce identity and background stability."],
 ["Review the exact instructions","The Studio prompt field accepts up to 500 characters. Copy a complete example, adjust it to your photo and audio, then check what Studio will submit."],
 ["Watch and refine","Results are generative and never guaranteed. Review lips, face, hands, background, audio and framing, and change one instruction at a time."]
];
const issues=[
 ["My face looks different","Try a clear frontal reference, Static camera, shorter head turns and a smaller movement arc."],
 ["The motion is ignored","Use one short, direct action and describe the endpoint. Try a 5–10-second excerpt rather than stacking many moves."],
 ["The background flickers","Reduce orbiting, camera travel and full-body gestures. Start with a medium shot and a simple background."],
 ["The mouth doesn't animate naturally","Use a clearly audible voice, visible lips and explicitly say 'the singer sings' or 'the speaker talks'."],
 ["Two people are talking","Start with one clearly identified speaker and a silent reacting character. Alternating dialogue and independently animated speakers require separate workflows and are not guaranteed in the current Studio."],
 ["The subject walks out of frame","Ask the camera to keep the subject centered and finish in a medium shot; avoid exiting and re-entering the frame."],
 ["A fast movement looks broken","Replace whip pans, large orbits and complex zoom combinations with a slow, small movement; assemble transitions from separate clips if needed."]
];
const readyToCopy="Slow push-in from a medium shot to a medium close-up. The singer performs warmly and sings to the camera. First they smile, then place one hand over their heart, and finally look directly into the lens as the camera settles on their face.";
const continuous="Static medium shot. The presenter speaks to the camera confidently. First they raise one hand to greet the audience, then lower it and explain the main point, and finally smile and nod at the end.";
const beforeAfter="The singer first looks toward the window and takes a breath. Then they turn to the camera and begin singing, gently lifting one hand during the final phrase. The camera stays in a medium shot.";
const twoCharacters="Static medium shot. Only the presenter on the right speaks calmly to the camera. The person on the left listens, nods once, and smiles without speaking.";
export default function CameraMovementsHelp(){
 return <div className="sm-legal sm-camera-guide">
  <SiteHeader/>
  <main id="content" className="sm-legal-main sm-camera-main">
   <nav className="sm-camera-breadcrumb" aria-label="Guide navigation"><Link href="/help">Help & best practices</Link><Link href="/faq">FAQ</Link></nav>
   <header className="sm-legal-intro sm-camera-intro">
    <span className="sm-legal-kicker">SINGMOTION AI · CREATIVE GUIDE</span>
    <h1>Camera movements & prompts<span>.</span></h1>
    <p>Make an image come alive with clear camera direction, continuous movements, gestures, emotions and a strong speaking or singing performance.</p>
    <small>Every example is an editable English prompt for SingMotion Studio. Prompts are creative guidance, not guaranteed camera controls. No example videos are included.</small>
   </header>
   <div className="sm-camera-callout">
    <Camera size={23} aria-hidden="true"/>
    <div><strong>The best prompt is a short, natural scene.</strong>
     <p>Camera movement → emotion → say who speaks or sings → specific actions in order → optional background action. A clear start, speed and end frame are more useful than a list of camera keywords.</p>
    </div>
   </div>
   <section className="sm-legal-panel">
    <span className="sm-legal-num">01 / HOW TO WRITE A PROMPT</span>
    <h2>One scene. One camera move. A clear sequence.</h2>
    <p>In <Link href="/studio">Studio</Link>, choose your own music or spoken audio and a reference image. Then use the <strong>Performance prompt</strong> field. The <strong>Camera Movements</strong> buttons insert editable camera directions, and the Advanced camera menu offers presets. For the most reliable interpretation, spell out the movement in your prompt rather than relying only on a preset label.</p>
    <p>Write who is performing and whether they are <strong>singing, rapping or speaking</strong>. Describe a couple of visible actions using <strong>first → then → finally</strong>. Specify how fast the camera moves and where it stops. Avoid contradicting the source image or asking for several unrelated scenes at once.</p>
    <div className="sm-camera-copy-example"><div><strong>Complete example to copy</strong><p>{readyToCopy}</p></div><PromptCopyButton text={readyToCopy} label="Copy complete performance example"/></div>
    <p className="sm-camera-fineprint">The Studio field currently accepts up to <strong>500 characters</strong>. The voice track determines the words; camera and gesture prompts direct the visual performance. They do not generate a new spoken script.</p>
   </section>
   <section className="sm-legal-panel" id="continuous-actions">
    <span className="sm-legal-num">02 / CONTINUOUS ACTIONS</span>
    <h2>What should happen first, then and finally?</h2>
    <p>Describe connected actions in the order they should occur. You can place a gesture before speech, during a lyric, or after speaking ends. Keep the sequence achievable in your selected audio length.</p>
    <div className="sm-camera-copied-examples">
     <div className="sm-camera-copy-example"><div><strong>Speak while gesturing</strong><p>{continuous}</p></div><PromptCopyButton text={continuous} label="Copy continuous actions prompt"/></div>
     <div className="sm-camera-copy-example"><div><strong>Gesture first, sing next</strong><p>{beforeAfter}</p></div><PromptCopyButton text={beforeAfter} label="Copy gesture then singing prompt"/></div>
     <div className="sm-camera-copy-example"><div><strong>Two people in one image</strong><p>{twoCharacters}</p><small>One designated speaker is a safer starting point than an alternating conversation. Distinct speakers and simultaneous vocal tracks are not a verified control in this Studio flow.</small></div><PromptCopyButton text={twoCharacters} label="Copy one-speaker group prompt"/></div>
    </div>
   </section>
   <section className="sm-camera-section" id="camera-movements">
    <div className="sm-camera-section-title"><span className="sm-legal-num">03 / CAMERA MOVEMENTS</span><h2>Camera moves and copy-ready instructions</h2>
     <p>Start with a SingMotion preset or a simple push-in. Advanced camera terms are creative experiments, not extra buttons or guaranteed features. Match each move to what is visible in your reference image.</p>
    </div>
    <div className="sm-camera-techniques">{techniques.map((t,i)=><article key={t.name} className="sm-camera-technique">
     <div className="sm-camera-technique-top"><span className="sm-camera-number">{String(i+1).padStart(2,"0")}</span><div><h3>{t.name}</h3><small>{t.level} · {t.where}</small></div></div>
     <p>{t.text}</p>
     <div className="sm-camera-prompt-top"><strong>Copy this prompt</strong><PromptCopyButton text={t.example} label={"Copy "+t.name+" prompt"}/></div>
     <blockquote>{t.example}</blockquote>
     <p className="sm-camera-risk"><TriangleAlert size={16} aria-hidden="true"/>{t.risk}</p>
    </article>)}</div>
   </section>
   <section className="sm-legal-panel">
    <span className="sm-legal-num">04 / WORKFLOW</span><h2>Make the first attempt count</h2>
    <div className="sm-camera-checklist">{steps.map(([heading,body])=><div key={heading}><CheckCircle2 size={19} aria-hidden="true"/><div><h3>{heading}</h3><p>{body}</p></div></div>)}</div>
    <p><Music2 size={17} style={{display:"inline",verticalAlign:"middle",marginRight:6}} aria-hidden="true"/><strong>Media uploads:</strong> MP3, WAV or audio-only M4A up to 50 MB, plus JPEG or PNG up to 30 MB. Provider and generation limits can be stricter; not every uploaded file can be rendered as a video.</p>
   </section>
   <section className="sm-legal-panel">
    <span className="sm-legal-num">05 / FIX COMMON PROBLEMS</span><h2>If the camera or performance looks wrong</h2>
    <div className="sm-camera-questions">{issues.map(([title,answer])=><details key={title}><summary>{title}</summary><p>{answer}</p></details>)}</div>
   </section>
   <section className="sm-legal-panel">
    <span className="sm-legal-num">06 / RIGHTS & SAFETY</span><h2>Publish responsibly</h2>
    <p>Use only songs, photos, recordings and voices you have permission to animate and publish. Never imply that a real person endorsed a product or reported an event without authorization. Label synthetic presenters and manipulated news-style footage when required, verify claims, and follow platform advertising rules.</p>
    <p>See <Link href="/rights">Media rights</Link>, <Link href="/ai-transparency">AI transparency</Link> and <Link href="/privacy">Privacy</Link>. No example videos or links to external platforms are included in this guide.</p>
   </section>
   <section className="sm-camera-section" id="ideas">
    <div className="sm-camera-section-title"><span className="sm-legal-num">07 / WHAT ELSE CAN YOU MAKE?</span>
     <h2>Creative uses for SingMotion</h2><p>These are ideas for turning a photo and your own licensed audio into a performed video. They are not promises of native integrations with outside apps, guaranteed exports to social platforms, or automatically enabled paid rendering.</p></div>
    <div className="sm-camera-techniques sm-camera-uses">{useCases.map((idea,i)=><article className="sm-camera-technique" key={idea.name}>
     <div className="sm-camera-technique-top"><span className="sm-camera-number">{String(i+1).padStart(2,"0")}</span><h3>{idea.name}</h3></div>
     <p>{idea.description}</p>
     <div className="sm-camera-prompt-top"><strong>Prompt idea</strong><PromptCopyButton text={idea.prompt} label={"Copy "+idea.name+" prompt"}/></div>
     <blockquote>{idea.prompt}</blockquote>
    </article>)}</div>
    <p className="sm-camera-fineprint">A synthetic voiceover created in another app can be uploaded as a supported audio file if you have the necessary rights. This does not mean those apps are directly connected to SingMotion.</p>
   </section>
   <div className="sm-camera-bottom"><Link href="/studio"><Clapperboard size={18}/> Try a prompt in Studio <ArrowRight size={17}/></Link><Link href="/help">More help</Link></div>
  </main>
 </div>;
}
