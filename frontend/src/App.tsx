import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ArrowRight,
  AudioLines,
  BellRing,
  Check,
  ChevronRight,
  Drum,
  Guitar,
  Heart,
  LoaderCircle,
  Mic,
  Music2,
  Pause,
  Piano,
  Play,
  ShieldCheck,
  Square,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { checkConnection, preseedOnboarding } from './lib/api'
import {
  getCompositions,
  MusicRoom,
  saveCompositionBeat,
  type CapturePhase,
  type Instrument,
  type Mood,
  type SavedComposition,
} from './lib/music'
import { useCompanion, type Phase } from './hooks/useCompanion'
import SoundFlux from './components/sound-flux/SoundFlux.jsx'
import { MouthBeatbox } from './components/MouthBeatbox'
import { ProfilePanel } from './components/ProfilePanel'
import { SavedHistory } from './components/SavedHistory'
import { useSavedData } from './hooks/useSavedData'
import {
  historyTime,
  mergeTurns,
  onboardingQuestion,
  welcomeText,
} from './lib/savedData'
import amazingGraceChurch from '../assets/amazing_grace/church.webp'
import amazingGraceSundown from '../assets/amazing_grace/sundown.webp'
import amazingGraceWedding from '../assets/amazing_grace/wedding.webp'

const instruments = [
  {
    id: 'piano',
    name: 'Piano',
    icon: Piano,
    className: 'instrument-piano',
  },
  {
    id: 'guitar',
    name: 'Guitar',
    icon: Guitar,
    className: 'instrument-guitar',
  },
  {
    id: 'bells',
    name: 'Glockenspiel',
    icon: BellRing,
    className: 'instrument-bells',
  },
  {
    id: 'drum',
    name: 'Drum',
    icon: Drum,
    className: 'instrument-drum',
  },
] as const

const phaseText: Record<Phase, string> = {
  idle: 'Time for your music',
  permission: 'Opening the microphone …',
  recording: 'I’m listening …',
  transcribing: 'Understanding your words …',
  thinking: 'Creating your answer …',
  speaking: 'Sound Flux is speaking …',
}

const amazingGraceImages = [
  amazingGraceChurch,
  amazingGraceSundown,
  amazingGraceWedding,
]

function compositionArtwork(identifier: string) {
  const seed = Number(identifier.split('-').at(-1))
  return amazingGraceImages[
    Number.isSafeInteger(seed) ? seed % amazingGraceImages.length : 0
  ]
}

const debugPhaseText: Record<Phase, string> = {
  idle: 'Ready',
  permission: 'Opening microphone…',
  recording: 'Listening…',
  transcribing: 'Understanding your words…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
}

function Dialog({
  open,
  onClose,
  title,
  children,
  dismissible = true,
  fullPage = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  dismissible?: boolean
  fullPage?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal()
    else if (!open && ref.current?.open) ref.current.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault()
        if (dismissible) onClose()
      }}
      onClick={(event) => {
        if (dismissible && event.target === ref.current) onClose()
      }}
      aria-label={title}
      className={`room-dialog ${fullPage ? 'journey-dialog' : ''}`}
    >
      <div className="dialog-header flex items-start justify-between gap-6">
        <h2 className="font-display text-4xl font-bold uppercase">{title}</h2>
        <button
          onClick={onClose}
          className="icon-button shrink-0"
          aria-label="Close"
          disabled={!dismissible}
        >
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  )
}

function RecordArtwork({ active }: { active: boolean }) {
  return (
    <div
      className={`record-art ${active ? 'is-playing' : ''}`}
      aria-hidden="true"
    >
      <div className="record-sun" />
      <svg className="staff-lines" viewBox="0 0 440 200" fill="none">
        {[0, 12, 24, 36, 48].map((offset) => (
          <path
            key={offset}
            d={`M-20 ${96 + offset} C110 ${-20 + offset} 290 ${225 + offset} 470 ${72 + offset}`}
          />
        ))}
      </svg>
      <Music2 className="floating-note note-one" size={30} strokeWidth={1.7} />
      <Music2 className="floating-note note-two" size={23} strokeWidth={1.7} />
      <div className="vinyl">
        <div className="record-label">
          <AudioLines size={34} strokeWidth={1.6} />
          <i />
        </div>
      </div>
    </div>
  )
}

function AmazingGraceArtwork({
  src,
  children,
  alt = 'Music artwork',
}: {
  src: string
  children?: ReactNode
  alt?: string
}) {
  return (
    <div className="amazing-grace-art" aria-label={alt}>
      <img src={src} alt={alt} />
      {children}
    </div>
  )
}

function CompositionTimeline({ composition }: { composition?: SavedComposition }) {
  if (!composition?.duration) return null
  const time = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
  return (
    <div
      className="composition-timeline"
      role="img"
      aria-label={`Composition timeline with ${composition.beats.length} mouth ${composition.beats.length === 1 ? 'beat' : 'beats'}`}
    >
      <span>0:00</span>
      <div className="timeline-track" aria-hidden="true">
        {composition.beats.map((beat, index) => (
          <span
            key={`${beat}-${index}`}
            className="timeline-beat"
            style={{ left: `${Math.max(2, Math.min(98, beat / composition.duration * 100))}%` }}
            title={`Mouth beat at ${time(beat)}`}
          >
            <Drum size={18} />
          </span>
        ))}
      </div>
      <span>{time(composition.duration)}</span>
    </div>
  )
}

export default function App({ debug = false }: { debug?: boolean }) {
  const [mood, setMood] = useState<Mood>('calm')
  const [playing, setPlaying] = useState(false)
  const [capturePhase, setCapturePhase] = useState<CapturePhase>('idle')
  const [volume, setVolume] = useState(0.45)
  const [readAloud, setReadAloud] = useState(true)
  const [dialog, setDialog] = useState<'help' | 'profile' | null>(null)
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
  const [connection, setConnection] = useState<
    'checking' | 'online' | 'offline'
  >('checking')
  const [musicError, setMusicError] = useState('')
  const [seeding, setSeeding] = useState(false)
  const [amazingGraceImage] = useState(
    () => amazingGraceImages[Math.floor(Math.random() * amazingGraceImages.length)],
  )
  const [activeInstrument, setActiveInstrument] = useState<Instrument | null>(
    null,
  )
  const [compositions, setCompositions] = useState<SavedComposition[]>([])
  const [activeCompositionId, setActiveCompositionId] = useState<string | null>(
    null,
  )
  const [musicRequest, setMusicRequest] = useState(0)
  const [styleReady, setStyleReady] = useState(false)
  const [music] = useState(() => new MusicRoom())
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const healthRequest = useRef<AbortController | null>(null)
  const compositionsRequest = useRef<AbortController | null>(null)
  const handledMusicRequest = useRef(0)
  const saved = useSavedData()
  const refreshSaved = saved.refresh
  const requestMusic = useCallback(() => setMusicRequest((value) => value + 1), [])
  const beginMusicPreparation = useCallback(() => setStyleReady(false), [])
  const companion = useCompanion(
    saved.history,
    readAloud,
    volume,
    refreshSaved,
    saved.profile?.onboarding ?? null,
    saved.profile?.properties.find((property) => property.key === 'name')
      ?.value ?? '',
    requestMusic,
    beginMusicPreparation,
  )
  const compositionMode = activeCompositionId !== null
  const activeComposition = compositions.find(
    (composition) => composition.id === activeCompositionId,
  )
  const preparingMusicStyle = companion.playMode && !styleReady
  const busy =
    companion.phase !== 'idle' ||
    companion.continuous ||
    compositionMode ||
    companion.playMode
  const preparingMusicRoom = companion.playMode && companion.phase === 'speaking'
  const showAmazingGrace =
    compositionMode || companion.playMode || (!saved.profile?.onboarding && busy)
  const history = mergeTurns(saved.history, companion.turns)
  const companionRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (busy) companionRef.current?.focus()
  }, [busy])

  const refreshConnection = useCallback(() => {
    healthRequest.current?.abort()
    const controller = new AbortController()
    healthRequest.current = controller
    return checkConnection(controller.signal).then(
      () => {
        if (!controller.signal.aborted) {
          setConnection('online')
          void refreshSaved()
        }
      },
      () => {
        if (!controller.signal.aborted) setConnection('offline')
      },
    )
  }, [refreshSaved])

  const refreshCompositions = useCallback(() => {
    compositionsRequest.current?.abort()
    const controller = new AbortController()
    compositionsRequest.current = controller
    return getCompositions(controller.signal).then(
      (items) => {
        if (!controller.signal.aborted) setCompositions(items)
      },
      () => {},
    )
  }, [])

  useEffect(() => {
    void refreshConnection()
    const interval = setInterval(() => void refreshConnection(), 30_000)
    return () => {
      clearInterval(interval)
      healthRequest.current?.abort()
    }
  }, [refreshConnection])
  useEffect(() => {
    void refreshCompositions()
    return () => compositionsRequest.current?.abort()
  }, [refreshCompositions])
  useEffect(() => {
    music.setVolume(volume)
  }, [music, volume])
  useEffect(
    () => () => {
      music.dispose()
      if (flashTimer.current) clearTimeout(flashTimer.current)
    },
    [music],
  )
  useEffect(() => {
    if (!companion.playMode) {
      music.stop()
      return
    }
    if (musicRequest === handledMusicRequest.current) return
    handledMusicRequest.current = musicRequest
    let active = true
    setMusicError('')
    const timer = setTimeout(() => {
      setStyleReady(true)
      setCapturePhase('recording')
      void music.captureAndCompose(setCapturePhase, (identifier) => {
        setActiveCompositionId(identifier)
        void refreshCompositions()
      }).then(
        (isPlaying) => {
          if (active) {
            setCapturePhase('idle')
            setPlaying(isPlaying)
          }
        },
        (error: unknown) => {
          if (active) {
            setCapturePhase('idle')
            setMusicError(
              error instanceof Error
                ? error.message
                : 'The audio engine could not create music.',
            )
          }
        },
      )
    }, 4_000)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [companion.playMode, music, musicRequest, refreshCompositions])

  const playInstrument = useCallback(
    async (instrument: Instrument) => {
      try {
        await music.play(instrument)
        setMusicError('')
        setActiveInstrument(instrument)
        if (flashTimer.current) clearTimeout(flashTimer.current)
        flashTimer.current = setTimeout(() => setActiveInstrument(null), 220)
      } catch {
        setMusicError(
          'The sound could not start. Check your browser’s audio permission.',
        )
      }
    },
    [music],
  )
  const beat = useCallback(() => {
    const at = music.beat()
    if (at === null || !activeCompositionId) return
    void saveCompositionBeat(activeCompositionId, at).then(
      ({ beats, duration }) => {
        setCompositions((items) =>
          items.map((item) =>
            item.id === activeCompositionId ? { ...item, beats, duration } : item,
          ),
        )
        setMusicError('')
      },
      () => setMusicError('The beat played, but could not be saved.'),
    )
  }, [activeCompositionId, music])
  const stopAll = () => {
    music.stop()
    setCapturePhase('idle')
    setPlaying(false)
    setActiveCompositionId(null)
    companion.stop()
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        dialog ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return
      if (
        event.target instanceof HTMLElement &&
        (event.target.closest('input, textarea, select, button, summary') ||
          event.target.isContentEditable)
      )
        return
      const index = Number(event.key) - 1
      if (index >= 0 && index < instruments.length && Number.isInteger(index)) {
        event.preventDefault()
        void playInstrument(instruments[index].id)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dialog, playInstrument])

  async function toggleMusic() {
    if (playing) {
      music.stop()
      setPlaying(false)
      return
    }
    try {
      const composition = compositions.find(
        (item) => item.id === activeCompositionId,
      )
      if (!composition) companion.stop()
      setPlaying(
        Boolean(
          composition
            ? await music.playComposition(composition.url)
            : await music.start(mood),
        ),
      )
      setMusicError('')
    } catch {
      setMusicError(
        'The sound could not start. Check your browser’s audio permission.',
      )
    }
  }
  async function playSavedComposition(composition: SavedComposition) {
    music.stop()
    setPlaying(false)
    void companion.stop()
    setActiveCompositionId(composition.id)
    try {
      setPlaying(Boolean(await music.playComposition(composition.url)))
      setMusicError('')
    } catch {
      setActiveCompositionId(null)
      setMusicError('The saved composition could not be played.')
    }
  }
  async function chooseMood(next: Mood) {
    setMood(next)
    if (playing) {
      try {
        setPlaying(Boolean(await music.start(next)))
      } catch {
        setPlaying(false)
        setMusicError(
          'The music could not start. Please try again.',
        )
      }
    }
  }
  function onMicrophone() {
    if (preparingMusicStyle) return
    if (capturePhase === 'recording') {
      music.finishCapture()
      return
    }
    if (capturePhase === 'composing') return
    if (companion.phase === 'recording') {
      companion.finishRecording()
      return
    }
    if (companion.continuous) {
      void companion.stop()
      return
    }
    music.stop()
    setPlaying(false)
    void companion.startConversation()
  }
  function resetSession() {
    stopAll()
    companion.reset()
    setDialog(null)
  }

  function openProfile() {
    stopAll()
    setDialog('profile')
    void saved.refresh()
  }

  function afterDataDeleted() {
    companion.reset()
    setOnboardingDismissed(false)
  }

  async function preseed() {
    setSeeding(true)
    try {
      await preseedOnboarding(new AbortController().signal)
      setConnection('online')
      await saved.refresh()
    } catch {
      setConnection('offline')
    } finally {
      setSeeding(false)
    }
  }

  async function clearDebugData() {
    if (!window.confirm('Delete all saved profile and chat data?')) return
    try {
      await saved.erase('all', companion.stop)
      window.location.reload()
    } catch {
      setConnection('offline')
    }
  }

  if (debug) {
    return (
      <main className="debug-page">
        <header>
          <div><p>Sound Flux</p><h1>Live companion</h1></div>
          <a href="/">Open companion</a>
        </header>
        <section>
          <div className={`debug-status ${connection}`}>
            Voice service: {connection === 'online' ? 'ready' : connection === 'offline' ? 'offline' : 'checking'}
          </div>
          <button onClick={() => void refreshConnection()}>Check connection</button>
          <button onClick={() => void preseed()} disabled={seeding}>
            {seeding ? 'Adding sample data…' : 'Add sample profile'}
          </button>
          <button onClick={() => void clearDebugData()} disabled={saved.busy}>
            Clear all data
          </button>
        </section>
        <section>
          <h2>Conversation</h2>
          {showAmazingGrace && <AmazingGraceArtwork src={amazingGraceImage} />}
          <button onClick={onMicrophone}>
            {companion.continuous ? 'End conversation' : 'Start listening'}
          </button>
          <p>Status: {debugPhaseText[companion.phase]}</p>
          {companion.transcript && <p>You: {companion.transcript}</p>}
          {companion.answer && <p>Companion: {companion.answer}</p>}
          {companion.error && <p>{companion.error}</p>}
        </section>
        <section>
          <h2>Your profile</h2>
          <table>
            <thead><tr><th>Property</th><th>Value</th></tr></thead>
            <tbody>
              {(saved.profile?.properties ?? []).map((property) => (
                <tr key={property.key}>
                  <td>{property.label}</td><td>{property.value}</td>
                </tr>
              ))}
              {!saved.loading && !saved.profile?.properties.length && (
                <tr><td colSpan={2}>No profile details saved yet.</td></tr>
              )}
            </tbody>
          </table>
        </section>
        <section>
          <h2>Conversation history</h2>
          <table>
            <thead><tr><th>Time</th><th>You</th><th>Companion</th></tr></thead>
            <tbody>
              {history.map((turn) => (
                <tr key={turn.turn_id}>
                  <td>{historyTime(turn.created_at)}</td><td>{turn.user}</td><td>{turn.assistant}</td>
                </tr>
              ))}
              {!saved.loading && !history.length && (
                <tr><td colSpan={3}>No saved conversations yet.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#musikraum">
        Skip to music room
      </a>
      <header className="site-header">
        <a
          href="#musikraum"
          aria-label="Sound Flux, music room"
          className="brand"
        >
          <span className="brand-icon">
            <AudioLines size={27} strokeWidth={2.4} />
          </span>
          <span>
            sound flux<span className="brand-dot">.</span>
          </span>
        </a>
        <nav className="desktop-nav" aria-label="Main navigation">
          <button className="nav-link" onClick={() => setDialog('help')}>
            How it works
          </button>
        </nav>
        <button
          className="companion-link"
          aria-label="For companions"
          onClick={openProfile}
        >
          <Users size={18} />
          <span>For companions</span>
          <ChevronRight size={16} />
        </button>
      </header>
      <main id="musikraum" className="main-content">
        <section className="hero-grid" aria-labelledby="page-title">
          <div className="hero-copy">
            <h1 id="page-title">MAKE MUSIC.</h1>
            <p className="hero-description">
              Choose a sound or talk with Sound Flux.
            </p>
            <fieldset className="mood-selection">
              <legend>Choose a sound</legend>
              <div className="flex flex-wrap gap-2.5">
                <button
                  onClick={() => void chooseMood('calm')}
                  aria-pressed={mood === 'calm'}
                  className={`mood-button ${mood === 'calm' ? 'selected' : ''}`}
                >
                  <Heart size={17} />
                  Calm{mood === 'calm' && <Check size={18} />}
                </button>
                <button
                  onClick={() => void chooseMood('bright')}
                  aria-pressed={mood === 'bright'}
                  className={`mood-button ${mood === 'bright' ? 'selected' : ''}`}
                >
                  <Music2 size={17} />
                  Bright{mood === 'bright' && <Check size={18} />}
                </button>
              </div>
            </fieldset>
            <button
              className="music-button"
              onClick={() => void toggleMusic()}
            >
              {playing ? (
                <Pause size={24} fill="currentColor" />
              ) : (
                <Play size={24} fill="currentColor" />
              )}
              {playing ? 'Pause music' : 'Start music'}
            </button>
            {musicError && (
              <p className="error-message" role="alert">
                {musicError}
              </p>
            )}
          </div>
          <section
            ref={companionRef}
            className={`companion-card ${busy ? 'session-active' : ''} ${compositionMode ? 'composition-mode' : ''}`}
            aria-label="Voice companion"
            tabIndex={-1}
          >
            <div className="flex items-center gap-3">
              <button
                className={`connection-status ${connection}`}
                onClick={() => void refreshConnection()}
                title="Check the voice companion connection again"
                aria-label={`Voice API ${connection === 'online' ? 'available' : connection === 'offline' ? 'offline' : 'being checked'}. Check the connection again`}
              >
                <span />
                {connection === 'checking'
                  ? 'Connecting …'
                  : connection === 'online'
                    ? 'Voice ready'
                    : 'Voice unavailable'}
              </button>
            </div>
            {preparingMusicStyle ? (
              <div className="record-art music-preparation" role="status">
                <SoundFlux state="thinking" size={180} showBrand={false} showStatus={false} />
                <p>Preparing your style of music</p>
              </div>
            ) : showAmazingGrace ? (
              <AmazingGraceArtwork
                src={
                  compositionMode
                    ? compositionArtwork(activeCompositionId ?? '')
                    : amazingGraceImage
                }
                alt={compositionMode ? 'Artwork for your saved composition' : 'Music artwork'}
              >
                {capturePhase === 'composing' && (
                  <div className="composer-overlay" role="status">
                    <SoundFlux
                      className="composer-logo"
                      state="thinking"
                      size={180}
                      showBrand={false}
                      showStatus={false}
                    />
                    <span>Creating your music…</span>
                  </div>
                )}
              </AmazingGraceArtwork>
            ) : companion.phase !== 'idle' ? (
              <div className="record-art">
                <SoundFlux
                  state={
                    companion.phase === 'speaking'
                      ? 'speaking'
                      : companion.phase === 'recording'
                        ? 'listening'
                        : 'thinking'
                  }
                  size={440}
                  showStatus={false}
                />
              </div>
            ) : (
              <RecordArtwork active={playing} />
            )}
            <div
              className="companion-message"
              aria-live="polite"
              aria-atomic="true"
              aria-busy={companion.phase === 'thinking'}
            >
              {companion.transcript && (
                <p className="transcript">You: {companion.transcript}</p>
              )}
              <h2 className={companion.answer && !compositionMode ? 'answer-text' : ''}>
                {compositionMode
                  ? 'Your composition is playing'
                  : companion.answer ||
                    (companion.phase === 'idle'
                      ? welcomeText(saved.profile)
                      : phaseText[companion.phase])}
              </h2>
              {!compositionMode && !companion.answer && (
                <p>
                  {companion.phase === 'recording'
                    ? 'Take your time. I’ll reply after a short pause.'
                    : companion.phase === 'idle'
                      ? 'Tell me about your favorite music.'
                      : 'You can tap stop at any time.'}
                </p>
              )}
            </div>
            {compositionMode && (
              <>
                <div className="composition-controls">
                  <button className="music-button" onClick={() => void toggleMusic()}>
                    {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
                    {playing ? 'Pause music' : 'Play music'}
                  </button>
                  <button onClick={stopAll}>Back to your songs</button>
                </div>
                <CompositionTimeline composition={activeComposition} />
                <MouthBeatbox active={playing} onBeat={beat} />
              </>
            )}
            {companion.error && (
              <p role="alert" className="error-message mt-3">
                {companion.error}
              </p>
            )}
            <div className="voice-controls">
              <button
                className={`microphone-button ${capturePhase === 'recording' || companion.phase === 'recording' ? 'recording' : ''}`}
                onClick={onMicrophone}
                disabled={
                  preparingMusicStyle ||
                  capturePhase === 'composing' ||
                  preparingMusicRoom ||
                  !companion.continuous &&
                  (companion.phase === 'permission' ||
                    companion.phase === 'transcribing')
                }
              >
                {capturePhase === 'recording' || companion.phase === 'recording' ? (
                  <Square size={17} fill="currentColor" />
                ) : capturePhase === 'composing' || preparingMusicRoom ? (
                  <LoaderCircle className="animate-spin" size={21} />
                ) : companion.phase === 'permission' ||
                  companion.phase === 'transcribing' ? (
                  <LoaderCircle className="animate-spin" size={21} />
                ) : (
                  <Mic size={21} />
                )}
                {preparingMusicStyle
                  ? 'Preparing your music…'
                  : capturePhase === 'recording'
                  ? 'Humming…'
                  : capturePhase === 'composing'
                    ? 'Creating your music…'
                    : preparingMusicRoom
                      ? 'Preparing your music room…'
                  : companion.phase === 'recording'
                    ? 'Finish speaking'
                    : companion.continuous
                      ? 'End conversation'
                      : companion.phase === 'permission'
                      ? 'Opening microphone …'
                      : companion.phase === 'transcribing'
                        ? 'Understanding words …'
                        : 'Talk with Sound Flux'}
              </button>
            </div>
            {companion.canReplay && (
              <button
                className="replay-button"
                onClick={() => void companion.replay()}
                disabled={companion.phase === 'speaking'}
              >
                <Volume2 size={16} />
                Hear the answer again
              </button>
            )}
            <p className="companion-footnote">
              <ShieldCheck size={13} />
              Saved on this Mac.
            </p>
            {saved.profile?.onboarding &&
              !onboardingDismissed &&
              !busy &&
              !companion.answer && (
                <div className="onboarding-offer">
                  <p>
                    {onboardingQuestion(saved.profile)} <span>Optional.</span>
                  </p>
                  <div>
                    <button onClick={openProfile}>Add details</button>
                    <button onClick={() => setOnboardingDismissed(true)}>
                      Later
                    </button>
                  </div>
                </div>
              )}
          </section>
        </section>
        <section
          id="instrumente"
          className="instruments-section"
          aria-labelledby="instrument-title"
        >
          <div className="section-heading">
            <h2 id="instrument-title">PLAY AN INSTRUMENT</h2>
          </div>
          <div className="instrument-grid">
            {instruments.map(
              (
                { id, name: instrumentName, icon: Icon, className },
              ) => (
                <button
                  key={id}
                  onClick={() => void playInstrument(id)}
                  className={`instrument-card ${className} ${activeInstrument === id ? 'is-active' : ''}`}
                  aria-label={`Play ${instrumentName}`}
                >
                  <span className="instrument-icon">
                    <Icon size={31} strokeWidth={1.5} />
                  </span>
                  <span className="instrument-description">
                    <strong>{instrumentName}</strong>
                  </span>
                  <ArrowRight className="instrument-arrow" size={17} />
                </button>
              ),
            )}
          </div>
        </section>
        {compositions.length > 0 && (
          <section className="compositions-section" aria-labelledby="compositions-title">
            <div className="section-heading">
              <h2 id="compositions-title">YOUR COMPOSITIONS</h2>
              <p>Tap a song to play it with its artwork.</p>
            </div>
            <div className="composition-grid">
              {compositions.map((composition) => (
                <button
                  key={composition.id}
                  className="composition-card"
                  onClick={() => void playSavedComposition(composition)}
                  aria-label={`Play composition from ${historyTime(composition.created_at)}`}
                >
                  <img src={compositionArtwork(composition.id)} alt="" />
                  <span>
                    <strong>Your composition</strong>
                    <time dateTime={composition.created_at}>
                      {historyTime(composition.created_at)}
                    </time>
                  </span>
                  <Play size={19} fill="currentColor" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        )}
        <SavedHistory
          turns={history}
          loading={saved.loading}
          error={saved.errors.history}
          onRefresh={() => void saved.refresh()}
          onManage={openProfile}
        />
        <div className="session-toolbar">
          <div className="audio-settings">
            <label className="volume-control">
              {volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
              <span>Volume</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
              />
            </label>
            <button
              className="read-aloud"
              onClick={() => setReadAloud(!readAloud)}
              aria-pressed={readAloud}
            >
              <span className={`toggle-track ${readAloud ? 'on' : ''}`}>
                <span />
              </span>
              Read answers aloud
            </button>
            <button className="stop-all" onClick={stopAll}>
              <Square size={12} fill="currentColor" />
              Stop everything
            </button>
          </div>
        </div>
      </main>
      {(playing || busy) && (
        <button
          className="immediate-stop"
          onClick={stopAll}
          aria-label="Stop everything immediately"
        >
          <Square size={15} fill="currentColor" />
          Stop
        </button>
      )}
      <Dialog
        open={dialog === 'help'}
        onClose={() => setDialog(null)}
        title="How it works"
        fullPage
      >
        <div className="journey-intro">
          <p>Your musical journey</p>
          <h3>From your story to your sound.</h3>
          <span>
            Sound Flux listens first, then turns the moments that matter to you
            into music you can shape together.
          </span>
        </div>
        <ol className="journey-steps">
          <li>
            <div className="journey-art journey-profile" aria-hidden="true">
              <span className="profile-person"><Users size={42} /></span>
              <span className="preference preference-one">
                <Heart size={17} /> Favorite songs
              </span>
              <span className="preference preference-two">
                <Music2 size={17} /> Your style
              </span>
            </div>
            <div className="journey-copy">
              <span>01 · Listen</span>
              <h4>We get to know you</h4>
              <p>
                A gentle conversation helps us understand your favorite music,
                moods, and what feels comfortable today.
              </p>
            </div>
          </li>
          <li>
            <div className="journey-art journey-memories" aria-hidden="true">
              <span className="memory-card memory-one"><Heart size={27} /></span>
              <AudioLines className="memory-wave" size={42} />
              <span className="memory-card memory-two"><Music2 size={27} /></span>
            </div>
            <div className="journey-copy">
              <span>02 · Remember</span>
              <h4>We revisit meaningful moments</h4>
              <p>
                Together, we remember people, places, and experiences that bring
                warmth, joy, or calm.
              </p>
            </div>
          </li>
          <li>
            <div className="journey-art journey-create" aria-hidden="true">
              <span className="journey-record"><AudioLines size={34} /></span>
              <span className="sound-chip sound-piano"><Piano size={21} /></span>
              <span className="sound-chip sound-guitar"><Guitar size={21} /></span>
              <span className="sound-chip sound-drum"><Drum size={21} /></span>
            </div>
            <div className="journey-copy">
              <span>03 · Create</span>
              <h4>We make music together</h4>
              <p>
                Your stories guide a personal sound. Listen, hum, or add an
                instrument—there is no wrong way to join in.
              </p>
            </div>
          </li>
        </ol>
        <div className="journey-finish">
          <p><ShieldCheck size={16} /> Private, unhurried, and always at your pace.</p>
          <button className="dialog-primary" onClick={() => {
            setDialog(null)
            onMicrophone()
          }}>
            Start your musical journey <ArrowRight size={18} />
          </button>
        </div>
      </Dialog>
      <Dialog
        open={dialog === 'profile'}
        onClose={() => setDialog(null)}
        title="Experience music together"
        dismissible={!saved.busy}
      >
        {dialog === 'profile' && (
          <ProfilePanel
            key={saved.profile ? 'loaded' : 'loading'}
            saved={saved}
            beforeDelete={() => {
              music.stop()
              setPlaying(false)
              return companion.stop()
            }}
            onDeleted={afterDataDeleted}
            onEndSession={resetSession}
          />
        )}
      </Dialog>
    </div>
  )
}
