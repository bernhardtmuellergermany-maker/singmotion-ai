import { stagingEnabled } from "./staging.ts";
type Environment = Record<string, string | undefined>;
// Trust only server configuration behind TLS termination, never forwarded headers.
export function applicationOrigin(
  requestUrl: string,
  host: string | null,
  env: Environment = process.env,
): string | null {
  const configured =
    env.APP_ORIGIN || (env.CMS_ENABLED === "true" ? env.CMS_ORIGIN : undefined);
  if (configured) {
    try {
      const url = new URL(configured);
      if (
        url.origin !== configured ||
        (url.protocol !== "https:" &&
          !(
            url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
          ))
      )
        return null;
      return url.origin;
    } catch {
      return null;
    }
  }
  if (stagingEnabled(env)) return null;
  // Preserve direct local/non-staging development without proxy-header trust.
  try {
    return new URL(`${new URL(requestUrl).protocol}//${host}`).origin;
  } catch {
    return null;
  }
}
