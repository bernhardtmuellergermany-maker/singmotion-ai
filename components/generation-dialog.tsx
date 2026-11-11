"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ensureSession, resetSession } from "@/lib/client";
import type { StudioDraftExport } from "@/lib/studio-draft";
import type { StudioProject } from "@/lib/live/studio";
const usd = (n: number) => `USD ${(n / 1000000).toFixed(2)}`;
export function GenerationDialog({
  selection,
  artistName,
  projectName,
  songName,
  requestKey,
  initialRights = false,
  onClose,
}: {
  selection: StudioDraftExport;
  artistName: string;
  projectName: string;
  songName: string;
  requestKey: string;
  initialRights?: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    lock = useRef(false),
    router = useRouter();
  const [rights, setRights] = useState(initialRights),
    [immediateStart,setImmediateStart] = useState(false),
    [withdrawalConsequences,setWithdrawalConsequences] = useState(false),
    [terms, setTerms] = useState(""),
    [plan, setPlan] = useState<StudioProject | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [checkoutStep,setCheckoutStep]=useState<"preparing"|"redirecting">("preparing"),
    [pilot, setPilot] = useState<boolean | null>(null),
    [superAdmin, setSuperAdmin] = useState(false),
    [loginBusy, setLoginBusy] = useState(false),
    [blockers, setBlockers] = useState<string[]>([]),
    [customerOrdersAvailable, setCustomerOrdersAvailable] = useState(false),
    [customerCheckoutEnabled,setCustomerCheckoutEnabled] = useState(false),
    [checkoutUnavailableReason,setCheckoutUnavailableReason] = useState(""),
    [savedOrderId,setSavedOrderId] = useState(""),
    [guestEmail,setGuestEmail] = useState(""),
    [guestAccessUrl,setGuestAccessUrl] = useState(""),
    [customerQuote, setCustomerQuote] = useState<{plan:string;includedBalanceSeconds:number;includedSeconds:number;extraSeconds:number;estimatedExtraPriceCents:number;estimatedBillableSeconds:number;promotion?:{discountCents:number;finalCents:number;kind:string;percent:number|null}|null}|null>(null),
    [promoCode,setPromoCode] = useState(""),
    [appliedPromo,setAppliedPromo] = useState(""),
    [promoError,setPromoError] = useState(""),
    [quotePending, setQuotePending] = useState(true);
  // CMS operators must never fall through to the public guest checkout.
  const operatorFlow=selection.owner.startsWith("cms-staff-");
  const customerFlow=!operatorFlow && customerOrdersAvailable;
  useEffect(() => {
    dialog.current?.showModal();
    let current = true;
    void fetch("/api/customer-orders", { cache: "no-store" })
      .then(async r => r.ok ? r.json() : null)
      .then(v => { if (current) {setCustomerOrdersAvailable(v?.available === true);setCustomerCheckoutEnabled(v?.checkoutEnabled===true);setCheckoutUnavailableReason(typeof v?.checkoutUnavailableReason==="string" ? v.checkoutUnavailableReason : "");} })
      .catch(() => {});
    void Promise.all([
      api<{ version: string }>("rights"),
      api<{
        pilot?: boolean;
        superAdmin?: boolean;
        available: boolean;
        blockers: string[];
      }>("studio-live"),
    ])
      .then(([t, r]) => {
        if (current) {
          setTerms(t.version);
          setPilot(r.pilot === true);
          setSuperAdmin(r.superAdmin === true);
          setBlockers(r.blockers || []);
        }
      })
      .catch(() => {
        if (current)
          setError("Could not load authorization. Please close and try again.");
      });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const seconds = selection.end - selection.start;
    if(operatorFlow){setQuotePending(false);setCustomerQuote(null);return ()=>{active=false};}
    void Promise.resolve().then(()=>{if(active){setQuotePending(true);setCustomerQuote(null);}});
    const query = new URLSearchParams({seconds:seconds.toFixed(3)});
    if(appliedPromo)query.set("promo",appliedPromo);
    void fetch(`/api/customer-quote?${query.toString()}`,{credentials:"same-origin",cache:"no-store"})
      .then(async response => {
        if(!response.ok){
          if(active && appliedPromo)setPromoError("Promotion unavailable for this video.");
          return null;
        }
        if(active)setPromoError("");
        return response.json();
      })
      .then(value => {if(active)setCustomerQuote(value?.estimateOnly===true ? value : null)})
      .catch(()=>{})
      .finally(()=>{if(active)setQuotePending(false)});
    return ()=>{active=false};
  },[selection.start,selection.end,appliedPromo,operatorFlow]);
  // Prepare and price server-side inside the same dialog once the operator
  // accepts the media rights. This is NOT a paid provider submission.
  useEffect(() => {
    if (
      !rights ||
      !terms ||
      customerFlow ||
      pilot !== true ||
      blockers.length ||
      plan ||
      busy ||
      error ||
      lock.current
    )
      return;
    lock.current = true;
    void Promise.resolve().then(()=>{if(lock.current)setBusy(true)});
    void api<StudioProject>("studio-live", {
      method: "POST",
      body: JSON.stringify({
        action: "prepare",
        requestKey,
        selection,
        artistName,
        projectName,
        consent: true,
        termsVersion: terms,
        english: true,
      }),
    })
      .then((prepared) => {
        setPlan(prepared);
      })
      .catch((cause) => {
        setError((cause as Error).message);
      })
      .finally(() => {
        lock.current = false;
        setBusy(false);
      });
  }, [
    rights,
    terms,
    customerFlow,
    pilot,
    blockers.length,
    plan,
    busy,
    error,
    selection,
    artistName,
    projectName,
    requestKey,
  ]);
  async function signInOperator(event: import("react").FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loginBusy) return;
    const form = event.currentTarget, data = new FormData(form);
    setLoginBusy(true); setError("");
    try {
      const response = await fetch("/api/cms/staff/login", {
        method: "POST", credentials: "same-origin",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({email: data.get("email"), password: data.get("password")}),
      });
      form.reset();
      if (!response.ok) throw Error("Super-Admin-Anmeldung fehlgeschlagen.");
      resetSession();
      const workspace=await ensureSession() as {owner?:string};
      if (!workspace.owner?.startsWith("cms-staff-"))
        throw Error("Private Super-Admin-Sitzung konnte nicht eingerichtet werden.");
      const access = await api<{pilot?: boolean; superAdmin?: boolean; blockers?: string[]}>("studio-live");
      setSuperAdmin(access.superAdmin === true);
      setPilot(access.pilot === true);
      setBlockers(access.blockers || []);
      if (!access.superAdmin || !access.pilot)
        throw Error("Dieses Konto ist nicht für private Super-Admin-Generierung freigegeben.");
    } catch (cause) { setError((cause as Error).message); }
    finally { setLoginBusy(false); }
  }
  // The order is committed server-side first; only Stripe's verified webhook
  // may settle payment and authorize paid video generation.
  async function openCustomerCheckout(orderId: string) {
    const response = await fetch("/api/stripe-checkout", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({orderId,immediateStart,acknowledgedWithdrawalConsequences:withdrawalConsequences}),
    });
    const body = await response.json() as {
      url?:unknown;error?:string;code?:string;
      stripeErrorCode?:string|null;stripeErrorParameter?:string|null;
      stripeFailureCategory?:string;
    };
    if (!response.ok || typeof body.url !== "string") {
      const details=body.code==="STRIPE_TEST_CHECKOUT_REJECTED"
        ? [body.stripeErrorCode,body.stripeErrorParameter,
            body.stripeFailureCategory && body.stripeFailureCategory!=="unclassified"
              ? "reason: "+body.stripeFailureCategory : null].filter(Boolean).join(" / ")
        : "";
      throw Error((body.error || "Secure Stripe Checkout is unavailable.")+
        (details?" Stripe diagnostic: "+details:""));
    }
    const url = new URL(body.url);
    if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" ||
        url.username || url.password)
      throw Error("Invalid Stripe Checkout destination.");
    window.location.assign(url.href);
  }
  async function prepareCustomerOrder() {
    if (busy || !rights || !immediateStart || !withdrawalConsequences || !customerOrdersAvailable || !customerCheckoutEnabled ||
        !terms || !customerQuote || quotePending ||
        promoCode.trim().toUpperCase() !== appliedPromo) return;
    setBusy(true);
    setCheckoutStep("preparing");
    setError("");
    try {
      // Guests retain their private upload workspace; resetting it would
      // orphan their verified assets and make delivery impossible.
      const workspace = await ensureSession() as {owner?:string};
      const account=workspace.owner?.startsWith("customer-")===true;
      if (!workspace.owner || selection.owner !== workspace.owner)
        throw Error("This project's private uploads belong to another session. Reopen Studio in the original browser.");
      if (!account && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail.trim()))
        throw Error("Enter a valid email address for your guest order confirmation.");
      if (savedOrderId && guestAccessUrl) {
        setCheckoutStep("redirecting");
        await openCustomerCheckout(savedOrderId);
        return;
      }
      let orderId = savedOrderId;
      if (!orderId) {
        const response = await fetch("/api/customer-orders", {
          method: "POST", credentials: "same-origin",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({
            projectId: requestKey, requestKey, draft: selection,
            consent: true, termsVersion: terms,
            ...(appliedPromo ? {promoCode: appliedPromo} : {}),
            ...(!account ? {email:guestEmail.trim()} : {}),
          }),
        });
        const result = await response.json() as {
          orderId?:string;error?:string;checkoutReady?:boolean;
          includedOnly?:boolean;promotionAwaitingActivation?:boolean;guestAccessUrl?:string;
        };
        if (!response.ok || !result.orderId)
          throw Error(result.error || "Order preparation failed.");
        orderId = result.orderId;
        setSavedOrderId(orderId);
        if (!result.checkoutReady) {
          // Never invite a guest to Stripe when the immutable server-side
          // reviewed quote is not yet eligible for paid checkout.
          if(result.guestAccessUrl)setGuestAccessUrl(result.guestAccessUrl);
          router.push(result.guestAccessUrl || `/orders/${orderId}`);
          return;
        }
        if(result.guestAccessUrl){
          // A guest must save the secret link before leaving for Stripe.
          setGuestAccessUrl(result.guestAccessUrl);
          return;
        }
      }
      setCheckoutStep("redirecting");
      await openCustomerCheckout(orderId);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function act(repeatOf?: string) {
    if (lock.current || !rights || !terms || !pilot || (blockers.length > 0 && !superAdmin)) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!plan || repeatOf) {
        const prepared = await api<StudioProject>("studio-live", {
            method: "POST",
            body: JSON.stringify({
              action: "prepare",
              requestKey,
              selection,
              artistName,
              projectName,
              consent: true,
              termsVersion: terms,
              english: true,
              ...(repeatOf ? { repeatOf } : {}),
            }),
        });
        setPlan(prepared);
        if (superAdmin && !repeatOf && prepared.state === "prepared" &&
            prepared.digest && prepared.ceilingMicroUsd && !prepared.providerJobId) {
          await api("studio-live", {
            method: "POST",
            body: JSON.stringify({
              action: "submit", id: prepared.id, digest: prepared.digest,
              ceilingMicroUsd: prepared.ceilingMicroUsd, consent: true,
              termsVersion: terms,
              confirmation: `CONFIRM PAID STUDIO ${prepared.id} ${prepared.digest} ${prepared.ceilingMicroUsd}${prepared.experimental ? " ACCEPT EXPERIMENTAL UNKNOWN DURATION FEES MEDIA" : ""}`,
            }),
          });
          router.push(`/projects/live_${prepared.id}`);
        }
        return;
      }
      if (
        plan.state !== "prepared" ||
        !plan.digest ||
        !plan.ceilingMicroUsd ||
        plan.budgetBlocker
      )
        throw Error(
          "This project cannot be submitted. Open its saved status or operator review.",
        );
      await api("studio-live", {
        method: "POST",
        body: JSON.stringify({
          action: "submit",
          id: plan.id,
          digest: plan.digest,
          ceilingMicroUsd: plan.ceilingMicroUsd,
          consent: true,
          termsVersion: terms,
          confirmation: `CONFIRM PAID STUDIO ${plan.id} ${plan.digest} ${plan.ceilingMicroUsd}${plan.experimental ? " ACCEPT EXPERIMENTAL UNKNOWN DURATION FEES MEDIA" : ""}`,
        }),
      });
      router.push(`/projects/live_${plan.id}`);
    } catch (e) {
      setError((e as Error).message);
      // Retain the exact saved plan on an uncertain HTTP result. Retrying this
      // id is idempotent; never prepare a replacement automatically.
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const blocked =
    busy ||
    !rights ||
    !terms ||
    pilot !== true ||
    (!superAdmin &&
      (blockers.length > 0 ||
        !plan ||
        (plan.state !== "prepared" ||
          !plan.digest ||
          !plan.ceilingMicroUsd ||
          !!plan.budgetBlocker)));
  const selectedSeconds = Math.max(0, selection.end - selection.start);
  const time = (seconds: number) => {
    const centis = Math.round(Math.max(0, seconds) * 100);
    return String(Math.floor(centis / 6000)).padStart(2, "0") + ":" +
      String(Math.floor((centis % 6000) / 100)).padStart(2, "0") + "." +
      String(centis % 100).padStart(2, "0");
  };
  return (
    <dialog ref={dialog} className="product-dialog product-theme sm-confirm-simple"
      onCancel={onClose} onClose={onClose} aria-labelledby="confirm-generation-title">
      <h2 id="confirm-generation-title">Confirm generation</h2>
      <div className="sm-confirm-summary">
        <div><span>{customerFlow && customerQuote ? "Estimated extra price (VAT included)" : "BytePlus-Basispreis (geschätzt, zzgl. möglicher Gebühren)"}</span><strong>{customerFlow && customerQuote ? new Intl.NumberFormat("en-IE",{style:"currency",currency:"EUR"}).format((customerQuote.promotion?.finalCents ?? customerQuote.estimatedExtraPriceCents)/100) : pilot === true ? (plan ? usd(plan.estimatedBaseMicroUsd) : `USD ${(selectedSeconds * 0.07).toFixed(2)}*`) : `USD ${(selectedSeconds * 0.07).toFixed(2)}*`}</strong></div>
        <div><span>Duration</span><strong>{time(selectedSeconds)}</strong></div>
        <div><span>Song</span><strong className="sm-confirm-song" title={songName}>{songName}</strong></div>
      </div>
      {customerFlow && customerQuote && <p className="sm-confirm-notice" role="status">Your {customerQuote.plan==="hobby"?"Hobby":"pay-as-you-go"} estimate: {customerQuote.estimatedBillableSeconds} chargeable seconds, {customerQuote.includedSeconds} included, {customerQuote.extraSeconds} payable. {customerQuote.plan==="hobby"?`${customerQuote.includedBalanceSeconds} included seconds currently available. `:""}This is not a final charge. Generated output duration may differ; the binding total must be confirmed before payment or generation.</p>}
      {customerFlow && selection.owner.startsWith("customer-") && <section aria-label="Promotion code" className="sm-confirm-notice">
        <label htmlFor="generation-promo-code">Promotion code (optional)</label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <input id="generation-promo-code" type="text" maxLength={40} autoComplete="off"
            value={promoCode} disabled={busy}
            onChange={e=>setPromoCode(e.target.value.toUpperCase())} placeholder="PROMO20"/>
          <button type="button" className="product-secondary" disabled={busy}
            onClick={()=>{setSavedOrderId("");setAppliedPromo(promoCode.trim().toUpperCase());}}>Apply code</button>
        </div>
        {customerQuote?.promotion && <p role="status">
          Coupon discount: €{(customerQuote.promotion.discountCents/100).toFixed(2)}.
          {customerQuote.promotion.finalCents===0 ? " Free video fulfillment requires separate authorization." : ""}
        </p>}
        {promoError && <p role="alert">{promoError}</p>}
        {promoCode.trim().toUpperCase()!==appliedPromo && <p role="status">Apply your code before saving this order.</p>}
      </section>}
      {!customerQuote && !quotePending && customerFlow && <p role="status" className="sm-confirm-notice">Your personal price is currently unavailable. No payment can be made here.</p>}
      <label className="consent sm-confirm-consent">
        <input type="checkbox" checked={rights} disabled={busy} onChange={e=>setRights(e.target.checked)}/>
        <span>I confirm that I own the rights or have permission to use this audio, image, and any depicted person(s).</span>
      </label>
      <p className="sm-confirm-links">View <Link href="/legal" target="_blank">Terms, Privacy &amp; Legals</Link></p>
      {customerFlow && !selection.owner.startsWith("customer-") && <div className="sm-confirm-notice">
        <label htmlFor="guest-buyer-email">E-Mail für die Gastbestellung</label>
        <input id="guest-buyer-email" type="email" autoComplete="email" required
          maxLength={254} disabled={busy || !!savedOrderId} value={guestEmail}
          onChange={e=>setGuestEmail(e.target.value)} placeholder="deine@email.de"/>
        <p>Kein Konto erforderlich. Speichere den privaten Bestelllink vor dem Bezahlen.</p>
        {guestAccessUrl&&<p role="status">
          Dein privater Bestelllink: <a href={guestAccessUrl}>{guestAccessUrl}</a>
          {" "}Bitte kopieren oder als Lesezeichen speichern, bevor du fortfährst.
        </p>}
      </div>}
      {customerFlow && <div className="sm-confirm-notice" aria-label="Early digital performance acknowledgements">
        <label className="consent sm-confirm-consent">
          <input type="checkbox" checked={immediateStart} disabled={busy} onChange={e=>setImmediateStart(e.target.checked)}/>
          <span>Ich verlange ausdrücklich, dass SingMotion AI nach bestätigter Testzahlung vor Ablauf der Widerrufsfrist mit der individuellen Videogenerierung beginnt.</span>
        </label>
        <label className="consent sm-confirm-consent">
          <input type="checkbox" checked={withdrawalConsequences} disabled={busy} onChange={e=>setWithdrawalConsequences(e.target.checked)}/>
          <span>Ich habe zur Kenntnis genommen, dass mein Widerrufsrecht bei digitalen Inhalten unter den gesetzlichen Voraussetzungen durch den Beginn der Ausführung erlöschen kann. Gesetzliche Rechte bei Mängeln bleiben erhalten.</span>
        </label>
      </div>}
      {pilot !== true && !customerFlow && (
        <form onSubmit={signInOperator} className="sm-confirm-notice" aria-label="Optionale Super-Admin-Anmeldung">
          <p>Die normale Gast- und Kundenbestellung ist hier derzeit nicht freigegeben. Eine Super-Admin-Anmeldung ist nur für den separat genehmigten Betreiberzugang vorgesehen; sie ersetzt keine Checkout-Freigabe. Bild und Audio bleiben erhalten.</p>
          <label>E-Mail <input type="email" name="email" autoComplete="username" required disabled={loginBusy}/></label>
          <label>Passwort <input type="password" name="password" autoComplete="current-password" required disabled={loginBusy}/></label>
          <button type="submit" className="product-secondary" disabled={loginBusy}>
            {loginBusy ? "Anmeldung läuft…" : "Als Super Admin anmelden"}
          </button>
        </form>
      )}
      {pilot === null && <p role="status" className="sm-confirm-notice">Checking availability…</p>}
      {pilot === false && !customerFlow && <p role="alert" className="sm-confirm-notice">Gast- und Kunden-Videobestellungen sind in dieser Umgebung noch nicht aktiviert. Der angezeigte Preis ist nur eine Schätzung; es wird keine Zahlung ausgelöst.</p>}
      {customerFlow && <p role={customerCheckoutEnabled ? "status" : "alert"} className="sm-confirm-notice">{customerCheckoutEnabled ? "Nach der bestätigten Stripe-Zahlung wird das Video privat verarbeitet und bereitgestellt." : (checkoutUnavailableReason || "Sicherer Checkout und BytePlus-Videogenerierung sind hier noch nicht freigegeben. Es erfolgt keine Zahlung.")}</p>}
      {!customerFlow && blockers.length > 0 && <p role="alert" className="sm-confirm-notice">{blockers.join(" ")}</p>}
      {plan?.budgetBlocker && <p role="alert" className="sm-confirm-notice">{plan.budgetBlocker}</p>}
      {error && <p role="alert" className="sm-confirm-notice">{error}</p>}
      <div className="product-actions">
        <button type="button" className="product-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        {customerFlow ?
          <button type="button" className="product-primary" disabled={busy || !customerCheckoutEnabled || !rights || !immediateStart || !withdrawalConsequences || !terms || !customerQuote || quotePending || (selection.owner.startsWith("customer-") && promoCode.trim().toUpperCase()!==appliedPromo) || (!selection.owner.startsWith("customer-") && !guestAccessUrl && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail.trim()))} onClick={()=>void prepareCustomerOrder()}>{busy ? (checkoutStep==="preparing" ? "Preparing order…" : "Opening Stripe Checkout…") : guestAccessUrl?"Continue to Stripe Checkout":"Generate Video"}</button> :
          <button type="button" className="product-primary" disabled={blocked} onClick={()=>void act()}>{busy ? "Working…" : "Generate video"}</button>}
      </div>
    </dialog>
  );
}
