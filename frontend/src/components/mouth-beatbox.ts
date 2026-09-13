const OPEN_MOUTH = 0.35
const CLOSED_MOUTH = 0.2

export function mouthBeat(jawOpen: number, isOpen: boolean) {
  if (!isOpen && jawOpen >= OPEN_MOUTH) return { isOpen: true, beat: true }
  if (isOpen && jawOpen <= CLOSED_MOUTH) return { isOpen: false, beat: false }
  return { isOpen, beat: false }
}
