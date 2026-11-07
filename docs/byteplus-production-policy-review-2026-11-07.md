# SingMotion AI – BytePlus / Studio / Customer Policy – Reviewentwurf (2026-11-07)

**Status: ENTWURF, NICHT FREIGEGEBEN.** Dieses Dokument ist kein `studio-live-policy.json`, kein `customer-byteplus-policy.json` und keine Freigabevariable. Es darf nicht automatisch in eine Laufzeitfreigabe umgewandelt werden.

## Gesicherte Quellen im Repository

- `lib/commerce/owner-confirmed-provider-policy.ts`: Auf den 2026-11-05 datierte *Owner-bestätigte Pilotannahmen* für geschütztes Staging; ausdrücklich kein BytePlus-Rechnungsnachweis.
- `lib/live/studio-policy.ts`: `validateStudioPolicy` verlangt expliziten Review, aktuelle Ablaufdaten, überprüfte Output-Hosts, Media-Contract und Abrechnungsbelege. Stagedatei `DATA_DIR/studio-live-policy.json` hat Vorrang; Ersatz via serverseitigem `STUDIO_LIVE_POLICY_JSON` nur bei nicht vorhandener Datei.
- `lib/commerce/customer-paid-worker.ts`: Production akzeptiert keinen stillen Rückfall auf die Staging-Pilotannahme; verlangt eine gesondert bestätigte private `DATA_DIR/customer-byteplus-policy.json`.
- `lib/commerce/customer-live-config.ts`: Production-Live-Zahlungen und öffentliche Kundenfreigabe verlangen getrennte Owner-/Betriebsnachweise.
- Railway Staging-Deployment `da8f2379-271a-45fa-8b57-6710d4b016b4`: private R2-MP4-Canary erfolgreich; Studio-Start meldete `POLICY_REVIEW_REQUIRED`. Keine Einsicht in den Inhalt etwaiger privater Policy-Dateien.

## Dokumentierte Staging-Pilotannahmen – nicht als Production-Belege verwenden

| Feld | Wert | Evidenzstatus |
|---|---|---|
| Provider / Modell | BytePlus OmniHuman 2.0 | Codekonfiguration |
| Abrechnung | 70.000 micro-USD pro generierter Sekunde (= 0,07 USD/s) | Owner-bestätigte Annahme am 05.11.2026; keine verifizierte Rechnung |
| Minimale / maximale Eingabe | 4 bis 30 Sekunden | konservative Staging-Policy |
| Zusätzliche generierte Dauer | max. 2 Sekunden | konservative Annahme, kein universeller Provider-Nachweis |
| Tägliche Reservierung | 2.500.000 micro-USD (= 2,50 USD) | Staging-Codegrenze |
| Gesamte Reservierung | 10.000.000 micro-USD (= 10,00 USD) | Staging-Codegrenze |
| Bekannter Auslieferungs-Host | `v16m-default.tiktokcdn.com` | beobachteter Host; keine pauschale Host-Freigabe |
| Ausgabe | 720 × 1280, H.264, AAC, Normalisierung auf 25 FPS | lokaler Liefervertrag; Format bei jedem Output validieren |
| Download | maximal 100.000.000 Bytes und 120 Sekunden | private Transportgrenze |
| Staging-Reviewablauf | 04.12.2026, 23:59:59 UTC | im Code datierte Annahme |

Der Maximalpreis einer 30-Sekunden-Eingabe bei bis zu 32 generierten Sekunden wäre unter der **Annahme** von 0,07 USD/s und ohne Zusatzgebühren **2,24 USD**. Dies ist **keine garantierte Rechnungsobergrenze**. Der Produktionsbetrieb darf daraus weder Steuern, Abrechnungsrundung noch garantierte Maximaldauer ableiten.

## Vorbereitete Vorgaben für Production (bis Belege vorliegen: gesperrt)

1. **Keine echte Zahlung freischalten**: `PUBLIC_CUSTOMER_LAUNCH_APPROVED`, `STRIPE_LIVE_CHECKOUT_ENABLED` und die weiteren in `PRODUCTION_CUSTOMER_PROOFS` verlangten Nachweise nicht ohne unabhängige Prüfung aktivieren.
2. **Keine automatische Kunden-Generierung**: `CUSTOMER_PAID_WORKER_ENABLED`, `CUSTOMER_PAID_PROVIDER_DISPATCH_ENABLED` und `CUSTOMER_GENERATION_ENABLED` bleiben deaktiviert, bis ein separat dokumentierter Production-Vertrag, bestätigte Rechnungslogik, Auslieferungsprüfung und Kostenlimits vorliegen.
3. **Provider-Output nur privat**: Genaue allowlist-basierte Hosts, signierte Providerantworten, DNS-/SSRF-Prüfung, Dauer/FPS/Codec/Audio-Prüfung, eigentümergebundene R2-Auslieferung und Range-Streaming beibehalten. Keine öffentlichen Bucket-URLs oder vorzeitige Lieferung.
4. **Kostensteuerung**: Für Production eigene tägliche und lebenslange Höchstgrenzen schriftlich festlegen und unabhängig genehmigen. Bereits gebuchte oder unklare Provider-Jobs als reserviert zählen, niemals automatisch erneut einreichen.
5. **Erstattungen und Disputes**: Verifizierte Stripe-Webhooks, vollständige und teilweise Erstattungen, Streitfälle, rückwirkende Berechtigungsentziehung und Abstimmung zwischen Payment, Fulfillment und Provider-Kosten nachweisen. Nicht anhand von Sandbox-Test allein freigeben.
6. **Kundenbetrieb**: Backup/Restore-Test, Medienaufbewahrung, Datenschutz-/Rechtstexte, Supportkontakt, CMS-Berechtigungen, Stripe-Live-Konto, private R2-Speicherung und BytePlus-Steuer-/Abrechnungsnachweise ergänzen.

## Noch zu beschaffende Freigaben

- Eigentümer-Unterschrift mit Datum/Scope (Staging-Studio separat von Production-Kundenbetrieb).
- Tatsächlich verifizierte BytePlus-Preis-, Steuer-, Rundungs- und Auszahlungs-/Abrechnungsbedingungen.
- Von der realen Providerantwort bestätigte Output-Hosts und unterstützte Medienkontrakte; Testdatei und unveränderliche Prüfsummen.
- Verbindliche Production-Caps und Alarm-/Kill-Switch-Nachweise.
- Stripe-Live-Webhooks, Rückerstattung-/Dispute-E2E, private Customer-R2-E2E, Restore- und Rechts-/Supportnachweise.

**Entscheidung:** Dieser Entwurf verbessert die Nachvollziehbarkeit und darf als Basis für einen späteren Owner-Review verwendet werden. Bis zur Freigabe bleibt `POLICY_REVIEW_REQUIRED` ein gültiges und bewusstes Fail-Closed-Ergebnis. Nie fiktive `reviewedBy`, `billingEvidence`, `outputEvidence` oder `expiresAt` in eine aktive Policy eintragen.

## Implementierte zusätzliche Production-Sicherung (Release 2026-11-07)

Der Customer-Worker verweigert jetzt eine private Production-Policy, wenn die
`contract.revision` nicht ausdrücklich mit `production-` beginnt oder die
Staging-Pilotreview-Kennung benutzt wird. Eine kopierte Staging-Datei kann
keine Production-Freigabe ersetzen. Diese Herkunftsprüfung ist ein zusätzlicher
Schutz, **kein** Nachweis einer echten Provider- oder Owner-Freigabe.

Die endgültige Production-Policy muss unverändert alle Validierungen in
`validateCustomerWorkerPolicy` bestehen und separat bestätigte Rechnungsdaten,
Output-Hosts, Kostenlimits sowie den erforderlichen Owner-Review enthalten.
Production-Kundenworker und Live-Checkout bleiben bis dahin gesperrt.
