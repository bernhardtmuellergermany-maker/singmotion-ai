"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ensureSession, resetSession } from "@/lib/client";
import type { StudioDraftExport } from "@/lib/studio-draft";
import type { StudioProject } from "@/lib/live/studio";
import {quoteVideoCredits,VIDEO_CREDITS_PER_STARTED_SECOND} from "@/lib/commerce/video-credit-quote";
import {CustomerFeedback} from "./customer-feedback";
import {generationFeedback,requestErrorFeedback,type CustomerNotice} from "@/lib/live/customer-feedback";

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
    autoSubmitted = useRef(false),
    router = useRouter();
  const [rights] = useState(initialRights),
    [immediateStart,setImmediateStart] = useState(false),
    [withdrawalConsequences,setWithdrawalConsequences] = useState(false),
    [terms, setTerms] = useState(""),
    [plan, setPlan] = useState<StudioProject | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [checkoutStep,setCheckoutStep]=useState<"preparing"|"redirecting">("preparing"),
    [pilot, setPilot] = useState<boolean | null>(null),
    [superAdmin, setSuperAdmin] = useState(false),
    [availableCredits,setAvailableCredits] = useState<number|null>(null),
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
  useEffect(()=>{
    if(!superAdmin)return;
    let active=true;
    void fetch("/api/credit-balance",{cache:"no-store",credentials:"same-origin"})
      .then(async response=>{
        const result=await response.json() as {availableCredits?:number};
        if(active)setAvailableCredits(response.ok&&Number.isSafeInteger(result.availableCredits)&&typeof result.availableCredits==="number"&&result.availableCredits>=0?result.availableCredits:null);
      }).catch(()=>{if(active)setAvailableCredits(null);});
    return()=>{active=false;};
  },[superAdmin]);
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
  // The Studio review already displays the Credit price and captures rights.
  // Its "Generate Video" button is the only customer action required. Preserve
  // this dialog for actual preflight failures and the operator sign-in path.
  useEffect(()=>{
    if(autoSubmitted.current||!rights||!terms||pilot!==true||!superAdmin||
      !plan||plan.state!=="prepared"||!plan.digest||!plan.ceilingMicroUsd||
      plan.budgetBlocker||busy||lock.current||error||blockers.length||
      availableCredits===null||!creditQuote||availableCredits<creditQuote.credits)return;
    autoSubmitted.current=true;
    void act();
  },[rights,terms,pilot,superAdmin,plan,busy,error,blockers.length,availableCredits,creditQuote]);
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
  const creditQuote=quoteVideoCredits(selection.start,selection.end);
  const creditPrice=creditQuote?new Intl.NumberFormat("en-GB").format(creditQuote.credits)+" Credits":"Unavailable";
  const insufficient=superAdmin&&creditQuote!==null&&availableCredits!==null&&availableCredits<creditQuote.credits;
  const activeNotice:CustomerNotice|null=error?requestErrorFeedback(error,"generation"):
    insufficient&&creditQuote?generationFeedback("credits-needed",{credits:creditQuote.credits,status:"estimated"},availableCredits):
    busy?{key:"generation-submitting",kind:"info",title:"Checking your video request",message:"Your project and credit reservation are being checked. Keep this dialog open; a network interruption does not mean the request failed."}:
    null;
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
      <CustomerFeedback notice={activeNotice} context="generation"/>
      <div className="sm-confirm-summary">
        <div><span>Estimated video cost</span><strong>{creditPrice}</strong></div>
        <div><span>Duration</span><strong>{time(selectedSeconds)}</strong></div>
        <div><span>Song</span><strong className="sm-confirm-song" title={songName}>{songName}</strong></div>
      </div>
      {creditQuote&&<p className="sm-confirm-notice" role="status">Customer credit calculation: {creditQuote.sourceSeconds.toFixed(3)} selected source seconds → {creditQuote.startedSeconds} started seconds × {VIDEO_CREDITS_PER_STARTED_SECOND} Credits = <strong>{creditPrice}</strong>. Playback slow-down never increases this credit price. {customerFlow?"Customer credit-paid generation is not yet enabled, so this preview does not deduct Credits.":"Your available wallet Credits will be reserved before BytePlus submission and charged after verified video delivery."}</p>}
      <p className="sm-confirm-notice">{customerFlow?"Customer video generation with Credits is not yet enabled.":<>Your own wallet must contain enough available Credits. <Link href="/credits#buy-credits">Buy Credits</Link> if needed before confirming this operator generation. There is no additional Stripe charge at generation time.</>}</p>
      <p className="sm-confirm-links">View <Link href="/legal" target="_blank">Terms, Privacy &amp; Legals</Link></p>
      {pilot !== true && !customerFlow && (
        <form onSubmit={signInOperator} className="sm-confirm-notice" aria-label="Optional Super Admin sign-in">
          <p>Customer and guest video generation are not yet available. This separate operator login enables only authorised private testing; it does not enable customer credit billing. Your image and audio stay in the draft.</p>
          <label>Email <input type="email" name="email" autoComplete="username" required disabled={loginBusy}/></label>
          <label>Password <input type="password" name="password" autoComplete="current-password" required disabled={loginBusy}/></label>
          <button type="submit" className="product-secondary" disabled={loginBusy}>
            {loginBusy ? "Signing in…" : "Sign in as Super Admin"}
          </button>
        </form>
      )}
      {pilot === null && <p role="status" className="sm-confirm-notice">Checking availability…</p>}
      {pilot === false && !customerFlow && <p role="alert" className="sm-confirm-notice">Guest and customer video generation are not yet enabled here. The credit cost is an estimate; nothing is charged.</p>}
      {customerFlow && <p role={customerCheckoutEnabled ? "status" : "alert"} className="sm-confirm-notice">{customerCheckoutEnabled ? "The legacy per-video checkout is retired. Credit-based generation is not yet released." : (checkoutUnavailableReason || "Credit-based video generation is not enabled here. Nothing is charged.")}</p>}
      {!customerFlow && blockers.length > 0 && <p role="alert" className="sm-confirm-notice">{blockers.join(" ")}</p>}
      {plan?.budgetBlocker && <p role="alert" className="sm-confirm-notice">{plan.budgetBlocker}</p>}
      {error && <p className="sm-confirm-notice">Your original project remains saved. Check its status before trying another paid request.</p>}
      <div className="product-actions">
        <button type="button" className="product-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        {customerFlow ?
          <Link href="/credits#buy-credits" className="product-secondary" onClick={onClose}>Open Credits</Link> :
          <button type="button" className="product-primary" disabled={blocked||insufficient} onClick={()=>void act()}>{busy ? "Working…" : `Generate video · ${creditPrice}`}</button>}
      </div>
    </dialog>
  );
}
