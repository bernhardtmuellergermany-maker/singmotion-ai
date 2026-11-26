/** Shared camera movement library for Help and Studio. Short English camera-only prompts aligned with the existing illustrative WebP renderer. */
export type CameraMovement = {name:string; category:string; id:string; level:string; where:string; text:string; example:string; risk:string; direction:string; recommended:boolean;};
export const cameraMovements:readonly CameraMovement[] = [
  {
    "name": "Static shot",
    "category": "Pan/Tilt",
    "id": "01",
    "level": "Pan/Tilt",
    "where": "Creative camera direction",
    "text": "Keep the camera completely still.",
    "example": "Keep the camera completely still.",
    "risk": "Suggested starting point for OmniHuman 2.0. AI-generated motion and lip sync may vary.",
    "direction": "Camera: Keep the camera completely still.",
    "recommended": true
  },
  {
    "name": "Pan right",
    "category": "Pan/Tilt",
    "id": "02",
    "level": "Pan/Tilt",
    "where": "Creative camera direction",
    "text": "Pan the camera smoothly to the right from a fixed position.",
    "example": "Pan the camera smoothly to the right from a fixed position.",
    "risk": "Suggested starting point for OmniHuman 2.0. AI-generated motion and lip sync may vary.",
    "direction": "Camera: Pan the camera smoothly to the right from a fixed position.",
    "recommended": true
  },
  {
    "name": "Pan left",
    "category": "Pan/Tilt",
    "id": "02B",
    "level": "Pan/Tilt",
    "where": "Creative camera direction",
    "text": "Pan the camera smoothly to the left from a fixed position.",
    "example": "Pan the camera smoothly to the left from a fixed position.",
    "risk": "Suggested starting point for OmniHuman 2.0. AI-generated motion and lip sync may vary.",
    "direction": "Camera: Pan the camera smoothly to the left from a fixed position.",
    "recommended": true
  },
  {
    "name": "Slow zoom in",
    "category": "Zoom/Lens",
    "id": "05",
    "level": "Zoom/Lens",
    "where": "Creative camera direction",
    "text": "Slowly zoom in on the subject without moving the camera.",
    "example": "Slowly zoom in on the subject without moving the camera.",
    "risk": "Suggested starting point for OmniHuman 2.0. AI-generated motion and lip sync may vary.",
    "direction": "Camera: Slowly zoom in on the subject without moving the camera.",
    "recommended": true
  },
  {
    "name": "Slow zoom out",
    "category": "Zoom/Lens",
    "id": "05B",
    "level": "Zoom/Lens",
    "where": "Creative camera direction",
    "text": "Slowly zoom out from the subject without moving the camera.",
    "example": "Slowly zoom out from the subject without moving the camera.",
    "risk": "Suggested starting point for OmniHuman 2.0. AI-generated motion and lip sync may vary.",
    "direction": "Camera: Slowly zoom out from the subject without moving the camera.",
    "recommended": true
  },
  {
    "name": "Dolly in",
    "category": "Dolly/Track",
    "id": "08",
    "level": "Dolly/Track",
    "where": "Creative camera direction",
    "text": "Move the camera smoothly forward toward the subject.",
    "example": "Move the camera smoothly forward toward the subject.",
    "risk": "Suggested starting point for OmniHuman 2.0. AI-generated motion and lip sync may vary.",
    "direction": "Camera: Move the camera smoothly forward toward the subject.",
    "recommended": true
  },
  {
    "name": "Dolly out",
    "category": "Dolly/Track",
    "id": "09",
    "level": "Dolly/Track",
    "where": "Creative camera direction",
    "text": "Move the camera smoothly backward away from the subject.",
    "example": "Move the camera smoothly backward away from the subject.",
    "risk": "Suggested starting point for OmniHuman 2.0. AI-generated motion and lip sync may vary.",
    "direction": "Camera: Move the camera smoothly backward away from the subject.",
    "recommended": true
  },
  {
    "name": "Handheld shot",
    "category": "Human Camera",
    "id": "23",
    "level": "Human Camera",
    "where": "Creative camera direction",
    "text": "Move the camera with a gentle handheld sway.",
    "example": "Move the camera with a gentle handheld sway.",
    "risk": "Suggested starting point for OmniHuman 2.0. AI-generated motion and lip sync may vary.",
    "direction": "Camera: Move the camera with a gentle handheld sway.",
    "recommended": true
  },
  {
    "name": "Reverse tracking",
    "category": "Dolly/Track",
    "id": "18",
    "level": "Dolly/Track",
    "where": "Creative camera direction",
    "text": "Track backward in front of the moving subject at the same speed.",
    "example": "Track backward in front of the moving subject at the same speed.",
    "risk": "Suggested starting point for OmniHuman 2.0. AI-generated motion and lip sync may vary.",
    "direction": "Camera: Track backward in front of the moving subject at the same speed.",
    "recommended": true
  },
  {
    "name": "Whip pan right",
    "category": "Pan/Tilt",
    "id": "03",
    "level": "Pan/Tilt",
    "where": "Creative camera direction",
    "text": "Whip the camera quickly to the right with motion blur.",
    "example": "Whip the camera quickly to the right with motion blur.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Whip the camera quickly to the right with motion blur.",
    "recommended": false
  },
  {
    "name": "Whip pan left",
    "category": "Pan/Tilt",
    "id": "03B",
    "level": "Pan/Tilt",
    "where": "Creative camera direction",
    "text": "Whip the camera quickly to the left with motion blur.",
    "example": "Whip the camera quickly to the left with motion blur.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Whip the camera quickly to the left with motion blur.",
    "recommended": false
  },
  {
    "name": "Tilt up",
    "category": "Pan/Tilt",
    "id": "04",
    "level": "Pan/Tilt",
    "where": "Creative camera direction",
    "text": "Tilt the camera smoothly upward from a fixed position.",
    "example": "Tilt the camera smoothly upward from a fixed position.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Tilt the camera smoothly upward from a fixed position.",
    "recommended": false
  },
  {
    "name": "Tilt down",
    "category": "Pan/Tilt",
    "id": "04B",
    "level": "Pan/Tilt",
    "where": "Creative camera direction",
    "text": "Tilt the camera smoothly downward from a fixed position.",
    "example": "Tilt the camera smoothly downward from a fixed position.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Tilt the camera smoothly downward from a fixed position.",
    "recommended": false
  },
  {
    "name": "Fast zoom in",
    "category": "Zoom/Lens",
    "id": "06",
    "level": "Zoom/Lens",
    "where": "Creative camera direction",
    "text": "Quickly zoom in on the subject without moving the camera.",
    "example": "Quickly zoom in on the subject without moving the camera.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Quickly zoom in on the subject without moving the camera.",
    "recommended": false
  },
  {
    "name": "Fast zoom out",
    "category": "Zoom/Lens",
    "id": "06B",
    "level": "Zoom/Lens",
    "where": "Creative camera direction",
    "text": "Quickly zoom out from the subject without moving the camera.",
    "example": "Quickly zoom out from the subject without moving the camera.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Quickly zoom out from the subject without moving the camera.",
    "recommended": false
  },
  {
    "name": "Tracking shot",
    "category": "Dolly/Track",
    "id": "16",
    "level": "Dolly/Track",
    "where": "Creative camera direction",
    "text": "Track smoothly alongside the moving subject from an angled view.",
    "example": "Track smoothly alongside the moving subject from an angled view.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Track smoothly alongside the moving subject from an angled view.",
    "recommended": false
  },
  {
    "name": "Follow shot",
    "category": "Dolly/Track",
    "id": "17",
    "level": "Dolly/Track",
    "where": "Creative camera direction",
    "text": "Follow behind the moving subject at the same speed.",
    "example": "Follow behind the moving subject at the same speed.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Follow behind the moving subject at the same speed.",
    "recommended": false
  },
  {
    "name": "Side tracking",
    "category": "Dolly/Track",
    "id": "19",
    "level": "Dolly/Track",
    "where": "Creative camera direction",
    "text": "Track parallel beside the moving subject at the same speed.",
    "example": "Track parallel beside the moving subject at the same speed.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Track parallel beside the moving subject at the same speed.",
    "recommended": false
  },
  {
    "name": "Low tracking",
    "category": "Dolly/Track",
    "id": "20",
    "level": "Dolly/Track",
    "where": "Creative camera direction",
    "text": "Track alongside the moving subject from a low angle near the ground.",
    "example": "Track alongside the moving subject from a low angle near the ground.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Track alongside the moving subject from a low angle near the ground.",
    "recommended": false
  },
  {
    "name": "Truck right",
    "category": "Physical Moves",
    "id": "10",
    "level": "Physical Moves",
    "where": "Creative camera direction",
    "text": "Move the whole camera straight to the right without turning.",
    "example": "Move the whole camera straight to the right without turning.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Move the whole camera straight to the right without turning.",
    "recommended": false
  },
  {
    "name": "Truck left",
    "category": "Physical Moves",
    "id": "10B",
    "level": "Physical Moves",
    "where": "Creative camera direction",
    "text": "Move the whole camera straight to the left without turning.",
    "example": "Move the whole camera straight to the left without turning.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Move the whole camera straight to the left without turning.",
    "recommended": false
  },
  {
    "name": "Pedestal up",
    "category": "Physical Moves",
    "id": "11A",
    "level": "Physical Moves",
    "where": "Creative camera direction",
    "text": "Raise the camera straight up without tilting.",
    "example": "Raise the camera straight up without tilting.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Raise the camera straight up without tilting.",
    "recommended": false
  },
  {
    "name": "Pedestal down",
    "category": "Physical Moves",
    "id": "11B",
    "level": "Physical Moves",
    "where": "Creative camera direction",
    "text": "Lower the camera straight down without tilting.",
    "example": "Lower the camera straight down without tilting.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Lower the camera straight down without tilting.",
    "recommended": false
  },
  {
    "name": "Slider right",
    "category": "Physical Moves",
    "id": "12",
    "level": "Physical Moves",
    "where": "Creative camera direction",
    "text": "Slide the camera a short distance to the right.",
    "example": "Slide the camera a short distance to the right.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Slide the camera a short distance to the right.",
    "recommended": false
  },
  {
    "name": "Slider left",
    "category": "Physical Moves",
    "id": "12B",
    "level": "Physical Moves",
    "where": "Creative camera direction",
    "text": "Slide the camera a short distance to the left.",
    "example": "Slide the camera a short distance to the left.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Slide the camera a short distance to the left.",
    "recommended": false
  },
  {
    "name": "Push past",
    "category": "Physical Moves",
    "id": "13",
    "level": "Physical Moves",
    "where": "Creative camera direction",
    "text": "Glide the camera forward past a foreground object.",
    "example": "Glide the camera forward past a foreground object.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Glide the camera forward past a foreground object.",
    "recommended": false
  },
  {
    "name": "Arc right",
    "category": "Physical Moves",
    "id": "14",
    "level": "Physical Moves",
    "where": "Creative camera direction",
    "text": "Move the camera in a short arc to the right around the subject.",
    "example": "Move the camera in a short arc to the right around the subject.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Move the camera in a short arc to the right around the subject.",
    "recommended": false
  },
  {
    "name": "Arc left",
    "category": "Physical Moves",
    "id": "14B",
    "level": "Physical Moves",
    "where": "Creative camera direction",
    "text": "Move the camera in a short arc to the left around the subject.",
    "example": "Move the camera in a short arc to the left around the subject.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Move the camera in a short arc to the left around the subject.",
    "recommended": false
  },
  {
    "name": "Orbit clockwise",
    "category": "Physical Moves",
    "id": "15",
    "level": "Physical Moves",
    "where": "Creative camera direction",
    "text": "Orbit the camera clockwise in a full circle around the subject.",
    "example": "Orbit the camera clockwise in a full circle around the subject.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Orbit the camera clockwise in a full circle around the subject.",
    "recommended": false
  },
  {
    "name": "Orbit counterclockwise",
    "category": "Physical Moves",
    "id": "15B",
    "level": "Physical Moves",
    "where": "Creative camera direction",
    "text": "Orbit the camera counterclockwise in a full circle around the subject.",
    "example": "Orbit the camera counterclockwise in a full circle around the subject.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Orbit the camera counterclockwise in a full circle around the subject.",
    "recommended": false
  },
  {
    "name": "Crane up",
    "category": "Drone/Crane",
    "id": "25",
    "level": "Drone/Crane",
    "where": "Creative camera direction",
    "text": "Lift the camera smoothly upward while pulling back.",
    "example": "Lift the camera smoothly upward while pulling back.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Lift the camera smoothly upward while pulling back.",
    "recommended": false
  },
  {
    "name": "Crane down",
    "category": "Drone/Crane",
    "id": "25B",
    "level": "Drone/Crane",
    "where": "Creative camera direction",
    "text": "Lower the camera smoothly while moving closer.",
    "example": "Lower the camera smoothly while moving closer.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Lower the camera smoothly while moving closer.",
    "recommended": false
  },
  {
    "name": "Drone push in",
    "category": "Drone/Crane",
    "id": "26",
    "level": "Drone/Crane",
    "where": "Creative camera direction",
    "text": "Fly the camera forward and downward toward the subject.",
    "example": "Fly the camera forward and downward toward the subject.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Fly the camera forward and downward toward the subject.",
    "recommended": false
  },
  {
    "name": "Drone pull back",
    "category": "Drone/Crane",
    "id": "26B",
    "level": "Drone/Crane",
    "where": "Creative camera direction",
    "text": "Fly the camera backward and upward away from the subject.",
    "example": "Fly the camera backward and upward away from the subject.",
    "risk": "Experimental with OmniHuman 2.0: the model may ignore the move, alter the background or lose facial consistency. Keep the performer visible.",
    "direction": "Camera: Fly the camera backward and upward away from the subject.",
    "recommended": false
  }
];
export const featuredCameraMovements = cameraMovements.filter(move => move.recommended);
export const additionalCameraMovements = cameraMovements.filter(move => !move.recommended);

/** The same locally rendered demonstration and reduced-motion poster power Help and Studio. */
export function cameraMovementPreview(move:CameraMovement){
 const stem="/camera-movements/singmotion-"+move.name.toLowerCase().replace(/[^a-z0-9]+/g,"-");
 return {animation:stem+".webp",poster:stem+"-poster.webp"};
}


/** Exact previous library lines, retained only to replace old tips in saved drafts. */
const legacyCameraDirections:readonly string[] = [
  "Camera: static shot. Movement: hold a single locked camera position for the entire clip. Speed: perfectly still and steady. Framing: the angle, height, lens distance and composition never change. End: finish on the identical framing you opened with.",
  "Camera: pan right. Movement: rotate the camera horizontally left-to-right from one fixed point. Speed: smooth, constant rotation. Framing: hold the horizon level as new space enters from the right edge. End: settle on a clean final composition.",
  "Camera: pan left. Movement: rotate the camera horizontally right-to-left from one fixed point. Speed: smooth, constant rotation. Framing: hold the horizon level as new space enters from the left edge. End: settle on a clean final composition.",
  "Camera: slow zoom in. Movement: increase the lens focal length gradually toward a tighter frame. Speed: gradual and even. Framing: the main subject stays readable as it grows in frame. End: finish on a stable tighter composition.",
  "Camera: slow zoom out. Movement: decrease the lens focal length gradually toward a wider frame. Speed: gradual and even. Framing: the main subject stays readable as more surroundings appear. End: finish on a stable wider composition.",
  "Camera: dolly in. Movement: the subject stands in place, feet planted, body steady — ONLY the camera moves: a smooth controlled push physically straight forward toward the subject. Speed: a smooth, controlled push. Framing: camera height and lens direction stay constant as the distance closes. End: finish in a tighter composition on their face.",
  "Camera: dolly out. Movement: move the camera physically backward in a straight line away from the subject. Speed: a smooth, controlled retreat. Framing: lens direction and height stay consistent as more environment enters. End: finish in a wider composition.",
  "Camera: handheld shot. Movement: hold the camera at operator height with natural body movement. Speed: responsive and organic. Framing: the subject stays readable through subtle sway and micro-adjustments. End: finish on a natural handheld frame.",
  "Camera: reverse tracking. Movement: move backward in front of the walking subject. Speed: matched to their forward pace. Framing: face and body framing stay stable as the background falls away behind them. End: hold a clear front-facing moving composition.",
  "Camera: whip pan right. Movement: snap the camera rapidly toward a new target on the right. Speed: a fast whip with a breath of motion blur mid-turn. Framing: open on one readable frame and land on a second readable target. End: lock into a sharp final frame.",
  "Camera: whip pan left. Movement: snap the camera rapidly toward a new target on the left. Speed: a fast whip with a breath of motion blur mid-turn. Framing: open on one readable frame and land on a second readable target. End: lock into a sharp final frame.",
  "Camera: Pivot upward from a fixed tripod position, keeping distance and focal length constant. The stationary subject moves toward the bottom of the frame as the space above becomes visible.",
  "Camera: tilt down. Movement: rotate the camera downward from one fixed point. Speed: smooth, constant tilt. Framing: keep the vertical subject centered as the frame descends. End: land on the lower target.",
  "Camera: fast zoom in. Movement: push the lens quickly toward the main subject. Speed: quick and decisive. Framing: keep the target centered through the scale change. End: finish on a stable tighter composition.",
  "Camera: fast zoom out. Movement: pull the lens quickly away from the main subject. Speed: quick and decisive. Framing: keep the target readable as the surrounding space opens up. End: finish on a stable wider composition.",
  "Camera: tracking shot. Movement: move through the scene together with the main subject. Speed: matched to the subject’s pace. Framing: the subject stays consistently readable while the world moves around them. End: hold a clear moving composition.",
  "Camera: follow shot. Movement: move behind the subject along their route at shoulder height. Speed: matched to the subject’s pace. Framing: their back and shoulders lead the frame while the route ahead stays readable. End: keep following with the subject leading the frame.",
  "Camera: side tracking. Movement: move parallel beside the subject along their direction of travel. Speed: matched to the subject’s motion. Framing: hold the subject in side or three-quarter profile at a stable distance. End: continue the parallel move with clear lateral motion.",
  "Camera: low tracking. Movement: move at ground height alongside the subject’s path. Speed: matched to the footsteps or wheels. Framing: keep the low detail sharp while the ground plane streams through frame. End: finish with the low perspective intact.",
  "Camera: truck right. Movement: move the whole camera to the right on a straight lateral path. Speed: smooth, constant lateral travel. Framing: the lens keeps facing the same direction while the scene slides across. End: finish on a clean lateral composition.",
  "Camera: truck left. Movement: move the whole camera to the left on a straight lateral path. Speed: smooth, constant lateral travel. Framing: the lens keeps facing the same direction while the scene slides across. End: finish on a clean lateral composition.",
  "Camera: pedestal up. Movement: the subject stands completely still, feet planted — ONLY the camera moves: it rises physically straight UP at a constant height gain, its lens staying level the whole time, never tilting. Speed: a smooth, constant vertical rise. Framing: the subject slides steadily DOWN the frame as the camera rises past eye level, while the scene above them enters from the top edge. End: the camera holds its higher position, lens still level, the subject low in the frame.",
  "Camera: pedestal down. Movement: lower the entire camera straight downward. Speed: a smooth, constant descent. Framing: the lens stays level and pointed the same way through the drop. End: finish with the lower framing clearly readable.",
  "Camera: slider right. Movement: slide the camera a short distance to the right. Speed: slow, controlled, constant. Framing: foreground, subject and background layers shift with gentle parallax. End: finish on a refined frame with the new right-side angle visible.",
  "Camera: slider left. Movement: slide the camera a short distance to the left. Speed: slow, controlled, constant. Framing: foreground, subject and background layers shift with gentle parallax. End: finish on a refined frame with the new left-side angle visible.",
  "Camera: push past. Movement: glide forward past a visible foreground object, edge or opening. Speed: a smooth forward glide. Framing: the foreground sweeps close to the lens while the space beyond sharpens. End: arrive inside or beyond the foreground layer.",
  "Camera: arc right. Movement: move on a shallow curve around the subject toward their left side. Speed: a smooth, measured curve. Framing: distance, height and subject readability hold while the angle changes. End: finish from a new left-side angle.",
  "Camera: arc left. Movement: move on a shallow curve around the subject toward their right side. Speed: a smooth, measured curve. Framing: distance, height and subject readability hold while the angle changes. End: finish from a new right-side angle.",
  "Camera: Move smoothly right on a curve around the stationary subject, keeping height and distance constant; the background sweeps left. The subject naturally follows the lens with their head and eyes.",
  "Camera: Move smoothly left on a curve around the stationary subject, keeping height and distance constant; the background sweeps right. The subject naturally follows the lens with their head and eyes.",
  "Camera: crane up. Movement: travel smoothly upward through open space. Speed: a slow, controlled vertical lift. Framing: the subject or location stays readable as the camera gains height. End: finish with the larger scale clearly visible.",
  "Camera: crane down. Movement: travel smoothly downward through open space. Speed: a slow, controlled vertical descent. Framing: the subject or destination stays readable as the camera comes down. End: finish with the lower subject clearly visible.",
  "Camera: Fly smoothly forward toward the stationary subject, keeping them centered as they grow larger and the environment slides past the frame edges.",
  "Camera: drone pull back. Movement: fly smoothly backward away from the subject. Speed: a controlled aerial retreat. Framing: the subject stays readable as more landscape opens around them. End: finish on a wider aerial composition."
];

/** Replace library suggestions while preserving manually written lines and formatting. */
export function replaceCameraQuickTip(prompt:string,move:CameraMovement):string {
 const known=new Set([...cameraMovements.map(item=>item.direction),...legacyCameraDirections]);
 let replaced=false;
 const lines=prompt.split("\n").flatMap(line=>{
  if(!known.has(line))return [line];
  if(replaced)return [];
  replaced=true;
  return [move.direction];
 });
 return replaced?lines.join("\n"):prompt+(prompt&&!prompt.endsWith("\n")?"\n":"")+move.direction;
}
