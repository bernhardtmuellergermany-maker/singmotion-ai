"use client";
import {useState} from "react";
export default function Page(){
  const [email,setEmail]=useState(""),[password,setPassword]=useState(""),
    [setupToken,setSetupToken]=useState(""),[busy,setBusy]=useState(false),
    [message,setMessage]=useState(""),[done,setDone]=useState(false);
  async function create(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/owner-setup",{
        method:"POST",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({email,password,setupToken})
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Setup is unavailable.");
      setDone(true);setPassword("");setSetupToken("");
      setMessage("Super-Admin-Konto erfolgreich angelegt. Jetzt anmelden.");
    }catch(error){setMessage(error instanceof Error?error.message:"Einrichtung fehlgeschlagen.");}
    finally{setBusy(false);}
  }
  return <main style={{maxWidth:520,margin:"3rem auto",padding:"1.5rem"}}>
    <h1>SingMotion AI – Super Admin einrichten</h1>
    <p>Diese einmalige Einrichtung ist nur in der geschützten Production-Umgebung
      möglich, solange noch kein Mitarbeiterkonto existiert. Das Staging-Passwort
      schützt die Website; der zusätzliche Einrichtungs-Code steht ausschließlich
      in den privaten Railway-Variablen.</p>
    {done?<a href="/operator-signin">Zur Super-Admin-Anmeldung</a>:
    <form onSubmit={create} style={{display:"grid",gap:"1rem"}}>
      <label>Admin-E-Mail<input type="email" autoComplete="email" required
        value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label>Neues Super-Admin-Passwort (mind. 20 Zeichen)<input
        type="password" autoComplete="new-password" minLength={20}
        required value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <label>Einmaliger Einrichtungscode aus Railway<input
        type="password" autoComplete="off" required value={setupToken}
        onChange={e=>setSetupToken(e.target.value)}/></label>
      <button type="submit" disabled={busy}>{busy?"Prüfe…":"Super Admin einmalig erstellen"}</button>
    </form>}
    {message&&<p role="status">{message}</p>}
  </main>;
}
