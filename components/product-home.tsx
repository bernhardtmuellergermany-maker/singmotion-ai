import Link from "next/link";
import { ArrowRight, Music2, ImageIcon, Sparkles } from "lucide-react";
import { ProductHeader } from "./product-header";
import type { Page } from "@/cms/payload-types";
export function ProductHome({ page }: { page: Page }) {
  const hero = page.blocks?.find((b) => b.blockType === "hero");
  const imageBlock = page.blocks?.find((b) => b.blockType === "image");
  const image =
    imageBlock && typeof imageBlock.image === "object"
      ? imageBlock.image
      : null;
  return (
    <div className="product-home product-theme">
      <ProductHeader />
      <main id="content" className="product-hero">
        <img
          className="product-art"
          src={
            image?.url?.startsWith("/") && !image.url.startsWith("//")
              ? image.url
              : "/artwork/singmotion-stage.webp"
          }
          alt=""
          fetchPriority="high"
        />
        <div className="product-hero-copy">
          <h1>
            {hero?.heading && hero.heading !== "Make your artist sing." ? (
              hero.heading
            ) : (
              <>
                Your music
                <br />
                <span>brought to life.</span>
              </>
            )}
          </h1>
          <p>
            {hero?.body &&
            hero.body !==
              "Turn your music and a single image into a lifelike singing performance with synchronized lip movements, expressive motion and natural stage presence."
              ? hero.body
              : "Upload a song, add an image, and create a stunning AI performance video."}
          </p>
          <Link href="/studio" className="product-primary">
            {hero?.buttonLabel && hero.buttonLabel !== "Create your music video"
              ? hero.buttonLabel
              : "Create your video"}{" "}
            <ArrowRight size={20} />
          </Link>
          <ul className="product-features">
            <li>
              <Music2 />
              Your song
            </li>
            <li>
              <ImageIcon />
              Your image
            </li>
            <li>
              <Sparkles />
              AI performance
            </li>
          </ul>
        </div>
        <small className="product-art-disclosure">
          Concept artwork · not a generated-video preview
        </small>
      </main>
      <footer className="product-home-footer">
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/contact">Contact</Link>
      </footer>
    </div>
  );
}
