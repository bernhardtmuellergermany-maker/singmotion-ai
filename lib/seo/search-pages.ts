import {stagingEnabled} from "../staging.ts";
import {PRODUCTION_RAILWAY_ENVIRONMENT_ID} from "../commerce/customer-live-config.ts";

export const SITE_ORIGIN="https://www.singmotion.ai";
export const SEO_TOPICS=["video","music","shorts","omnihuman"] as const;
export type SeoTopic=(typeof SEO_TOPICS)[number];
export type SeoLocale="de"|"en";
type Section={heading:string;body:string};
type Faq={question:string;answer:string};
type LocalizedTopic={
 slug:string;title:string;description:string;eyebrow:string;heading:string;
 intro:string;steps:Section[];benefits:Section[];faq:Faq[];
 footnote:string;
};
export const SEO_CONTENT:Record<SeoTopic,Record<SeoLocale,LocalizedTopic>>={
 video:{
  de:{
   slug:"ki-video-erstellen",
   title:"KI Video erstellen aus Foto und Musik | SingMotion AI",
   description:"KI-Video aus eigenem Foto und Audio erstellen: SingMotion AI animiert eine Performance mit Musik, Prompt und privatem MP4-Download.",
   eyebrow:"KI-VIDEO AUS FOTO & AUDIO",
   heading:"KI Video erstellen – aus deinem Foto und deiner Musik",
   intro:"Du möchtest ein KI Video erstellen, ohne selbst zu filmen? SingMotion konzentriert sich auf einen klaren Anwendungsfall: Aus einem Bild der auftretenden Person, deiner eigenen Musik oder Sprachaufnahme und einer Szenenbeschreibung entsteht eine animierte Performance. Das ist kein allgemeiner Text-zu-Video-Generator: Foto und Audio gehören zum Workflow.",
   steps:[
    {heading:"Ein geeignetes Foto vorbereiten",body:"Wähle ein gut erkennbares Portrait oder Künstlerbild. Nutze ausschließlich Aufnahmen, für die du die nötigen Bild- und Persönlichkeitsrechte besitzt."},
    {heading:"Deinen Song oder deine Stimme hinzufügen",body:"Lade eigenes oder rechtmäßig lizenziertes Audio hoch. Die Tonspur gibt Timing und Stimmung der Videoperformance vor; sie wird nicht automatisch von SingMotion komponiert."},
    {heading:"Szene beschreiben und Ergebnis prüfen",body:"Beschreibe etwa Bühnenlicht, Bewegung oder Kameraperspektive. Nach einer verfügbaren, mit Credits bezahlten Generierung lässt sich das fertige Video im eigenen Projekt als MP4 abrufen."}
   ],
   benefits:[
    {heading:"Foto animieren statt aufwendiger Dreh",body:"Das Bild liefert die visuelle Vorlage; die generierte Bewegung wird passend zum Audio entwickelt. Das Ergebnis bleibt eine KI-Interpretation und ist keine echte Aufnahme des abgebildeten Menschen."},
    {heading:"Musik und Bild bewusst kombinieren",body:"Ein ruhiges Portrait mit einer Ballade braucht oft andere Kamerabewegungen als eine energiegeladene Bühnenperformance. Präzise Prompts helfen, die Richtung vorzugeben."},
    {heading:"Privater Arbeitsablauf",body:"Deine Projekte sind accountgebunden; fertige Videoausgaben werden geschützt ausgeliefert. Ein öffentlicher Showcase zeigt nur eigens dafür freigegebene Beispiele."}
   ],
   faq:[
    {question:"Kann ich aus einem einzigen Foto ein KI-Video machen?",answer:"Ja, ein Foto ist der visuelle Ausgangspunkt. Für SingMotions Audio-Performance-Workflow benötigst du zusätzlich eine eigene oder rechtmäßig nutzbare Audioaufnahme."},
    {question:"Erstellt SingMotion Musik automatisch?",answer:"Nein. SingMotion setzt deine vorhandene Musik oder Stimme als Performance-Video um. Die App ist kein eigenständiger Songgenerator."},
    {question:"Ist der KI-Video-Generator kostenlos?",answer:"Für echte Render-Aufträge ist ein verifiziertes Credit-Guthaben nötig, sobald der Kauf für dein Konto und Land freigeschaltet ist. Ohne Freigabe wird keine Zahlung gestartet."}
   ],
   footnote:"Hinweis: Keine Garantie für identische Mimik oder Bewegung. Nur eigene oder erlaubte Bilder, Stimmen und Musik verwenden."
  },
  en:{
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
  }
 },
 music:{
  de:{
   slug:"ki-musikvideo-erstellen",
   title:"KI Musikvideo erstellen – Song zu Video | SingMotion AI",
   description:"Eigenen Song als KI Musikvideo gestalten: Foto, Musik und Regie-Prompt kombinieren, singende Performance generieren und MP4 herunterladen.",
   eyebrow:"KI-MUSIKVIDEO & DIGITALER SÄNGER",
   heading:"KI Musikvideo erstellen: Gib deinem Song eine Bühne",
   intro:"Ein fertiger Song verdient mehr als ein statisches Coverbild. Mit SingMotion kannst du aus deiner Musik, einem Foto der Künstlerin oder des Künstlers und einem Regie-Prompt ein KI-Musikvideo entwickeln. Besonders geeignet ist das für visuelle Gesangsperformances, Singer-Songwriter-Projekte, Demos und künstlerische Clips.",
   steps:[
    {heading:"Mit deinem fertigen Song beginnen",body:"Wähle eine Audioaufnahme, an der du die nötigen Rechte besitzt. Vocals, Rhythmus und Ausdruck liefern die Grundlage; SingMotion ersetzt weder Produktion noch Mastering."},
    {heading:"Deinen Künstler zeigen",body:"Ein Portrait oder ein geeignetes Motiv definiert das Aussehen der auftretenden Figur. Für reale Personen müssen Bild- und Einwilligungsrechte vorhanden sein."},
    {heading:"Eine Performance inszenieren",body:"Wähle Stimmung, Licht, Kamera und Ausrichtung im Studio. Die KI animiert die visuelle Interpretation deiner Musik; abgeschlossene Ergebnisse werden als MP4 im eigenen Projekt abgelegt."}
   ],
   benefits:[
    {heading:"Musikvideo ohne Drehtag",body:"Du kannst eine Musikidee visualisieren, ohne ein eigenes Filmset aufzubauen. Das spart nicht automatisch alle Produktionsschritte, bietet aber einen anderen kreativen Einstieg."},
    {heading:"Gesang als Mittelpunkt",body:"Im Unterschied zu generischen Videoclips konzentriert sich das SingMotion-Studio auf die Figur, die deinen Song performt – mit Ausdruck, Bewegung und Kamera."},
    {heading:"Für Social-Clips und Musikprojekte",body:"Eine einzelne Performance kann als Ausgangspunkt für einen Künstler-Teaser oder ein vertikales Kurzvideo dienen. Prüfe Format, Dauer und Plattformrechte vor dem Veröffentlichen."}
   ],
   faq:[
    {question:"Wie erstelle ich ein KI Musikvideo mit meinem eigenen Song?",answer:"Lade eine berechtigte Audioaufnahme und ein passendes Bild hoch, beschreibe den gewünschten Auftritt und starte bei verfügbarer Freigabe eine credit-finanzierte Generierung."},
    {question:"Kann ich einen Sänger aus einem Foto animieren?",answer:"SingMotion ist auf foto- und audiogetriebene Musikperformances ausgelegt. Die generierte Figur ist eine KI-Interpretation und kann vom Original abweichen."},
    {question:"Brauche ich ein Abo?",answer:"Das neue Produktkonzept arbeitet mit vorausbezahlten Credits statt einem neuen verpflichtenden Monatsabo für den Video-Checkout. Kaufmöglichkeiten werden pro Konto geprüft."}
   ],
   footnote:"Musik-, Darsteller-, Bild- und Veröffentlichungslizenzen bleiben deine Verantwortung. Keine Behauptung einer garantierten Lippensynchronität."
  },
  en:{
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
  }
 },
 shorts:{
  de:{
   slug:"tiktok-reels-shorts",
   title:"KI Videos für TikTok, Reels & Shorts erstellen | SingMotion",
   description:"9:16 KI Musikclips für TikTok, Instagram Reels und YouTube Shorts vorbereiten: Song, Portrait, Performance und MP4.",
   eyebrow:"VERTIKALE MUSIKCLIPS · 9:16",
   heading:"KI Musikvideos für TikTok, Reels und Shorts",
   intro:"Auf TikTok, Instagram Reels und YouTube Shorts steht das vertikale Video im Mittelpunkt. SingMotion hilft dir, aus eigener Musik und einem Bild eine animierte Gesangsperformance als Grundlage für deinen Social-Media-Clip zu gestalten. Du entscheidest über Bildausschnitt und Stimmung – das fertige Video lädst du anschließend selbst hoch.",
   steps:[
    {heading:"Mit dem passenden Ausschnitt planen",body:"Überlege, welcher Songabschnitt die stärkste visuelle Aussage trägt. Der Ton sollte bereits bearbeitet und für die beabsichtigte Plattform freigegeben sein."},
    {heading:"Hochformat bewusst auswählen",body:"Das Studio unterstützt die Wahl einer vertikalen 9:16-Ausrichtung. Achte darauf, dass Gesicht und wichtige Elemente auch auf kleinen Smartphone-Displays sichtbar bleiben."},
    {heading:"MP4 prüfen und selbst veröffentlichen",body:"Nach der Generierung kontrollierst du Bild, Ton, Lesbarkeit und Plattformvorgaben. SingMotion bietet keinen behaupteten automatischen Upload oder garantierte Viralität."}
   ],
   benefits:[
    {heading:"TikTok-Musikvideo mit KI",body:"Nutze die KI-Performance als Grundlage für einen Song-Teaser oder einen artist-zentrierten Musikclip. Die Plattform entscheidet selbst über Darstellung und Reichweite."},
    {heading:"Instagram-Reels für Musiker",body:"Ein vertikaler Künstlerauftritt kann einen Refrain begleiten. Prüfe sichere Bildränder, insbesondere dort, wo Reels Bedienelemente einblendet."},
    {heading:"YouTube Shorts als Performance-Teaser",body:"Kurze Musikmomente lassen sich als Shorts aufbereiten. Videolänge und Urheberrecht müssen vor dem Hochladen zu den aktuellen YouTube-Regeln passen."}
   ],
   faq:[
    {question:"Kann ich ein KI Video im 9:16-Format erstellen?",answer:"Das SingMotion-Studio sieht eine vertikale Ausrichtung für Performance-Videos vor. Die tatsächliche Ausgabe hängt von der verfügbaren Generierung und dem geprüften Medienergebnis ab."},
    {question:"Lädt SingMotion automatisch auf TikTok oder Instagram hoch?",answer:"Nein. Du erhältst ein eigenes Projekt und ein privates Video zum Herunterladen; Upload, Schnitt und Veröffentlichung erfolgen außerhalb der App."},
    {question:"Kann ich aktuelle Chartmusik nutzen?",answer:"Nur mit den nötigen Musik-, Aufnahme- und Veröffentlichungsrechten. Plattforminterne Musiklizenzen decken nicht automatisch externe KI-Verarbeitung ab."}
   ],
   footnote:"TikTok, Instagram und YouTube sind Marken ihrer jeweiligen Inhaber. SingMotion ist nicht mit diesen Plattformen verbunden."
  },
  en:{
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
  }
 },
 omnihuman:{
  de:{
   slug:"omnihuman-ki-video",
   title:"OmniHuman KI Video mit Foto & Audio | SingMotion AI",
   description:"OmniHuman-basierte KI-Performance verstehen: Foto und Song für digitale Sänger und Musikvideos verwenden. SingMotion als eigenständiges Studio.",
   eyebrow:"OMNIHUMAN · FOTO ZU PERFORMANCE",
   heading:"OmniHuman für KI-Musikvideos und singende Portraits",
   intro:"OmniHuman ist eine Technologie für foto- und audiogesteuerte digitale Darstellungen. SingMotion integriert im geprüften Studio-Betrieb BytePlus OmniHuman 2.0 für animierte Performance-Videos. Du arbeitest dabei in der SingMotion-Oberfläche mit eigenen Bildern, Musik und Regieanweisungen. SingMotion ist eine unabhängige Anwendung und kein offizielles Produkt von BytePlus.",
   steps:[
    {heading:"Foto der Person hochladen",body:"Das Portrait gibt die Erscheinung vor. Je klarer die Bildvorlage und je eindeutiger die Rechte, desto besser lässt sich das kreative Ziel definieren."},
    {heading:"Audio als Bewegungsgrundlage verwenden",body:"Gesang oder Sprache gibt Takt und emotionalen Ausdruck vor. SingMotion generiert damit keine neue Stimme und bietet keine Erlaubnis zur Nachahmung fremder Personen."},
    {heading:"Kameraführung beschreiben",body:"Ein Prompt kann Atmosphäre, Bewegung und Kamera anregen. Das Resultat ist ein generiertes Video, das du vor der Weitergabe sorgfältig prüfen solltest."}
   ],
   benefits:[
    {heading:"Audio-driven statt reiner Textclip",body:"Der zentrale Unterschied ist die Verbindung von Bild und bestehendem Audio. SingMotion richtet sich vor allem an Musikperformances und Künstlerpräsentationen."},
    {heading:"Digitale Sänger mit Einwilligung",body:"Ein rechtmäßig verwendetes Künstlerbild kann als KI-Sänger interpretiert werden. Das ist keine Identitätsbestätigung oder echte Aufzeichnung."},
    {heading:"Eigenständiges SingMotion-Studio",body:"Die Oberfläche bündelt Credit-Buchhaltung, Projektverwaltung und private MP4-Ausgabe um die externe Video-Technologie. Provider-Verfügbarkeit und Freigabestatus werden vom System geprüft."}
   ],
   faq:[
    {question:"Ist SingMotion die offizielle OmniHuman-Seite?",answer:"Nein. SingMotion ist ein unabhängiges KI-Musikvideo-Studio, das BytePlus OmniHuman 2.0 als externe Video-Technologie in seinem geprüften Workflow einsetzt."},
    {question:"Welche Eingaben benötigt das OmniHuman-Video?",answer:"Für SingMotions Performance-Workflow werden ein Foto, deine berechtigt nutzbare Audiodatei und optional eine Szenenbeschreibung benötigt."},
    {question:"Kann ich fremde Stars oder Stimmen kopieren?",answer:"Nur wenn du alle nötigen Einwilligungen und Nutzungsrechte besitzt. Unautorisierte Nachahmung oder irreführende Aussagen über reale Personen sind nicht zulässig."}
   ],
   footnote:"OmniHuman und BytePlus sind Bezeichnungen des jeweiligen Anbieters. SingMotion ist weder ein offizieller BytePlus-Shop noch dessen Vertreter."
  },
  en:{
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
 }
};
export function seoPagePath(topic:SeoTopic,locale:SeoLocale){
 return "/"+locale+"/"+SEO_CONTENT[topic][locale].slug;
}
export function resolveSeoTopic(locale:SeoLocale,slug:string):SeoTopic|null{
 return SEO_TOPICS.find(t=>SEO_CONTENT[t][locale].slug===slug)??null;
}
export const SEO_PUBLIC_PATHS=[
 "/","/de","/en",...SEO_TOPICS.flatMap(t=>["de","en"].map(l=>seoPagePath(t,l as SeoLocale))),
 "/help/camera-movements"
];
/** Never expose sitemap entries in password-gated or non-Production environments. */
export function seoPubliclyIndexable(env:Record<string,string|undefined>=process.env){
 return env.RAILWAY_ENVIRONMENT_ID===PRODUCTION_RAILWAY_ENVIRONMENT_ID&&!stagingEnabled(env);
}
export function seoAlternates(topic:SeoTopic){
 return {de:seoPagePath(topic,"de"),en:seoPagePath(topic,"en"),"x-default":seoPagePath(topic,"en")};
}
