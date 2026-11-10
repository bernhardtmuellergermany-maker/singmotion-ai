"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, resetSession } from "@/lib/client";
export function CustomerAccount() {
  const [state, setState] = useState<{
      enabled: boolean;
      authenticated?: boolean;
      emailVerification?: "pending"|"verified"|"legacy";
      balanceCents?: number;
    } | null>(null),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [mode, setMode] = useState("login"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice,setNotice] = useState(""),
    [guestOrderId,setGuestOrderId] = useState("");
  const refresh = useCallback(() => {
    return api<NonNullable<typeof state>>("account")
      .then(setState)
      .catch(() => setState({ enabled: false }));
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function resend(){
    if(busy)return;
    setBusy(true);setError("");setNotice("");
    try{const res=await fetch("/api/customer-email-verification",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"resend"})});
      const result=await res.json();if(!res.ok)throw Error(result.error||"Unable to resend");
      setNotice(result.message||"Check your inbox.");
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  async function adoptGuestVideo(e:import("react").FormEvent<HTMLFormElement>){
    e.preventDefault();if(busy)return;
    setBusy(true);setError("");setNotice("");
    try{
      const raw=guestOrderId.trim();
      const orderId=raw.startsWith("SM-")?raw.slice(3).toLowerCase():raw;
      if(!/^[a-f0-9-]{36}$/.test(orderId))throw Error("Bitte die vollständige Auftragsnummer eintragen.");
      const response=await fetch("/api/customer-guest-video-claim",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({orderId}),
      });
      const result=await response.json();
      if(!response.ok)throw Error(result.error||"Übernahme fehlgeschlagen");
      setNotice("Dein Gastvideo wurde deinem Konto zugeordnet. Öffne es in „Meine Videos“.");
      setGuestOrderId("");
    }catch(e){setError(e instanceof Error?e.message:"Übernahme fehlgeschlagen")}
    finally{setBusy(false)}
  }
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
          {state.emailVerification==="pending"&&<div role="status"><p>Email confirmation pending. Please check your inbox before paid ordering.</p><button className="product-secondary" type="button" disabled={busy} onClick={()=>void resend()}>Resend verification email</button></div>}
          {state.emailVerification==="verified"&&<p>✓ Email verified.</p>}
          <p>
            Payments are not enabled. Your private operator workspace and
            historical videos are separate from customer credit.
          </p>
          <section aria-label="Gastvideo ins Konto übernehmen">
            <h2>Gastvideo übernehmen</h2>
            <p>Du brauchst dieselbe bestätigte E-Mail-Adresse wie bei der Bestellung und Zugriff auf den privaten Bestelllink. Öffne den Link zuerst in diesem Browser. Falls er fehlt, nutze die E-Mail-Wiederherstellung auf der Bestellseite.</p>
            <form onSubmit={e=>void adoptGuestVideo(e)}>
              <label htmlFor="claim-guest-video-id">Auftragsnummer (SM-…)</label>
              <input id="claim-guest-video-id" value={guestOrderId}
                onChange={e=>setGuestOrderId(e.target.value)} required disabled={busy}
                placeholder="SM-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"/>
              <button type="submit" className="product-primary" disabled={busy || state.emailVerification==="pending"}>Gastvideo zu meinen Videos hinzufügen</button>
            </form>
          </section>
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
            New passwords require at least 20 characters. A confirmation email is sent to newly registered customer accounts.
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
      {notice&&<p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      <Link href="/admin/login">Private operator login</Link>
      <Link href="/studio">Back to Studio</Link>
    </section>
  );
}
