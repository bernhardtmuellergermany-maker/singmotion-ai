// Pure policy helpers: never import provider adapters or expose server configuration.
export const contentRoles = ["super-admin", "editor"];
export function hasRole(user: unknown, roles: string[]): boolean {
  if (!user || typeof user !== "object") return false;
  const u = user as { collection?: string; role?: string };
  return u.collection === "staff" && roles.includes(u.role || "");
}
export function safeLink(value: unknown): boolean {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\s\\\u0000-\u001f]/.test(value)
  )
    return false;
  if (/^\/(?!\/)/.test(value) && !/%(?:2f|5c|0[0-9a-f]|1[0-9a-f])/i.test(value))
    return true;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}
export const pageSlugs = [
  "home",
  "pricing",
  "faq",
  "about",
  "contact",
  "help",
  "privacy",
  "terms",
  "legal",
  "rights",
];
export function cmsEnvironment(
  env: Record<string, string | undefined> = process.env,
) {
  if (env.CMS_ENABLED !== "true") return;
  if (!env.PAYLOAD_SECRET || env.PAYLOAD_SECRET.length < 32)
    throw new Error("CMS requires a strong PAYLOAD_SECRET.");
  if (!/^postgres(?:ql)?:\/\//.test(env.CMS_DATABASE_URL || ""))
    throw new Error(
      "CMS_DATABASE_URL must reference a dedicated PostgreSQL database.",
    );
  const origin = new URL(env.CMS_ORIGIN || "");
  if (
    origin.origin !== env.CMS_ORIGIN ||
    (origin.protocol !== "https:" &&
      !(
        env.CMS_LOCAL_TEST === "true" &&
        ["localhost", "127.0.0.1"].includes(origin.hostname)
      ))
  )
    throw new Error("CMS_ORIGIN must be an exact HTTPS origin.");
}
