import "server-only";
import { getPayload } from "payload";
import config from "../payload.config";
import {
  defaultStudioContent,
  validTemplates,
  type StudioContent,
} from "../lib/studio-content";

export async function studioContent(): Promise<StudioContent> {
  if (process.env.CMS_ENABLED !== "true") return defaultStudioContent;
  try {
    const payload = await getPayload({ config });
    const content = await payload.findGlobal({
      slug: "studio-settings",
      overrideAccess: false,
      depth: 1,
    });
    const hero = content as typeof content & {
      heroHeading?: string | null;
      heroSubtitle?: string | null;
      heroImage?: number | string | { filename?: string | null; alt?: string | null } | null;
    };
    const image = typeof hero.heroImage === "object" ? hero.heroImage : null;
    const imageUrl = image?.filename
      ? `/api/cms/cms-assets/file/${encodeURIComponent(image.filename)}`
      : null;
    return {
      intro: content.intro || defaultStudioContent.intro,
      heroHeading: hero.heroHeading?.trim() || defaultStudioContent.heroHeading,
      heroSubtitle: hero.heroSubtitle?.trim() || defaultStudioContent.heroSubtitle,
      heroImageUrl: imageUrl,
      heroImageAlt: image?.alt || defaultStudioContent.heroImageAlt,
      performanceTemplates: validTemplates(content.performanceTemplates)
        ? content.performanceTemplates
        : defaultStudioContent.performanceTemplates,
      cameraTemplates: validTemplates(content.cameraTemplates)
        ? content.cameraTemplates
        : defaultStudioContent.cameraTemplates,
    };
  } catch {
    console.warn("STUDIO_CONTENT_UNAVAILABLE: using built-in Studio copy");
    return defaultStudioContent;
  }
}
