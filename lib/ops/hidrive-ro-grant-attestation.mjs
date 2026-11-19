/**
 * Independent OAuth scope proof for a dedicated rclone HiDrive read-only grant.
 * Reads a caller-owned 0600 config ONLY inside the trusted recovery runtime.
 * Nothing credential-bearing may be logged, committed, or sent to ChatGPT.
 */
const refuse = (code) => { throw Error(code); };
function readRemoteSection(configText, sectionName) {
  if (typeof configText !== "string" || configText.length > 256 * 1024 ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(sectionName))
    refuse("RCLONE_CONFIG_INVALID");
  let inTarget = false, matched = false;
  const options = new Map();
  for (const raw of configText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) {
      inTarget = section[1] === sectionName;
      if (inTarget) {
        if (matched) refuse("RCLONE_REMOTE_DUPLICATE");
        matched = true;
      }
      continue;
    }
    if (!inTarget) continue;
    const index = line.indexOf("=");
    if (index < 1) refuse("RCLONE_CONFIG_INVALID");
    const key = line.slice(0,index).trim();
    const value = line.slice(index+1).trim();
    if (!/^[a-z_]+$/.test(key) || options.has(key))
      refuse("RCLONE_CONFIG_INVALID");
    options.set(key,value);
  }
  if (!matched) refuse("RCLONE_REMOTE_MISSING");
  return options;
}

/** The callback must send the token directly to HiDrive tokeninfo, not ChatGPT. */
export async function attestHiDriveReadOnlyGrant({configText,remoteName,tokeninfo}) {
  if (typeof tokeninfo !== "function") refuse("TOKENINFO_REQUIRED");
  const options = readRemoteSection(configText,remoteName);
  if (options.get("type") !== "hidrive" ||
      options.get("scope_access") !== "ro" ||
      (options.has("scope_role") && options.get("scope_role") !== "user") ||
      options.has("client_credentials") ||
      options.has("auth_url") || options.has("token_url") ||
      options.has("endpoint") ||
      options.has("chunk_size") || options.has("upload_cutoff") ||
      options.has("upload_concurrency"))
    refuse("READONLY_RCLONE_SCOPE_REQUIRED");
  // A new OAuth grant is required. CLI flags alone cannot downgrade an RW grant.
  let parsed;
  try { parsed = JSON.parse(options.get("token") ?? ""); }
  catch { refuse("READONLY_TOKEN_INVALID"); }
  if (!parsed || typeof parsed.access_token !== "string" ||
      parsed.access_token.length < 10 ||
      typeof parsed.refresh_token !== "string" || parsed.refresh_token.length < 10)
    refuse("READONLY_TOKEN_INVALID");
  let info;
  try { info = await tokeninfo(parsed.access_token); }
  catch { refuse("TOKENINFO_UNAVAILABLE"); }
  const scopes = typeof info?.scope === "string" ?
    info.scope.split(",").map(x=>x.trim().toLowerCase()) : [];
  if (scopes.length !== 2 ||
      new Set(scopes).size !== 2 ||
      !scopes.includes("ro") || !scopes.includes("user") ||
      !Number.isSafeInteger(info.expires_in) || info.expires_in <= 60 ||
      typeof info.alias !== "string" || !info.alias ||
      typeof info.client_id !== "string" || !info.client_id)
    refuse("HIDRIVE_GRANTED_SCOPE_NOT_READONLY");
  if (options.has("client_id") && options.get("client_id") !== info.client_id)
    refuse("HIDRIVE_CLIENT_ID_MISMATCH");
  // No token, refresh token, alias, client ID or private folder is returned.
  return {grantReadOnlyVerified:true,scope:"user,ro"};
}
