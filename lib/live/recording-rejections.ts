/** Recording-specific moderation history. Unknown identity is not a positive match. */
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../domain.ts";
import { sha256File } from "./media.ts";
import type { LiveTestStore, Attempt } from "./store.ts";
import type { StudioDraftExport } from "../studio-draft.ts";
const hashValue = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const independentRecordingConfirmation =
  "INDEPENDENT_NEW_RECORDING_NOT_A_REJECTION_RETRY";
async function privateHash(root: string, file: string) {
  const base = await realpath(path.join(root, "media")),
    actual = await realpath(file);
  if (!actual.startsWith(base + path.sep))
    throw new AppError("Recording must remain in private storage.");
  return sha256File(actual);
}
async function identityState(
  root: string,
  store: LiveTestStore,
  songId: string,
  owner: string,
  hash: string,
  clipHash?: string,
) {
  const { asset, job } = await import("../db.ts");
  const hasProjects = !!store.db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='live_studio_projects'",
    )
    .get();
  const unknown: { id: string; createdAt: number; evidence: string }[] = [];
  for (const row of store.db
    .prepare("SELECT data FROM live_attempts ORDER BY id")
    .all() as { data: string }[]) {
    const a = JSON.parse(row.data) as Attempt;
    const result = store.firstTestResult(a.id)?.result;
    if (!(
      a.failureCode?.includes("REJECT") ||
      a.failureCode?.includes("PREFILTER")
      // A 50510 status-read response alone does not prove content rejection.
      // Preserve its task record for reconciliation without permanently
      // blacklisting the same recording.
    ))
      continue;
    const clipMatches = [
      a.media.audioSha256,
      a.media.tempo?.originalSha256,
    ].some(
      (h) =>
        hashValue(h) && (h === hash || (hashValue(clipHash) && h === clipHash)),
    );
    let oldSong = a.media.recording?.songId || a.media.tempo?.songId;
    if (!oldSong && hasProjects) {
      const project = store.db
        .prepare(
          "SELECT selection_json FROM live_studio_projects WHERE attempt_id=?",
        )
        .get(a.id) as { selection_json: string } | undefined;
      if (project) {
        try {
          oldSong = JSON.parse(project.selection_json).songId;
        } catch {
          /* unknown remains unknown */
        }
      }
    }
    if (!oldSong) {
      try {
        oldSong = job(a.media.sourceJobId, a.media.owner).songId;
      } catch {
        /* legacy draft may have no job mapping */
      }
    }
    const fullHashes = [
      a.media.recording?.sourceSha256,
      a.media.tempo?.sourceSha256,
    ].filter(hashValue);
    if (
      clipMatches ||
      fullHashes.includes(hash) ||
      (oldSong === songId && a.media.owner === owner)
    )
      throw new AppError(
        "[TEMPO_RECORDING_REJECTED] Tempo processing is blocked for a recording with a previous provider failure/rejection. A new upload ID, excerpt or tempo is not a moderation retry authorization.",
      );
    // Persisted source hashes are authoritative; different source IDs alone are not proof.
    if (new Set(fullHashes).size === 1) continue;
    if (!fullHashes.length && oldSong) {
      try {
        const prior = asset(oldSong, a.media.owner);
        if (prior.kind !== "audio")
          throw new Error("Invalid recording mapping");
        const priorHash = await privateHash(root, prior.path);
        if (priorHash === hash)
          throw new AppError(
            "[TEMPO_RECORDING_REJECTED] Tempo processing is blocked for a recording with a previous provider failure/rejection, including identical reuploads.",
          );
        continue;
      } catch (error) {
        if (
          error instanceof AppError &&
          error.message.startsWith("[TEMPO_RECORDING_REJECTED]")
        )
          throw error;
      }
    }
    unknown.push({
      id: a.id,
      createdAt: a.createdAt,
      evidence: row.data + JSON.stringify(result || null),
    });
  }
  return {
    unknown,
    digest: createHash("sha256").update(JSON.stringify(unknown)).digest("hex"),
  };
}
export async function checkRecordingRejections(
  root: string,
  store: LiveTestStore,
  songId: string,
  owner: string,
  hash: string,
  clipHash?: string,
) {
  const state = await identityState(root, store, songId, owner, hash, clipHash);
  // Unknown legacy identity is not evidence against this upload. Matching
  // source/clip hashes and owned source IDs still fail in identityState above.
  // Preserve every historical record; optional provenance reviews remain useful
  // audit evidence, but unrelated legacy records cannot lock new Studio jobs.
  return { unresolvedHistoricalRecords: state.unknown.length };
}
/** Explicit staff assessment of NEW content; never fills in or rewrites legacy provenance. */
export async function reviewIndependentRecording(
  root: string,
  store: LiveTestStore,
  selection: StudioDraftExport,
  owner: string,
  actor: string,
  evidence: unknown,
  confirmation: unknown,
) {
  if (selection.owner !== owner || !actor)
    throw new AppError("Recording review ownership mismatch.", 403);
  if (
    confirmation !== independentRecordingConfirmation ||
    typeof evidence !== "string" ||
    evidence.trim().length < 40 ||
    evidence.length > 2000
  )
    throw new AppError(
      "Provide a verifiable independent-recording evidence reference (40–2000 characters) and explicitly confirm it is not derived from a rejected recording. A generic acknowledgment is insufficient.",
    );
  const { asset } = await import("../db.ts");
  const source = asset(selection.songId, owner);
  if (source.kind !== "audio")
    throw new AppError("Choose your newly uploaded recording.");
  const hash = await privateHash(root, source.path);
  const state = await identityState(root, store, selection.songId, owner, hash);
  if (!state.unknown.length)
    return {
      message:
        "No unresolved recording identity applies. Review the video cost normally.",
    };
  if (
    !Number.isFinite(source.created) ||
    state.unknown.some(
      (a) => !Number.isFinite(a.createdAt) || source.created <= a.createdAt,
    )
  )
    throw new AppError(
      "Upload the independently sourced recording after the historical tasks before requesting this review. Upload time alone does not prove independence; verifiable source evidence is also required.",
    );
  store.db
    .exec(`CREATE TABLE IF NOT EXISTS live_recording_independence_reviews (
    id INTEGER PRIMARY KEY, owner TEXT NOT NULL, song_id TEXT NOT NULL, source_sha256 TEXT NOT NULL,
    legacy_digest TEXT NOT NULL, actor TEXT NOT NULL, evidence TEXT NOT NULL, confirmation TEXT NOT NULL,
    created_at INTEGER NOT NULL, UNIQUE(owner,song_id,source_sha256,legacy_digest)
  )`);
  store.db
    .prepare(
      "INSERT OR IGNORE INTO live_recording_independence_reviews (owner,song_id,source_sha256,legacy_digest,actor,evidence,confirmation,created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(
      owner,
      selection.songId,
      hash,
      state.digest,
      actor,
      evidence.trim(),
      confirmation,
      Date.now(),
    );
  return {
    message:
      "Independent-recording assessment saved for these exact uploaded bytes and retained legacy evidence. Legacy identity is still unresolved, not reconstructed. Review video cost again; no paid request was made. Known clip/source matches are still checked before submission.",
  };
}
