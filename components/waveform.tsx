"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import { Play, Pause, RotateCcw, Minus, Plus, Trash2, Music2 } from "lucide-react";
import { moveSelection } from "@/lib/studio-editor";
export default function Waveform({
  url,
  duration,
  start,
  end,
  onChange,
  filename,
  onRemove,
  removeDisabled = false,
}: {
  url: string;
  duration: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  filename?: string;
  onRemove?: () => void;
  removeDisabled?: boolean;
}) {
  const [peaks, setPeaks] = useState<number[]>([]),
    [playing, setPlaying] = useState(false),
    [error, setError] = useState(""),
    [position, setPosition] = useState(0),
    [dragging, setDragging] = useState(false),
    [editingTime, setEditingTime] = useState<"start" | "end" | null>(null);
  const audio = useRef<HTMLAudioElement>(null),
    strip = useRef<HTMLDivElement>(null),
    segment = useRef(false),
    dragOrigin = useRef<{ x: number; start: number; end: number } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let context: AudioContext | undefined;
    async function decode() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Audio unavailable");
        context = new AudioContext();
        const buffer = await context.decodeAudioData(
          await response.arrayBuffer(),
        );
        const data = buffer.getChannelData(0),
          count = 2048,
          block = Math.max(1, Math.floor(data.length / count));
        const p = Array.from({ length: count }, (_, i) => {
          let max = 0;
          for (
            let k = i * block;
            k < Math.min((i + 1) * block, data.length);
            k += Math.max(1, Math.floor(block / 300))
          )
            max = Math.max(max, Math.abs(data[k]));
          return max;
        });
        if (!controller.signal.aborted) setPeaks(p);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError"))
          setError(
            "Waveform preview is unavailable. The audio player and precise time controls still work.",
          );
      } finally {
        await context?.close();
      }
    }
    decode();
    return () => {
      controller.abort();
    };
  }, [url]);
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const checkEnd = () => {
      const player = audio.current;
      if (player && segment.current && player.currentTime >= end) {
        player.pause();
        player.currentTime = end;
        segment.current = false;
        return;
      }
      frame = requestAnimationFrame(checkEnd);
    };
    frame = requestAnimationFrame(checkEnd);
    return () => cancelAnimationFrame(frame);
  }, [playing, end]);
  function drag(
    e: React.PointerEvent<HTMLButtonElement>,
    handle: "start" | "end",
  ) {
    audio.current?.pause();
    setDragging(true);
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    move(e, handle);
  }
  function move(
    e: React.PointerEvent<HTMLButtonElement>,
    handle: "start" | "end",
  ) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const rect = strip.current?.getBoundingClientRect();
    if (!rect) return;
    const val =
      Math.round(
        Math.max(
          0,
          Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration),
        ) * 100,
      ) / 100;
    if (handle === "start")
      onChange(Math.max(0, end - 300, Math.min(val, end - 0.1)), end);
    else
      onChange(
        start,
        Math.max(start + 0.1, Math.min(val, start + 300, duration)),
      );
  }
  function toggle() {
    const a = audio.current;
    if (!a) return;
    if (playing) {
      a.pause();
      return;
    }
    segment.current = true;
    a.currentTime = start;
    void a
      .play()
      .catch(() =>
        setError("Playback could not start. Try the audio controls."),
      );
  }
  function replay() {
    const a=audio.current;
    if(!a)return;
    segment.current=true;
    a.pause();
    a.currentTime=start;
    setPosition(start);
    void a.play().catch(()=>setError("Playback could not start. Try the audio controls."));
  }
  const formatTime=(n:number)=>String(Math.floor(n/60)).padStart(2,"0")+":"+String(Math.floor(n%60)).padStart(2,"0");
  const formatHundredths=(seconds:number)=>{const centiseconds=Math.round(Math.max(0,seconds)*100);return String(Math.floor(centiseconds/6000)).padStart(2,"0")+":"+String(Math.floor((centiseconds%6000)/100)).padStart(2,"0")+"."+String(centiseconds%100).padStart(2,"0");};
  const adjust=(which:"start"|"end",amount:number)=>which==="start"?onChange(Math.max(0,end-300,Math.min(end-.1,start+amount)),end):onChange(start,Math.max(start+.1,Math.min(duration,start+300,end+amount)));
  const bars = useMemo(() => {
    const count = Math.min(peaks.length || 220, 220);
    const values = Array.from({ length: count }, (_, i) => {
      if (!peaks.length) return 0.08;
      const from = Math.floor((i * peaks.length) / count),
        to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / count));
      return Math.max(...peaks.slice(from, to));
    });
    return values.map((p, i) => (
      <i
        key={i}
        style={{
          height: `${Math.max(5, p * 92)}%`,
          background:
            (i / values.length) * duration >= start &&
            (i / values.length) * duration <= end
              ? "#9c54ff"
              : "#58627b",
        }}
      />
    ));
  }, [peaks, duration, start, end]);
  return (
    <div className="wave-editor studio-modern-wave">
      <div
        className="wave-viewport"
        role="region"
        aria-label="Audio waveform and selection"
      >
        <div className="studio-wave-meta studio-unified-toolbar">
          <div className="studio-wave-filename"><Music2 size={18} aria-hidden="true"/><div className="studio-wave-file-text"><strong title={filename}>{filename}</strong><small>{formatTime(duration)} total</small></div></div>
          <div className="studio-wave-actions studio-unified-actions">
            <button type="button" className="studio-wave-play" onClick={toggle} aria-label={playing?"Pause audio":"Play selected audio"}>{playing?<Pause size={19}/>:<Play size={19}/>}</button>
            <button type="button" className="studio-wave-play" onClick={replay} aria-label="Replay selected audio from start" title="Replay selected audio"><RotateCcw size={18}/></button>
            {(["start","end"] as const).map(which => (
              <div key={which} className={"studio-inline-time "+(editingTime===which?"is-editing":"")}>
                <span>{which==="start"?"Start":"End"}</span>
                <button type="button" className="studio-inline-time-trigger" aria-label={`Edit ${which} time`} aria-expanded={editingTime===which} onClick={()=>setEditingTime(editingTime===which?null:which)}>{formatHundredths(which==="start"?start:end)}</button>
                {editingTime===which&&<div className="studio-inline-time-popover">
                  <input aria-label={which==="start"?"Start seconds":"End seconds"} autoFocus type="number" step="0.001" min={which==="start"?0:start+0.1} max={which==="start"?end-0.1:duration} value={Number((which==="start"?start:end).toFixed(3))} onChange={e=>{
                    const value=e.target.valueAsNumber;
                    if(!Number.isFinite(value))return;
                    if(which==="start")onChange(Math.max(0,end-300,Math.min(value,end-.1)),end);
                    else onChange(start,Math.max(start+.1,Math.min(duration,start+300,value)));
                  }}/>
                  <button type="button" aria-label={`Decrease ${which}`} onClick={()=>adjust(which,-1)}><Minus size={14}/></button>
                  <button type="button" aria-label={`Increase ${which}`} onClick={()=>adjust(which,1)}><Plus size={14}/></button>
                  <button type="button" className="studio-inline-time-done" onClick={()=>setEditingTime(null)}>Done</button>
                </div>}
              </div>
            ))}
            <div className="studio-inline-duration"><span>Duration</span><strong>{formatHundredths(Math.max(0,end-start))}</strong></div>
            {onRemove&&<button type="button" className="studio-wave-remove" aria-label="Remove audio" disabled={removeDisabled} onClick={onRemove}><Trash2 size={17}/></button>}
          </div>
        </div>
        <div
          className={`wave-strip ${dragging ? "is-dragging" : ""}`}
          ref={strip}
        >
          <div className="wave-bars" aria-hidden="true">
            {bars}
          </div>
          <div
            className="wave-selection"
            role="slider"
            tabIndex={0}
            aria-label="Move selected audio segment"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, duration - (end - start))}
            aria-valuenow={start}
            aria-valuetext={`${start.toFixed(3)} to ${end.toFixed(3)} seconds`}
            onPointerDown={(e) => {
              e.stopPropagation();
              audio.current?.pause();
              setDragging(true);
              e.currentTarget.setPointerCapture(e.pointerId);
              dragOrigin.current = { x: e.clientX, start, end };
            }}
            onPointerMove={(e) => {
              const origin = dragOrigin.current;
              const rect = strip.current?.getBoundingClientRect();
              if (
                !origin ||
                !rect ||
                !e.currentTarget.hasPointerCapture(e.pointerId)
              )
                return;
              onChange(
                ...moveSelection(
                  origin.start,
                  origin.end,
                  ((e.clientX - origin.x) / rect.width) * duration,
                  duration,
                ),
              );
            }}
            onPointerUp={() => {
              dragOrigin.current = null;
              setDragging(false);
            }}
            onPointerCancel={() => {
              dragOrigin.current = null;
              setDragging(false);
            }}
            onLostPointerCapture={() => {
              dragOrigin.current = null;
              setDragging(false);
            }}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              audio.current?.pause();
              onChange(
                ...moveSelection(
                  start,
                  end,
                  (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 0.01),
                  duration,
                ),
              );
            }}
            style={{
              cursor: "grab",
              touchAction: "none",
              background: "rgba(151,86,246,.13)",
              border: "0",
              left: `${(start / duration) * 100}%`,
              width: `${((end - start) / duration) * 100}%`,
            }}
            >
              <span className="wave-selection-hit" aria-hidden="true" />
            </div>
          <div
            className="playhead"
            style={{ left: `${(position / duration) * 100}%` }}
          />
          {(["start", "end"] as const).map((handle) => (
            <button
              type="button"
              role="slider"
              aria-label={`${handle === "start" ? "Start" : "End"} of selection`}
              aria-valuemin={handle === "start" ? 0 : start + 0.1}
              aria-valuemax={
                handle === "start" ? end - 0.1 : Math.min(duration, start + 300)
              }
              aria-valuenow={handle === "start" ? start : end}
              key={handle}
              className={`wave-handle wave-handle-${handle}`}
              style={{
                left: `${((handle === "start" ? start : end) / duration) * 100}%`,
              }}
              onPointerDown={(e) => { e.stopPropagation(); drag(e, handle); }}
              onPointerMove={(e) => { e.stopPropagation(); move(e, handle); }}
              onPointerUp={() => setDragging(false)}
              onPointerCancel={() => setDragging(false)}
              onLostPointerCapture={() => setDragging(false)}
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
                e.preventDefault();
                audio.current?.pause();
                const delta =
                  (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 0.01);
                if (handle === "start")
                  onChange(
                    Math.max(0, end - 300, Math.min(end - 0.1, start + delta)),
                    end,
                  );
                else
                  onChange(
                    start,
                    Math.max(
                      start + 0.1,
                      Math.min(duration, start + 300, end + delta),
                    ),
                  );
              }}
            />
          ))}
        </div>
        <div
          className="wave-time"
          
          aria-hidden="true"
        >
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i}>{formatTime((duration * i) / 6)}</span>
          ))}
        </div>
      </div>
      <audio
        ref={audio}
        controls
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => {
          const a = audio.current;
          if (a) {
            setPosition(a.currentTime);
            if (segment.current && a.currentTime >= end) {
              a.pause();
              segment.current = false;
            }
          }
        }}
        onSeeking={() => {
          if (
            audio.current &&
            (audio.current.currentTime < start ||
              audio.current.currentTime > end)
          )
            segment.current = false;
        }}
      />
      <small className="quiet">
        Recommended: 5–10 seconds with clear lead vocals. Selected audio is
        trimmed for the final generation.
      </small>
      {error && <p className="notice">{error}</p>}
    </div>
  );
}
