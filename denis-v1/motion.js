export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function poseFromLandmarks(points) {
  const leftEye = points[33];
  const rightEye = points[263];
  const nose = points[1];
  if (!leftEye || !rightEye || !nose) return null;
  const dx = rightEye.x - leftEye.x;
  const dy = rightEye.y - leftEye.y;
  const eyeDistance = Math.hypot(dx, dy);
  if (!eyeDistance) return null;
  return {
    tilt: Math.atan2(dy, dx) * 180 / Math.PI,
    nod: (nose.y - (leftEye.y + rightEye.y) / 2) / eyeDistance,
  };
}

export function detectGesture(pose, baseline, threshold, previous) {
  const nod = pose.nod - baseline.nod;
  const tilt = pose.tilt - baseline.tilt;
  const gesture = nod > threshold.nod ? "kick"
    : tilt < -threshold.tilt ? "snare"
    : tilt > threshold.tilt ? "crash" : null;
  return gesture && gesture !== previous ? gesture : null;
}
