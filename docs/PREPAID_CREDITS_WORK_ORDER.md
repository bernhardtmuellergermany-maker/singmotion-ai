# SingMotion AI — vollständiger Entwicklungsauftrag: Prepaid Credits, Stripe Wallet und BytePlus

**Stand: 12. November 2026 · Spezifikation und schrittweise Umsetzung.**

## 1. Ziel und verbindliche Grenzen

SingMotion stellt von Einzelzahlung pro Video auf ein **accountgebundenes Prepaid-Credit-System** um. Stripe lädt das Guthaben auf; BytePlus-Videojobs verbrauchen die Credits nach erfolgreicher, überprüfter Auslieferung. Zahlungen und aktive Provider-Jobs bleiben bis zur gesonderten Freigabe hinter den vorhandenen Launch-Gates. Dieses Dokument ist **keine Freigabe für echte Zahlungen, automatische Abbuchungen oder neue bezahlte BytePlus-Aufrufe**.

Bestehende Zahlungsmittel, bereits gekaufte Abos, Bestellungen, Quittungen und Kundenansprüche dürfen durch den Wechsel nicht stillschweigend gelöscht oder umgedeutet werden.

## 2. Kundenerlebnis / Navigation / Design

Die globale öffentliche Navigation bleibt auf `My Projects, Help, Legals, Contact` reduziert.

**Account-/Login-Dropdown**

- Für Gäste: Login, Plans & Pricing. Keine Guthabeninformation aus anderen Konten.
- Für angemeldete Kunden: verfügbare Credits **direkt im Dropdown**, Buy Credits, Usage, Plans & Pricing, Account Settings, Logout.
- Für Redakteure/Staff: getrennte Staff-Navigation ohne Kundenguthaben. Für **Super Admin**: explizite Testansicht mit lokal simulierten Grün/Gelb/Rot-Salden (0/500/1.500), Preisrechner und Nutzungsbeispielen; keine Änderung oder Einsicht in fremde Kundenwallets.
- Anzeige nur aus verifizierter, privater Serverabfrage; bei Fehler oder fehlender Berechtigung "— / Balance unavailable", niemals eine irreführende Null.
- Ampel-Logik: **grün ab 1.000 Credits**, **gelb 250–999**, **rot 0–249**, bei unbekanntem Wert neutral. Farbunabhängige Beschriftungen für Accessibility.
- Aktualisierung beim Laden, Öffnen des Menüs, Fokus und nach einem Guthabenereignis. `Cache-Control: private, no-store`.

**/plans – Information statt Checkout**

- Preise und Credit-Prinzip verständlich, mit deutlich sichtbarem **Status: geplantes Modell / nicht kaufbar** bis zur produktiven Freigabe.
- Beispieltarif: **25 Credits pro abrechenbarer Sekunde**, entsprechend bisher 0,25 €/s brutto; 1 Credit = 0,01 € interne Video-Verrechnungseinheit.
- Beispielpakete: 20 € / 2.000 Credits; 40 € / 4.000; 100 € / 10.000. Beträge, Bonusaktionen und finale Regeln erst nach kaufmännischer Freigabe.
- **Kein neuer Hobby-Tarif**: Neue Abos werden nicht mehr beworben und bleiben im alten Stripe-Checkout über das zusätzliche, standardmäßig inaktive Gate `HOBBY_NEW_PURCHASES_ENABLED` gesperrt. Bestehende Abos behalten ihre Vertragsrechte, Kontingente, Belege und gegebenenfalls Verwaltungs-/Kündigungswege. Ein bestehender historischer Abonnementpreis darf nicht nachträglich einseitig als Credit-Preis ausgegeben werden.
- Keine Preisversprechen oder aktive Stripe-Buttons, bevor das Wallet produktionsreif ist.

**/credits – Guthaben / Kaufprozess**

- Aktuell: authentifiziertes Guthaben aus dem existierenden Ledger; Informationspakete, kein Checkout.
- Ziel: konkrete Pakete und **frei eingegebene Anzahl Credits** (ganze Credits statt Eurobetragseingabe), zunächst 500–100.000 Credits; vorgeschlagener Bruttopreis ist exakt `Credits × 0,01 €`. Nicht-ganzzahlige, negative oder außerhalb liegende Werte ablehnen. Server muss jede künftige Stripe-Kalkulation unabhängig vom Browser validieren. Stripe Hosted Checkout mit Status `pending | paid | failed | refunded | disputed`, sichere Bestätigung.
- Aktuelle/verfügbare/reservierte Credits separat ausweisen.
- Konto zwingend erforderlich, E-Mail-Validierungsregeln vor echtem Kauf prüfen.

**/usage – Nutzung**

- Chronologische Credits-Historie mit Datum, Projekt/Job, aufgeladenen Credits, Reservierung, Verbrauch, Freigabe und Rückzahlungen.
- Filter: Übersicht / Analysen, Zeiträume, Verbrauch je Video, ggf. getrennte Guthabenarten.
- Vorerst nur echte vorhandene historische Credit-Ledger-Einträge anzeigen; keine synthetischen Zahlungen oder fake Events.

**Studio / Checkout**

- Gast kann Seite ansehen und ggf. Entwurf bearbeiten, **keine echte BytePlus-Generierung ohne Kundenkonto**.
- Vor Generierung die feste, brutto kalkulierte Credit-Anforderung anzeigen und Verfügbarkeit prüfen.
- Bei unzureichendem Guthaben: Login oder Buy Credits. Keine kostenpflichtige Provider-Submission.
- Credits reserviert, bei validiertem Erfolg verbraucht, bei bestätigtem Fehlschlag freigegeben.
- Alte Gast-Checkout- und Gratis-/Promo-Providerpfade nicht nur im UI verstecken: serverseitig absperren oder migrieren. Bereits rechtmäßig erworbene Gastvideos bleiben nachweisbar/recoverbar.

## 3. Datenmodell, Transaktionen und Kohärenz

Vorhandene Grundlage (nicht gleichbedeutend mit produktionsreifem Wallet):
- `lib/commerce/store.ts`: `customer_credits`, `customer_holds`, `balance`, `reserveCredit`, `captureCredit`, `refundCredit`.
- `app/(site)/api/stripe-checkout/route.ts`: derzeit Checkout für einzelne Videos.
- `lib/commerce/plans.ts`: gesonderte Hobby-Verbrauchskonten.
- `app/(site)/api/customer-settings/route.ts`: aktueller Kundenkontostand.
- `app/(site)/api/credit-balance/route.ts`: neu, ausschließlich read-only-Kundenanzeige auf Basis bestehender Beträge.

**Zu implementieren:**
1. Unveränderliches, doppelt gebuchtes bzw. revisionsfähiges Wallet-Ledger, eindeutige Transaktions-ID und Idempotenzschlüssel. Werte als ganze interne Einheiten, niemals Floats.
2. `credit_purchases`: accountId, Stripe Customer, CheckoutSession, PaymentIntent, Bruttobetrag, Währung, Preisversion, Status, verifizierte Webhook-Ereignisse, steuerliche Belegdaten, Dispute/Refund.
3. `credit_wallet_entries`: accountId, Quelle (Kauf, Bonus, Migration, Korrektur, Verbrauch, Guthabenerstattung), delta, Buchungsreferenz, Zeitpunkt, unveränderlicher Audit-Trail.
4. `credit_reservations`: accountId, Projekt/Job, unveränderlicher Input-Digest, Pricing-Version, erforderliche Credits, `reserved | submitted_or_unknown | consumed | released`, Provider-Job-ID, Erzeugungs-/Änderungszeit.
5. Bestands-Hobby-Kontingente als **Legacy-Entitlements** mit ihren ursprünglichen Perioden-/Ablaufregeln erhalten. Keine neuen Hobby-Abos erzeugen. Die Migration darf ungenutzte, bereits bezahlte Ansprüche nicht löschen.
6. DB mit ACID-Transaktionen, referenzieller Integrität, Migrations-/Backup-/Restore-Plan, Lösch- und Aufbewahrungsregeln. Für Produktion robuste gemeinsame PostgreSQL-Datenhaltung bevorzugen.
7. Konto- und Mandantentrennung streng durchsetzen. Keine Überziehung, Doppelreservierung, Replay-Buchung oder Gast-Entnahme.

## 4. Sicherheitsprotokoll Stripe

- Ein Kundenkauf erzeugt serverseitig einen **katalog- und tarifgebundenen** Stripe Checkout. Niemals Client-Preis als Autorität nutzen.
- Sandbox- und Live-Schlüssel/Webhooks strikt getrennt; Stripe Event-Signatur, Ablauf und Typ prüfen.
- Zahlung dem richtigen Account, Kauf, Checkout und erwarteten EUR-Bruttobetrag zuordnen; keine Gutschrift allein wegen Success-URL.
- Asynchrone Zahlungsmethoden, verspätete Webhooks, Doppelsendungen, Retries und Race Conditions unterstützen.
- Pro verifiziertem Kauf **maximal eine** Gutschrift. Alle Retry-Pfade idempotent.
- Refund/Dispute mit Credit-Rücknahme, Sperre/Negativsaldo nur über ausdrücklich geprüfte Policies; keine Doppelentschädigung.
- Kundendaten und Stripe-Belege nach gesetzlicher Aufbewahrung, Datenschutz und Buchhaltung behandeln.
- Kein unaufgefordertes automatisches Aufladen in der ersten Version. Optional später mit expliziter Zustimmung, sicherer Off-Session-Authentifizierung, 3DS-Fallback, Ausgabenlimit, Benachrichtigungen und Widerrufsmöglichkeit.

## 5. BytePlus: Abrechnungszustände

1. Aufruf nur durch authentifizierten, berechtigten Kunden mit geprüftem Input und serverseitiger Preisberechnung.
2. Vor **jeder** kostenpflichtigen Provider-Submission atomar Credits reservieren. Der Kunde sieht den Maximalabzug.
3. `submitted_or_unknown` bei Timeout oder unklarer API-Antwort: **nicht** automatisch erneut submitten, nicht sofort freigeben; sicher via Providerstatus abgleichen.
4. Provider bestätigt endgültige Ablehnung, technische Nichtlieferung oder unbrauchbare/fehlende Auslieferung: Reservierung genau einmal freigeben.
5. Provider liefert Video, MP4 wird geprüft (Authentizität, Dauer, Entitlement, sichere private Auslieferung), erst dann genau einmal Verbrauch buchen.
6. Verbindlichen Kundenpreis nicht heimlich nach oben korrigieren; Überschüsse nur nach sichtbarer Einwilligung separat behandeln. Zeit/Preisregeln mit tatsächlichem Providervertrag abgleichen.
7. Support- und Retry-Pfade benötigen Reconciliation; rechtlich gebotene Rückerstattungen können trotz Credit-Verbrauch auftreten.

## 6. Abnahmetests (Pflicht vor Aktivierung)

- Gast, abgelaufene Session, Staff ohne Kundenkonto oder direkter API-Aufruf: kein billbarer BytePlus-Auftrag.
- Kunde ohne ausreichendes Guthaben: kein Provideraufruf und keine negative Wallet-Bilanz.
- Zwei zeitgleiche Jobs + unzureichender Gesamtbestand: höchstens ein Job darf erfolgreich reservieren.
- Verifizierter Stripe-Kauf + mehrfacher Webhook: genau eine Gutschrift.
- Unbezahlter, fehlgeschlagener, abgebrochener oder zurückgebuchter Checkout: keine neu verfügbaren Credits.
- Provider timeout/unbekannt: gesperrte Credits bleiben sicher; keine doppelte Submission.
- Endgültiger Providerfehler: einmalige Freigabe; erfolgreicher validierter Download: einmaliger Verbrauch.
- Cross-account Zugriff und Credit-Buchung verboten; historische Konten nicht zugänglich für Gäste.
- Refund, Chargeback, Storno, Widerruf, Cancel, Promo, bestehende Hobby-Abos, Migration, Kontoauflösung und Auskunft/Export behandelt.
- Header-Dropdown korrekt grün/gelb/rot und neutral bei API-Ausfall; mobil, Desktop, Tastatur, Screenreader.
- Pricing zeigt nur freigegebene Beträge, keine aktiven Buttons vor Freigabe, keine falschen Rabatte.
- Staging-Sandbox-Ende-zu-Ende, Build/Lint/Typecheck, Payment- und Provider-Mocks, reale private Delivery mit Zugriffsprüfung.
- Backups und Wiederherstellung getestet; alte bezahlte Videos und Abos bleiben erhalten.

## 7. Prioritäten und Deployment

**Phase A – jetzt:** UI, Read-only-Endpoint, Preise nur informativ, frei eingebbare Credit-Anzahl, kein neu angebotenes Hobby-Abo, abgesperrter alter Hobby-Checkout für Neuabschlüsse, Super-Admin-Preview (rollengeprüft, keine Kundensaldofälschung), Buy-Credits-Einstieg ohne aktivierten Zahlungsvorgang, Usage für echte vorhandene Ledgerdaten, Tests. Bestehende Bestandsabos, Stripe-/BytePlus-Abwicklung und Live-Artefakte nicht beschädigen.

**Phase B – Payment-Backend:** Wallet-Schema, Stripe Top-up-Sandbox, Webhook-Idempotenz und Refund/Dispute-Sicherheit, Register-/Login-Gates, migrationssichere Buchführung.

**Phase C – Video-Fulfillment:** Alte Pay-per-video- und Gast-Billing-Pfade durch serverseitige Credit-Gates ersetzen; Provider-Reservierung, Erfolg, Ablehnung, Reconciliation, neue Projekt- und Usage-Events.

**Phase D – Freigabe:** Vollständige Staging-E2E, Vertrags-/MwSt-/Datenschutzprüfung, Freigabe durch Betreiber, Production-Rollout zunächst **nicht öffentlich zahlungsaktiv**. Erst nach überprüftem Go/No-Go echte Stripe-Aufladungen und BytePlus-Fulfillment separat aktivieren.

**Phase E – optional:** Auto-Top-up und Analytics.

Staging und Production laufen im Railway-Projekt `brilliant-sparkle` aktuell über denselben aktiven GitHub-Branch `design/studio-audio-redesign-20261111`. UI-Code über Feature-PR in den aktiven Branch mergen, automatische Builds beider Umgebungen auf **SUCCESS** prüfen. Keine Änderung an API-Secrets, vorhandenen Volumes, Stripe-Livemodus, Provider-Flags, Kundenbestellungen oder Zahlungsmethoden für Phase A.

## 8. Definition of Done

Die **gesamte** Credit-Umstellung ist erst abgeschlossen, wenn ein verifizierter Kunde Stripe-Guthaben kaufen, dieses als verfügbar im Dropdown sehen, eine Videogenerierung mit serverseitig reserviertem Guthaben auslösen, nach gültiger Auslieferung exakt einmal bezahlen und bei bestätigtem Providerfehler automatisch die Credits zurückerhalten kann — inklusive Reconciliation, Belegen, Refund/Dispute-Handling und rechtlicher Freigabe. Eine reine UI-Veröffentlichung ist ausdrücklich **nicht** diese Freigabe.
