export type Instrument = 'piano' | 'guitar' | 'bells' | 'drum'
export type EffectPitch = 'low' | 'high'
export type Mood = 'calm' | 'bright'
export type CapturePhase = 'idle' | 'recording' | 'composing'

export interface CompositionEffect {
  id: string
  at: number
  effect: Instrument
  intensity: number
  volume: number
  pitch: EffectPitch
}

export interface SavedComposition {
  id: string
  created_at: string
  url: string
  effectsUrl: string
  duration: number
  effects: CompositionEffect[]
}

export interface MusicSettings {
  prompt: string
  negative_prompt: string
  seconds: number
  strength: number
  steps: number
  cfg: number
  seed: number
  repeat: boolean
  input_mix: number
  match_input: boolean
  use_default: boolean
  default_file: string
}

export const DEFAULT_MUSIC_SETTINGS: MusicSettings = {
  prompt: 'Gentle, uplifting, upbeat and beautiful orchestral instrumental composition with warm piano, soft acoustic guitar and a light rhythm.',
  seconds: 60,
  strength: 0.8,
  steps: 8,
  cfg: 2,
  seed: 145081676,
  repeat: false,
  negative_prompt: 'incoherence, noise, lo-fi, bad quality, atonal, bad sound, noisy, glitchy, generic, boring, exaggerated, kitsch, corporate',
  input_mix: 0.95,
  match_input: true,
  use_default: false,
  default_file: 'default_sound.wav',
}

export async function getDefaultAudioFiles() {
  const response = await fetch('/engine/api/assets')
  if (!response.ok) throw new Error('The default audio files could not be loaded.')
  const files: unknown = await response.json()
  if (!Array.isArray(files) || !files.every((file) => typeof file === 'string'))
    throw new Error('The default audio files could not be read.')
  return files
}

export async function getMusicSettings() {
  const response = await fetch('/engine/api/settings')
  if (!response.ok) throw new Error('The music settings could not be loaded.')
  return response.json() as Promise<MusicSettings>
}

export async function saveMusicSettings(settings: MusicSettings) {
  const response = await fetch('/engine/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!response.ok) throw new Error('The music settings could not be saved.')
  return response.json() as Promise<MusicSettings>
}

function isCompositionEffect(value: unknown): value is CompositionEffect {
  if (!value || typeof value !== 'object') return false
  const effect = value as Partial<CompositionEffect>
  return (
    typeof effect.id === 'string' &&
    typeof effect.at === 'number' &&
    ['piano', 'guitar', 'bells', 'drum'].includes(effect.effect ?? '') &&
    typeof effect.intensity === 'number' &&
    typeof effect.volume === 'number' &&
    (effect.pitch === 'low' || effect.pitch === 'high')
  )
}

export async function getCompositions(signal: AbortSignal) {
  const response = await fetch('/engine/api/compositions', { signal })
  if (!response.ok) throw new Error('The saved compositions could not be loaded.')
  const data: unknown = await response.json()
  if (!Array.isArray(data)) throw new Error('The saved compositions could not be read.')
  return data.reduce<SavedComposition[]>((items, item) => {
    if (
      item &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      typeof item.created_at === 'string'
    )
      items.push({
        id: item.id,
        created_at: item.created_at,
        url: `/engine/api/compositions/${encodeURIComponent(item.id)}/base`,
        effectsUrl: `/engine/api/compositions/${encodeURIComponent(item.id)}/effects`,
        duration: typeof item.duration === 'number' ? item.duration : 0,
        effects: Array.isArray(item.effects)
          ? item.effects.filter(isCompositionEffect)
          : [],
      })
    return items
  }, [])
}

export async function deleteComposition(identifier: string) {
  const response = await fetch(
    `/engine/api/compositions/${encodeURIComponent(identifier)}`,
    { method: 'DELETE' },
  )
  if (!response.ok) throw new Error('The song could not be deleted.')
}

export async function deleteAllCompositions() {
  const response = await fetch('/engine/api/compositions', { method: 'DELETE' })
  if (!response.ok) throw new Error('The songs could not be deleted.')
}

export async function saveCompositionEffect(
  identifier: string,
  effect: Omit<CompositionEffect, 'id'>,
) {
  const response = await fetch(
    `/engine/api/compositions/${encodeURIComponent(identifier)}/effects`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(effect),
    },
  )
  if (!response.ok) throw new Error('The mouth effect could not be saved.')
  return response.json() as Promise<{
    duration: number
    effects: CompositionEffect[]
  }>
}

export async function deleteCompositionEffect(
  identifier: string,
  effectId: string,
) {
  const response = await fetch(
    `/engine/api/compositions/${encodeURIComponent(identifier)}/effects/${encodeURIComponent(effectId)}`,
    { method: 'DELETE' },
  )
  if (!response.ok) throw new Error('The mouth effect could not be removed.')
  return response.json() as Promise<{
    duration: number
    effects: CompositionEffect[]
  }>
}

export class MusicRoom {
  private context: AudioContext | null = null
  private gain: GainNode | null = null
  private musicGain: GainNode | null = null
  private effectsGain: GainNode | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private voices = new Set<AudioScheduledSourceNode>()
  private loop: AudioBufferSourceNode | null = null
  private effectsLoop: AudioBufferSourceNode | null = null
  private loopStartedAt = 0
  private loopDuration = 0
  private compositionRefresh = 0
  private stream: MediaStream | null = null
  private input: MediaStreamAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private recorder: MediaRecorder | null = null
  private captureTimer: ReturnType<typeof setInterval> | null = null
  private onCapturePhaseChange: ((phase: CapturePhase) => void) | null = null
  private request: AbortController | null = null
  private capturedAudio: File | null = null
  private capturedCompositionId: string | null = null
  private epoch = 0
  private volume = 0.45
  private musicVolume = 1
  private effectsVolume = 1
  private autoReplay = true
  private noteIndex = 0
  private readonly onPlaybackEnd: () => void

  constructor(onPlaybackEnd: () => void = () => {}) {
    this.onPlaybackEnd = onPlaybackEnd
  }

  private async ready() {
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext()
      this.gain = this.context.createGain()
      this.musicGain = this.context.createGain()
      this.effectsGain = this.context.createGain()
      this.gain.gain.value = this.volume * 0.45
      this.musicGain.gain.value = this.musicVolume
      this.effectsGain.gain.value = this.effectsVolume
      this.musicGain.connect(this.gain)
      this.effectsGain.connect(this.gain)
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

  setMusicVolume(value: number) {
    this.musicVolume = value
    if (this.context && this.musicGain)
      this.musicGain.gain.setTargetAtTime(value, this.context.currentTime, 0.05)
  }

  setEffectsVolume(value: number) {
    this.effectsVolume = value
    if (this.context && this.effectsGain)
      this.effectsGain.gain.setTargetAtTime(value, this.context.currentTime, 0.05)
  }

  setAutoReplay(value: boolean) {
    this.autoReplay = value
    if (this.loop) this.loop.loop = value
    if (this.effectsLoop) this.effectsLoop.loop = value
  }

  async pause() {
    if (this.context?.state === 'running') await this.context.suspend()
  }

  async resume() {
    if (!this.context || (!this.loop && !this.timer)) return false
    await this.context.resume()
    return true
  }

  private note(
    midi: number,
    instrument: Instrument,
    duration = 1.5,
    strength = 0.25,
    output = this.effectsGain!,
  ) {
    const context = this.context!
    const now = context.currentTime
    const envelope = context.createGain()
    envelope.connect(output)
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

  beat(effect: Instrument, intensity: number, volume: number, pitch: EffectPitch) {
    if (
      !this.context ||
      this.context.state === 'closed' ||
      !this.gain ||
      !this.loop ||
      !this.loopDuration
    )
      return null
    const midi = (pitch === 'high' ? 72 : 60) + (effect === 'bells' ? 12 : 0)
    this.note(midi, effect, effect === 'drum' ? 0.4 : 1.2, (0.2 + 0.45 * intensity) * volume)
    return (this.context.currentTime - this.loopStartedAt) % this.loopDuration
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
          this.note(
            note + (step % 8 === 4 ? 5 : 0),
            'piano',
            3.4,
            0.08,
            this.musicGain!,
          ),
        )
      this.note(
        melody[step % melody.length],
        mood === 'calm' ? 'piano' : 'guitar',
        1.5,
        0.14,
        this.musicGain!,
      )
      step++
    }
    tick()
    this.timer = setInterval(tick, mood === 'calm' ? 720 : 460)
    return true
  }

  async captureAndCompose(
    onCapturePhaseChange: (phase: CapturePhase) => void,
    onComposition?: (identifier: string) => void,
  ) {
    this.stop()
    const epoch = this.epoch
    const audio = await this.capture(epoch, onCapturePhaseChange)
    if (!audio || epoch !== this.epoch) {
      onCapturePhaseChange('idle')
      return false
    }
    this.capturedAudio = audio
    return this.compose(audio, epoch, onCapturePhaseChange, onComposition)
  }

  canRegenerate(identifier: string | null) {
    return Boolean(
      identifier &&
        this.capturedAudio &&
        identifier === this.capturedCompositionId,
    )
  }

  async regenerate(
    onCapturePhaseChange: (phase: CapturePhase) => void,
    onComposition?: (identifier: string) => void,
  ) {
    if (!this.capturedAudio)
      throw new Error('Record a melody before regenerating it.')
    this.stop()
    return this.compose(
      this.capturedAudio,
      this.epoch,
      onCapturePhaseChange,
      onComposition,
    )
  }

  private async compose(
    audio: File,
    epoch: number,
    onCapturePhaseChange: (phase: CapturePhase) => void,
    onComposition?: (identifier: string) => void,
  ) {
    const controller = new AbortController()
    this.request = controller
    onCapturePhaseChange('composing')
    try {
      await this.waitForEngine(controller.signal, epoch)
      if (epoch !== this.epoch) return false
      const form = new FormData()
      form.append('audio', audio)
      form.append('settings', '{}')
      const response = await fetch('/engine/api/compose', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(
          typeof body.detail === 'string'
            ? body.detail
            : 'The audio engine could not create music.',
        )
      }
      const buffer = await this.context!.decodeAudioData(
        await response.arrayBuffer(),
      )
      if (epoch !== this.epoch) return false
      this.startLoop(buffer)
      const identifier = response.headers.get('X-Composition-ID')
      if (identifier) {
        this.capturedCompositionId = identifier
        onComposition?.(identifier)
      }
      onCapturePhaseChange('idle')
      return true
    } catch (error) {
      onCapturePhaseChange('idle')
      if (epoch !== this.epoch || controller.signal.aborted) return false
      throw error
    } finally {
      if (this.request === controller) this.request = null
    }
  }

  async playComposition(url: string, effectsUrl?: string) {
    this.stop()
    const epoch = this.epoch
    await this.ready()
    const [response, effectsResponse] = await Promise.all([
      fetch(url),
      effectsUrl ? fetch(effectsUrl) : null,
    ])
    if (!response.ok || (effectsResponse && !effectsResponse.ok))
      throw new Error('The saved composition could not be played.')
    const [buffer, effectsBuffer] = await Promise.all([
      this.context!.decodeAudioData(await response.arrayBuffer()),
      effectsResponse
        ? this.context!.decodeAudioData(await effectsResponse.arrayBuffer())
        : null,
    ])
    if (epoch !== this.epoch) return false
    this.startLoop(buffer)
    if (effectsBuffer) this.startEffectsLoop(effectsBuffer)
    return true
  }

  async refreshCompositionEffects(url: string) {
    if (!this.context || !this.loop || !this.loopDuration) return false
    const epoch = this.epoch
    const refresh = ++this.compositionRefresh
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error('The updated effects could not be played.')
    const buffer = await this.context.decodeAudioData(await response.arrayBuffer())
    if (epoch !== this.epoch || refresh !== this.compositionRefresh || !this.loop)
      return false
    const offset =
      (this.context.currentTime - this.loopStartedAt) % buffer.duration
    this.effectsLoop?.stop()
    this.effectsLoop?.disconnect()
    this.startEffectsLoop(buffer, offset)
    return true
  }

  private startLoop(buffer: AudioBuffer, offset = 0) {
    const source = this.context!.createBufferSource()
    this.loop = source
    source.buffer = buffer
    source.loop = this.autoReplay
    source.connect(this.musicGain!)
    this.loopStartedAt = this.context!.currentTime - offset
    this.loopDuration = buffer.duration
    source.onended = () => {
      if (this.loop !== source) return
      source.disconnect()
      this.loop = null
      this.effectsLoop?.stop()
      this.effectsLoop?.disconnect()
      this.effectsLoop = null
      this.loopDuration = 0
      this.onPlaybackEnd()
    }
    source.start(0, offset)
  }

  private startEffectsLoop(buffer: AudioBuffer, offset = 0) {
    this.effectsLoop = this.context!.createBufferSource()
    this.effectsLoop.buffer = buffer
    this.effectsLoop.loop = this.autoReplay
    this.effectsLoop.connect(this.effectsGain!)
    this.effectsLoop.start(0, offset)
  }

  finishCapture() {
    const recorder = this.recorder
    if (!recorder || recorder.state === 'inactive') return
    if (this.captureTimer) clearInterval(this.captureTimer)
    this.captureTimer = null
    this.onCapturePhaseChange?.('composing')
    recorder.stop()
  }

  private async capture(
    epoch: number,
    onCapturePhaseChange: (phase: CapturePhase) => void,
  ) {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
      throw new Error('This browser cannot record a melody here.')
    await this.ready()
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
    if (epoch !== this.epoch) {
      stream.getTracks().forEach((track) => track.stop())
      return null
    }
    const context = this.context!
    const chunks: Blob[] = []
    const recorder = new MediaRecorder(stream)
    this.stream = stream
    this.input = context.createMediaStreamSource(stream)
    this.analyser = context.createAnalyser()
    this.analyser.fftSize = 2048
    this.input.connect(this.analyser)
    recorder.ondataavailable = ({ data }) => {
      if (data.size) chunks.push(data)
    }
    this.recorder = recorder
    this.onCapturePhaseChange = onCapturePhaseChange
    recorder.start(250)
    onCapturePhaseChange('recording')

    return new Promise<File | null>((resolve, reject) => {
      const samples = new Float32Array(this.analyser!.fftSize)
      const startedAt = performance.now()
      let heardAudio = false
      let lastAudioAt = startedAt
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        if (this.captureTimer) clearInterval(this.captureTimer)
        this.captureTimer = null
        this.onCapturePhaseChange?.('composing')
        if (recorder.state !== 'inactive') recorder.stop()
      }
      recorder.onerror = () => {
        this.releaseMicrophone(recorder)
        reject(new Error('The microphone recording could not finish.'))
      }
      recorder.onstop = async () => {
        this.releaseMicrophone(recorder)
        if (!heardAudio || epoch !== this.epoch) return resolve(null)
        try {
          const input = await context.decodeAudioData(
            await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer(),
          )
          const audio = input.getChannelData(0).slice(0, input.sampleRate * 30)
          resolve(
            audio.length >= input.sampleRate
              ? new File([this.encodeWav(audio, input.sampleRate)], 'melody.wav', {
                  type: 'audio/wav',
                })
              : null,
          )
        } catch {
          reject(new Error('The melody could not be read. Please try again.'))
        }
      }
      this.captureTimer = setInterval(() => {
        this.analyser?.getFloatTimeDomainData(samples)
        let energy = 0
        for (const sample of samples) energy += sample * sample
        const now = performance.now()
        if (Math.sqrt(energy / samples.length) >= 0.012) {
          heardAudio = true
          lastAudioAt = now
        }
        if (
          now - startedAt >= 30_000 ||
          (heardAudio && now - startedAt >= 1_000 && now - lastAudioAt >= 1_200)
        )
          finish()
      }, 100)
    })
  }

  private releaseMicrophone(recorder?: MediaRecorder) {
    if (recorder && this.recorder !== recorder) return
    if (this.captureTimer) clearInterval(this.captureTimer)
    this.captureTimer = null
    this.stream?.getTracks().forEach((track) => track.stop())
    this.input?.disconnect()
    this.analyser?.disconnect()
    this.stream = this.input = this.analyser = this.recorder = null
  }

  private async waitForEngine(signal: AbortSignal, epoch: number) {
    let setupRequested = false
    while (epoch === this.epoch) {
      const response = await fetch('/engine/api/status', { signal })
      if (!response.ok) throw new Error('The audio engine is unavailable.')
      const status = await response.json()
      if (status.ready) return
      if (setupRequested && !status.setup?.busy)
        throw new Error(status.message || 'The audio engine is not ready.')
      if (!status.setup?.busy) {
        setupRequested = true
        const setup = await fetch('/engine/api/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal,
        })
        if (!setup.ok) throw new Error('The audio engine could not start.')
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
  }

  private encodeWav(samples: Float32Array, sampleRate: number) {
    const wav = new ArrayBuffer(44 + samples.length * 2)
    const view = new DataView(wav)
    const text = (offset: number, value: string) =>
      [...value].forEach((character, index) =>
        view.setUint8(offset + index, character.charCodeAt(0)),
      )
    text(0, 'RIFF')
    view.setUint32(4, 36 + samples.length * 2, true)
    text(8, 'WAVE')
    text(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    text(36, 'data')
    view.setUint32(40, samples.length * 2, true)
    samples.forEach((sample, index) =>
      view.setInt16(
        44 + index * 2,
        Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767)),
        true,
      ),
    )
    return wav
  }

  stop() {
    this.epoch++
    this.compositionRefresh++
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.request?.abort()
    this.request = null
    this.onCapturePhaseChange?.('idle')
    this.onCapturePhaseChange = null
    const recorder = this.recorder
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    this.releaseMicrophone()
    if (this.loop) {
      this.loop.stop()
      this.loop.disconnect()
      this.loop = null
    }
    if (this.effectsLoop) {
      this.effectsLoop.stop()
      this.effectsLoop.disconnect()
      this.effectsLoop = null
    }
    this.loopDuration = 0
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
