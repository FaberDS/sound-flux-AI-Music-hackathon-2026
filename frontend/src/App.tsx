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
  MusicRoom,
  type CapturePhase,
  type Instrument,
  type Mood,
} from './lib/music'
import { useCompanion, type Phase } from './hooks/useCompanion'
import SoundFlux from './components/sound-flux/SoundFlux.jsx'
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
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  dismissible?: boolean
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
      className="room-dialog"
    >
      <div className="flex items-start justify-between gap-6">
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
}: {
  src: string
  children?: ReactNode
}) {
  return (
    <div className="amazing-grace-art" aria-label="Amazing Grace artwork">
      <img src={src} alt="Amazing Grace memory" />
      {children}
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
  const [music] = useState(() => new MusicRoom())
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const healthRequest = useRef<AbortController | null>(null)
  const engineStarted = useRef(false)
  const saved = useSavedData()
  const refreshSaved = saved.refresh
  const companion = useCompanion(
    saved.history,
    readAloud,
    volume,
    refreshSaved,
    saved.profile?.onboarding ?? null,
    saved.profile?.properties.find((property) => property.key === 'name')
      ?.value ?? '',
  )
  const busy =
    companion.phase !== 'idle' ||
    companion.continuous ||
    (companion.playMode && (capturePhase !== 'idle' || playing))
  const preparingMusicRoom = companion.playMode && companion.phase === 'speaking'
  const showAmazingGrace = companion.playMode || (!saved.profile?.onboarding && busy)
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

  useEffect(() => {
    void refreshConnection()
    const interval = setInterval(() => void refreshConnection(), 30_000)
    return () => {
      clearInterval(interval)
      healthRequest.current?.abort()
    }
  }, [refreshConnection])
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
      engineStarted.current = false
      music.stop()
      return
    }
    if (companion.phase !== 'idle' || engineStarted.current) return
    engineStarted.current = true
    let active = true
    setMusicError('')
    setCapturePhase('recording')
    void music.captureAndCompose(setCapturePhase).then(
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
    return () => {
      active = false
    }
  }, [companion.phase, companion.playMode, music])

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
  const stopAll = () => {
    music.stop()
    setCapturePhase('idle')
    setPlaying(false)
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
    companion.stop()
    try {
      setPlaying(Boolean(await music.start(mood)))
      setMusicError('')
    } catch {
      setMusicError(
        'The sound could not start. Check your browser’s audio permission.',
      )
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
    if (capturePhase === 'recording') {
      music.finishCapture()
      return
    }
    if (capturePhase === 'composing') return
    if (companion.continuous) {
      void companion.stop()
      return
    }
    if (companion.phase === 'recording') {
      companion.finishRecording()
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
            className={`companion-card ${busy ? 'session-active' : ''}`}
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
            {showAmazingGrace ? (
              <AmazingGraceArtwork src={amazingGraceImage}>
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
              <h2 className={companion.answer ? 'answer-text' : ''}>
                {companion.answer ||
                  (companion.phase === 'idle'
                    ? welcomeText(saved.profile)
                    : phaseText[companion.phase])}
              </h2>
              {!companion.answer && (
                <p>
                  {companion.phase === 'recording'
                    ? 'Take your time. I’ll reply after a short pause.'
                    : companion.phase === 'idle'
                      ? 'Tell me about your favorite music.'
                      : 'You can tap stop at any time.'}
                </p>
              )}
            </div>
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
                {capturePhase === 'recording'
                  ? 'Humming…'
                  : capturePhase === 'composing'
                    ? 'Creating your music…'
                    : preparingMusicRoom
                      ? 'Preparing your music room…'
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
        title="Your moment with music"
      >
        <p className="dialog-intro">
          Make yourself comfortable. You decide what feels good today.
        </p>
        <ol className="help-steps">
          <li>
            <span>1</span>
            <div>
              <h3>Start with a melody</h3>
              <p>
                Choose calm or bright sounds and tap “Start music”.
              </p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <h3>Play along</h3>
              <p>
                Tap an instrument. On a keyboard, keys 1 to 4 work too.
              </p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <h3>Share a little</h3>
              <p>
                Tap the microphone and speak. After a short pause, your answer
                is sent automatically.
              </p>
            </div>
          </li>
        </ol>
        <p className="dialog-intro">
          A short speaking pause is enough for your companion to reply. After
          the reply, Sound Flux listens again until you end the conversation.
        </p>
        <p className="dialog-note">
          “Stop everything” immediately ends music, recording, and speech.
          If the voice companion is offline, instruments and melodies still work.
        </p>
        <button className="dialog-primary" onClick={() => setDialog(null)}>
          Back to music <ArrowRight size={18} />
        </button>
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
