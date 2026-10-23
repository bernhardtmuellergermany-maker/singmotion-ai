import Link from "next/link";
import { ArrowRight, ArrowUpRight, LockKeyhole } from "lucide-react";
import { PerformanceStudy } from "./performance-study";
import { Brand } from "../brand";
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
  const defaultHeader = [
    { label: "How it works", url: "/#how" },
    { label: "Possibilities", url: "/#possibilities" },
    { label: "Help", url: "/help" },
  ];
  const defaultFooter = ["privacy", "terms", "legal", "rights", "contact"].map(
    (p) => ({
      label:
        p === "legal" ? "Legal notice" : p.charAt(0).toUpperCase() + p.slice(1),
      url: `/${p}`,
    }),
  );
  const links = (items: unknown) =>
    Array.isArray(items)
      ? items.map((item: { label: string; url: string }, i: number) =>
          safeLink(item.url) ? (
            <Link key={i} href={item.url}>
              {item.label}
            </Link>
          ) : null,
        )
      : null;
  return (
    <div
      className={`marketing premium-site ${isHome ? "home-site" : ""}`}
      id="content"
    >
      <header className="marketing-header">
        <Brand />
        <nav aria-label="Website navigation">
          {links(nav?.header?.links?.length ? nav.header.links : defaultHeader)}
        </nav>
        <Link className="button subtle" href="/studio">
          Open studio
        </Link>
      </header>
      <main>
        {isHome && (
          <div className="availability-note">
            <span className="status-dot" /> Private demo available{" "}
            <span>·</span> Live AI rendering is not enabled
          </div>
        )}
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
          if (secondary && i === 1) return null;
          switch (b.blockType) {
            case "hero":
              return (
                <section className="hero" key={i}>
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
                      <p className="hero-trust">
                        <LockKeyhole size={14} /> Private uploads. No payment
                        required for the demo.
                      </p>
                    )}
                  </div>
                  <PerformanceStudy />
                </section>
              );
            case "cards":
              return (
                <section
                  className="how-section"
                  id={
                    isHome && i === 2
                      ? "how"
                      : isHome && i === 3
                        ? "possibilities"
                        : undefined
                  }
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
      <footer>
        <Brand />
        <div>
          {links(nav?.footer?.links?.length ? nav.footer.links : defaultFooter)}
        </div>
        <small>{nav?.copyright || "SingMotion AI · Development preview"}</small>
      </footer>
    </div>
  );
}
