import { useEffect, useRef, useState } from 'react'
import type { EffectPitch, Instrument } from '../lib/music'

export function useChordcatRhythm({
  effects,
  savesToSong,
  onPlay,
}: {
  effects: readonly { id: Instrument; name: string }[]
  savesToSong: boolean
  onPlay: (effect: Instrument, pitch: EffectPitch) => void
}) {
  const [effect, setEffect] = useState<Instrument>('drum')
  const [input, setInput] = useState<MIDIInput | null>(null)
  const [status, setStatus] = useState('Connect your Chordcat to begin.')
  const [connecting, setConnecting] = useState(false)
  const lastTapAt = useRef(-Infinity)

  useEffect(() => {
    if (!input) return
    const onMessage = (event: MIDIMessageEvent) => {
      if (!event.data) return
      const [message = 0, note = 0, velocity = 0] = event.data
      if ((message & 0xf0) !== 0x90 || velocity === 0) return
      const now = performance.now()
      if (now - lastTapAt.current < 100) return
      lastTapAt.current = now
      onPlay(effect, note < 66 ? 'low' : 'high')
      const name = effects.find(({ id }) => id === effect)?.name ?? 'Sound'
      setStatus(`${name} ${savesToSong ? 'added to your song' : 'played'}.`)
    }
    const onStateChange = () => {
      if (input.state !== 'disconnected') return
      setInput(null)
      setStatus('Chordcat disconnected. Connect it and try again.')
    }
    input.addEventListener('midimessage', onMessage)
    input.addEventListener('statechange', onStateChange)
    return () => {
      input.removeEventListener('midimessage', onMessage)
      input.removeEventListener('statechange', onStateChange)
    }
  }, [effect, effects, input, onPlay, savesToSong])

  async function connect() {
    if (!navigator.requestMIDIAccess) {
      setStatus('This browser does not support music boards. Try Chrome or Edge.')
      return
    }
    setConnecting(true)
    setStatus('Looking for Chordcat…')
    try {
      const access = await navigator.requestMIDIAccess()
      const chordcat = Array.from(access.inputs.values()).find((port) =>
        /chordcat|alphatheta/i.test(port.name ?? ''),
      )
      if (!chordcat) {
        setStatus('Chordcat not found. Connect it directly by USB and try again.')
        return
      }
      await chordcat.open()
      setInput(chordcat)
      setStatus('Ready. Tap any key when you feel the music.')
    } catch {
      setStatus('Chordcat access was not allowed. Check your browser permission.')
    } finally {
      setConnecting(false)
    }
  }

  function disconnect() {
    void input?.close()
    setInput(null)
    setStatus('Chordcat disconnected.')
  }

  function selectEffect(next: Instrument) {
    setEffect(next)
    const name = effects.find(({ id }) => id === next)?.name ?? 'Sound'
    setStatus(`${name} selected. Tap any key to play.`)
  }

  return {
    connected: Boolean(input),
    connecting,
    effect,
    status,
    connect,
    disconnect,
    selectEffect,
  }
}

export type ChordcatRhythmController = ReturnType<typeof useChordcatRhythm>
