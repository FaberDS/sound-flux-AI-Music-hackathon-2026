import { Cable, Check, Unplug, type LucideIcon } from 'lucide-react'
import type { ChordcatRhythmController } from '../hooks/useChordcatRhythm'
import type { Instrument } from '../lib/music'

export function ChordcatRhythm({
  effects,
  chordcat,
}: {
  effects: readonly { id: Instrument; name: string; icon: LucideIcon }[]
  chordcat: ChordcatRhythmController
}) {
  return (
    <section className="rhythm-section" aria-labelledby="rhythm-title">
      <div className="rhythm-card">
        <div className="rhythm-intro">
          <p>Optional music board</p>
          <h2 id="rhythm-title">FIND YOUR RHYTHM</h2>
          <span>
            Choose one sound, then tap any key. There are no wrong notes.
          </span>
        </div>
        <div className="rhythm-controls">
          {chordcat.connected ? (
            <>
              <fieldset className="rhythm-sounds">
                <legend>Choose your sound</legend>
                {effects.map(({ id, name, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={chordcat.effect === id}
                    onClick={() => chordcat.selectEffect(id)}
                  >
                    <Icon size={24} aria-hidden="true" />
                    {name}
                    {chordcat.effect === id && <Check size={19} aria-hidden="true" />}
                  </button>
                ))}
              </fieldset>
              <button
                type="button"
                className="rhythm-disconnect"
                onClick={chordcat.disconnect}
              >
                <Unplug size={18} /> Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              className="music-button rhythm-connect"
              onClick={() => void chordcat.connect()}
              disabled={chordcat.connecting}
            >
              <Cable size={24} />
              {chordcat.connecting ? 'Connecting…' : 'Connect Chordcat'}
            </button>
          )}
          <p className="rhythm-status" role="status" aria-live="polite">
            {chordcat.status}
          </p>
        </div>
      </div>
    </section>
  )
}
