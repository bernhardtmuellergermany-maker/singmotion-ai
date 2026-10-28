import { cameraHelp, cameras } from "@/lib/domain";

export const metadata = {
  title: "Camera movements help · SingMotion AI",
  description: "Learn how camera movement directions guide generated videos.",
};

export default function CameraMovementsHelp() {
  return (
    <main id="content" style={{ maxWidth: 760, margin: "3rem auto", padding: "0 1.25rem", lineHeight: 1.7 }}>
      <a href="/studio">← Back to Studio</a>
      <h1>Camera movements</h1>
      <p>Select one camera direction for each video. The chosen movement is translated into an English instruction for the AI video provider. The result may differ depending on the input image, audio, and provider capabilities; no movement is guaranteed.</p>
      <dl>
        {cameras.map((camera) => (
          <div key={camera} style={{ marginBottom: "1.25rem" }}>
            <dt><strong>{camera}</strong></dt>
            <dd style={{ marginLeft: 0 }}>{cameraHelp[camera]}</dd>
          </div>
        ))}
      </dl>
      <h2>Tips</h2>
      <p>A reference image with visible space around the singer may give the model more room to simulate camera motion. Keep one main camera direction per clip. Optional custom performance instructions are combined with the selected camera direction, not substituted for it.</p>
    </main>
  );
}
