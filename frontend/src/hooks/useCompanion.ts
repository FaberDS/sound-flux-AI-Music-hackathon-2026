import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createSpeech,
  interruptTurn,
  streamReply,
  transcribe,
  type Message,
} from '../lib/api'

export type Phase =
  'idle' | 'permission' | 'recording' | 'transcribing' | 'thinking' | 'speaking'
interface Turn {
  id: string
  controller: AbortController
}

export function useCompanion(
  profile: string[],
  readAloud: boolean,
  volume: number,
) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [transcript, setTranscript] = useState('')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [canReplay, setCanReplay] = useState(false)
  const [history, setHistory] = useState<Message[]>([])
  const historyRef = useRef<Message[]>([])
  const active = useRef<Turn | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const media = useRef<MediaStream | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const player = useRef<HTMLAudioElement | null>(null)
  const audioUrl = useRef<string | null>(null)
  const playbackGeneration = useRef(0)
  const settings = useRef({ readAloud, volume })

  const clearCapture = useCallback(() => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    if (recorder.current?.state === 'recording') recorder.current.stop()
    recorder.current = null
    media.current?.getTracks().forEach((track) => track.stop())
    media.current = null
  }, [])

  const cancel = useCallback(() => {
    playbackGeneration.current++
    const previous = active.current
    active.current = null
    previous?.controller.abort()
    if (previous) interruptTurn(previous.id)
    clearCapture()
    if (player.current) {
      player.current.onended = null
      player.current.pause()
      player.current.currentTime = 0
    }
  }, [clearCapture])

  const stop = useCallback(() => {
    cancel()
    setPhase('idle')
  }, [cancel])

  useEffect(
    () => () => {
      cancel()
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current)
    },
    [cancel],
  )

  useEffect(() => {
    settings.current = { readAloud, volume }
    if (player.current) player.current.volume = volume
  }, [readAloud, volume])
  useEffect(() => {
    if (!readAloud) {
      player.current?.pause()
    }
  }, [readAloud])

  const isCurrent = (turn: Turn) =>
    active.current === turn && !turn.controller.signal.aborted

  function beginTurn() {
    cancel()
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
    cancel()
    setPhase('idle')
    setError(
      cause instanceof Error &&
        cause.name !== 'TypeError' &&
        cause.name !== 'TimeoutError'
        ? cause.message
        : 'Die Sprachbegleitung antwortet gerade nicht. Du kannst weiter auf den Instrumenten spielen.',
    )
  }

  async function respond(text: string, turn: Turn) {
    if (!isCurrent(turn)) return
    setTranscript(text)
    setPhase('thinking')
    try {
      const response = await streamReply(
        turn.id,
        text,
        historyRef.current,
        profile,
        turn.controller.signal,
        (partial) => {
          if (isCurrent(turn)) setAnswer(partial)
        },
      )
      if (!isCurrent(turn)) return
      historyRef.current = [
        ...historyRef.current,
        { role: 'user', content: text },
        { role: 'assistant', content: response.slice(0, 4_000) },
      ].slice(-12) as Message[]
      setHistory([...historyRef.current])
      if (!settings.current.readAloud) {
        setPhase('idle')
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
          setPhase('idle')
          return
        }
        audioUrl.current = URL.createObjectURL(blob)
        const audio = new Audio(audioUrl.current)
        audio.volume = settings.current.volume
        player.current = audio
        setCanReplay(true)
        audio.onended = () => {
          if (isCurrent(turn)) setPhase('idle')
        }
        audio.onpause = () => {
          if (isCurrent(turn)) setPhase('idle')
        }
        try {
          await audio.play()
          if (isCurrent(turn)) setPhase('speaking')
          else audio.pause()
        } catch {
          if (isCurrent(turn)) setPhase('idle')
        }
      } catch {
        if (isCurrent(turn)) {
          setPhase('idle')
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
    const turn = beginTurn()
    await respond(text.trim().slice(0, 4_000), turn)
  }

  async function startRecording() {
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
      setPhase('recording')
      const startedAt = Date.now()
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1_000)
        setSeconds(elapsed)
        if (elapsed >= 60 && capture.state === 'recording') capture.stop()
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

  function finishRecording() {
    if (recorder.current?.state === 'recording') {
      setPhase('transcribing')
      clearCapture()
    }
  }

  async function replay() {
    if (!player.current) return
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
    stop()
    historyRef.current = []
    setHistory([])
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
    history,
    send,
    startRecording,
    finishRecording,
    replay,
    stop,
    reset,
  }
}
