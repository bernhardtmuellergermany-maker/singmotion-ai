"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import { Play, Pause, Scissors } from "lucide-react";
import { moveSelection } from "@/lib/studio-editor";
export default function Waveform({
  url,
  duration,
  start,
  end,
  onChange,
}: {
  url: string;
  duration: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
}) {
  const [peaks, setPeaks] = useState<number[]>([]),
    [playing, setPlaying] = useState(false),
    [error, setError] = useState(""),
    [position, setPosition] = useState(0),
    [dragging, setDragging] = useState(false);
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
  const bars = useMemo(() => {
    const count = Math.min(peaks.length || 160, 160);
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
          height: `${Math.max(3, p * 76)}%`,
          background:
            (i / values.length) * duration >= start &&
            (i / values.length) * duration <= end
              ? "#e9c6ff"
              : "#536884",
        }}
      />
    ));
  }, [peaks, duration, start, end]);
  return (
    <div className="wave-editor">
      <div className="wave-toolbar">
        <span>
          <Scissors size={14} /> Find your moment
        </span>
        <button type="button" className="text-button" onClick={toggle}>
          {playing ? <Pause size={14} /> : <Play size={14} />} Preview selection
        </button>
      </div>
      <div
        className="wave-viewport"
        role="region"
        aria-label="Audio waveform and selection"
      >
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
              background: "rgba(168,85,247,.22)",
              border: "0",
              left: `${(start / duration) * 100}%`,
              width: `${((end - start) / duration) * 100}%`,
            }}
          />
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
              className="wave-handle"
              style={{
                left: `${((handle === "start" ? start : end) / duration) * 100}%`,
              }}
              onPointerDown={(e) => drag(e, handle)}
              onPointerMove={(e) => move(e, handle)}
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
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i}>{((duration * i) / 4).toFixed(2)}s</span>
          ))}
        </div>
      </div>
      <div className="time-inputs">
        <label>
          Start (seconds)
          <input
            aria-label="Start seconds"
            type="number"
            step="0.001"
            min="0"
            max={end - 0.1}
            value={Number(start.toFixed(3))}
            onChange={(e) => {
              const value = e.target.valueAsNumber;
              if (Number.isFinite(value))
                onChange(
                  Math.max(0, end - 300, Math.min(value, end - 0.1)),
                  end,
                );
            }}
          />
        </label>
        <span>—</span>
        <label>
          End (seconds)
          <input
            aria-label="End seconds"
            type="number"
            step="0.001"
            min={start + 0.1}
            max={duration}
            value={Number(end.toFixed(3))}
            onChange={(e) => {
              const value =
                e.target.value.valueOf() === "" ? NaN : e.target.valueAsNumber;
              if (Number.isFinite(value))
                onChange(
                  start,
                  Math.max(start + 0.1, Math.min(duration, start + 300, value)),
                );
            }}
          />
        </label>
        <strong aria-label="Selected duration">{Math.max(0, end - start).toFixed(2)}s selected</strong>
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
