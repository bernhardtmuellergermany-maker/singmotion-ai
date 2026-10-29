"use client";
import { useEffect, useRef, useState } from "react";
import { Trash2, Pause, Play } from "lucide-react";
import type { Asset } from "@/lib/domain";

const time = (n: number) => {
  const s = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
};

export function HomeUploadedAudio({
  audio, active, onRemove,
}: {
  audio: Asset;
  active: boolean;
  onRemove: () => void;
}) {
  const player = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const duration = audio.duration || 0;
  const playbackUrl = "/api/assets/" + encodeURIComponent(audio.id) + (/\.(wav|m4a)$/i.test(audio.name) ? "?playback=1" : "");

  useEffect(() => {
    const controller = new AbortController();
    let ctx: AudioContext | null = null;
    setPeaks([]);
    setPosition(0);
    setPlaying(false);
    (async () => {
      try {
        const res = await fetch(playbackUrl, { signal: controller.signal });
        if (!res.ok) return;
        const raw = await res.arrayBuffer();
        if (controller.signal.aborted) return;
        ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(raw);
        const samples = decoded.getChannelData(0);
        const count = 68;
        const step = Math.max(1, Math.floor(samples.length / count));
        const next = Array.from({ length: count }, (_, i) => {
          let peak = 0;
          const offset = i * step;
          for (let j = offset; j < Math.min(samples.length, offset + step); j += Math.max(1, Math.floor(step / 180)))
            peak = Math.max(peak, Math.abs(samples[j]));
          return Math.max(.08, peak);
        });
        if (!controller.signal.aborted) setPeaks(next);
      } catch {
        // The native audio player remains usable when waveform decoding fails.
      } finally {
        if (ctx) await ctx.close().catch(() => {});
      }
    })();
    return () => { controller.abort(); player.current?.pause(); };
  }, [audio.id, playbackUrl]);

  useEffect(() => {
    if (!active) player.current?.pause();
  }, [active]);

  const seek = (seconds: number) => {
    const next = Math.min(Math.max(0, seconds), duration);
    if (player.current) player.current.currentTime = next;
    setPosition(next);
  };
  const toggle = () => {
    const el = player.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  };

  return (
    <div className="sm-home-uploaded" onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()} onTouchEnd={e => e.stopPropagation()}>
      <div className="sm-home-audio-player">
        <div className="sm-home-audio-heading">
          <div className="sm-home-audio-file">
            <strong title={audio.name}>{audio.name}</strong>
            <span>{time(duration)} total</span>
          </div>
          <button type="button" className="sm-home-audio-delete" aria-label="Remove uploaded audio" onClick={() => { player.current?.pause(); onRemove(); }}><Trash2 size={19}/></button>
        </div>
        <div className="sm-home-audio-wave" role="slider" tabIndex={0} aria-label="Seek within uploaded audio" aria-valuemin={0} aria-valuemax={Math.max(0,Math.floor(duration))} aria-valuenow={Math.round(position)} onPointerDown={e=>{e.stopPropagation();const rect=e.currentTarget.getBoundingClientRect();seek(((e.clientX-rect.left)/rect.width)*duration);e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const rect=e.currentTarget.getBoundingClientRect();seek(((e.clientX-rect.left)/rect.width)*duration);}} onKeyDown={e=>{if(e.key==="Home"){e.preventDefault();seek(0);}else if(e.key==="End"){e.preventDefault();seek(duration);}else if(e.key==="ArrowRight"||e.key==="ArrowLeft"){e.preventDefault();seek(position+(e.key==="ArrowRight"?1:-1));}}}>
          {(peaks.length ? peaks : Array.from({length:68},()=>.13)).map((peak,i) => (
            <i key={i} style={{
              height: Math.max(8,Math.min(96,peak*96))+"%",
              background: duration > 0 && i / 68 <= position / duration ? "#b67bff" : "#5c587c",
            }} />
          ))}
        </div>
        <div className="sm-home-audio-playback">
          <button type="button" className="sm-home-audio-play" aria-label={playing?"Pause audio":"Play audio"} onClick={toggle}>
            {playing?<Pause size={18}/>:<Play size={18}/>}
          </button>
          <div className="sm-home-audio-progress">
            <input type="range" min={0} max={Math.max(1,duration)} step={.01} value={position}
              aria-label="Audio playback position"
              onPointerDown={e=>e.stopPropagation()} onPointerMove={e=>e.stopPropagation()}
              onChange={e=>seek(Number(e.target.value))}/>
            <span>{time(position)} / {time(duration)}</span>
          </div>
        </div>
        <audio ref={player} src={playbackUrl} preload="metadata"
          onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)}
          onTimeUpdate={e=>setPosition(e.currentTarget.currentTime)}
          onEnded={()=>setPlaying(false)} />
      </div>

    </div>
  );
}
