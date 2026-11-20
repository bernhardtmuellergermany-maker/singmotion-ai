"use client";

import {useId,useState} from "react";
import {ExternalLink,FileMusic,Music2} from "lucide-react";
import {normalizeSunoSongLink} from "@/lib/suno-song-link";
import styles from "./suno-song-import.module.css";

/** Guided official-download handoff, never stream-ripping or a media proxy. */
export function SunoSongImport({disabled,onChooseFile}:{
  disabled:boolean;
  onChooseFile:()=>void;
}){
  const id=useId();
  const [link,setLink]=useState("");
  const canonical=normalizeSunoSongLink(link);
  const invalid=link.trim().length>0&&!canonical;
  return <details className={styles.panel}>
    <summary className={styles.summary}><Music2 size={20} aria-hidden="true"/>
      <span><strong>Have a song on Suno?</strong><small>Use your Suno share link</small></span>
      <span aria-hidden="true" className={styles.plus}>+</span>
    </summary>
    <div className={styles.body}>
      <p className={styles.description}>Paste your own Suno song link. Open it in Suno, use Suno’s official Download option, then upload the downloaded audio here.</p>
      <label className={styles.label} htmlFor={id}>Suno song link</label>
      <input id={id} className={styles.input} type="url" inputMode="url"
        autoCapitalize="off" autoComplete="off" spellCheck={false}
        placeholder="https://suno.com/s/..." value={link} disabled={disabled}
        onChange={e=>setLink(e.target.value.slice(0,501))}/>
      {invalid&&<p className={styles.error} role="alert">Enter a valid suno.com/s/… or suno.com/song/… link.</p>}
      {canonical&&<div className={styles.steps}>
        <p className={styles.ready} role="status">Suno share link recognized.</p>
        <a className={styles.open} href={canonical} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={17} aria-hidden="true"/> 1. Open song in Suno and download it
        </a>
        <button className={styles.choose} type="button" disabled={disabled} onClick={onChooseFile}>
          <FileMusic size={18} aria-hidden="true"/> 2. Choose downloaded audio file
        </button>
        <p className={styles.note}>MP3, WAV or M4A · The usual upload, waveform and 250-second clip limit apply. A public share link alone is not a downloadable audio file. Use only a song you have permission to download and use.</p>
      </div>}
    </div>
  </details>;
}
