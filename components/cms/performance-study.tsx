import { AudioLines, ArrowUpRight, ImageIcon } from "lucide-react";
// An editorial illustration, deliberately not a photograph, player, or sample AI result.
export function PerformanceStudy() {
  return (
    <figure
      className="performance-study"
      aria-label="Concept illustration: one reference image and your own music. No generated performance is shown."
    >
      <div className="study-top">
        <span>SINGMOTION / CREATIVE STUDY</span>
        <ArrowUpRight size={18} />
      </div>
      <div className="study-portrait">
        <span className="study-label">
          <ImageIcon size={13} /> REFERENCE IMAGE
        </span>
        <svg viewBox="0 0 220 250" aria-hidden="true">
          <path
            fill="#aaa7d3"
            d="M40 250c0-45 18-72 55-80l-3-21h38l-2 21c35 9 52 39 56 80Z"
          />
          <path
            fill="#dbd8ec"
            d="M67 70c0-43 91-48 91 8l-8 54c-5 22-25 35-39 35s-36-19-39-39Z"
          />
          <path
            fill="#36364f"
            d="M60 134c-15-46-10-89 25-107 31-16 72-2 80 35 9 39-2 70-8 87l-14-12 4-42c-21-5-41-20-48-33-3 18-17 32-30 35l8 47Z"
          />
          <path
            fill="none"
            stroke="#646078"
            strokeWidth="2"
            strokeLinecap="round"
            d="m87 111 9-1m25 0 9 1m-21 4-2 13 5 2m-13 12q10 4 19-1"
          />
          <path
            fill="#575477"
            d="M28 250c2-39 25-61 62-70l20 37 23-37c41 12 58 32 60 70Z"
          />
        </svg>
        <span className="portrait-note">A face for your sound.</span>
      </div>
      <div className="study-audio">
        <div>
          <AudioLines size={20} />
          <span>YOUR OWN MUSIC</span>
          <span className="study-plus">+</span>
        </div>
        <div className="study-wave" aria-hidden="true">
          {Array.from({ length: 44 }, (_, i) => (
            <i
              key={i}
              style={{
                height: `${Math.round(6 + Math.abs(Math.sin(i * 1.3) * Math.cos(i * 0.24)) * 34)}px`,
              }}
            />
          ))}
        </div>
      </div>
      <figcaption>
        <span>
          One image. One song.
          <br />
          <strong>A performance, imagined.</strong>
        </span>
        <span>
          Concept illustration
          <br />
          Not a generated result
        </span>
      </figcaption>
    </figure>
  );
}
