import { ShieldCheck, Square } from 'lucide-react'

export function FloatingSessionControls({
  conversation,
  onStop,
}: {
  conversation: boolean
  onStop: () => void
}) {
  const label = conversation ? 'Stop conversation' : 'Stop music'

  return (
    <div className="floating-session-controls" role="group" aria-label="Session controls">
      <span className="saved-device" role="img" aria-label="Saved on this device." title="Saved on this device.">
        <ShieldCheck size={25} aria-hidden="true" />
      </span>
      <button className="immediate-stop" onClick={onStop} aria-label={`${label} immediately`}>
        <Square size={18} fill="currentColor" aria-hidden="true" />
        {label}
      </button>
    </div>
  )
}
