import "server-only";
import { getPayload } from "payload";
import config from "../payload.config";
import { hasRole, pageSlugs } from "./policy";
import { headers } from "next/headers";
export async function publishedPage(slug: string, preview = false) {
  if (process.env.CMS_ENABLED !== "true" || !pageSlugs.includes(slug))
    return null;
  const payload = await getPayload({ config });
  const user = preview
    ? (await payload.auth({ headers: await headers() })).user
    : undefined;
  if (preview && !hasRole(user, ["editor", "super-admin"])) return null;
  const result = await payload.find({
    collection: "pages",
    overrideAccess: false,
    user,
    where: preview
      ? { slug: { equals: slug } }
      : {
          and: [
            { slug: { equals: slug } },
            { _status: { equals: "published" } },
          ],
        },
    draft: preview,
    limit: 1,
    depth: 1,
  });
  return result.docs[0] || null;
}
export async function navigation() {
  if (process.env.CMS_ENABLED !== "true") return null;
  const payload = await getPayload({ config });
  return payload.findGlobal({
    slug: "site-navigation",
    overrideAccess: false,
    depth: 0,
  });
}
