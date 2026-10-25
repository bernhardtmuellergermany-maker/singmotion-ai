/** Recovery-only worker: there is deliberately no submit/approve call here. */
import { existsSync } from "node:fs";
import path from "node:path";
import { openStudioStore } from "./studio.ts";
import { studioRuntime } from "./studio-runtime.ts";
let next = 0;
export async function pollStudioProjects(root: string) {
  if (
    process.env.BYTEPLUS_STUDIO_RECOVERY_ENABLED !== "true" ||
    Date.now() < next ||
    !existsSync(path.join(root, "live-test.sqlite"))
  )
    return;
  next = Date.now() + 30000;
  const runtime = studioRuntime(await openStudioStore(root), root);
  try {
    const rows = runtime.service.store.db
      .prepare(
        `SELECT p.attempt_id,p.owner FROM live_studio_projects p JOIN live_attempts a ON a.id=p.attempt_id WHERE json_extract(a.data,'$.state') IN ('submitted','processing') AND p.started_at>? ORDER BY a.rowid LIMIT 20`,
      )
      .all(Date.now() - 13 * 3600000) as {
      attempt_id: string;
      owner: string;
    }[];
    for (const row of rows)
      await runtime.service.poll(row.attempt_id, row.owner);
  } catch {
    console.warn("Studio recovery pending", { code: "STUDIO_RECOVERY_ERROR" });
  } finally {
    runtime.close();
  }
}
