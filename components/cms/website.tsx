import Link from "next/link";
import { ArrowRight, ArrowUpRight, LockKeyhole } from "lucide-react";

import { SiteHeader } from "../site-header";
import { SiteFooter, defaultFooterLinks } from "../site-footer";
import { navigation } from "../../cms/content";
import { safeLink } from "../../cms/policy";
// Deliberately no raw HTML, arbitrary CSS, scripts, or remote image URLs.
import type { Page } from "../../cms/payload-types";
export async function Website({
  page,
  preview = false,
}: {
  page: Page;
  preview?: boolean;
}) {
  const nav = await navigation();
  const isHome = page.slug === "home";
  // An optional CTA directly after the home hero becomes its editable secondary action.
  const secondary =
    isHome &&
    page.blocks?.[0]?.blockType === "hero" &&
    page.blocks?.[1]?.blockType === "cta"
      ? page.blocks[1]
      : null;
  // An existing Image block immediately following Hero (or its secondary CTA)
  // supplies CMS-owned artwork. No schema/data rewrite is needed.
  const artworkIndex = secondary ? 2 : 1;
  const artworkBlock =
    isHome &&
    page.blocks?.[0]?.blockType === "hero" &&
    page.blocks?.[artworkIndex]?.blockType === "image"
      ? page.blocks[artworkIndex]
      : null;
  const artwork =
    artworkBlock && typeof artworkBlock.image === "object"
      ? artworkBlock.image
      : null;
  const firstCards = page.blocks?.findIndex((b) => b.blockType === "cards");
  const headerLinks = nav?.header?.links || [];
  const studioLink = headerLinks.find((item) => item.url === "/studio") || {
    label: "Open studio",
    url: "/studio",
  };
  // Informational header links are retained in the footer, including custom URLs.
  const infoLinks = headerLinks.filter((item) => item.url !== "/studio");
  const footerLinks = [
    ...infoLinks,
    ...(nav?.footer?.links || []),
    ...defaultFooterLinks,
  ].filter(
    (item, i, all) => all.findIndex((other) => other.url === item.url) === i,
  );
  return (
    <div className={`marketing premium-site ${isHome ? "home-site" : ""}`}>
      <SiteHeader
        actions={
          <nav aria-label="Website navigation">
            <Link className="button subtle" href={studioLink.url}>
              {studioLink.label}
            </Link>
          </nav>
        }
      />
      <main id="content">
        {preview && <p role="status">Private draft preview — not published.</p>}
        {!page.blocks?.length && (
          <section className="hero">
            <div className="hero-copy">
              <h1>{page.title}</h1>
              <p>{page.description}</p>
            </div>
          </section>
        )}
        {page.blocks?.map((b, i) => {
          if ((secondary && i === 1) || (artworkBlock && i === artworkIndex))
            return null;
          switch (b.blockType) {
            case "hero":
              return (
                <section
                  className={
                    isHome && i === 0
                      ? "hero cinematic-hero"
                      : "hero content-hero"
                  }
                  key={i}
                >
                  <div className="hero-copy">
                    <span className="eyebrow">{b.eyebrow}</span>
                    <h1>{b.heading}</h1>
                    <p>{b.body}</p>
                    <div className="hero-actions">
                      {b.url && safeLink(b.url) && (
                        <Link className="button primary large" href={b.url}>
                          {b.buttonLabel}
                          <ArrowRight size={18} />
                        </Link>
                      )}
                      {secondary && safeLink(secondary.url) && (
                        <Link className="hero-secondary" href={secondary.url}>
                          {secondary.buttonLabel}
                          <ArrowUpRight size={16} aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                    {isHome && (
                      <p className="hero-availability">
                        Private demo available · Live AI rendering is not
                        enabled
                      </p>
                    )}
                    {isHome && (
                      <p className="hero-trust">
                        <LockKeyhole size={14} /> Private uploads. No payment
                        required for the demo.
                      </p>
                    )}
                  </div>
                  {isHome && i === 0 && (
                    <figure className="concert-artwork">
                      <img
                        src={
                          artwork?.filename
                            ? `/api/cms/cms-assets/file/${encodeURIComponent(artwork.filename)}`
                            : "/artwork/singmotion-concert-concept.png"
                        }
                        alt={
                          artwork?.alt ||
                          "Concept artwork: singer in purple and blue stage lighting with music and artist cards."
                        }
                        width={1672}
                        height={941}
                        fetchPriority="high"
                      />
                      <figcaption>
                        {artworkBlock?.caption && (
                          <span>{artworkBlock.caption} · </span>
                        )}
                        Concept artwork · Not a generated SingMotion result
                      </figcaption>
                    </figure>
                  )}
                </section>
              );
            case "cards":
              return (
                <section
                  className={`how-section ${isHome && i === firstCards ? "compact-how" : ""}`}
                  id={isHome && i === firstCards ? "how" : undefined}
                  key={i}
                >
                  <h2>{b.heading}</h2>
                  <div className="feature-grid">
                    {b.items?.map((item, j) => (
                      <article key={j}>
                        <span className="card-index" aria-hidden="true">
                          {String(j + 1).padStart(2, "0")}
                        </span>
                        <h3>{item.heading}</h3>
                        <p>{item.body}</p>
                      </article>
                    ))}
                  </div>
                </section>
              );
            case "image": {
              const image = typeof b.image === "object" ? b.image : null;
              return image?.filename ? (
                <figure key={i}>
                  <img
                    src={`/api/cms/cms-assets/file/${encodeURIComponent(image.filename!)}`}
                    alt={image.alt || ""}
                    style={{ maxWidth: "100%", height: "auto" }}
                  />
                  <figcaption>{b.caption}</figcaption>
                </figure>
              ) : null;
            }
            case "cta":
              return (
                <section key={i} className="pricing-section closing-cta">
                  <h2>{b.heading}</h2>
                  {b.url && safeLink(b.url) && (
                    <Link className="button primary" href={b.url}>
                      {b.buttonLabel}
                    </Link>
                  )}
                </section>
              );
            default:
              return (
                <section className="how-section" key={i}>
                  <h2>{b.heading}</h2>
                  <p style={{ whiteSpace: "pre-wrap" }}>{b.body}</p>
                </section>
              );
          }
        })}
      </main>
      <SiteFooter links={footerLinks} copyright={nav?.copyright || undefined} />
    </div>
  );
}
