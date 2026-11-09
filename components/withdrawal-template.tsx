/**
 * Static model withdrawal form reflecting Annex 2 to Art. 246a EGBGB.
 * No in-app submission: a mailto link opens the user's own mail client.
 * Do not represent a mailto link as the online statutory withdrawal function.
 */
export function WithdrawalTemplate(){
 const email="support@singmotion.ai";
 const subject=encodeURIComponent("Widerruf – SingMotion AI");
 const body=encodeURIComponent(
  "Hiermit widerrufe ich den von mir abgeschlossenen Vertrag über folgende Dienstleistung:\n"+
  "[Dienstleistung / Bestellnummer]\n"+
  "Bestellt am: [Datum]\n"+
  "Name: [Vor- und Nachname]\n"+
  "Anschrift: [Anschrift]\n"+
  "Datum: [Datum]"
 );
 return <section className="sm-legal-panel" id="muster-widerrufsformular" aria-labelledby="withdrawal-model-heading">
  <span className="sm-legal-num">04 / MUSTERFORMULAR</span>
  <h2 id="withdrawal-model-heading">Muster-Widerrufsformular</h2>
  <p>Wenn du deinen Vertrag widerrufen möchtest, kannst du dieses Muster verwenden. Eine eindeutige eigene Erklärung ist ebenfalls möglich. Nicht Zutreffendes bitte streichen.</p>
  <p><strong>An:</strong> Bernhardt Müller, SingMotion AI, Erich-Kästner-Str. 37, 16312 Bernau bei Berlin, Deutschland; E-Mail: <a href="mailto:support@singmotion.ai">support@singmotion.ai</a>.</p>
  <p>Hiermit widerrufe(n) ich/wir den von mir/uns abgeschlossenen Vertrag über die Erbringung der folgenden Dienstleistung:</p>
  <p>__________________________________________________</p>
  <p>Bestellt am: ______________________________</p>
  <p>Name des/der Verbraucher(s): ______________________________</p>
  <p>Anschrift des/der Verbraucher(s): ______________________________</p>
  <p>Datum: ______________________________</p>
  <p>Unterschrift (nur bei Mitteilung auf Papier): ______________________________</p>
  <p><a href={`mailto:${email}?subject=${subject}&body=${body}`}>Widerruf per E-Mail vorbereiten</a> – öffnet dein E-Mail-Programm. Du musst die E-Mail dort selbst absenden; ein Versand über diese Webseite findet nicht statt.</p>
  <p><small>Quelle: <a href="https://www.gesetze-im-internet.de/bgbeg/art_253anlage_2.html">Anlage 2 EGBGB</a>. Das Muster ersetzt nicht die rechtsgeprüfte Belehrung zum konkreten digitalen Angebot und nicht eine gegebenenfalls erforderliche eigenständige Online-Widerrufsfunktion.</small></p>
 </section>;
}
