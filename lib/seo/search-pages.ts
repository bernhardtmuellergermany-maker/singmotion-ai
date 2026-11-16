import {stagingEnabled} from "../staging.ts";
import {PRODUCTION_RAILWAY_ENVIRONMENT_ID} from "../commerce/customer-live-config.ts";

export const SITE_ORIGIN="https://www.singmotion.ai";
export const SEO_TOPICS=["video","music","shorts","omnihuman"] as const;
export type SeoTopic=(typeof SEO_TOPICS)[number];
type Section={heading:string;body:string};
type Faq={question:string;answer:string};
type SearchTopic={
 slug:string;title:string;description:string;eyebrow:string;heading:string;
 intro:string;steps:Section[];benefits:Section[];faq:Faq[];footnote:string;
};
/** English-only, informative search pages: no translation pages or public checkout claims. */
export const SEO_CONTENT:Record<SeoTopic,SearchTopic>={
 video:{
   slug:"ai-video-generator",
   title:"AI Video Generator from Photo & Audio | SingMotion AI",
   description:"Create an AI performance video from your photo and song. Upload licensed audio, direct the scene and download your private MP4 when available.",
   eyebrow:"AI VIDEO FROM PHOTO & AUDIO",
   heading:"AI video generator for your photo and music",
   intro:"If you're looking to create an AI video without a film crew, SingMotion offers a focused workflow: animate a performer from a still photo using your own music or spoken audio and a scene prompt. It is not a general text-to-video tool; a visual reference and audio are the starting inputs.",
   steps:[
    {heading:"Choose your image",body:"Upload a clear portrait or performer photograph. Make sure you have permission to use the image and represent the person in generated media."},
    {heading:"Add music or spoken audio",body:"Bring a song, vocal performance or recording you own or have licensed. The supplied audio guides the timing and character of the video; SingMotion does not compose the track."},
    {heading:"Describe the scene",body:"Set the performance mood, framing and camera direction. When credit-funded generation is available to your account, your finished video can be accessed as a private MP4 project."}
   ],
   benefits:[
    {heading:"From picture to moving performance",body:"The photo provides the subject's look while AI creates an audiovisual interpretation. It should not be presented as authentic footage."},
    {heading:"Direct the feel",body:"A restrained close-up and a dramatic concert shot tell very different stories. Prompts let you specify the intended atmosphere and movement."},
    {heading:"Private project delivery",body:"Video projects are bound to their owner. Public showcase clips are separately approved; private renders are not made public by default."}
   ],
   faq:[
    {question:"Can one photo become an AI video?",answer:"Yes. SingMotion's performance workflow combines one image with audio you are entitled to use, rather than generating everything from text alone."},
    {question:"Does SingMotion generate the song?",answer:"No. You supply the song or recording. SingMotion turns that material and a visual reference into a video performance."},
    {question:"Can I use it before public checkout launches?",answer:"Availability is checked for each account and billing country. No live purchase starts unless the credit checkout has been explicitly enabled."}
   ],
   footnote:"Use only images, music and voices you have permission to process. Generated movements are interpretations, not real footage."
  },
 music:{
   slug:"ai-music-video-maker",
   title:"AI Music Video Maker with Your Song | SingMotion AI",
   description:"Turn your song into an AI music performance video using a performer photo and creative direction. Private MP4 delivery with verified credits.",
   eyebrow:"AI MUSIC VIDEO & SINGING PERFORMANCE",
   heading:"Turn your song into an AI music video",
   intro:"Your music can have a visual performance without booking a set. SingMotion's AI music video maker starts with a song you own or are licensed to use and a performer image. You direct the mood, movement and camera to produce a singing-performance interpretation rather than generic stock footage.",
   steps:[
    {heading:"Start with the track",body:"Bring a finished vocal recording or song with the required rights. Audio defines the performance's rhythm; it is not replaced with automatically composed music."},
    {heading:"Choose the performer photo",body:"Select a clear image to establish the character on screen. If the subject is a real person, obtain any necessary consent and publicity permissions."},
    {heading:"Direct the music video",body:"Describe the stage, atmosphere and camera movement. Eligible accounts can use prepaid credits for rendering and receive the completed MP4 in a private project."}
   ],
   benefits:[
    {heading:"Focus on the song",body:"The performance follows the audio you provide, making it useful for demos, visualizers and artist promotion where the singer is the central subject."},
    {heading:"Creative direction without a full shoot",body:"Try a cinematic close-up, concert lighting or a more intimate visual concept. AI output still needs creative review before publication."},
    {heading:"Plan short-form cutdowns",body:"Choose an appropriate composition for a teaser or vertical social clip. Upload and distribution to social platforms remain separate steps."}
   ],
   faq:[
    {question:"Can I make a singing video from my own track?",answer:"That is the primary workflow: combine your track, a performer image and a scene description for an AI-generated performance."},
    {question:"Is this a song or beat generator?",answer:"No. SingMotion animates performances around an audio track you supply; it does not create a new melody or replace a DAW."},
    {question:"Do I need a monthly subscription?",answer:"The intended public workflow uses prepaid credits for generation, not a required new recurring video subscription. Availability and price are checked within the account."}
   ],
   footnote:"Rights to music, portraits, voices and publicity must be cleared. Results are generated interpretations, not authentic recordings."
  },
 shorts:{
   slug:"tiktok-reels-shorts",
   title:"AI Videos for TikTok, Instagram Reels & Shorts | SingMotion",
   description:"Create vertical 9:16 AI music performance clips with your own song and photo, then download MP4s for TikTok, Reels or YouTube Shorts.",
   eyebrow:"VERTICAL AI MUSIC CLIPS · 9:16",
   heading:"AI music videos for TikTok, Reels and Shorts",
   intro:"Short-form music content benefits from a clear performer and a strong audio moment. SingMotion lets you build an AI singing-performance video from a photo and music you can legally use. Choose a vertical composition, direct the visual mood and download the completed clip for your own social publishing workflow.",
   steps:[
    {heading:"Pick a moment from your song",body:"A hook, chorus or expressive vocal phrase provides a clear starting point. Prepare and clear the music you want to share before generation."},
    {heading:"Compose for a vertical screen",body:"Choose the 9:16 orientation in the Studio where supported. Plan the face and key visual details for a narrow mobile display, with space for platform overlays."},
    {heading:"Review and upload separately",body:"Check the final MP4 for audio, framing, timing and platform rules. SingMotion does not automatically publish to TikTok, Instagram or YouTube."}
   ],
   benefits:[
    {heading:"TikTok music teasers",body:"Turn a distinctive part of your song into an artist-led AI performance that can serve as source material for a TikTok post."},
    {heading:"Instagram Reels concepts",body:"Use focused performer framing and movement for a vertical music visual. Review placement against Instagram's interface overlays."},
    {heading:"YouTube Shorts performance clips",body:"Make short visual moments from your own audio, then check the current Shorts length and music-use rules before publication."}
   ],
   faq:[
    {question:"Does SingMotion support vertical AI video?",answer:"The studio offers vertical 9:16 composition for suitable music-performance generations. Always review the final file for the intended platform."},
    {question:"Can I publish directly from SingMotion?",answer:"No automatic social upload is advertised. Download your private MP4 and handle editing and publishing in your own channels."},
    {question:"Will the video go viral?",answer:"No tool can guarantee views or reach. Creative fit, audience and platform distribution matter beyond video generation."}
   ],
   footnote:"TikTok, Instagram and YouTube are trademarks of their respective owners. SingMotion is not affiliated with them."
  },
 omnihuman:{
   slug:"omnihuman-ai-video",
   title:"OmniHuman AI Video with Photo & Audio | SingMotion",
   description:"Learn how SingMotion uses BytePlus OmniHuman 2.0 for AI singing-performance videos with your own photo, audio and scene direction.",
   eyebrow:"OMNIHUMAN · PHOTO-DRIVEN PERFORMANCE",
   heading:"OmniHuman AI videos for music performances",
   intro:"OmniHuman technology animates performances from an image and audio. SingMotion's reviewed Studio integrates BytePlus OmniHuman 2.0 as an external video provider for music-oriented creations. Upload a photo, bring your own track and describe a camera direction in SingMotion. This is an independent application, not the official BytePlus service.",
   steps:[
    {heading:"Provide the performer image",body:"Use an image you have rights to process. A clear portrait helps communicate who should appear in the generated performance."},
    {heading:"Add the audio reference",body:"Music or spoken audio shapes the timing and mood of the performance. SingMotion is not a voice cloning or music composition tool."},
    {heading:"Direct and review the scene",body:"Suggest movement, lighting and camera framing with a prompt. Review the generated result before sharing it as an AI-created clip."}
   ],
   benefits:[
    {heading:"Audio-led generation",body:"The workflow is driven by both a visual reference and an existing sound recording, rather than a text prompt alone."},
    {heading:"AI singer visuals",body:"An authorized artist portrait can be interpreted as a singing performer, but this output is not an authentic recording of that person."},
    {heading:"A separate creative workspace",body:"SingMotion adds account-bound projects, prepaid credit accounting and private media delivery around the provider workflow, subject to availability."}
   ],
   faq:[
    {question:"Is SingMotion the official OmniHuman website?",answer:"No. SingMotion is independent software with an integration for BytePlus OmniHuman 2.0 in its reviewed Studio workflow."},
    {question:"Does the OmniHuman workflow need audio?",answer:"Yes. SingMotion's music-performance flow uses a photo and a recording you are permitted to use, with optional scene guidance."},
    {question:"Can I impersonate a real singer?",answer:"Do not submit unlicensed music or imitate someone without the permissions required for the intended use. AI output must not be misrepresented as real footage."}
   ],
   footnote:"BytePlus and OmniHuman belong to their respective owner. SingMotion is not affiliated with or endorsed by BytePlus."
  }
};
export const SEO_GUIDES_HUB="/help/ai-video-guides";
export function seoPagePath(topic:SeoTopic){return "/help/"+SEO_CONTENT[topic].slug;}
export function resolveSeoTopic(slug:string):SeoTopic|null{
 return SEO_TOPICS.find(t=>SEO_CONTENT[t].slug===slug)??null;
}
export const SEO_PUBLIC_PATHS=[
 "/","/help","/help/camera-movements",SEO_GUIDES_HUB,
 ...SEO_TOPICS.map(seoPagePath)
];
/** Search indexing remains locked behind the existing independent public release. */
export function seoPubliclyIndexable(env:Record<string,string|undefined>=process.env){
 return env.RAILWAY_ENVIRONMENT_ID===PRODUCTION_RAILWAY_ENVIRONMENT_ID&&!stagingEnabled(env);
}
/** Exact canonical path allowlist; wallets, user media and checkouts are never indexed. */
export function seoIndexablePath(pathname:string,env:Record<string,string|undefined>=process.env){
 return seoPubliclyIndexable(env)&&SEO_PUBLIC_PATHS.includes(pathname);
}
