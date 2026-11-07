import { getPayload } from "payload";
import config from "@payload-config";
import { RootPage, generatePageMetadata } from "@payloadcms/next/views";
import { importMap } from "../importMap";
export const dynamic = "force-dynamic";
type Props = {
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] }>;
};
export const generateMetadata = (args: Props) =>
  generatePageMetadata({ config, ...args });
export default async function Page(args: Props) {
  if (process.env.CMS_ENABLED !== "true") return <p>CMS disabled.</p>;
  const payload = await getPayload({ config });
  if (
    !(await payload.count({ collection: "staff", overrideAccess: true }))
      .totalDocs
  )
    return (
      <p>
        Administrator provisioning is required. Public registration is disabled.
      </p>
    );
  return RootPage({ config, importMap, ...args });
}
