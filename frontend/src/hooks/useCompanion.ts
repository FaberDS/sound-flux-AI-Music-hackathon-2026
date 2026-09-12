import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createSpeech,
  interruptTurn,
  streamReply,
  transcribe,
} from '../lib/api'
import { chatContext, mergeTurns, type SavedTurn } from '../lib/savedData'
import { SpeechPauseDetector } from '../lib/speechPause'

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
) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [transcript, setTranscript] = useState('')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [canReplay, setCanReplay] = useState(false)
  const [turns, setTurns] = useState<SavedTurn[]>([])
  const turnsRef = useRef<SavedTurn[]>([])
  const [continuous, setContinuous] = useState(false)
  const continuousRef = useRef(false)
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pauseDetector = useRef<SpeechPauseDetector | null>(null)
  const active = useRef<Turn | null>(null)
  const pendingInterrupts = useRef(new Set<Promise<void>>())
  const recorder = useRef<MediaRecorder | null>(null)
  const media = useRef<MediaStream | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const player = useRef<HTMLAudioElement | null>(null)
  const audioUrl = useRef<string | null>(null)
  const playbackGeneration = useRef(0)
  const settings = useRef({ readAloud, volume, savedHistory, onTurnFinished })

  const clearCapture = useCallback(() => {
    pauseDetector.current?.stop()
    pauseDetector.current = null
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    if (recorder.current?.state === 'recording') recorder.current.stop()
    recorder.current = null
    media.current?.getTracks().forEach((track) => track.stop())
    media.current = null
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
      void pending.finally(() => pendingInterrupts.current.delete(pending)).catch(() => {})
    }
    const interrupted = Promise.all([...pendingInterrupts.current]).then(() => {})
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
    settings.current = { readAloud, volume, savedHistory, onTurnFinished }
    if (player.current) player.current.volume = volume
  }, [readAloud, volume, savedHistory, onTurnFinished])
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

  async function send(text: string) {
    if (!text.trim()) return
    continuousRef.current = false
    setContinuous(false)
    const turn = beginTurn()
    await respond(text.trim().slice(0, 4_000), turn)
  }

  async function startRecording(automatic = false) {
    if (automatic && !continuousRef.current) return
    if (!automatic) {
      continuousRef.current = false
      setContinuous(false)
    }
    const turn = beginTurn()
    setPhase('permission')
    setSeconds(0)
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      fail(
        new Error(
          'Dieser Browser kann hier nicht aufnehmen. Öffne die Seite über localhost oder HTTPS, oder schreibe deine Nachricht.',
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
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].find((type) => MediaRecorder.isTypeSupported(type))
      const capture = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      )
      recorder.current = capture
      const chunks: Blob[] = []
      let bytes = 0
      capture.ondataavailable = ({ data }) => {
        if (data.size) {
          chunks.push(data)
          bytes += data.size
        }
        if (bytes >= 24 * 1024 * 1024 && capture.state === 'recording')
          capture.stop()
      }
      capture.onerror = () =>
        fail(
          new Error(
            'Die Aufnahme wurde unterbrochen. Bitte versuche es noch einmal oder schreibe deine Nachricht.',
          ),
          turn,
        )
      capture.onstop = async () => {
        if (!isCurrent(turn)) return
        clearCapture()
        setPhase('transcribing')
        try {
          const blob = new Blob(chunks, { type: capture.mimeType })
          if (!blob.size)
            throw new Error('Die Aufnahme ist leer. Bitte sprich noch einmal.')
          const text = await transcribe(blob, turn.id, turn.controller.signal)
          if (isCurrent(turn)) await respond(text, turn)
        } catch (cause) {
          fail(cause, turn)
        }
      }
      capture.start(1_000)
      if (automatic) {
        const detector = new SpeechPauseDetector(stream)
        pauseDetector.current = detector
        await detector.start(() => {
          if (isCurrent(turn) && capture.state === 'recording')
            finishRecording()
        })
        if (!isCurrent(turn)) {
          detector.stop()
          return
        }
      }
      setPhase('recording')
      const startedAt = Date.now()
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1_000)
        setSeconds(elapsed)
        if (elapsed >= 60 && capture.state === 'recording') {
          if (automatic && !pauseDetector.current?.hasSpeech) {
            fail(
              new Error(
                'Ich habe keine Stimme gehört. Starte das Gespräch erneut oder schreibe eine Nachricht.',
              ),
              turn,
            )
          } else capture.stop()
        }
      }, 250)
    } catch (cause) {
      const denied =
        cause instanceof DOMException &&
        (cause.name === 'NotAllowedError' || cause.name === 'SecurityError')
      fail(
        new Error(
          denied
            ? 'Das Mikrofon ist nicht freigegeben. Erlaube den Zugriff im Browser oder schreibe deine Nachricht.'
            : 'Kein Mikrofon verfügbar. Prüfe dein Mikrofon oder schreibe deine Nachricht.',
        ),
        turn,
      )
    }
  }

  function startConversation() {
    continuousRef.current = true
    setContinuous(true)
    return startRecording(true)
  }

  function finishRecording() {
    if (recorder.current?.state === 'recording') {
      setPhase('transcribing')
      clearCapture()
    }
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
    seconds,
    canReplay,
    turns,
    continuous,
    send,
    startRecording,
    startConversation,
    finishRecording,
    replay,
    stop,
    reset,
  }
}
