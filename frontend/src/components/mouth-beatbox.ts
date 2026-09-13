const OPEN_MOUTH = 0.35
const CLOSED_MOUTH = 0.2
const HEAD_TURN = 0.05
const HEAD_NOD = 0.08

export interface HeadPose {
  nod: number
  turn: number
}

export type HeadControl = 'previous' | 'next' | 'softer' | 'louder'

export function mouthBeat(jawOpen: number, isOpen: boolean) {
  if (!isOpen && jawOpen >= OPEN_MOUTH) return { isOpen: true, beat: true }
  if (isOpen && jawOpen <= CLOSED_MOUTH) return { isOpen: false, beat: false }
  return { isOpen, beat: false }
}

export function poseFromLandmarks(
  points: readonly { x: number; y: number }[],
): HeadPose | null {
  const leftEye = points[33]
  const rightEye = points[263]
  const nose = points[1]
  if (!leftEye || !rightEye || !nose) return null
  const dx = rightEye.x - leftEye.x
  const dy = rightEye.y - leftEye.y
  const eyeDistance = Math.hypot(dx, dy)
  if (!eyeDistance) return null
  const noseX = nose.x - (leftEye.x + rightEye.x) / 2
  const noseY = nose.y - (leftEye.y + rightEye.y) / 2
  return {
    nod: (-noseX * dy + noseY * dx) / eyeDistance ** 2,
    turn: (noseX * dx + noseY * dy) / eyeDistance ** 2,
  }
}

export function headControl(
  pose: HeadPose,
  baseline: HeadPose,
  active: HeadControl | null,
) {
  const nod = pose.nod - baseline.nod
  const turn = pose.turn - baseline.turn
  const amount = active === 'previous' || active === 'next' ? turn : nod
  const threshold = active === 'previous' || active === 'next'
    ? HEAD_TURN
    : HEAD_NOD
  const control: HeadControl | null = turn < -HEAD_TURN
    ? 'previous'
    : turn > HEAD_TURN
      ? 'next'
      : nod > HEAD_NOD
        ? 'softer'
        : nod < -HEAD_NOD
          ? 'louder'
          : null
  if (active)
    return {
      control: control && control !== active ? control : null,
      active: control && control !== active
        ? control
        : Math.abs(amount) < threshold * 0.7
          ? null
          : active,
    }
  return { control, active: control }
}
