import { publishedPage } from "@/cms/content";
import { Website } from "@/components/cms/website";
export const dynamic = "force-dynamic";
import Link from "next/link";
import {
  ArrowRight,
  AudioLines,
  ImagePlus,
  Clapperboard,
  ShieldCheck,
  ArrowUpRight,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { money, quote } from "@/lib/domain";
export async function generateMetadata() {
  const page = await publishedPage("home");
  return page ? { title: page.title, description: page.description } : {};
}
export default async function Home() {
  const page = await publishedPage("home");
  if (page) return <Website page={page} />;
  return (
    <div className="marketing" id="content">
      <header className="marketing-header">
        <Brand />
        <nav>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <Link href="/help">Help</Link>
        </nav>
        <Link href="/signin" className="button subtle">
          Sign in <ArrowUpRight size={16} />
        </Link>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="status-dot" /> A NEW STAGE FOR YOUR MUSIC
            </span>
            <h1>
              Your music.
              <br />
              Your artist.
              <br />
              <em>Your performance.</em>
            </h1>
            <p>
              Turn the song in your head into a performance you can see. Bring
              your own music, choose your artist, and make the moment yours.
            </p>
            <Link href="/studio" className="button primary large">
              Explore the studio <ArrowRight size={19} />
            </Link>
            <span className="quiet hero-note">
              Try the local demo. No payments. No live AI renders.
            </span>
          </div>
          <div className="hero-art">
            <div className="art-orbit" />
            <div className="art-mic">
              <div className="mic-head" />
              <div className="mic-stem" />
            </div>
            <span className="art-label">
              YOUR NEXT PERFORMANCE
              <br />
              <strong>Starts with a song.</strong>
            </span>
            <div className="art-bottom">
              <AudioLines size={23} />
              <span>Your sound. A new perspective.</span>
              <span className="pill">STUDIO 01</span>
            </div>
          </div>
        </section>
        <section className="how-section" id="how">
          <span className="eyebrow">FROM SONG TO SCENE</span>
          <h2>A little direction. A lot of possibility.</h2>
          <div className="feature-grid">
            {[
              [
                AudioLines,
                "01",
                "Bring your music",
                "Upload an MP3 or WAV and find the part that deserves its own moment.",
              ],
              [
                ImagePlus,
                "02",
                "Meet your artist",
                "Add your own reference image. Save your artist and come back to them for the next song.",
              ],
              [
                Clapperboard,
                "03",
                "Shape the performance",
                "Choose an emotion, set a camera direction, and review every detail before you create.",
              ],
            ].map(([Icon, n, title, desc]) => {
              const I = Icon as typeof AudioLines;
              return (
                <article key={String(n)}>
                  <div className="feature-top">
                    <I size={25} />
                    <span>{String(n)}</span>
                  </div>
                  <h3>{String(title)}</h3>
                  <p>{String(desc)}</p>
                </article>
              );
            })}
          </div>
        </section>
        <section className="pricing-section" id="pricing">
          <div>
            <span className="eyebrow">CLEAR FROM THE FIRST NOTE</span>
            <h2>Your vision. One clear price.</h2>
            <p>
              Illustrative customer pricing: {money(quote(10).cents)} for 10
              seconds, including German VAT when applicable. Duration determines
              your total; custom prompts cost nothing extra.
            </p>
            <p className="quiet">
              Prices and balances are simulated in this version. Live billing
              rules and any provider minimums remain subject to verification.
            </p>
          </div>
          <div className="price-card">
            <span>10-second reference</span>
            <strong>{money(quote(10).cents)}</strong>
            <span>720p · MP4 · 25 FPS intended output</span>
            <Link href="/studio" className="button primary">
              Try the demo <ArrowRight size={17} />
            </Link>
            <small>No charge. Fixed, labeled sample output.</small>
          </div>
        </section>
        <section className="example-section">
          <div>
            <span className="eyebrow">AN HONEST FIRST LOOK</span>
            <h2>A studio in the making.</h2>
            <p>
              Real singing examples will appear here after the live provider is
              validated. This included clip only demonstrates playback and
              download.
            </p>
            <span className="demo-badge">Demo sample · not AI generated</span>
          </div>
          <video
            controls
            preload="none"
            aria-label="Fixed SingMotion demo sample"
          >
            <source src="/media/demo.mp4" type="video/mp4" />
          </video>
        </section>
        <div className="trust-line">
          <ShieldCheck size={19} /> Your uploads stay private to your demo
          session. You stay in control.
        </div>
      </main>
      <footer>
        <Brand />
        <div>
          {["privacy", "terms", "legal", "rights", "contact"].map((p) => (
            <Link key={p} href={`/${p}`}>
              {p === "legal" ? "Legal notice" : p[0].toUpperCase() + p.slice(1)}
            </Link>
          ))}
        </div>
        <small>
          © {new Date().getFullYear()} SingMotion AI · Development preview
        </small>
      </footer>
    </div>
  );
}
