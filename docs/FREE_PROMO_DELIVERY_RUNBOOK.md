# SingMotion AI – sicherer Gratisvideo-Betrieb (4.11.2026)

**Status: NICHT bereit für öffentliche kostenlose Videogenerierung.** Dieses Runbook gibt keine Freigaben und startet keine Provider-Anfragen.

## Nachgewiesene technische Grundlagen

- 3 Gratisvideos mit höchstens 10 Sekunden sind als **reservierte Zero-EUR-Berechtigungen** im Commerce-Ledger modelliert.
- Der getrennte Betreiber-Kill-Switch muss ausdrücklich aktiviert sein; HMAC-Genehmigungen gelten kurzzeitig und binden Konto, Bestellung und Kostenobergrenze.
- Einmaliger, persistenter Provider-Claim: `authorized` → `submitted_or_unknown`. Nach Timeout oder Neustart **niemals automatisch wiederholen**.
- `submitted_or_unknown` → `requires_review` nur nach neuer signierter Betreiberfreigabe; Guthaben und Gutscheine bleiben reserviert.
- Kostenlimits pro Auftrag, Gutschein, rollierenden 24 Stunden und global werden inklusive offener Ansprüche gezählt. Ab 80 % wird eine Warnung berechnet.
- Ein privates MP4 kann nach einem **bereits beanspruchten** Gratisauftrag ohne externen Provider-Request vollständig mit ffprobe/ffmpeg, Dauer/Format/Streams, restriktiven Dateirechten und SHA-256 geprüft werden. Die Prüffunktion liefert zunächst **nur eine temporäre Bestätigung**, keine Freigabe oder Zustellung.

## Betreiber-Prüfung (nur geschützte Staging-Umgebung)

```bash
npm run inspect:free-promo-risk
```

- Voraussetzung: `RAILWAY_ENVIRONMENT_ID` ist exakt die private Staging-ID; `DATA_DIR/commerce.sqlite` existiert bereits.
- Das Skript öffnet SQLite im Lesemodus. Keine Kundennamen, Mails, Gutscheincodes, Auftragskennungen, Provider-URLs oder Geheimnisse werden ausgegeben.
- Es zählt Gesamt- und rollierende 24h-Reservierungen (USD-Mikroeinheiten), autorisierte, unklare, zu prüfende und gelieferte Versuche sowie unklare Vorgänge älter als 15 Minuten.
- Eine leere Ledger-Tabelle bedeutet **nicht**, dass BytePlus abrechnungsfrei ist; externe Rechnungen und Provider-Tasks separat abgleichen.
- Keine automatische Cron-Ausführung oder E-Mail-Benachrichtigung behaupten.

## Harte Abbruchkriterien

1. Fehlt eine echte, vom Betreiber geprüfte BytePlus-Abrechnung einschließlich Steuern, genehmigter Ausgabehosts oder eine harte Ausgabengrenze? **Keinen Provider-POST senden**.
2. Ist ein Provider-POST unklar oder liefert einen Timeout? **Niemals einen zweiten POST starten**; Status manuell mit Provider-Task-ID und externen Abrechnungsbelegen klären.
3. Ist der Gutschein deaktiviert, die geprüfte Medien-Snapshot-Bindung verändert oder die HMAC-Genehmigung abgelaufen? **Den Claim ablehnen**.
4. Ist die MP4-Datei unvollständig, nicht dekodierbar, zu lang, symlinkbasiert, über dem Dateilimit oder nicht privat? **Nicht verbuchen oder ausliefern**.
5. Ist kein dauerhafter privater Kunden-Download nachweisbar? **Gutschein nicht als eingelöst markieren**, keinen Stripe-Zahlungseingang erfinden.
6. Nach einer Konto-/Session-Ablaufprüfung nicht pauschal Medien löschen; abgelaufene Login-Tokens sind keine Löschfreigabe für Kundeninhalte.

## Explizit gesperrter Staging-only Offline-Testpfad (PR #25)

- Ein separater, **standardmäßig deaktivierter** Abschlussweg prüft ein lokal vorhandenes MP4 vollständig und verbucht erst dann den reservierten Gratisgutschein atomar als `redeemed`, den Auftrag als `free_delivered` und ein owner-gebundenes SHA-256-/Byte-Manifest.
- Dazu müssen **beide** Bedingungen erfüllt sein: `RAILWAY_ENVIRONMENT_ID` ist exakt Staging, und ein vertrauenswürdiger Betreiber hat `FREE_PROMO_PRIVATE_SETTLEMENT_ENABLED=true` ausdrücklich gesetzt. Der signierte Betreiber-Nachweis bleibt Pflicht. Der Schalter wird durch dieses PR **nicht** in Railway gesetzt.
- `/api/customer-free-video` ist ein eigenständiger authentifizierter, staging-gesperrter Lesepfad. Vor jedem Byte-Range-Stream wird die gesamte lokale Datei erneut gegen die gespeicherte Prüfsumme validiert. Andere Kunden erhalten keinen Zugriff; es gibt keinen Stripe-paid-Status.
- Dieser Pfad ist **noch keine freigegebene Produktionsauslieferung**: Es fehlt die private, dauerhafte R2-Archivierung inklusive Cloud-E2E/Restore und eine echte, kontrolliert genehmigte BytePlus-Ausführung. Die lokale Staging-Datei kann keine produktive Haltbarkeit garantieren.
- **Keinen** Live-Schalter in Produktion setzen; keine automatischen Provider-Retries.

## Noch zu implementieren/verifizieren

- Echte, strikt kontrollierte BytePlus-Gratisvideo-Übermittlung unter freigegebenem Vertrag und Limits.
- Dauerhafte, private Output-Metadaten + Kunden-Download mit erneuter Eigentümerprüfung und validierten Range-Requests.
- Atomare Gutscheineinlösung **erst nach** nachweislicher, dauerhaft erreichbarer Videozustellung; niemals durch `paid`-/Stripe-Fiktion.
- Provider-Billing-Abgleich, fehlgeschlagene Auftragserstattung, Beleg- und Kundensupport-Kommunikation.
- Explizite Rechts-/Musikrechteprüfung, produktive R2-Separierung, Backups und Recovery-Rehearsal.

Siehe auch [Release-Gate #6](https://github.com/bernhardtmuellergermany-maker/singmotion-ai/issues/6), [Storage-Gate #8](https://github.com/bernhardtmuellergermany-maker/singmotion-ai/issues/8) sowie `docs/PRODUCTION_RELEASE_RUNBOOK.md`.
