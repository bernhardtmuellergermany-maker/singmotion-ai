import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import path from "node:path";
import { AppError } from "../domain.ts";
import { LiveTestStore } from "./store.ts";
/** Remove offline review metadata before normal owned-asset deletion. Keep charged
 * reservations intact: a future authorized attempt requires operator reconciliation. */
export function removeOfflinePlans(dataDir: string, owner: string) {
  const file = path.join(dataDir, "live-test.sqlite");
  if (!existsSync(file)) return;
  const store = new LiveTestStore(file);
  try {
    store.removeUnsubmittedOwnerPlans(owner);
  } catch {
    throw new AppError(
      "A live-test record requires operator reconciliation before account deletion.",
      409,
    );
  } finally {
    store.close();
  }
}

/** Retain immutable operator inputs, including unpriced admin plans. Fail closed on unreadable ledgers. */
export function retainedInputPaths(dataDir: string): string[] {
  const file = path.join(dataDir, "live-test.sqlite");
  if (!existsSync(file)) return [];
  const ledger = new DatabaseSync(file, { readOnly: true });
  try {
    return (
      ledger.prepare("SELECT data FROM live_attempts").all() as {
        data: string;
      }[]
    ).flatMap(({ data }) => {
      const { media } = JSON.parse(data);
      return [media.imagePath, media.audioPath];
    });
  } finally {
    ledger.close();
  }
}
