# SingMotion AI – Staging-Abnahme und Freigabegates

Stand: 2026-11-03. **Keine Produktions- oder Zahlungsverkehrsfreigabe.**
Die hier genannten Nachweise betreffen isolierte Tests und Staging.

## Nachgewiesen

- [x] Signierte Stripe-**Sandbox**-Webhook-Ereignisse, Replay-Schutz und unveränderliche Checkout-Bindung; keine echten Buchungen.
- [x] Vorbereitete BytePlus-Aufträge und Offline-Providerantworten einschließlich Fehler-, Wiederanlauf- und Doppelversandprüfung; **kein kostenpflichtiger API-Aufruf**.
- [x] Eigentümergebundener privater MP4-Download, Byte-Range-Streaming und Widerruf bei Zahlungsstreit; Vorschau/Download **in der bestehenden Ausgabe-Karte** auf der Bestellseite.
- [x] Chromium-HTTP-Kundenprüfung mit isoliertem Konto, Testvideo und signierter Stripe-Testnachricht als Teil des Railway-Docker-Builds.
- [x] Payload-CMS-PostgreSQL-Migrationen auf einer kurzlebigen, isolierten GitHub-Actions-Datenbank. Testabdeckung: Admin-Anmeldung, Rollen, Entwurf/Publikation/Versionierung, Bild-Uploads und Audit.
- [x] Produktionsabhängigkeiten: zuletzt 0 kritische, hohe, mittlere und niedrige npm-Advisories. Entwicklungsabhängigkeiten getrennt bewerten.
- [x] Fail-closed CMS-DB-Sperre verhindert Migrationen gegen bestehende App-Datenbank, Railway und Production.

## Zusätzlich vor Pilotbetrieb prüfen

- [ ] CMS-Browser-E2E über HTTPS-Loopback inklusive geschützter Admin-Oberfläche, Redaktion, Vorschau, Rollen und CSRF muss auf kurzlebiger PostgreSQL-Testdatenbank **grün** sein. Nachweis: GitHub Actions „CMS isolated PostgreSQL integration“.
- [ ] Staging-App und PostgreSQL online, letzte Version erfolgreich und keine offenen Railway-Warnungen, Deployments oder Fehler; exakten GitHub-SHA abgleichen.
- [ ] Rechte, Logs, Backup-/Restore-Prozess, Alerts, Datenaufbewahrung und Kundensupport auf einer getrennten, explizit autorisierten Testumgebung nachweisen.
- [ ] Checkout- und Erstattungsfluss mit echten **Stripe-Testmodus**-APIs auf einer ausdrücklich dafür freigegebenen Testumgebung prüfen. Offline-Testereignisse ersetzen diesen externen Integrationsnachweis nicht.
- [ ] Bezahlten Videoablauf mit echtem BytePlus-Provider nur nach ausdrücklicher Budget- und Testfreigabe einmalig prüfen. Ohne Genehmigung bleibt dies gesperrt.
- [ ] Kundenkommunikation und Zustellung (inklusive Video-Recovery/Email) produktionsbereit konfigurieren und nachvollziehbar testen.
- [ ] Datenschutz/AGB/Preisangaben, Rechnungs- und Steuerbehandlung, Widerrufs-/Supportprozess prüfen und durch Verantwortliche freigeben.
- [ ] Unabhängigen Release-Review durchführen: Konfigurationsgates, Zugangsdaten, Rollen, Rate-Limits, getrennte Daten, Fehlerbehandlung und Rückabwicklung.

## Harte Freigabegrenzen

1. `customerLaunchReadiness()` in `lib/commerce/readiness.ts` meldet weiterhin `readyForPaidOrders: false` und blockiert Kundenzahlungen/-generierung/-auslieferung zur Live-Freigabe. Ein grüner Test hebt diese Sperre **nicht** auf.
2. Keine Produktions-Deployments, echten Stripe-Abbuchungen, kostenpflichtigen BytePlus-Jobs, kostenpflichtige neue Infrastruktur oder Datenlöschungen ohne vorherige ausdrückliche Zustimmung.
3. Kein neuer Bereich „Meine Videos“: Alle Videostatus-, Vorschau- und Downloadfunktionen bleiben in der vorhandenen Ausgabekarte.
4. Die Tests sind **kein** Beleg, dass Zahlungen oder externe Generierung auf Production angeschlossen sind.

## Reproduzierbare Tests

- `npm run build` – npm-Produktion-Audit, 82+ Backend-Tests, TypeScript, Next.js.
- Railway-Staging-Docker-Build – zusätzlich `npm run test:customer:browser` mit lokalem Chromium.
- GitHub Actions `.github/workflows/cms-isolated.yml` – ephemere PostgreSQL-Testdatenbank, `npm run test:cms:compat`, `npm run test:cms`, separater Next.js-Build und `npm run test:cms:browser`.
- Lokal mit Docker: `npm run test:cms:isolated -- --browser`; startet und entfernt eine eigene PostgreSQL-Instanz; verweigert bereits konfigurierte oder Railway-DBs.

**Launch-Entscheidung: NICHT FREIGEGEBEN**, bis alle offenen Punkte nachgewiesen, Produkt-/Betriebsrisiken bewertet und ausdrücklich genehmigt sind.
