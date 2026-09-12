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
    points: [leftEye, rightEye, nose],
  };
}

export function calibrationFromRange(range) {
  return {
    nod: clamp(range.nod * .45, .025, .12),
    left: clamp(range.left * .45, 6, 25),
    right: clamp(range.right * .45, 6, 25),
  };
}

export function updateGesture(pose, baseline, threshold, active = null) {
  const nod = pose.nod - baseline.nod;
  const tilt = pose.tilt - baseline.tilt;
  const release = active === "kick" ? nod < threshold.nod * .45
    : active === "snare" ? tilt > -threshold.left * .45
    : active === "crash" ? tilt < threshold.right * .45 : true;
  if (active) return { gesture: null, active: release ? null : active, nod, tilt };
  const gesture = nod > threshold.nod ? "kick"
    : tilt < -threshold.left ? "snare"
    : tilt > threshold.right ? "crash" : null;
  return { gesture, active: gesture, nod, tilt };
}
