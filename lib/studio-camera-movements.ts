/** Shared camera movement library used by the public Help page and Studio.
 * Prompts are optional creative directions, NOT guaranteed AI camera controls.
 * Keep the first eight conservative; show experimental moves only on request.
 */
export type CameraMovement = {
  name:string;
  level:string;
  where:string;
  text:string;
  example:string;
  risk:string;
  direction:string;
  recommended:boolean;
};
export const cameraMovements:readonly CameraMovement[] = [
  {
    "name": "Static / locked shot",
    "level": "Studio preset",
    "where": "Easy starting point",
    "text": "No camera travel. Good for announcements, facial consistency and lip sync.",
    "example": "Static medium shot. The performer speaks calmly to the camera, maintains natural eye contact, and makes one small open-hand gesture.",
    "risk": "Even a static prompt cannot guarantee zero background or facial movement.",
    "direction": "Camera: Hold a steady medium shot with no camera travel.",
    "recommended": true
  },
  {
    "name": "Slow push-in",
    "level": "Quick idea / custom prompt",
    "where": "Emotion, choruses, strong openings",
    "text": "Camera physically moves closer as the shot becomes tighter.",
    "example": "Slowly push the camera from a medium shot toward a medium close-up. The singer performs warmly, briefly closes their eyes, then looks into the lens.",
    "risk": "Keep the mouth visible; too tight a crop may change facial details.",
    "direction": "Camera: Slowly push in from a medium shot to a medium close-up, then settle.",
    "recommended": true
  },
  {
    "name": "Slow pull-out / dolly out",
    "level": "Studio preset",
    "where": "Reveal the environment",
    "text": "Camera travels backward, gradually showing more of the frame.",
    "example": "The camera slowly pulls back from a medium close-up to a medium shot while the singer continues singing and opens both hands.",
    "risk": "The model may invent background details outside the original photo.",
    "direction": "Camera: Slowly pull back from a medium close-up to a medium shot, keeping the performer centered.",
    "recommended": true
  },
  {
    "name": "Orbit left",
    "level": "Studio preset",
    "where": "Music performance energy",
    "text": "Camera moves along a gentle curved path to the performer's left.",
    "example": "Gently orbit left from a front view to a slight three-quarter view. The singer smiles while singing and keeps their face visible.",
    "risk": "Large orbits can expose unseen facial details and distort identity.",
    "direction": "Camera: Gently orbit left to a subtle three-quarter view, keeping the face clearly visible.",
    "recommended": true
  },
  {
    "name": "Orbit right",
    "level": "Custom prompt",
    "where": "A second view of the performer",
    "text": "Camera makes a small rightward arc around the subject.",
    "example": "Slowly orbit right from a front medium shot to a subtle three-quarter view. The performer sings and turns their eyes toward the camera.",
    "risk": "Treat this as a creative prompt, not an additional Studio control.",
    "direction": "Camera: Gently orbit right to a subtle three-quarter view, keeping the face clearly visible.",
    "recommended": false
  },
  {
    "name": "Tilt up",
    "level": "Studio preset",
    "where": "Reveal from hands to face",
    "text": "Camera pivots upward without changing its physical location.",
    "example": "Begin on the singer's hands and gently tilt up to an eye-level medium shot of the face as the singing begins.",
    "risk": "Needs room in the source image; large tilts may invent detail.",
    "direction": "Camera: Gently tilt upward from the hands to an eye-level medium shot of the face.",
    "recommended": true
  },
  {
    "name": "Tilt down",
    "level": "Studio preset",
    "where": "Hands, instruments or products",
    "text": "Camera pivots downward to a lower part of the scene.",
    "example": "Start with the presenter at eye level, then slowly tilt down toward the product held at chest height while they continue speaking.",
    "risk": "Avoid a final frame where the face disappears during lip sync.",
    "direction": "Camera: Gently tilt downward to an object or the hands already visible in the reference image.",
    "recommended": true
  },
  {
    "name": "Gentle handheld",
    "level": "Studio preset",
    "where": "UGC and natural energy",
    "text": "Very small handheld-style drift; no hard shake.",
    "example": "Soft handheld camera feel with subtle natural movement. The creator speaks confidently to the camera and nods once.",
    "risk": "Too much shake can reduce visual clarity.",
    "direction": "Camera: Use very subtle handheld-style drift without shaking.",
    "recommended": true
  },
  {
    "name": "Follow backwards",
    "level": "Studio preset",
    "where": "Walking and singing",
    "text": "Camera tracks backward while the singer moves toward it.",
    "example": "The singer walks forward with short visible steps while singing. The camera smoothly tracks backward to keep them in a medium shot.",
    "risk": "Use a full-body or wide-enough source; feet and backgrounds may become unstable.",
    "direction": "Camera: Smoothly track backward as the performer takes short visible steps forward, holding a medium shot.",
    "recommended": true
  },
  {
    "name": "Pan left",
    "level": "Custom prompt",
    "where": "Reveal a person or object",
    "text": "Camera rotates horizontally left from one composition to another.",
    "example": "The camera slowly pans left and settles on the presenter in a centered medium shot. The presenter begins speaking with a welcoming smile.",
    "risk": "A sweeping pan is less predictable when the source has little side detail.",
    "direction": "Camera: Slowly pan left and settle on a centered medium shot.",
    "recommended": false
  },
  {
    "name": "Pan right",
    "level": "Custom prompt",
    "where": "Show a staged reveal",
    "text": "Camera rotates horizontally right.",
    "example": "Gently pan right, then settle on a front-facing medium shot of the singer as they continue the chorus.",
    "risk": "Specify where the camera should stop for better clarity.",
    "direction": "Camera: Slowly pan right and settle on a centered medium shot.",
    "recommended": false
  },
  {
    "name": "Zoom in",
    "level": "Custom prompt",
    "where": "Emphasize a line",
    "text": "Image framing tightens; unlike a push-in, the virtual position need not change.",
    "example": "Begin with a steady medium shot, then slowly zoom in to a close-up of the presenter's face on the final sentence.",
    "risk": "May crop lips or produce artificial facial texture.",
    "direction": "Camera: Start on a steady medium shot, then slowly zoom in on the face.",
    "recommended": false
  },
  {
    "name": "Zoom out",
    "level": "Custom prompt",
    "where": "Provide more context",
    "text": "Framing widens without requiring a camera move backward.",
    "example": "Begin on a close view of the speaker, then slowly zoom out to a comfortable medium shot while they finish speaking.",
    "risk": "Background outside the source portrait may be inconsistent.",
    "direction": "Camera: Slowly zoom out from a close view to a comfortable medium shot.",
    "recommended": false
  },
  {
    "name": "Side tracking / truck",
    "level": "Custom prompt · advanced",
    "where": "Dynamic profile reveal",
    "text": "Camera travels horizontally, trying to maintain similar distance.",
    "example": "Track the camera gently from left to right while keeping the performer in a medium shot. The performer continues singing without turning away.",
    "risk": "More likely to distort background geometry than a stationary shot.",
    "direction": "Camera: Gently track from left to right while maintaining a medium shot.",
    "recommended": false
  },
  {
    "name": "Forward tracking",
    "level": "Custom prompt · advanced",
    "where": "Walk-through or approach",
    "text": "Camera moves forward with a walking subject.",
    "example": "The camera smoothly follows behind the presenter for two steps, then settles at a slight side angle as they speak.",
    "risk": "Difficult if the source image does not show the subject's body or surroundings.",
    "direction": "Camera: Smoothly track forward with the performer, finishing at a slight side angle.",
    "recommended": false
  },
  {
    "name": "Crane up",
    "level": "Custom prompt · advanced",
    "where": "Elevated ending",
    "text": "Camera travels upward toward a higher viewpoint.",
    "example": "Start at eye level, then slowly rise to a slightly elevated angle while the performer finishes the last phrase.",
    "risk": "High angles may alter face geometry and scene continuity.",
    "direction": "Camera: Slowly rise from eye level to a slightly elevated view, then settle.",
    "recommended": false
  },
  {
    "name": "Crane down",
    "level": "Custom prompt · advanced",
    "where": "Introduce a speaker",
    "text": "Camera lowers from a higher vantage point.",
    "example": "Slowly lower the camera from a gentle high angle to eye level, ending with a clear medium close-up of the speaker.",
    "risk": "Keep the change small; dramatic overhead moves are less reliable.",
    "direction": "Camera: Slowly lower from a slight high angle to an eye-level medium close-up.",
    "recommended": false
  },
  {
    "name": "Pedestal up / down",
    "level": "Custom prompt · advanced",
    "where": "Small vertical reframing",
    "text": "Camera moves vertically while its direction stays approximately level.",
    "example": "Raise the camera slightly while keeping it level, finishing at eye height as the host speaks.",
    "risk": "Do not combine with a large tilt in the same short clip.",
    "direction": "Camera: Move vertically upward a small distance, keeping the angle level.",
    "recommended": false
  },
  {
    "name": "Low angle → eye level",
    "level": "Custom prompt · advanced",
    "where": "Confident introduction",
    "text": "The apparent viewpoint transitions from slightly below to eye level.",
    "example": "Start at a subtle low angle and move gently to eye level, ending on the presenter's front face as they say the final line.",
    "risk": "Strong perspective shifts can deform the face.",
    "direction": "Camera: Gently shift from a slight low angle to eye level, ending on the front of the face.",
    "recommended": false
  },
  {
    "name": "Rack focus",
    "level": "Custom prompt · experimental",
    "where": "Attention shift",
    "text": "Focus moves between visible foreground and speaker.",
    "example": "Start with the product in focus, then smoothly shift focus to the presenter, who smiles and begins speaking.",
    "risk": "Not a dependable focus control; both subjects must be present in the image.",
    "direction": "Camera: Gradually shift focus from a visible foreground object to the person.",
    "recommended": false
  },
  {
    "name": "Whip pan",
    "level": "Custom prompt · experimental",
    "where": "Fast transitions",
    "text": "Very fast horizontal movement meant to imply a cut.",
    "example": "A brief, fast pan right leads into a steady frontal medium shot, where the performer starts singing.",
    "risk": "Often produces blur and scene drift. Prefer separate clips for this edit.",
    "direction": "Camera: Make one brief fast pan right, then hold a steady frontal medium shot.",
    "recommended": false
  },
  {
    "name": "Dolly zoom",
    "level": "Custom prompt · experimental",
    "where": "Stylized perspective",
    "text": "Camera moves while zooming in the opposite direction.",
    "example": "Gently pull the camera back while slowly zooming in so the singer stays roughly the same size.",
    "risk": "Complex opposing actions frequently fail in image-driven generation.",
    "direction": "Camera: Move slowly backward while gently zooming in, keeping the performer roughly the same size.",
    "recommended": false
  }
];
export const featuredCameraMovements = cameraMovements.filter(move => move.recommended);
export const additionalCameraMovements = cameraMovements.filter(move => !move.recommended);
