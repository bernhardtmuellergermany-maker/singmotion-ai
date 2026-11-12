# SingMotion AI — Stripe Credit TEST Kauf (Staging only)
Stand: 12 November 2026

## Überblick
- Auf **Staging** kann ein eingeloggter Kunde oder ein authentifizierter CMS Super-Admin mit **seinem eigenen Wallet** Kredit-Guthaben in Stripe **Test mode** kaufen. Keine echten Gelder werden bewegt.
- **Production** bekommt nur den Code; der Test-Checkout bleibt dort durch die feste Railway-Environment-ID gesperrt. Live-Zahlungen und Credit-basierte Videogenerierung bleiben unangetastet.
- Kunden- und Super-Admin-Dropdown zeigen dieselbe Guthabenansicht. Kein simuliertes Guthaben, keine Testbeträge im UI.
- Unter `/credits#usage` erscheinen echte Wallet-Posten und getrennt die historischen, in EUR bezahlten Kundenaufträge mit ausdrücklich als Gegenwert bezeichneten Credits.
- Die neue Wallet-Buchführung ist **nicht** automatisch mit BytePlus-Videogenerierung verbunden; dafür sind weiterhin die serverseitigen Hold/Settle/Release-Workstreams aus Issue #143 erforderlich.

## Testumgebung
Bereits vorhandener Stripe-Test-Webhook (Sandbox) im SingMotion-Konto:
`https://singmotion-ai-staging.up.railway.app/api/stripe-webhook`
Relevante signierte Ereignisse:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `refund.created`, `refund.updated`
- `charge.dispute.created`

Derselbe Webhook verarbeitet weiterhin alte Video-Events. Credit-Events werden anhand ihrer servergebundenen Flow-Metadaten und der zugehörigen gespeicherten Stripe-Checkout-Session getrennt geprüft. Für Test-Credits muss zusätzlich ein echtes über Stripe API verifiziertes, bezahltes Test-Checkout mit genau dem erwarteten EUR-Betrag vorliegen. Replay: maximal eine Gutschrift.

## Erst aktivieren nach erfolgreichem Staging-Build
Staging Service in Railway:
1. Sicherstellen, dass **nur** `sk_test_` und ein passender signierter `whsec_`-Test-Webhook auf Staging konfiguriert sind. Vorhandene Secrets nicht auslesen, ersetzen oder ausgeben.
2. `STRIPE_CHECKOUT_ENABLED=true` muss im Staging-Testbetrieb gesetzt sein.
3. `STRIPE_CREDIT_TOPUPS_TEST_ENABLED=true` ausschließlich für Railway Staging setzen. Die Produktionsumgebung bekommt diese Variable **nicht**.
4. `/credits` als authentifizierter Kunde oder Super-Admin öffnen. Einen Betrag, z. B. 500 Credits/5,00 €, eingeben und `Testkauf mit Stripe` starten.
5. Mit der offiziellen Stripe-Testkarte `4242 4242 4242 4242` bezahlen (beliebiges zukünftiges Ablaufdatum, gültige CVC/Postleitzahl im Testmodus).
6. Nach Rückkehr erst nach Webhook-Gutschrift den verfügbaren Credit-Saldo prüfen. Browser-Redirect alleine darf keinen Credit buchen.
7. `/credits#usage` prüfen: +500 Credits einmalig, Kaufstatus bezahlt und Konto stimmt. Replay eines Stripe-Events darf nicht erneut gutschreiben.
8. In Stripe Test Dashboard vollständige Erstattung testen; die Wallet-Reversalbuchung muss genau einmal auftreten und verfügbare Credits korrigieren.
9. Konto B, nicht angemeldete Gäste, Staff ohne Super-Admin-Rolle und Staging-Umgebung ohne Test-Key dürfen weder kaufen noch Guthaben eines anderen Kontos sehen.
10. Bei Fehlern sofort `STRIPE_CREDIT_TOPUPS_TEST_ENABLED=false` schalten. **Wichtig:** signierte Settlement- und Rückbuchungs-Webhooks für bereits begonnene Testkäufe werden auch nach Deaktivierung weiterhin verarbeitet.

## Verifikation und Sicherheit
- Serverseitige Festpreisberechnung: 1 Credit = 1 Eurocent, 500–100.000 ganze Credits. Niemals den vom Browser behaupteten EUR-Betrag übernehmen.
- Kein Live-Schlüssel, kein Live-Checkout oder Echtgeldbetrieb durch diese Phase.
- Serverseitige Session-/CMS-Rollenprüfung, CSRF-Origin-Schutz, Rate- und Body-Limits, signierte Webhooks, Testmode-/Währungs-/Betrags-/Session-Abgleich und Idempotenz.
- Staging besitzt eine eigene persistente SQLite CommerceStore-Wallet; Production erhält keine Testkäufe.
- Refund/Dispute: Rückbuchung auf Wallet-Ebene, eventuell bereits verbrauchtes Guthaben als offene Verbindlichkeit anzeigen (kein stilles Wegfallen der Buchung).
- Alte Videokäufe sind keine nachträglichen Wallet-Abbuchungen. Sie erscheinen als *Gegenwert* neben Datum, Projekt-ID, Betrag und Status.

## Nicht abgeschlossen / Production Go-Live
- Endgültige steuerliche und rechtliche Einordnung, Live-Stripeschlüssel und getrennte Webhooks.
- Hold/Settle/Release pro BytePlus-Job, zuverlässige Provider-Reconciliation, Gast-Generierungsverbot auf allen API-/Workerpfaden, Promotion-/Hobby-Bestandsmigration, Refund-/Chargeback-Reconciliation im Live-Modus.
- Vollständige E2E-Abnahme, Live-Risiko- und Lastgrenzen, Buchhaltung, Backups/Restore und Freigabe nach Issue #143.

**Hinweis:** Dieser Runbook-Eintrag autorisiert ausschließlich Stripe-Sandbox-Testkäufe, nicht den Echtgeldverkauf.
