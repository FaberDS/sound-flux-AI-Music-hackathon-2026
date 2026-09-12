// This only measures pauses locally. The existing upload endpoint receives the completed recording.
export class SpeechPauseDetector {
  private context = new AudioContext()
  private source: MediaStreamAudioSourceNode
  private analyser: AnalyserNode
  private timer: ReturnType<typeof setInterval> | null = null
  private heardSpeech = false
  private stopped = false

  constructor(stream: MediaStream) {
    this.source = this.context.createMediaStreamSource(stream)
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 2048
    this.source.connect(this.analyser)
  }

  get hasSpeech() {
    return this.heardSpeech
  }

  async start(onPause: () => void) {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.context.resume(),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  'Die Pausenerkennung konnte nicht starten. Bitte verwende die manuelle Aufnahme.',
                ),
              ),
            3_000,
          )
        }),
      ])
    } finally {
      clearTimeout(timeout)
    }
    if (this.stopped) return
    const samples = new Float32Array(this.analyser.fftSize)
    let voiceFrames = 0
    let lastSpeechAt = performance.now()
    this.timer = setInterval(() => {
      this.analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const sample of samples) sum += sample * sample
      if (Math.sqrt(sum / samples.length) >= 0.012) {
        voiceFrames++
        if (voiceFrames >= 2) this.heardSpeech = true
        lastSpeechAt = performance.now()
      } else {
        voiceFrames = 0
        if (this.heardSpeech && performance.now() - lastSpeechAt >= 1_200) {
          this.stop()
          onPause()
        }
      }
    }, 100)
  }

  stop() {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.source.disconnect()
    this.analyser.disconnect()
    if (this.context.state !== 'closed')
      void this.context.close().catch(() => {})
  }
}
