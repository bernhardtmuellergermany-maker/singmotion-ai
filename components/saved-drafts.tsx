"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ensureSession } from "@/lib/client";
export function SavedDrafts() {
  const [drafts, setDrafts] = useState<
    {
      id: string;
      artistName: string;
      selection: { outputFormat?: string; start: number; end: number };
    }[]
  >([]);
  useEffect(() => {
    void ensureSession()
      .then(() => api<typeof drafts>("studio-drafts"))
      .then(setDrafts)
      .catch(() => {});
  }, []);
  return drafts.length ? (
    <section aria-label="Saved drafts">
      <h2>Drafts</h2>
      {drafts.map((d) => (
        <p key={d.id}>
          <Link href={`/studio?draft=${encodeURIComponent(d.id)}`}>
            {d.artistName} · {(d.selection.end - d.selection.start).toFixed(2)}s
            · {d.selection.outputFormat || "Original format"} — Continue editing
          </Link>
        </p>
      ))}
    </section>
  ) : null;
}
