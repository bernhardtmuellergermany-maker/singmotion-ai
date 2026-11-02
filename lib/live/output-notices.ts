/** Customer-safe SingMotion messages; never show provider internals or infer a policy category. */
export function outputNotice(state:string,stage:string,createdAt:number,now=Date.now()){
 const s=String(stage||"");
 const codes=[...s.matchAll(/\[([A-Z][A-Z0-9_]{2,80})\]/g)].map(m=>m[1]);
 const has=(...wanted:string[])=>wanted.some(x=>codes.includes(x));
 if(state==="failed"){
  if(has("CONTENT_PREFILTER_REJECTED"))return {kind:"policy" as const,title:"Video konnte nicht erstellt werden",message:"Die hochgeladenen Inhalte wurden bei der Sicherheitsprüfung abgelehnt. Bitte verwende ein anderes, zulässiges Bild oder Audio. Der genaue Ablehnungsgrund ist nicht bestätigt.",action:"Überarbeite die Eingaben und prüfe den Projektstatus. Eine erneute kostenpflichtige Generierung erfolgt nicht automatisch."};
  return {kind:"failed" as const,title:"Videogenerierung fehlgeschlagen",message:"SingMotion konnte dieses Video nicht fertigstellen. Der genaue technische Grund wird geprüft.",action:"Bitte prüfe den Projektstatus oder kontaktiere den Support. Starte nicht denselben kostenpflichtigen Auftrag erneut, solange die Abrechnung ungeklärt ist."};
 }
 if(state==="uncertain"||state==="output_observed")return {kind:"review" as const,title:"Videostatus wird geprüft",message:"Die Generierung oder Bereitstellung konnte noch nicht abschließend bestätigt werden.",action:"Bitte prüfe den Status später erneut. SingMotion startet keine zusätzliche kostenpflichtige Generierung automatisch."};
 if((state==="processing"||state==="submitted")&&Number.isFinite(createdAt)&&createdAt>0&&now-createdAt>45*60*1000)return {kind:"delayed" as const,title:"Die Generierung dauert ungewöhnlich lange",message:"Der Auftrag ist noch nicht als fehlgeschlagen bestätigt. SingMotion prüft, ob das Video noch erstellt wird.",action:"Nutze „Status prüfen“. Bitte keinen zweiten kostenpflichtigen Auftrag starten."};
 return null;
}
