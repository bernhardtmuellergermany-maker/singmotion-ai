"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { CONSENT_KEY, readConsent, serializeConsent, publicAnalyticsLocation, sanitizedReferrer, type Choice } from "@/lib/analytics/consent";
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
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";
  const [hash, setHash] = useState("");
  const key = CONSENT_KEY + (id ? ":" + id : ":preview");
  const [choice, setChoice] = useState<Choice | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState(false);
  const lastPage = useRef<string | null>(null);
  const initialized = useRef(false);
  const title = publicAnalyticsLocation(pathname ?? "", search, hash);
  const active = Boolean(id || preview);
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const sync = () => {
      setHash(location.hash);
      const current = readChoice(key);
      if (id && current !== "granted") {
        disable(id);
        clearAnalyticsCookies();
        if (initialized.current) {
          scriptRef.current?.remove();
          initialized.current = false;
          location.reload();
          return;
        }
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
    window.addEventListener("hashchange", sync);
    const pagehide = () => { if (id) disable(id); };
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted && initialized.current) location.reload();
      else sync();
    };
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    const timer = window.setInterval(sync, 60_000);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener("focus", sync);
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
      window.clearInterval(timer);
      if (id) disable(id);
    };
  }, [active, id, key]);

  useLayoutEffect(() => {
    if (!id) return;
    // The Google tag is never inserted before affirmative, current consent and a public route.
    // Recheck the real browser URL as well as React state. A query-bearing home URL may be a private workspace.
    const actualTitle = publicAnalyticsLocation(location.pathname, location.search, location.hash);
    if (!ready || choice !== "granted" || !title || !actualTitle || readChoice(key) !== "granted") {
      disable(id);
      lastPage.current = null;
      if (initialized.current && !actualTitle) {
        scriptRef.current?.remove();
        initialized.current = false;
        location.reload();
      }
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
        cookie_expires: 180 * 24 * 60 * 60,
        cookie_update: false,
        cookie_flags: "SameSite=Lax;Secure",
        page_location: page, page_title: title,
        page_referrer: sanitizedReferrer(document.referrer),
      });
      const script = document.createElement("script");
      script.async = true;
      script.referrerPolicy = "no-referrer";
      script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
      scriptRef.current = script;
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
  }, [id, ready, choice, title, pathname, search, hash, key]);

  useEffect(() => {
    if (!id) return;
    // When the loaded tag would otherwise survive a Next client navigation to a private view,
    // use a fresh document instead. Do not interfere with modified/new-tab/download clicks.
    const leave = (event: MouseEvent) => {
      if (!initialized.current || event.defaultPrevented || event.button !== 0 ||
          event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.download || (anchor.target && anchor.target !== "_self")) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || publicAnalyticsLocation(url.pathname, url.search, url.hash)) return;
      disable(id);
      event.preventDefault();
      event.stopPropagation();
      location.assign(url.href);
    };
    document.addEventListener("click", leave, true);
    return () => document.removeEventListener("click", leave, true);
  }, [id]);

  function choose(next: Choice) {
    if (next === "denied" && id) {
      disable(id);
      clearAnalyticsCookies();
    }
    try {
      if (next === "denied") localStorage.removeItem(key);
      localStorage.setItem(key, serializeConsent(next));
      setChoice(next);
      setError(false);
      setOpen(false);
      setDetailsOpen(false);
      // Unload an already loaded third-party tag after withdrawal.
      if (next === "denied" && initialized.current) {
        scriptRef.current?.remove();
        initialized.current = false;
        location.reload();
      }
    } catch {
      setError(true);
      setChoice(null);
      if (id) disable(id);
      if (next === "denied" && initialized.current) scriptRef.current?.remove();
    }
  }

  if (!active || !ready) return null;
  // Ask for consent on marketing pages; settings remain reachable on all site pages.
  const show = open || (!choice && Boolean(title));
  return <>
    {show ? <aside className={styles.panel} aria-label="Privacy preferences">
      <div className={styles.heading}>
        <h2><ShieldCheck size={17} aria-hidden="true"/>Privacy preferences</h2>
        <button type="button" className={styles.detailsToggle} aria-expanded={detailsOpen} aria-controls="sm-analytics-details" onClick={() => setDetailsOpen(value => !value)}>Details <ChevronDown size={14} aria-hidden="true" style={{transform: detailsOpen ? "rotate(180deg)" : undefined}}/></button>
      </div>
      <p className={styles.desktopCopy}>Essential technologies keep SingMotion working. With your permission, Google Analytics 4 measures visits, approximate country and traffic sources. Google may process browser data and identifiers outside the EEA. No advertising tracking.</p>
      <p className={styles.mobileSummary}>Optional Google Analytics measures visits, approximate location and traffic sources. Withdraw consent anytime in Privacy settings.</p>
      <div className={styles.mobileDetails} id="sm-analytics-details" hidden={!detailsOpen}>
        <p>Essential technologies keep SingMotion working. Google may process browser data and identifiers outside the EEA. Analytics cookies are configured for up to 180 days. No advertising tracking. Rejecting optional analytics does not restrict the service.</p>
      </div>
      {preview && !id && <p className={styles.preview}>Preview only: analytics is off. Nothing is sent to Google. We will ask again before activation.</p>}
      <div className={styles.actions}>
        <button type="button" onClick={() => choose("denied")}>Reject optional</button>
        <button type="button" onClick={() => choose("granted")}>Accept analytics</button>
      </div>
      <p className={styles.links}><a href="/privacy">Privacy policy</a><span aria-hidden="true">·</span><a href="/cookies">Cookie policy</a></p>
      {error && <p role="alert">Your choice could not be saved. Analytics remains off.</p>}
      {open && choice && <button type="button" className={styles.close} onClick={() => setOpen(false)}>Close settings</button>}
    </aside> : <button type="button" className={styles.settings} onClick={() => setOpen(true)}><ShieldCheck size={14} aria-hidden="true"/>Privacy settings</button>}
  </>;
}
