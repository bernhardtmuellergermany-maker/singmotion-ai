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
    [timeInputError, setTimeInputError] = useState("");
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
  const formatHundredths=(seconds:number)=>{const centiseconds=Math.round(Math.max(0,seconds)*100);return String(Math.floor(centiseconds/6000)).padStart(2,"0")+":"+String(Math.floor((centiseconds%6000)/100)).padStart(2,"0")+"."+String(centiseconds%100).padStart(2,"0");};
  const minimumClipSeconds = 5;
  const roundHundredths = (value: number) => Math.round(value * 100) / 100;
  function openTimeEditor(which: "start" | "end") {
    if (editingTime === which) {
      setEditingTime(null);
      setTimeInputError("");
      return;
    }
    // The field displays the same mm:ss.cc format as the visible timeline.
    setTimeDraft(formatHundredths(which === "start" ? start : end));
    setTimeInputError("");
    setEditingTime(which);
  }
  function parseTimeDraft() {
    const raw = timeDraft.trim().replace(",", ".");
    if (!raw) return null;
    const time = raw.match(/^(\\d+):([0-5]\\d)(?:\\.(\\d{1,2}))?$/);
    const seconds = time
      ? Number(time[1]) * 60 + Number(time[2]) + Number("0." + (time[3] || "0"))
      : /^\\d+(?:\\.\\d{1,2})?$/.test(raw) ? Number(raw) : NaN;
    return Number.isFinite(seconds) ? roundHundredths(seconds) : null;
  }
  function selectedTimes(which: "start" | "end", requested: number) {
    const selectionLength = end - start;
    const normalizedDuration = Math.max(0, duration);
    if (requested < 0 || requested > normalizedDuration + 0.000001) return null;
    if (which === "start") {
      // Preserve the current clip duration when moving its start past its end.
      const nextEnd = requested > end - minimumClipSeconds
        ? requested + selectionLength : end;
      if (nextEnd > normalizedDuration + 0.000001 || nextEnd - requested > 300) return null;
      return [requested, nextEnd] as const;
    }
    // Symmetric behavior when moving the end before the current start.
    const nextStart = requested < start + minimumClipSeconds
      ? requested - selectionLength : start;
    if (nextStart < -0.000001 || requested - nextStart > 300) return null;
    return [Math.max(0, nextStart), requested] as const;
  }
  function saveTimeEditor() {
    if (!editingTime) return;
    const value = parseTimeDraft();
    const range = value === null ? null : selectedTimes(editingTime, value);
    if (!range) {
      setTimeInputError(`Enter a valid time (mm:ss.cc or seconds) within the ${formatHundredths(duration)} song. The selected clip must last 5–300 seconds.`);
      return;
    }
    onChange(range[0], range[1]);
    setTimeDraft(formatHundredths(value!));
    setTimeInputError("");
    setEditingTime(null);
  }
  function adjust(which: "start" | "end", amount: number) {
    const basis = parseTimeDraft() ?? (which === "start" ? start : end);
    const target = roundHundredths(Math.max(0, Math.min(duration, basis + amount)));
    const range = selectedTimes(which, target);
    if (!range) {
      setTimeInputError("This time would move the selection outside the song.");
      return;
    }
    setTimeDraft(formatHundredths(target));
    setTimeInputError("");
    onChange(range[0], range[1]);
  }
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
              aria-valuemin={handle === "start" ? 0 : start + 5}
              aria-valuemax={
                handle === "start" ? end - 5 : Math.min(duration, start + 300)
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
            <span key={i}>{formatTime((duration * i) / 6)}</span>
          ))}
        </div>
        {editingTime && <div className="studio-wave-time-editor" role="group" aria-label={`Edit ${editingTime} time`}>
          <span className="studio-wave-editor-label">{editingTime === "start" ? "Start" : "End"}</span>
          <input aria-label={editingTime === "start" ? "Start time in minutes and seconds" : "End time in minutes and seconds"}
            autoFocus type="text" inputMode="decimal" autoComplete="off" placeholder="mm:ss.cc" placeholder="MM:SS.ss"
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
          <button type="button" className="studio-wave-time-done" onClick={()=>saveTimeEditor()}>Done</button>
          {timeInputError && <span className="studio-wave-time-error" id="studio-time-input-error" role="alert">{timeInputError}</span>}
        </div>}
      </div>
      <audio
        ref={audio}
        controls
        src={url}
        preload="metadata"
        onPlay={() => { setPlaying(true); setError(""); }}
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
