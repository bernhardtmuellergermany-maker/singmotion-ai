export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${url}`, {
    ...init,
    headers: {
      ...(init?.body && typeof init.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}
let sessionPromise: Promise<unknown> | undefined;
export function ensureSession() {
  return (sessionPromise ??= api("session", { method: "POST" }).catch((e) => {
    sessionPromise = undefined;
    throw e;
  }));
}
export async function upload(file: File, kind: "audio" | "image") {
  const form = new FormData();
  form.set("file", file);
  form.set("kind", kind);
  return api<import("./domain").Asset>("assets", {
    method: "POST",
    body: form,
  });
}

export function resetSession() {
  sessionPromise = undefined;
}
