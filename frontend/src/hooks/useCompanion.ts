import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createSpeech,
  interruptTurn,
  liveSocketUrl,
  streamReply,
} from '../lib/api'
import {
  chatContext,
  mergeTurns,
  type ProfileState,
  type SavedTurn,
} from '../lib/savedData'

export type Phase =
  'idle' | 'permission' | 'recording' | 'transcribing' | 'thinking' | 'speaking'
interface Turn {
  id: string
  controller: AbortController
}

export function useCompanion(
  savedHistory: SavedTurn[],
  readAloud: boolean,
  volume: number,
  onTurnFinished: () => void,
  onboarding: ProfileState['onboarding'],
) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [transcript, setTranscript] = useState('')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [canReplay, setCanReplay] = useState(false)
  const [turns, setTurns] = useState<SavedTurn[]>([])
  const turnsRef = useRef<SavedTurn[]>([])
  const [continuous, setContinuous] = useState(false)
  const continuousRef = useRef(false)
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const active = useRef<Turn | null>(null)
  const pendingInterrupts = useRef(new Set<Promise<void>>())
  const media = useRef<MediaStream | null>(null)
  const socket = useRef<WebSocket | null>(null)
  const context = useRef<AudioContext | null>(null)
  const source = useRef<MediaStreamAudioSourceNode | null>(null)
  const processor = useRef<ScriptProcessorNode | null>(null)
  const finishLive = useRef<(() => void) | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const player = useRef<HTMLAudioElement | null>(null)
  const audioUrl = useRef<string | null>(null)
  const playbackGeneration = useRef(0)
  const pendingOnboardingKey = useRef<string | null>(null)
  const settings = useRef({ readAloud, volume, savedHistory, onTurnFinished, onboarding })

  const clearCapture = useCallback((closeSocket = true) => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    finishLive.current = null
    processor.current?.disconnect()
    processor.current = null
    source.current?.disconnect()
    source.current = null
    if (context.current?.state !== 'closed')
      void context.current?.close().catch(() => {})
    context.current = null
    media.current?.getTracks().forEach((track) => track.stop())
    media.current = null
    if (closeSocket) socket.current?.close()
    if (closeSocket) socket.current = null
  }, [])

  const cancel = useCallback(() => {
    if (restartTimer.current) clearTimeout(restartTimer.current)
    restartTimer.current = null
    playbackGeneration.current++
    const previous = active.current
    active.current = null
    previous?.controller.abort()
    if (previous) {
      const pending = interruptTurn(previous.id)
      pendingInterrupts.current.add(pending)
      void pending
        .finally(() => pendingInterrupts.current.delete(pending))
        .catch(() => {})
    }
    const interrupted = Promise.all([...pendingInterrupts.current]).then(
      () => {},
    )
    void interrupted.catch(() => {})
    clearCapture()
    if (player.current) {
      player.current.onended = null
      player.current.onpause = null
      player.current.pause()
      player.current.currentTime = 0
    }
    return interrupted
  }, [clearCapture])

  const stop = useCallback(() => {
    continuousRef.current = false
    setContinuous(false)
    const interrupted = cancel()
    setPhase('idle')
    return interrupted
  }, [cancel])

  useEffect(
    () => () => {
      continuousRef.current = false
      void cancel()
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current)
    },
    [cancel],
  )

  useEffect(() => {
    settings.current = { readAloud, volume, savedHistory, onTurnFinished, onboarding }
    if (player.current) player.current.volume = volume
  }, [readAloud, volume, savedHistory, onTurnFinished, onboarding])
  useEffect(() => {
    if (!readAloud) {
      player.current?.pause()
    }
  }, [readAloud])

  const isCurrent = (turn: Turn) =>
    active.current === turn && !turn.controller.signal.aborted

  function beginTurn() {
    void cancel()
    const turn = { id: crypto.randomUUID(), controller: new AbortController() }
    active.current = turn
    setError('')
    setAnswer('')
    setTranscript('')
    setCanReplay(false)
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current)
    audioUrl.current = null
    player.current = null
    return turn
  }

  function fail(cause: unknown, turn: Turn) {
    if (!isCurrent(turn)) return
    void stop()
    settings.current.onTurnFinished()
    setError(
      cause instanceof Error &&
        cause.name !== 'TypeError' &&
        cause.name !== 'TimeoutError'
        ? cause.message
        : 'Die Sprachbegleitung antwortet gerade nicht. Du kannst weiter auf den Instrumenten spielen.',
    )
  }

  function finishResponse(turn: Turn) {
    if (!isCurrent(turn)) return
    setPhase('idle')
    if (restartTimer.current) clearTimeout(restartTimer.current)
    if (continuousRef.current) {
      restartTimer.current = setTimeout(() => {
        if (continuousRef.current && isCurrent(turn)) void startRecording(true)
      }, 350)
    }
  }

  async function respond(text: string, turn: Turn) {
    if (!isCurrent(turn)) return
    setTranscript(text)
    setPhase('thinking')
    const startedAt = performance.now()
    try {
      const onboardingKey = pendingOnboardingKey.current
      pendingOnboardingKey.current = null
      const response = await streamReply(
        turn.id,
        text,
        chatContext(
          mergeTurns(settings.current.savedHistory, turnsRef.current),
        ),
        [],
        turn.controller.signal,
        (partial) => {
          if (isCurrent(turn)) setAnswer(partial)
        },
        onboardingKey,
      )
      if (!isCurrent(turn)) return
      turnsRef.current = [
        ...turnsRef.current,
        {
          turn_id: turn.id,
          created_at: new Date().toISOString(),
          user: text,
          assistant: response,
          model: '',
          duration_ms: Math.round(performance.now() - startedAt),
        },
      ]
      setTurns([...turnsRef.current])
      settings.current.onTurnFinished()
      if (!settings.current.readAloud) {
        finishResponse(turn)
        return
      }
      try {
        const blob = await createSpeech(
          turn.id,
          response,
          turn.controller.signal,
        )
        if (!isCurrent(turn)) return
        if (!settings.current.readAloud) {
          finishResponse(turn)
          return
        }
        audioUrl.current = URL.createObjectURL(blob)
        const audio = new Audio(audioUrl.current)
        audio.volume = settings.current.volume
        player.current = audio
        setCanReplay(true)
        audio.onended = () => {
          finishResponse(turn)
        }
        audio.onpause = () => {
          finishResponse(turn)
        }
        try {
          await audio.play()
          if (isCurrent(turn)) setPhase('speaking')
          else audio.pause()
        } catch {
          if (isCurrent(turn)) {
            void stop()
            setError(
              'Tippe auf „Antwort noch einmal hören“, um die Sprachausgabe zu starten.',
            )
          }
        }
      } catch {
        if (isCurrent(turn)) {
          void stop()
          setError(
            'Die Sprachausgabe ist gerade nicht verfügbar. Du kannst die Antwort hier lesen.',
          )
        }
      }
    } catch (cause) {
      fail(cause, turn)
    }
  }

  async function startRecording(automatic = false, existingTurn?: Turn) {
    if (automatic && !continuousRef.current) return
    if (!automatic) {
      continuousRef.current = false
      setContinuous(false)
    }
    const turn = existingTurn ?? beginTurn()
    setPhase('permission')
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === 'undefined'
    ) {
      fail(
        new Error(
          'Dieser Browser kann hier nicht aufnehmen. Öffne die Seite über localhost oder HTTPS.',
        ),
        turn,
      )
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      if (!isCurrent(turn)) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      media.current = stream
      const audioContext = new AudioContext()
      context.current = audioContext
      await audioContext.resume()
      const audioSource = audioContext.createMediaStreamSource(stream)
      const audioProcessor = audioContext.createScriptProcessor(4096, 1, 1)
      source.current = audioSource
      processor.current = audioProcessor
      const live = new WebSocket(liveSocketUrl(turn.id))
      socket.current = live
      let audioFrames = 0
      let heardSpeech = false
      let lastSpeechAt = performance.now()
      const finish = () => {
        if (!isCurrent(turn) || !finishLive.current) return
        finishLive.current = null
        setPhase('transcribing')
        const stopMessage = JSON.stringify({ type: 'stop' })
        if (live.readyState === WebSocket.OPEN) live.send(stopMessage)
        else live.addEventListener('open', () => live.send(stopMessage), { once: true })
        clearCapture(false)
      }
      finishLive.current = finish
      audioProcessor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0)
        const pcm = new Int16Array(input.length)
        let sum = 0
        for (let index = 0; index < input.length; index++) {
          const sample = input[index]
          pcm[index] = Math.max(-1, Math.min(1, sample)) * 32767
          sum += sample * sample
        }
        if (++audioFrames % 8 === 0 && automatic) {
          const level = Math.sqrt(sum / input.length)
          if (level >= 0.01) {
            heardSpeech = true
            lastSpeechAt = performance.now()
          } else if (heardSpeech && performance.now() - lastSpeechAt >= 1_200) {
            finish()
          }
        }
        if (live.readyState === WebSocket.OPEN) live.send(pcm.buffer)
      }
      audioSource.connect(audioProcessor)
      audioProcessor.connect(audioContext.destination)
      live.onopen = () =>
        live.send(JSON.stringify({ type: 'start', sample_rate: audioContext.sampleRate }))
      live.onerror = () =>
        fail(new Error('Die Mikrofonverbindung wurde unterbrochen.'), turn)
      live.onmessage = ({ data }) => {
        if (!isCurrent(turn)) return
        try {
          const message = JSON.parse(data)
          if (message.type === 'partial' && typeof message.text === 'string')
            setTranscript(message.text)
          if (message.type === 'error')
            fail(new Error(message.detail || 'Die Aufnahme konnte nicht verarbeitet werden.'), turn)
          if (message.type === 'final') {
            const text = typeof message.text === 'string' ? message.text.trim() : ''
            if (text) void respond(text, turn)
            else if (continuousRef.current)
              setTimeout(() => void startRecording(true), 300)
            else setPhase('idle')
          }
        } catch {
          fail(new Error('Die Mikrofonantwort konnte nicht gelesen werden.'), turn)
        }
      }
      setPhase('recording')
      const startedAt = Date.now()
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1_000)
        if (elapsed >= 60 && finishLive.current) {
          if (automatic && !heardSpeech) {
            fail(
              new Error(
                'Ich habe keine Stimme gehört. Starte das Gespräch erneut.',
              ),
              turn,
            )
          } else finish()
        }
      }, 250)
    } catch (cause) {
      const denied =
        cause instanceof DOMException &&
        (cause.name === 'NotAllowedError' || cause.name === 'SecurityError')
      fail(
        new Error(
          denied
            ? 'Das Mikrofon ist nicht freigegeben. Erlaube den Zugriff im Browser.'
            : 'Kein Mikrofon verfügbar. Prüfe dein Mikrofon.',
        ),
        turn,
      )
    }
  }

  function startConversation() {
    continuousRef.current = true
    setContinuous(true)
    const onboardingPrompt = settings.current.onboarding
    if (onboardingPrompt) return startOnboarding(onboardingPrompt)
    return startGreeting()
  }

  async function startOnboarding(onboarding: NonNullable<ProfileState['onboarding']>) {
    const prompt = onboarding.key === 'name'
      ? `Welcome to Sound Flux. I would like to get to know you a little better. ${onboarding.question}`
      : onboarding.question
    return speakBeforeListening(prompt, onboarding.key)
  }

  async function startGreeting() {
    return speakBeforeListening("Let's do some music.")
  }

  async function speakBeforeListening(prompt: string, onboardingKey: string | null = null) {
    const turn = beginTurn()
    pendingOnboardingKey.current = onboardingKey
    setAnswer(prompt)
    setPhase('thinking')
    try {
      const blob = await createSpeech(turn.id, prompt, turn.controller.signal)
      if (!isCurrent(turn)) return
      const url = URL.createObjectURL(blob)
      audioUrl.current = url
      const audio = new Audio(url)
      audio.volume = settings.current.volume
      player.current = audio
      audio.onended = () => {
        if (continuousRef.current && isCurrent(turn))
          void startRecording(true, turn)
      }
      await audio.play()
      if (isCurrent(turn)) setPhase('speaking')
    } catch (cause) {
      fail(cause, turn)
    }
  }

  function finishRecording() {
    finishLive.current?.()
  }

  async function replay() {
    if (!player.current) return
    void stop()
    const generation = ++playbackGeneration.current
    const audio = player.current
    audio.currentTime = 0
    audio.onended = () => {
      if (generation === playbackGeneration.current) setPhase('idle')
    }
    audio.onpause = () => {
      if (generation === playbackGeneration.current) setPhase('idle')
    }
    try {
      await audio.play()
      if (generation === playbackGeneration.current) setPhase('speaking')
      else audio.pause()
    } catch {
      if (generation === playbackGeneration.current)
        setError(
          'Die Wiedergabe konnte nicht starten. Prüfe die Audiofreigabe deines Browsers.',
        )
    }
  }

  function reset() {
    void stop()
    turnsRef.current = []
    setTurns([])
    setAnswer('')
    setTranscript('')
    setError('')
    setCanReplay(false)
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current)
    audioUrl.current = null
    player.current = null
  }

  return {
    phase,
    transcript,
    answer,
    error,
    canReplay,
    turns,
    continuous,
    startRecording,
    startConversation,
    finishRecording,
    replay,
    stop,
    reset,
  }
}
