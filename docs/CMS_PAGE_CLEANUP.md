# CMS-Seiten bereinigen – nur tatsächlich veröffentlichte Inhalte behalten

Derzeit gibt es zehn alte Seed-Datensätze im Payload-CMS. Das Vorhandensein eines
Eintrags unter **Seiten bearbeiten** ist kein Beleg für eine öffentlich
veröffentlichte CMS-Seite.

Die öffentliche SingMotion-Website verwendet mehrere getrennte Wege:

- `/` nutzt die moderne `CarouselExperience` und **nicht** den CMS-Home-Datensatz.
- `/legal` nutzt die eigene `LegalOverview` statt des CMS-Impressum-Datensatzes.
- `/help` verwendet die kuratierte FAQ; nur veröffentlichte CMS-Cards können diese ergänzen.
- `/plans` verwendet die aktuelle Preis-/Planübersicht, während `/pricing` eine separate
  ältere CMS-/Fallback-Informationsroute bleibt.
- `/about`, `/faq`, `/contact`, `/privacy`, `/terms`, `/rights`,
  `/pricing` sind CMS-gestützt **nur wenn veröffentlicht**; sonst zeigt die
  Website eine eigene Fallback-Seite.

## Sichere Bereinigung (geschütztes Staging)

**Keine automatischen Löschungen beim Deployment.** Bevor irgendetwas
verschwindet, muss der tatsächliche Datensatzstatus aus PostgreSQL gelesen
werden, nicht aus dem Screenshot abgeleitet.

1. Den Staging-Betreiberzugang verwenden, nicht Produktion.
2. `CMS_PRUNE_DRAFTS_APPROVED=true` nur temporär für die Wartungssitzung
   setzen und die aktuelle Staging-Umgebung prüfen.
3. `npm run cms:prune-drafts -- --dry-run`: Die Slugs sind aufgeteilt in
   `keepOnline`, `removeUnpublished` und `requireReview`.
4. Bei unbekannter Veröffentlichungshistorie, Duplikaten oder fehlenden
   Backups **abbrechen**. Alle live veröffentlichten Seiten (auch historisch)
   werden behalten, auch wenn sie aktuell einen bearbeiteten Entwurf haben.
5. `npm run cms:prune-drafts -- --apply` schreibt **zuerst** eine exklusive
   JSON-Datei mit allen aktuellen Inhalten und Versionen in das private
   `DATA_DIR/cms-draft-archives`-Verzeichnis und entfernt anschließend
   ausschließlich vollständig geprüfte, nie veröffentlichte Entwürfe.
6. Anschließend öffentlich erreichbare Links und CMS prüfen; vor öffentlicher
   Veröffentlichung keine rechtlichen Platzhalter versehentlich freigeben.
7. Den temporären Betreiber-Schalter wieder deaktivieren. Backup gemäß
   freigegebener Retention-Richtlinie schützen und nicht öffentlich zugänglich
   machen.

Der vorhandene `cms:seed`-Befehl ist separat bestätigt und legt bei
ausdrücklicher Nutzung wieder fehlende Entwürfe an. Nach der Bereinigung
nicht erneut ausführen, wenn die Liste bewusst reduziert bleiben soll.

Die Bereinigung ist von der öffent­lichen Produktfreigabe getrennt.
Sie schaltet keine Kunden-Zahlungen, BytePlus-Generierung oder Live-Medien frei.
