"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ensureSession } from "@/lib/client";

export function OperatorLogin() {
  const locked = useRef(false),
    router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="wizard-card operator-login">
      <h1>Private operator sign in</h1>
      <p>
        Use your approved operator account. An allowlisted editor can generate
        without Super Admin access.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (locked.current) return;
          locked.current = true;
          setBusy(true);
          setError("");
          const form = event.currentTarget,
            data = new FormData(form);
          try {
            const response = await fetch("/api/cms/staff/login", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: data.get("email"),
                password: data.get("password"),
              }),
            });
            // Payload issues an HTTP-only session cookie. Never retain its token in browser storage.
            form.reset();
            if (!response.ok)
              throw new Error(
                "Sign in failed. Check your operator account or try again later.",
              );
            await ensureSession();
            const access = await api<{ pilot?: boolean }>("studio-live");
            if (!access.pilot)
              throw new Error(
                "This account is not authorized for private generation. Contact your administrator.",
              );
            router.push("/");
            router.refresh();
          } catch (cause) {
            setError((cause as Error).message);
          } finally {
            locked.current = false;
            setBusy(false);
          }
        }}
      >
        <label>
          Email
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            disabled={busy}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={busy}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="product-primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in to Studio"}
        </button>
      </form>
      <p>Customer accounts cannot authorize private operator generation.</p>
      <Link href="/signin">Customer account</Link>
    </section>
  );
}
