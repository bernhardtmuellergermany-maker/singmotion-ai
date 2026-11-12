/**
 * Static model withdrawal form reflecting Annex 2 to Art. 246a EGBGB.
 * No in-app submission: a mailto link opens the user's own mail client.
 * Do not represent a mailto link as the online statutory withdrawal function.
 */
export function WithdrawalTemplate(){
 const email="support@singmotion.ai";
 const subject=encodeURIComponent("Withdrawal – SingMotion AI");
 const body=encodeURIComponent(
  "I hereby withdraw from my contract for the following digital content or service:\n"+
  "[Digital content or service / order number]\n"+
  "Ordered on: [date]\n"+
  "Name: [first and last name]\n"+
  "Postal address: [address]\n"+
  "Date: [date]"
 );
 return <section className="sm-legal-panel" id="muster-widerrufsformular" aria-labelledby="withdrawal-model-heading">
  <span className="sm-legal-num">04 / MODEL FORM</span>
  <h2 id="withdrawal-model-heading">Model withdrawal form</h2>
  <p>You may use this model form to withdraw from a contract if a statutory right applies. A clear statement in your own words is also acceptable. Delete any option that does not apply.</p>
  <p><strong>To:</strong> Bernhardt Müller, SingMotion AI, Erich-Kästner-Str. 37, 16312 Bernau bei Berlin, Germany; Email: <a href="mailto:support@singmotion.ai">support@singmotion.ai</a>.</p>
  <p>I/we hereby withdraw from my/our contract for the following digital content or service:</p>
  <p>__________________________________________________</p>
  <p>Ordered on: ______________________________</p>
  <p>Name of consumer(s): ______________________________</p>
  <p>Postal address of consumer(s): ______________________________</p>
  <p>Date: ______________________________</p>
  <p>Signature (only if this form is submitted on paper): ______________________________</p>
  <p><a href={`mailto:${email}?subject=${subject}&body=${body}`}>Prepare withdrawal email</a> – opens your email application. You must send the email yourself; this link does not submit a withdrawal to our servers.</p>
  <p><small>Source: <a href="https://www.gesetze-im-internet.de/bgbeg/art_253anlage_2.html">Anlage 2 EGBGB</a>. This model does not replace contract-specific legal information or the separate online withdrawal declaration function shown above.</small></p>
 </section>;
}
