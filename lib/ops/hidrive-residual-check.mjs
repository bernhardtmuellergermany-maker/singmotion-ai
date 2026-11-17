// Immutable scope: no caller-selected run/path, listing, write, or deletion.
import { createHash } from "node:crypto";
import { backupError, remoteHttp } from "./backup-errors.mjs";
export const residualNames = Object.freeze([
  "sm-be7fc257-d46d-49d9-92cd-f9cfd85da03e-eaf749d6-2f2a-4bc6-b1dc-1d3189d6013b.enc",
  "sm-be7fc257-d46d-49d9-92cd-f9cfd85da03e-d9925209-943f-445b-92d5-05f916669408.enc",
  "sm-be7fc257-d46d-49d9-92cd-f9cfd85da03e-COMMITTED.enc",
]);
export async function inspectResiduals(session, report = () => {}) {
  const results = [];
  for (const [index, name] of residualNames.entries()) {
    const response = await session.request(
      "GET",
      "/file",
      { path: session.dir + "/" + name },
      null,
    );
    if (response.status === 404) {
      await response.body?.cancel?.();
      results.push({ ordinal: index + 1, state: "absent" });
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel?.();
      throw remoteHttp(response.status);
    }
    const limit = index === 2 ? 16384 : 1048576;
    const advertised = response.headers?.get("content-length");
    if (
      advertised !== null &&
      advertised !== undefined &&
      (!/^\d+$/.test(advertised) || Number(advertised) > limit)
    ) {
      await response.body?.cancel?.();
      throw backupError("SIZE");
    }
    if (!response.body) throw backupError("INTEGRITY");
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > limit) throw backupError("SIZE");
      hash.update(chunk);
    }
    if (advertised != null && bytes !== Number(advertised))
      throw backupError("INTEGRITY");
    results.push({
      ordinal: index + 1,
      state: "present",
      bytes,
      sha256: hash.digest("hex"),
    });
  }
  // Emit only a completed inspection, never file paths or content.
  for (const result of results) report(result);
  return results;
}
