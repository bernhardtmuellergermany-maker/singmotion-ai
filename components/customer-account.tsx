"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, resetSession } from "@/lib/client";
export function CustomerAccount() {
  const [state, setState] = useState<{
      enabled: boolean;
      authenticated?: boolean;
      balanceCents?: number;
    } | null>(null),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [mode, setMode] = useState("login"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(() => {
    return api<NonNullable<typeof state>>("account")
      .then(setState)
      .catch(() => setState({ enabled: false }));
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function submit(action: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("account", {
        method: "POST",
        body: JSON.stringify({ action, email, password }),
      });
      setPassword("");
      resetSession();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="wizard-card">
      <h1>Your account</h1>
      {!state ? (
        <p>Checking availability…</p>
      ) : !state.enabled ? (
        <p>
          Customer accounts are prepared but not activated. Payments and public
          generation are unavailable.
        </p>
      ) : state.authenticated ? (
        <>
          <p>
            Signed in. Recorded customer credit: EUR{" "}
            {((state.balanceCents || 0) / 100).toFixed(2)}.
          </p>
          <p>
            Payments are not enabled. Your private operator workspace and
            historical videos are separate from customer credit.
          </p>
          <button
            className="product-secondary"
            onClick={() => void submit("logout")}
            disabled={busy}
          >
            Log out
          </button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(mode);
          }}
        >
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={mode === "register" ? 20 : 1}
              maxLength={256}
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <p>
            New passwords require at least 20 characters. Email recovery is not
            connected yet.
          </p>
          <button className="product-primary" disabled={busy}>
            {mode === "register" ? "Create account" : "Log in"}
          </button>
          <button
            type="button"
            className="product-secondary"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "Register instead" : "Log in instead"}
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      <Link href="/admin/login">Private operator login</Link>
      <Link href="/studio">Back to Studio</Link>
    </section>
  );
}
