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
export async function upload(file: File, kind: "audio" | "image", onProgress?: (percent: number) => void) {
  const form = new FormData();
  form.set("file", file);
  form.set("kind", kind);
  if (!onProgress) {
    return api<import("./domain").Asset>("assets", { method: "POST", body: form });
  }
  return new Promise<import("./domain").Asset>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/assets");
    xhr.timeout = 180000;
    xhr.upload.onprogress = event => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () => {
      let response: { error?: string } & Partial<import("./domain").Asset>;
      try { response = JSON.parse(xhr.responseText); }
      catch { reject(new Error("The server returned an invalid upload response. Please try again.")); return; }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(response.error || "Upload failed. Please try again."));
        return;
      }
      resolve(response as import("./domain").Asset);
    };
    xhr.onerror = () => reject(new Error("Network connection interrupted. Please try uploading again."));
    xhr.ontimeout = () => reject(new Error("Upload timed out. Please try again."));
    xhr.onabort = () => reject(new Error("Upload was interrupted. Please try again."));
    xhr.send(form);
  });
}

export function resetSession() {
  sessionPromise = undefined;
}

/** Report real bytes sent; once complete the server may still be processing metadata. */
export function uploadWithProgress(
  file: File,
  kind: "audio" | "image",
  onProgress: (percent: number | null) => void,
): Promise<import("./domain").Asset> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set("file", file);
    form.set("kind", kind);
    const request = new XMLHttpRequest();
    request.open("POST", "/api/assets");
    request.timeout = 180000;
    request.upload.addEventListener("progress", event => {
      onProgress(event.lengthComputable && event.total > 0
        ? Math.min(100, Math.round((event.loaded / event.total) * 100))
        : null);
    });
    request.upload.addEventListener("load", () => onProgress(100));
    request.addEventListener("load", () => {
      let data: {error?: string} & Partial<import("./domain").Asset>;
      try {
        data = JSON.parse(request.responseText) as typeof data;
      } catch {
        reject(new Error("Could not read the upload response. Please try again."));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(data.error || "Upload failed. Please try again."));
        return;
      }
      resolve(data as import("./domain").Asset);
    });
    request.addEventListener("error", () => reject(new Error("Upload interrupted. Check your connection and try again.")));
    request.addEventListener("timeout", () => reject(new Error("Upload timed out. Please try again.")));
    request.addEventListener("abort", () => reject(new Error("Upload cancelled.")));
    request.send(form);
  });
}
