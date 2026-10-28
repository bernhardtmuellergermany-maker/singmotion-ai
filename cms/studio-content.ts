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
      depth: 0,
    });
    return {
      intro: content.intro || defaultStudioContent.intro,
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
