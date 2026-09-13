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
  profileQuestion,
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
  name: string,
  onMusicPromptFinished?: () => void,
  onMusicModeStarted?: () => void,
) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [transcript, setTranscript] = useState('')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [canReplay, setCanReplay] = useState(false)
  const [turns, setTurns] = useState<SavedTurn[]>([])
  const turnsRef = useRef<SavedTurn[]>([])
  const [continuous, setContinuous] = useState(false)
  const [playMode, setPlayMode] = useState(false)
  const continuousRef = useRef(false)
  const playModeRef = useRef(false)
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
  const settings = useRef({ readAloud, volume, savedHistory, onTurnFinished, onboarding, name, onMusicPromptFinished, onMusicModeStarted })

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
    playModeRef.current = false
    setPlayMode(false)
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
    settings.current = { readAloud, volume, savedHistory, onTurnFinished, onboarding, name, onMusicPromptFinished, onMusicModeStarted }
    if (player.current) player.current.volume = volume
  }, [readAloud, volume, savedHistory, onTurnFinished, onboarding, name, onMusicPromptFinished, onMusicModeStarted])
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
        : 'The voice companion is not responding right now. You can keep playing the instruments.',
    )
  }

  function finishResponse(turn: Turn, startMusic = false) {
    if (!isCurrent(turn)) return
    setPhase('idle')
    if (startMusic) {
      settings.current.onMusicPromptFinished?.()
      return
    }
    if (restartTimer.current) clearTimeout(restartTimer.current)
    if (continuousRef.current) {
      setPhase('permission')
      restartTimer.current = setTimeout(() => {
        if (continuousRef.current && isCurrent(turn)) void startRecording(true)
      }, 100)
    }
  }

  async function respond(text: string, turn: Turn) {
    if (!isCurrent(turn)) return
    setTranscript(text)
    setPhase('thinking')
    const startedAt = performance.now()
    let startMusic = false
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
        (mode) => {
          if (mode === 'play') {
            continuousRef.current = false
            setContinuous(false)
            playModeRef.current = true
            setPlayMode(true)
            startMusic = true
            settings.current.onMusicModeStarted?.()
          }
        },
        (key) => {
          pendingOnboardingKey.current = key
        },
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
        finishResponse(turn, startMusic)
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
          finishResponse(turn, startMusic)
          return
        }
        audioUrl.current = URL.createObjectURL(blob)
        const audio = new Audio(audioUrl.current)
        audio.volume = settings.current.volume
        player.current = audio
        setCanReplay(true)
        audio.onended = () => {
          finishResponse(turn, startMusic)
        }
        audio.onpause = () => {
          finishResponse(turn, startMusic)
        }
        try {
          await audio.play()
          if (isCurrent(turn)) setPhase('speaking')
          else audio.pause()
        } catch {
          if (isCurrent(turn)) {
            void stop()
            setError(
              'Tap “Hear the answer again” to start speech playback.',
            )
          }
        }
      } catch {
        if (isCurrent(turn)) {
          void stop()
          setError(
            'Speech playback is unavailable right now. You can read the answer here.',
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
          'This browser cannot record here. Open the page through localhost or HTTPS.',
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
          if (level >= 0.003) {
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
        fail(new Error('The microphone connection was interrupted.'), turn)
      live.onmessage = ({ data }) => {
        if (!isCurrent(turn)) return
        try {
          const message = JSON.parse(data)
          if (message.type === 'partial' && typeof message.text === 'string')
            setTranscript(message.text)
          if (message.type === 'error')
            fail(new Error(message.detail || 'The recording could not be processed.'), turn)
          if (message.type === 'final') {
            const text = typeof message.text === 'string' ? message.text.trim() : ''
            if (text) void respond(text, turn)
            else if (continuousRef.current)
              setTimeout(() => void startRecording(true), 300)
            else setPhase('idle')
          }
        } catch {
          fail(new Error('The microphone response could not be read.'), turn)
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
                'I did not hear a voice. Start the conversation again.',
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
            ? 'The microphone is not allowed. Enable it in your browser.'
            : 'No microphone is available. Check your microphone.',
        ),
        turn,
      )
    }
  }

  async function startConversation() {
    playModeRef.current = false
    setPlayMode(false)
    continuousRef.current = true
    setContinuous(true)
    const turn = beginTurn()
    setPhase('permission')
    if (!navigator.mediaDevices?.getUserMedia) {
      fail(
        new Error(
          'This browser cannot use the microphone. Open the page over localhost or HTTPS.',
        ),
        turn,
      )
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      stream.getTracks().forEach((track) => track.stop())
      if (!isCurrent(turn)) return
    } catch (cause) {
      const denied =
        cause instanceof DOMException &&
        (cause.name === 'NotAllowedError' || cause.name === 'SecurityError')
      fail(
        new Error(
          denied
            ? 'The microphone is not allowed. Enable it in your browser.'
            : 'No microphone is available. Check your microphone.',
        ),
        turn,
      )
      return
    }
    const onboardingPrompt = settings.current.onboarding
    if (onboardingPrompt) return startOnboarding(onboardingPrompt, turn)
    return startGreeting(turn)
  }

  async function startOnboarding(
    onboarding: NonNullable<ProfileState['onboarding']>,
    turn?: Turn,
  ) {
    const prompt = onboarding.key === 'name'
      ? `Welcome to Sound Flux. I would like to get to know you a little better. ${onboarding.question}`
      : profileQuestion(onboarding.key, onboarding.question)
    return speakBeforeListening(prompt, onboarding.key, turn)
  }

  async function startGreeting(turn?: Turn) {
    const name = settings.current.name ? `, ${settings.current.name}` : ''
    continuousRef.current = false
    setContinuous(false)
    playModeRef.current = true
    setPlayMode(true)
    settings.current.onMusicModeStarted?.()
    return speakBeforeListening(
      `Let's do some music${name}. I am glad you are here. Hum a melody for me.`,
      null,
      turn,
      () => {
        setPhase('idle')
        settings.current.onMusicPromptFinished?.()
      },
    )
  }

  async function speakBeforeListening(
    prompt: string,
    onboardingKey: string | null = null,
    existingTurn?: Turn,
    onSpeechEnd?: () => void,
  ) {
    const turn = existingTurn ?? beginTurn()
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
        if (!isCurrent(turn)) return
        if (onSpeechEnd) return onSpeechEnd()
        if (continuousRef.current) void startRecording(true, turn)
        else setPhase('idle')
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
          'Playback could not start. Check your browser’s audio permission.',
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
    setPlayMode(false)
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
    playMode,
    startRecording,
    startConversation,
    finishRecording,
    replay,
    stop,
    reset,
  }
}
