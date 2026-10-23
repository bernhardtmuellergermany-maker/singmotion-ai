import Link from "next/link";
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
    <div className="marketing" id="content">
      <header className="marketing-header">
        <Brand />
        <nav>{links(nav?.header?.links)}</nav>
        <Link className="button subtle" href="/studio">
          Open studio
        </Link>
      </header>
      <main>
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
          switch (b.blockType) {
            case "hero":
              return (
                <section className="hero" key={i}>
                  <div className="hero-copy">
                    <span className="eyebrow">{b.eyebrow}</span>
                    <h1>{b.heading}</h1>
                    <p>{b.body}</p>
                    {b.url && safeLink(b.url) && (
                      <Link className="button primary large" href={b.url}>
                        {b.buttonLabel}
                      </Link>
                    )}
                  </div>
                  <div className="hero-art">
                    <div className="art-orbit" />
                    <div className="art-mic">
                      <div className="mic-head" />
                      <div className="mic-stem" />
                    </div>
                  </div>
                </section>
              );
            case "cards":
              return (
                <section className="how-section" key={i}>
                  <h2>{b.heading}</h2>
                  <div className="feature-grid">
                    {b.items?.map((item, j) => (
                      <article key={j}>
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
                <section key={i} className="pricing-section">
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
        <div>{links(nav?.footer?.links)}</div>
        <small>{nav?.copyright || "SingMotion AI · Development preview"}</small>
      </footer>
    </div>
  );
}
