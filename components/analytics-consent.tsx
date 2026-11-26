"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CONSENT_KEY, readConsent, serializeConsent, publicAnalyticsPage, sanitizedReferrer, type Choice } from "@/lib/analytics/consent";
import styles from "./analytics-consent.module.css";

type GoogleWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void } & Record<string, unknown>;
const denied = { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" };
const analyticsOnly = { ...denied, analytics_storage: "granted" };
const google = () => window as unknown as GoogleWindow;
function readChoice(key: string) {
  try { return readConsent(localStorage.getItem(key)); } catch { return null; }
}
function disable(id: string) { google()["ga-disable-" + id] = true; }
function clearAnalyticsCookies() {
  for (const item of document.cookie.split(";")) {
    const name = item.split("=")[0]?.trim();
    if (!name || !/^(_ga(?:_[A-Z0-9]+)?|_gid|_gat(?:_.*)?)$/i.test(name)) continue;
    document.cookie = name + "=; Max-Age=0; Path=/; SameSite=Lax; Secure";
    if (location.hostname === "www.singmotion.ai" || location.hostname === "singmotion.ai") {
      document.cookie = name + "=; Max-Age=0; Path=/; Domain=singmotion.ai; SameSite=Lax; Secure";
    }
  }
}

export function AnalyticsConsent({ id, preview }: { id: string | null; preview: boolean }) {
  const pathname = usePathname();
  const key = CONSENT_KEY + (id ? ":" + id : ":preview");
  const [choice, setChoice] = useState<Choice | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const lastPage = useRef<string | null>(null);
  const initialized = useRef(false);
  const title = publicAnalyticsPage(pathname ?? "");
  const active = Boolean(id || preview);

  useEffect(() => {
    if (!active) return;
    const sync = () => {
      const current = readChoice(key);
      if (id && current !== "granted") {
        disable(id);
        if (initialized.current) clearAnalyticsCookies();
      }
      setChoice(current);
      setReady(true);
    };
    sync();
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null) sync();
    };
    window.addEventListener("storage", changed);
    window.addEventListener("focus", sync);
    const timer = window.setInterval(sync, 60_000);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener("focus", sync);
      window.clearInterval(timer);
      if (id) disable(id);
    };
  }, [active, id, key]);

  useLayoutEffect(() => {
    if (!id) return;
    // The Google tag is never inserted before affirmative, current consent and a public route.
    if (!ready || choice !== "granted" || !title || readChoice(key) !== "granted") {
      disable(id);
      lastPage.current = null;
      return;
    }
    const w = google();
    w["ga-disable-" + id] = false;
    const page = location.origin + (pathname ?? "/");
    if (!initialized.current) {
      w.dataLayer = w.dataLayer || [];
      w.gtag = function () { w.dataLayer?.push(arguments); };
      w.gtag("consent", "default", denied);
      w.gtag("consent", "update", analyticsOnly);
      w.gtag("js", new Date());
      w.gtag("config", id, {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        page_location: page, page_title: title,
        page_referrer: sanitizedReferrer(document.referrer),
      });
      const script = document.createElement("script");
      script.async = true;
      script.referrerPolicy = "no-referrer";
      script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
      document.head.appendChild(script);
      initialized.current = true;
    }
    if (lastPage.current !== page) {
      w.gtag?.("event", "page_view", {
        send_to: id, page_location: page, page_title: title,
        page_referrer: lastPage.current || sanitizedReferrer(document.referrer),
      });
      lastPage.current = page;
    }
    return () => { disable(id); };
  }, [id, ready, choice, title, pathname, key]);

  function choose(next: Choice) {
    if (next === "denied" && id) {
      disable(id);
      clearAnalyticsCookies();
    }
    try {
      localStorage.setItem(key, serializeConsent(next));
      setChoice(next);
      setError(false);
      setOpen(false);
      // Unload an already loaded third-party tag after withdrawal.
      if (next === "denied" && initialized.current) location.reload();
    } catch {
      setError(true);
      setChoice(null);
      if (id) disable(id);
    }
  }

  if (!active || !ready) return null;
  // Ask for consent on marketing pages; settings remain reachable on all site pages.
  const show = open || (!choice && Boolean(title));
  return <>
    {show ? <aside className={styles.panel} aria-label="Privacy preferences">
      <h2>Privacy preferences</h2>
      <p>Essential technologies keep your account and projects working. Optional Google Analytics measures visits and traffic sources only with your permission. Advertising tracking is not enabled.</p>
      {preview && !id && <p>Staging preview — no information is sent to Google.</p>}
      <p><a href="/privacy">Privacy policy</a> · <a href="/cookies">Cookie policy</a></p>
      <div className={styles.actions}>
        <button type="button" onClick={() => choose("denied")}>Reject optional</button>
        <button type="button" onClick={() => choose("granted")}>Accept analytics</button>
      </div>
      {error && <p role="alert">Your choice could not be saved. Analytics remains off.</p>}
      {open && choice && <button type="button" className={styles.close} onClick={() => setOpen(false)}>Close settings</button>}
    </aside> : <button type="button" className={styles.settings} onClick={() => setOpen(true)}>Privacy settings</button>}
  </>;
}
