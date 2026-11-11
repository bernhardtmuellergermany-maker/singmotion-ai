"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, MoreVertical, Play, UserRound } from "lucide-react";

type ShowcaseVideo = { id: string; title: string; src?: string; poster?: string };
const landscape: ShowcaseVideo[] = [
  { id: "landscape-1", title: "Music video showcase" },
  { id: "landscape-2", title: "Your next performance" },
  { id: "landscape-3", title: "The stage is yours" },
];
const portrait: ShowcaseVideo[] = [
  { id: "portrait-1", title: "Stunning creation 01" },
  { id: "portrait-2", title: "Stunning creation 02" },
  { id: "portrait-3", title: "Stunning creation 03" },
  { id: "portrait-4", title: "Stunning creation 04" },
];

function VideoTile({ item, active = true, vertical = false }: { item: ShowcaseVideo; active?: boolean; vertical?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active && videoRef.current) {
      videoRef.current.pause();
      // Reset play affordance when a different slide becomes active.
    }
  }, [active]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video || failed) return; // Empty mockup slots never pretend to play.
    if (video.paused) {
      void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  return (
    <div className={`sm-video-tile ${vertical ? "sm-video-portrait" : "sm-video-landscape"}`}>
      {item.src && !failed ? (
        <video
          ref={videoRef}
          src={item.src}
          poster={item.poster ?? "/media/landing-mobile-fallback.webp"}
          onError={() => { setFailed(true); setPlaying(false); }}
          playsInline
          preload="metadata"
          loop
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          aria-label={item.title}
        />
      ) : (
        <div className="sm-video-empty" role="img" aria-label={`${item.title}: video coming soon`} />
      )}
      {(!playing || !item.src || failed) && (
        <button
          type="button"
          className="sm-video-play"
          aria-label={item.src && !failed ? `Play ${item.title}` : `${item.title} — coming soon`}
          onClick={toggle}
          disabled={!item.src || failed}
        >
          <Play size={vertical ? 26 : 30} fill="currentColor" strokeWidth={1.5} />
        </button>
      )}
      <div className="sm-video-caption">
        <strong>SingMotion AI Showcase</strong>
        <span>{item.src ? item.title : "Coming soon"}</span>
      </div>
    </div>
  );
}

function Carousel({ items, portraitMode = false }: { items: ShowcaseVideo[]; portraitMode?: boolean }) {
  const [index, setIndex] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number; at: number } | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const goTo = useCallback((next: number) => {
    const normalized = Math.max(0, Math.min(items.length - 1, next));
    setIndex(normalized);
    const el = scroller.current;
    if (el) {
      const slide = el.children.item(normalized) as HTMLElement | null;
      if (slide) {
        el.scrollTo({
          left: portraitMode && window.matchMedia("(max-width: 700px)").matches ? 0 : slide.offsetLeft - el.offsetLeft,
          top: portraitMode && window.matchMedia("(max-width: 700px)").matches ? slide.offsetTop - el.offsetTop : 0,
          behavior: "smooth",
        });
      }
    }
  }, [items.length, portraitMode]);

  // Scroll snapping is native; the observer keeps dots and playback in sync.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const best = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (best) setIndex(Number((best.target as HTMLElement).dataset.index ?? 0));
      },
      { root, threshold: [0.5, 0.7, 0.9] },
    );
    Array.from(root.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, []);

  const mobilePortrait = () => portraitMode && window.matchMedia("(max-width: 700px)").matches;
  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!mobilePortrait()) return;
    touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, at: Date.now() };
  };
  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStart.current || !mobilePortrait()) return;
    const dy = event.touches[0].clientY - touchStart.current.y;
    const dx = event.touches[0].clientX - touchStart.current.x;
    if (index === 0 && (scroller.current?.scrollTop ?? 0) <= 1 && dy > 0 && dy > Math.abs(dx)) {
      setPullDistance(Math.min(100, dy * 0.45));
    } else {
      setPullDistance(0);
    }
  };
  const onTouchEnd = () => {
    if (pullDistance >= 70 && index === 0 && !refreshing) {
      setRefreshing(true);
      window.location.reload();
    }
    setPullDistance(0);
    touchStart.current = null;
  };

  return (
    <div className={`sm-carousel ${portraitMode ? "sm-carousel-portrait" : "sm-carousel-landscape"}`}>
      {portraitMode && <div className="sm-pull-indicator" aria-live="polite" style={{ opacity: pullDistance ? 1 : 0, transform: `translateY(${pullDistance}px)` }}>{refreshing ? "Refreshing…" : pullDistance >= 70 ? "Release to refresh" : "Pull down to refresh"}</div>}
      <div
        className="sm-carousel-track"
        ref={scroller}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        aria-label={portraitMode ? "Portrait music video carousel" : "Music video carousel"}
      >
        {items.map((item, i) => (
          <div className="sm-carousel-slide" data-index={i} key={item.id}>
            <VideoTile item={item} active={i === index} vertical={portraitMode} />
          </div>
        ))}
      </div>
      <div className="sm-carousel-controls">
        <button type="button" aria-label="Previous video" onClick={() => goTo(index - 1)} disabled={index === 0}><ChevronLeft size={22} /></button>
        <div className="sm-carousel-dots" role="group" aria-label="Choose video">
          {items.map((item, i) => <button type="button" key={item.id} className={i === index ? "is-active" : ""} aria-label={`Go to video ${i + 1}`} aria-current={i === index ? "true" : undefined} onClick={() => goTo(i)} />)}
        </div>
        <button type="button" aria-label="Next video" onClick={() => goTo(index + 1)} disabled={index === items.length - 1}><ChevronRight size={22} /></button>
      </div>
    </div>
  );
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollToCreations = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const target = document.getElementById("creations");
    if (!target) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      target.scrollIntoView();
      return;
    }
    const start = window.scrollY;
    const distance = target.getBoundingClientRect().top;
    const duration = 1100;
    let startTime: number | null = null;
    const animate = (now: number) => {
      if (startTime === null) startTime = now;
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      window.scrollTo(0, start + distance * eased);
      if (progress < 1) window.requestAnimationFrame(animate);
    };
    window.requestAnimationFrame(animate);
  };
  return (
    <div className="sm-landing" id="content">
      <header className="sm-header">
        <Link href="/" className="sm-logo">SingMotion <span>AI</span></Link>
        <div className="sm-header-actions">
          <div className="sm-menu-wrap">
            <button type="button" className="sm-round" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><MoreVertical size={21} /></button>
            {menuOpen && <nav className="sm-dropdown" aria-label="Main menu"><a href="#creations" onClick={() => setMenuOpen(false)}>Stunning creations</a><a href="#how" onClick={() => setMenuOpen(false)}>How it works</a><Link href="/help">Help</Link></nav>}
          </div>
          <Link href="/signin" className="sm-round" aria-label="Sign in"><UserRound size={21} /></Link>
        </div>
      </header>

      <main>
        <section className="sm-hero" aria-labelledby="sm-hero-title">
          <div className="sm-hero-copy">
            <h1 id="sm-hero-title">Turn your song into a <span>music<br className="sm-desktop-break" /> video.</span></h1>
            <p>With SingMotion AI — your song, your performance.</p>
            <Link href="/studio" className="sm-cta">Create your music video <ArrowRight size={19} /></Link>
          </div>
          <Carousel items={landscape} />
          <a className="sm-scroll-down" href="#creations" onClick={scrollToCreations} aria-label="Explore stunning creations"><ChevronDown size={22} /></a>
        </section>

        <section className="sm-creations" id="creations" aria-labelledby="sm-creations-title">
          <span className="sm-kicker">THE STAGE IS YOURS</span>
          <h2 id="sm-creations-title">Stunning <span>creations.</span></h2>
          <p className="sm-section-copy">From your sound to the spotlight. See what a single song can become.</p>
          <Carousel items={portrait} portraitMode />
        </section>

        <section className="sm-how" id="how" aria-labelledby="sm-how-title">
          <span className="sm-kicker">YOUR MUSIC. YOUR MOMENT.</span>
          <h2 id="sm-how-title">Your song deserves<br />to be <span>seen.</span></h2>
          <p>Bring the music. Choose your artist. Shape the performance. We give your imagination a stage.</p>
          <Link href="/studio" className="sm-cta">Create your music video <ArrowRight size={19} /></Link>
          <small>Development preview · Real AI-generated showcase videos coming soon.</small>
        </section>
      </main>
      <footer className="sm-footer">
        <Link href="/" className="sm-logo">SingMotion <span>AI</span></Link>
        <div>{["privacy", "terms", "legal", "rights", "contact"].map((p) => <Link key={p} href={`/${p}`}>{p === "legal" ? "Legal notice" : p[0].toUpperCase() + p.slice(1)}</Link>)}</div>
        <small>© {new Date().getFullYear()} SingMotion AI</small>
      </footer>
    </div>
  );
}
