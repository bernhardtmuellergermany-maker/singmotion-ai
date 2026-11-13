"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import { Play, Pause, RotateCcw, Minus, Plus, Trash2 } from "lucide-react";
import { moveSelection } from "@/lib/studio-editor";
export default function Waveform({
  url,
  duration,
  start,
  end,
  onChange,
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
    [editingTime, setEditingTime] = useState<"start" | "end" | null>(null),
    [timeDraft, setTimeDraft] = useState(""),
    [timeInputError, setTimeInputError] = useState(""),
    [zoomLevel, setZoomLevel] = useState(0),
    // Keep the visible timeline fixed while trimming or moving the selection.
    // The window changes only on an explicit zoom action, never on onChange.
    [lockedView, setLockedView] = useState<{start:number;span:number}|null>(null);
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
      if (!player || player.paused) return;
      if (player.currentTime >= end) {
        player.pause();
        player.currentTime = end;
        setPosition(end);
        segment.current = false;
        return;
      }
      frame = requestAnimationFrame(checkEnd);
    };
    frame = requestAnimationFrame(checkEnd);
    return () => cancelAnimationFrame(frame);
  }, [playing, end]);
  // A new trim selection must immediately constrain any ongoing audio.
  // Zoom alone changes the visual window, not these absolute clip boundaries.
  useEffect(() => {
    const player=audio.current;
    if (!player) return;
    if (player.currentTime < start || player.currentTime > end) {
      ++playRequest.current;
      player.pause();
      player.currentTime=start;
      setPosition(start);
      segment.current=false;
    }
  }, [start,end]);
  // Zoom may center on the selection, but moving handles must not pan or
  // rescale the waveform underneath the pointer. Persist the current viewport
  // after the first edit; only explicit +/- zoom chooses a fresh viewport.
  const calculatedSpan = Math.min(duration, Math.max(Math.min(duration, end - start + 8), duration / Math.pow(1.45, zoomLevel)));
  const viewSpan = Math.max(0.001, Math.min(duration, lockedView?.span ?? calculatedSpan));
  const viewStart = Math.max(0, Math.min(duration - viewSpan,
    lockedView?.start ?? ((start + end) / 2 - viewSpan / 2)));
  const viewPercent = (seconds: number) => ((seconds - viewStart) / viewSpan) * 100;
  const lockViewport = () => {
    if(!lockedView)setLockedView({start:viewStart,span:viewSpan});
  };
  const zoomIn = () => {setLockedView(null);setZoomLevel(level => Math.min(12, level + 1));};
  const zoomOut = () => {setLockedView(null);setZoomLevel(level => Math.max(0, level - 1));};
  function drag(
    e: React.PointerEvent<HTMLButtonElement>,
    handle: "start" | "end",
  ) {
    audio.current?.pause();
    lockViewport();
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
          Math.min(duration, viewStart + ((e.clientX - rect.left) / rect.width) * viewSpan),
        ) * 100,
      ) / 100;
    if (handle === "start")
      onChange(Math.max(0, end - 300, Math.min(val, end - 5)), end);
    else
      onChange(
        start,
        Math.max(start + 5, Math.min(val, start + 300, duration)),
      );
  }
  // An interrupted play() promise is expected when a user quickly taps Pause
  // or Replay. It must not be displayed as an audio-loading failure.
  const playRequest = useRef(0);
  function startPlayback(a: HTMLAudioElement) {
    const request = ++playRequest.current;
    setError("");
    void a.play().catch((reason: unknown) => {
      if (request !== playRequest.current) return;
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError("Playback could not start. Try the audio controls.");
    });
  }
  function toggle() {
    const a = audio.current;
    if (!a) return;
    if (!a.paused) {
      ++playRequest.current;
      a.pause();
      setError("");
      return;
    }
    segment.current = true;
    // Resume a paused selection; restart only after reaching its end or leaving it.
    if (a.currentTime < start || a.currentTime >= end - 0.015) a.currentTime = start;
    setPosition(a.currentTime);
    startPlayback(a);
  }
  function replay() {
    const a = audio.current;
    if (!a) return;
    segment.current = true;
    // Seeking a playing element does not require pause(): pause() can reject
    // an in-flight play() call on Chrome/Android and show a false error.
    a.currentTime = start;
    setPosition(start);
    if (a.paused) startPlayback(a);
    else setError("");
  }
  const formatTime=(n:number)=>String(Math.floor(n/60)).padStart(2,"0")+":"+String(Math.floor(n%60)).padStart(2,"0");
  const formatHundredths=(seconds:number)=>{const ms=Math.max(0,Math.round(seconds*1000));return String(Math.floor(ms/60000)).padStart(2,"0")+":"+String(Math.floor(ms%60000/1000)).padStart(2,"0")+"."+String(ms%1000).padStart(3,"0");};
  const minimumClipSeconds = 5;
  // Accept both the waveform's displayed mm:ss.xx values and raw seconds.
  function parseTime(value: string): number | null {
    const raw = value.trim().replace(",", ".");
    if (!raw) return null;
    const parts = raw.split(":");
    if (parts.length > 3 || parts.some(part => !/^\d+(?:\.\d+)?$/.test(part))) return null;
    if (parts.length > 1 && parts.slice(1).some(part => Number(part) >= 60)) return null;
    const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) / 1000 : null;
  }
  function openTimeEditor(which: "start" | "end") {
    if (editingTime === which) {setEditingTime(null);setTimeInputError("");return;}
    setTimeDraft(formatHundredths(which === "start" ? start : end));
    setTimeInputError("");
    setEditingTime(which);
  }
  function saveTimeEditor() {
    if (!editingTime) return;
    const value = parseTime(timeDraft);
    if (value === null || value < 0 || value > duration) {
      setTimeInputError("Enter a valid time from 00:00 to " + formatHundredths(duration) + ".");
      return;
    }
    lockViewport();
    const clipLength = Math.max(minimumClipSeconds, Math.min(300, end - start));
    if (editingTime === "start") {
      if (value > duration - minimumClipSeconds + 0.0001) {
        setTimeInputError("Start must be at least 5 seconds before the end of the audio.");
        return;
      }
      // Moving Start moves End with it so the entered Start is never silently discarded.
      onChange(value, Math.min(duration, Math.round((value + clipLength) * 1000) / 1000));
    } else {
      if (value < minimumClipSeconds - 0.0001) {
        setTimeInputError("End must be at least 5 seconds into the audio.");
        return;
      }
      // Keep Start when possible. Otherwise shift the window so End is exact.
      const nextStart = value - start >= minimumClipSeconds && value - start <= 300
        ? start
        : Math.max(0, Math.round((value - clipLength) * 1000) / 1000);
      onChange(nextStart, value);
    }
    setTimeInputError("");
    setEditingTime(null);
  }
  function adjust(which: "start" | "end", amount: number) {
    const current = parseTime(timeDraft) ?? (which === "start" ? start : end);
    const lower = which === "start" ? 0 : minimumClipSeconds;
    const upper = which === "start" ? duration - minimumClipSeconds : duration;
    setTimeDraft(formatHundredths(Math.max(lower, Math.min(upper, Math.round((current + amount) * 1000) / 1000))));
    setTimeInputError("");
  }
  const bars = useMemo(() => {
    const count = Math.min(peaks.length || 220, 220);
    const values = Array.from({ length: count }, (_, i) => {
      if (!peaks.length) return 0.08;
      const from = Math.max(0, Math.min(peaks.length - 1, Math.floor(((viewStart + (i / count) * viewSpan) / duration) * peaks.length))),
        to = Math.max(from + 1, Math.min(peaks.length, Math.ceil(((viewStart + ((i + 1) / count) * viewSpan) / duration) * peaks.length)));
      return Math.max(...peaks.slice(from, to));
    });
    return values.map((p, i) => (
      <i
        key={i}
        style={{
          height: `${Math.max(5, p * 92)}%`,
          background:
            viewStart + (i / values.length) * viewSpan >= start &&
            viewStart + (i / values.length) * viewSpan <= end
              ? "#9c54ff"
              : "#58627b",
        }}
      />
    ));
  }, [peaks, duration, start, end, viewStart, viewSpan]);
  return (
    <div className="wave-editor studio-modern-wave">
      <div
        className="wave-viewport"
        role="region"
        aria-label="Audio waveform and selection"
      >
        <div className="studio-wave-meta studio-unified-toolbar">
          <div className="studio-wave-actions studio-unified-actions">
            <button type="button" className="studio-wave-play" onClick={toggle} aria-label={playing?"Pause audio":"Play selected audio"}>{playing?<Pause size={19}/>:<Play size={19}/>}</button>
            <button type="button" className="studio-wave-play" onClick={replay} aria-label="Replay selected audio from start" title="Replay selected audio"><RotateCcw size={18}/></button>
            {(["start","end"] as const).map(which => (
              <div key={which} className={"studio-inline-time "+(editingTime===which?"is-editing":"")}>
                <span>{which==="start"?"Start":"End"}</span>
                <button type="button" className="studio-inline-time-trigger" aria-label={`Edit ${which} time`} aria-expanded={editingTime===which} onClick={()=>openTimeEditor(which)}>{formatHundredths(which==="start"?start:end)}</button>
                
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
              lockViewport();
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
                  ((e.clientX - origin.x) / rect.width) * viewSpan,
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
              lockViewport();
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
              left: `${viewPercent(start)}%`,
              width: `${((end - start) / viewSpan) * 100}%`,
            }}
            >
              <span className="wave-selection-hit" aria-hidden="true" />
            </div>
          <div
            className="playhead"
            style={{ left: `${viewPercent(position)}%`, display: position >= viewStart && position <= viewStart + viewSpan ? undefined : "none" }}
          />
          {(["start", "end"] as const).map((handle) => (
            <button
              type="button"
              role="slider"
              aria-label={`${handle === "start" ? "Start" : "End"} of selection`}
              aria-valuemin={handle === "start" ? 0 : start + 5}
              aria-valuemax={
                handle === "start" ? end - 5 : Math.min(duration, start + 300)
              }
              aria-valuenow={handle === "start" ? start : end}
              key={handle}
              className={`wave-handle wave-handle-${handle}`}
              style={{
                left: `${viewPercent(handle === "start" ? start : end)}%`,
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
                lockViewport();
                const delta =
                  (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 0.01);
                if (handle === "start")
                  onChange(
                    Math.max(0, end - 300, Math.min(end - 5, start + delta)),
                    end,
                  );
                else
                  onChange(
                    start,
                    Math.max(
                      start + 5,
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
            <span key={i}>{formatTime(viewStart + (viewSpan * i) / 6)}</span>
          ))}
        </div>
        <div className="studio-wave-zoom-controls" role="group" aria-label="Waveform zoom controls">
          <span className="studio-wave-zoom-label">Zoom</span>
          <button type="button" aria-label="Zoom out waveform" title="Zoom out" onClick={zoomOut} disabled={zoomLevel === 0}><Minus size={15}/></button>
          <button type="button" aria-label="Zoom in waveform around selection" title="Zoom in around selection" onClick={zoomIn} disabled={viewSpan <= Math.min(duration, end - start + 8) + 0.001 || zoomLevel >= 12}><Plus size={15}/></button>
        </div>
        {editingTime && <div className="studio-wave-time-editor" role="group" aria-label={`Edit ${editingTime} time`}>
          <span className="studio-wave-editor-label">{editingTime === "start" ? "Start" : "End"}</span>
          <input aria-label={editingTime === "start" ? "Start time in minutes and seconds" : "End time in minutes and seconds"}
            autoFocus type="text" inputMode="decimal" autoComplete="off" placeholder="MM:SS.sss"
            onFocus={e=>e.currentTarget.select()}
            value={timeDraft} aria-invalid={!!timeInputError}
            aria-describedby={timeInputError ? "studio-time-input-error" : undefined}
            onChange={e=>{setTimeDraft(e.target.value);setTimeInputError("");}}
            onKeyDown={e=>{
              if (e.key === "Enter") {e.preventDefault();saveTimeEditor();}
              if (e.key === "Escape") {e.preventDefault();setEditingTime(null);setTimeInputError("");}
            }}/>
          <button type="button" aria-label={`Decrease ${editingTime}`} onClick={()=>adjust(editingTime,-1)}><Minus size={16}/></button>
          <button type="button" aria-label={`Increase ${editingTime}`} onClick={()=>adjust(editingTime,1)}><Plus size={16}/></button>
          <button type="button" className="studio-wave-time-done" onClick={()=>saveTimeEditor()}>Apply</button>
          {timeInputError && <span className="studio-wave-time-error" id="studio-time-input-error" role="alert">{timeInputError}</span>}
        </div>}
      </div>
      <audio
        ref={audio}
        controls
        src={url}
        preload="metadata"
        onPlay={() => {
          const a=audio.current;
          if(a){
            // Native controls can start playback without using our Play button.
            segment.current=true;
            if(a.currentTime < start || a.currentTime >= end){
              a.currentTime=start;
              setPosition(start);
            }
          }
          setPlaying(true);setError("");
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => {
          const a=audio.current;
          if(!a)return;
          if(a.currentTime >= end){
            a.pause();
            a.currentTime=end;
            setPosition(end);
            segment.current=false;
          }else if(a.currentTime < start){
            a.currentTime=start;
            setPosition(start);
          }else{
            setPosition(a.currentTime);
          }
        }}
        onSeeking={() => {
          const a=audio.current;
          if(!a)return;
          // Seeking with the native audio controls must never disable the
          // clip-end guard. Snap seeks outside the selection back to its start.
          if(a.currentTime < start || a.currentTime > end){
            a.currentTime=start;
            setPosition(start);
            segment.current=!a.paused;
          }
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
