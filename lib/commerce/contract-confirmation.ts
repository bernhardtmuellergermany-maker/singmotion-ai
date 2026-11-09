import {CommerceStore} from "./store.ts";
import {sendRightsEmail} from "./consumer-rights.ts";

/** Confirmation is delivered via email after verified settlement and before provider dispatch.
 * This is not a legal determination that the right of withdrawal has expired. */
export async function ensurePaidContractConfirmation(store:CommerceStore,orderId:string,env:NodeJS.ProcessEnv=process.env,sender:typeof fetch=fetch){
 if(!store.hasEarlyPerformanceConsent(orderId))return false; // Legacy paid orders cannot be retroactively consented.
 if(store.hasContractConfirmation(orderId))return true;
 const o=store.db.prepare("SELECT id,email,price_cents,currency,created,status FROM customer_orders WHERE id=?").get(orderId) as
  {id:string;email:string;price_cents:number;currency:string;created:number;status:string}|undefined;
 const consent=store.db.prepare("SELECT notice_version,acknowledged_at FROM customer_early_performance_consents WHERE order_id=?").get(orderId) as
  {notice_version:string;acknowledged_at:number}|undefined;
 if(!o||o.status!=="paid"||!consent||o.currency!=="EUR"||!Number.isSafeInteger(o.price_cents))return false;
 const text=[
  "SingMotion AI – Vertragsbestätigung für deine digitale Videobestellung",
  "","Bestellnummer: "+o.id,
  "Bestellt am (UTC): "+new Date(o.created).toISOString(),
  "Bezahlt: EUR "+(o.price_cents/100).toFixed(2),
  "Produkt: Individuell mit KI erstelltes Musikvideo aus den von dir geprüften Eingaben.",
  "Lieferung: digital über deinen privaten SingMotion-Bestellbereich nach Verarbeitung und Prüfung.",
  "","Deine getrennt erteilten Erklärungen vor dem Checkout:",
  "1. Ausdrückliche Zustimmung und Aufforderung zum Beginn der Videoerstellung vor Ablauf der Widerrufsfrist nach Zahlung.",
  "2. Kenntnisbestätigung über den möglichen Verlust des Widerrufsrechts bei nicht körperlichen digitalen Inhalten mit Beginn der Ausführung, wenn die gesetzlichen Voraussetzungen vorliegen; für Dienstleistungen gelten andere Erlöschensvoraussetzungen.",
  "Erklärungen gespeichert (UTC): "+new Date(consent.acknowledged_at).toISOString(),
  "Version: "+consent.notice_version,
  "","Wichtige Vertragsinformationen und Widerrufsbelehrung: https://singmotion.ai/withdrawal",
  "AGB: https://singmotion.ai/terms",
  "Anbieter: SingMotion AI, Bernhardt Müller, Erich-Kästner-Str. 37, 16312 Bernau bei Berlin, Deutschland.",
  "Kontakt: support@singmotion.ai",
  "Gesetzliche Ansprüche bei fehlerhafter oder nicht erbrachter Leistung bleiben bestehen.",
  "Diese Nachricht bestätigt den Vertrag und die abgegebenen Erklärungen. Sie behauptet nicht, dass ein Widerrufsrecht bereits erloschen sei."
 ].join("\n");
 const sent=await sendRightsEmail({to:o.email,subject:"SingMotion AI – Vertragsbestätigung "+o.id,text},env,sender);
 if(!sent)return false;
 store.markContractConfirmationSent(orderId);
 return true;
}
