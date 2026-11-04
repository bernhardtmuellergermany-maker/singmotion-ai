import {createHash,timingSafeEqual} from "node:crypto";

/** Deterministic integrity record for a private, one-shot CMS backup.
 * SHA-256 does not replace an encrypted, offsite disaster recovery backup.
 */
export function cmsArchiveDigest(bytes:Buffer):string{
 return createHash("sha256").update(bytes).digest("hex");
}
export function verifyCmsArchiveReadback(original:Buffer,readback:Buffer):boolean{
 const expected=Buffer.from(cmsArchiveDigest(original),"hex");
 const received=Buffer.from(cmsArchiveDigest(readback),"hex");
 return original.length===readback.length&&timingSafeEqual(expected,received);
}
export function hasChangedCmsVersions(
 recorded:unknown[],
 latest:unknown[],
 complete:boolean,
):boolean{
 return !complete||JSON.stringify(recorded)!==JSON.stringify(latest);
}
