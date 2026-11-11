"use client";
import {useState} from "react";
import Link from "next/link";
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
      setMessage("Super-Admin-Zugang ist bereit. Jetzt im CMS anmelden.");
    }catch(error){setMessage(error instanceof Error?error.message:"Einrichtung fehlgeschlagen.");}
    finally{setBusy(false);}
  }
  return <main style={{maxWidth:520,margin:"3rem auto",padding:"1.5rem"}}>
    <h1>SingMotion AI – CMS-Adminzugang einrichten oder wiederherstellen</h1>
    <p>Diese geschützte Funktion kann einen ersten CMS-Administrator anlegen oder den Zugang zum einzigen bestehenden Super-Admin wiederherstellen. Nutze die E-Mail-Adresse des vorhandenen CMS-Administrators und den einmaligen Code <code>CMS_OWNER_SETUP_TOKEN</code> aus Railway → jeweilige Umgebung → singmotion-ai → Variables. Der Code ist für Staging und Production unterschiedlich. Deine Medien und CMS-Inhalte bleiben erhalten.</p>
    {done?<Link href="/admin">Zum CMS-Login</Link>:
    <form onSubmit={create} style={{display:"grid",gap:"1rem"}}>
      <label>Admin-E-Mail<input type="email" autoComplete="email" required
        value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label>Neues Super-Admin-Passwort (mind. 20 Zeichen)<input
        type="password" autoComplete="new-password" minLength={20}
        required value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <label>Einmaliger Einrichtungscode aus Railway<input
        type="password" autoComplete="off" required value={setupToken}
        onChange={e=>setSetupToken(e.target.value)}/></label>
      <button type="submit" disabled={busy}>{busy?"Prüfe…":"Adminzugang einrichten / wiederherstellen"}</button>
    </form>}
    {message&&<p role="status">{message}</p>}
  </main>;
}
