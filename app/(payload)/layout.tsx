import "@payloadcms/next/css";
import "./admin-theme.css";
import config from "@payload-config";
import { RootLayout, handleServerFunctions } from "@payloadcms/next/layouts";
import type { ServerFunctionClient } from "payload";
import { importMap } from "./admin/importMap";
const serverFunction: ServerFunctionClient = async (args) => {
  "use server";
  if (process.env.CMS_ENABLED !== "true") throw new Error("CMS disabled.");
  return handleServerFunctions({ ...args, config, importMap });
};
export default function Layout({ children }: { children: React.ReactNode }) {
  if (process.env.CMS_ENABLED !== "true")
    return (
      <html lang="en">
        <body>CMS disabled.</body>
      </html>
    );
  return (
    <RootLayout
      config={config}
      importMap={importMap}
      serverFunction={serverFunction}
    >
      {children}
    </RootLayout>
  );
}
