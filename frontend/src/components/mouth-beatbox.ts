const OPEN_MOUTH = 0.35
const CLOSED_MOUTH = 0.2
const HEAD_NOD = 0.08
const HAND_RAISED = 0.05
const HAND_RELEASED = 0.02
const MIN_VISIBILITY = 0.5

export interface HeadPose {
  nod: number
}

export type HeadControl = 'softer' | 'louder'
export type HandControl = 'previous' | 'next'

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
  }
}

export function headControl(
  pose: HeadPose,
  baseline: HeadPose,
  active: HeadControl | null,
) {
  const nod = pose.nod - baseline.nod
  const control: HeadControl | null = nod > HEAD_NOD
    ? 'softer'
    : nod < -HEAD_NOD
      ? 'louder'
      : null
  if (active)
    return {
      control: control && control !== active ? control : null,
      active: control && control !== active
        ? control
        : Math.abs(nod) < HEAD_NOD * 0.7
          ? null
          : active,
    }
  return { control, active: control }
}

export function handControl(
  points: readonly { y: number; visibility?: number }[],
  active: HandControl | null,
) {
  const leftShoulder = points[11]
  const rightShoulder = points[12]
  const leftWrist = points[15]
  const rightWrist = points[16]
  if (
    !leftShoulder || !rightShoulder || !leftWrist || !rightWrist ||
    [leftShoulder, rightShoulder, leftWrist, rightWrist]
      .some(({ visibility = 1 }) => visibility < MIN_VISIBILITY)
  ) return { control: null, active }

  const left = leftShoulder.y - leftWrist.y
  const right = rightShoulder.y - rightWrist.y
  if (active && (active === 'previous' ? left : right) > HAND_RELEASED)
    return { control: null, active }

  const leftRaised = left > HAND_RAISED
  const rightRaised = right > HAND_RAISED
  const control: HandControl | null = leftRaised === rightRaised
    ? null
    : leftRaised
      ? 'previous'
      : 'next'
  return { control, active: control }
}
