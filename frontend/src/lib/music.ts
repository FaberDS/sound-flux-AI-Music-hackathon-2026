export type Instrument = 'piano' | 'guitar' | 'bells' | 'drum'
export type Mood = 'calm' | 'bright'

export class MusicRoom {
  private context: AudioContext | null = null
  private gain: GainNode | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private voices = new Set<AudioScheduledSourceNode>()
  private epoch = 0
  private volume = 0.45
  private noteIndex = 0

  private async ready() {
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext()
      this.gain = this.context.createGain()
      this.gain.gain.value = this.volume * 0.45
      this.gain.connect(this.context.destination)
    }
    await this.context.resume()
  }

  setVolume(value: number) {
    this.volume = value
    if (this.context && this.gain)
      this.gain.gain.setTargetAtTime(
        value * 0.45,
        this.context.currentTime,
        0.05,
      )
  }

  private note(
    midi: number,
    instrument: Instrument,
    duration = 1.5,
    strength = 0.25,
  ) {
    const context = this.context!
    const now = context.currentTime
    const envelope = context.createGain()
    envelope.connect(this.gain!)
    envelope.gain.setValueAtTime(0, now)
    envelope.gain.linearRampToValueAtTime(strength, now + 0.012)
    envelope.gain.exponentialRampToValueAtTime(0.001, now + duration)
    const oscillator = context.createOscillator()
    oscillator.type = instrument === 'guitar' ? 'triangle' : 'sine'
    const frequency = 440 * 2 ** ((midi - 69) / 12)
    oscillator.frequency.setValueAtTime(
      instrument === 'drum' ? 145 : frequency,
      now,
    )
    if (instrument === 'drum')
      oscillator.frequency.exponentialRampToValueAtTime(45, now + 0.22)
    if (instrument === 'bells') {
      const overtone = context.createOscillator()
      const overtoneGain = context.createGain()
      overtone.frequency.value = frequency * 2.76
      overtoneGain.gain.value = 0.18
      overtone.connect(overtoneGain).connect(envelope)
      this.track(overtone, now, duration, () => overtoneGain.disconnect())
    }
    oscillator.connect(envelope)
    this.track(oscillator, now, duration, () => envelope.disconnect())
  }

  private track(
    source: AudioScheduledSourceNode,
    now: number,
    duration: number,
    cleanup: () => void,
  ) {
    this.voices.add(source)
    source.onended = () => {
      source.disconnect()
      cleanup()
      this.voices.delete(source)
    }
    source.start(now)
    source.stop(now + duration + 0.05)
  }

  async play(instrument: Instrument) {
    const epoch = this.epoch
    await this.ready()
    if (epoch !== this.epoch) return
    const scale = [60, 64, 67, 69, 72, 67, 64, 62]
    this.note(
      scale[this.noteIndex++ % scale.length] +
        (instrument === 'bells' ? 12 : 0),
      instrument,
      instrument === 'drum' ? 0.4 : 1.8,
    )
  }

  async start(mood: Mood) {
    this.stop()
    const epoch = this.epoch
    await this.ready()
    if (epoch !== this.epoch) return false
    const melody =
      mood === 'calm'
        ? [60, 64, 67, 64, 69, 67, 64, 62]
        : [60, 67, 69, 72, 67, 64, 62, 67]
    let step = 0
    const tick = () => {
      if (step % 4 === 0)
        [48, 52, 55].forEach((note) =>
          this.note(note + (step % 8 === 4 ? 5 : 0), 'piano', 3.4, 0.08),
        )
      this.note(
        melody[step % melody.length],
        mood === 'calm' ? 'piano' : 'guitar',
        1.5,
        0.14,
      )
      step++
    }
    tick()
    this.timer = setInterval(tick, mood === 'calm' ? 720 : 460)
    return true
  }

  stop() {
    this.epoch++
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.voices.forEach((voice) => {
      try {
        voice.stop()
      } catch {
        /* Already ended. */
      }
    })
    this.voices.clear()
  }

  dispose() {
    this.stop()
    void this.context?.close()
    this.context = null
  }
}
