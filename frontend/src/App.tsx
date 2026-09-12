import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ArrowDown,
  ArrowRight,
  AudioLines,
  BellRing,
  Check,
  ChevronRight,
  CircleHelp,
  Drum,
  Guitar,
  Heart,
  Keyboard,
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
import { MusicRoom, type Instrument, type Mood } from './lib/music'
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

const instruments = [
  {
    id: 'piano',
    name: 'Klavier',
    detail: 'Ein paar sanfte Töne',
    icon: Piano,
    className: 'instrument-piano',
  },
  {
    id: 'guitar',
    name: 'Gitarre',
    detail: 'Ein warmer Saitenklang',
    icon: Guitar,
    className: 'instrument-guitar',
  },
  {
    id: 'bells',
    name: 'Glockenspiel',
    detail: 'Ein kleiner Lichtblick',
    icon: BellRing,
    className: 'instrument-bells',
  },
  {
    id: 'drum',
    name: 'Trommel',
    detail: 'Dein eigener Rhythmus',
    icon: Drum,
    className: 'instrument-drum',
  },
] as const

const phaseText: Record<Phase, string> = {
  idle: 'Zeit für deine Musik',
  permission: 'Mikrofon wird geöffnet …',
  recording: 'Ich höre dir zu …',
  transcribing: 'Deine Worte werden erkannt …',
  thinking: 'Deine Antwort entsteht …',
  speaking: 'Sound Flux spricht …',
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
          aria-label="Schließen"
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
          <span>SOUND FLUX</span>
          <AudioLines size={34} strokeWidth={1.6} />
          <span>MUSIC & MEMORIES</span>
          <i />
        </div>
      </div>
      <span className="art-caption">FÜR DIE FREUDE AM MOMENT</span>
    </div>
  )
}

export default function App({ debug = false }: { debug?: boolean }) {
  const [mood, setMood] = useState<Mood>('calm')
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.45)
  const [readAloud, setReadAloud] = useState(true)
  const [dialog, setDialog] = useState<'help' | 'profile' | null>(null)
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
  const [connection, setConnection] = useState<
    'checking' | 'online' | 'offline'
  >('checking')
  const [musicError, setMusicError] = useState('')
  const [seeding, setSeeding] = useState(false)
  const [activeInstrument, setActiveInstrument] = useState<Instrument | null>(
    null,
  )
  const [music] = useState(() => new MusicRoom())
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const healthRequest = useRef<AbortController | null>(null)
  const saved = useSavedData()
  const refreshSaved = saved.refresh
  const companion = useCompanion(
    saved.history,
    readAloud,
    volume,
    refreshSaved,
    saved.profile?.onboarding ?? null,
  )
  const busy = companion.phase !== 'idle' || companion.continuous
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
          'Der Ton konnte nicht starten. Prüfe die Audiofreigabe deines Browsers.',
        )
      }
    },
    [music],
  )
  const stopAll = () => {
    music.stop()
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
        'Der Ton konnte nicht starten. Prüfe die Audiofreigabe deines Browsers.',
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
          'Die Musik konnte nicht starten. Bitte versuche es noch einmal.',
        )
      }
    }
  }
  function onMicrophone() {
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

  if (debug) {
    return (
      <main className="debug-page">
        <header>
          <div><p>Sound Flux</p><h1>Live debug</h1></div>
          <a href="/">Companion öffnen</a>
        </header>
        <section>
          <div className={`debug-status ${connection}`}>
            API: {connection}
          </div>
          <button onClick={() => void refreshConnection()}>Aktualisieren</button>
          <button onClick={() => void preseed()} disabled={seeding}>
            {seeding ? 'Wird gefüllt …' : 'Onboarding mit Beispieldaten füllen'}
          </button>
        </section>
        <section>
          <h2>Live-Sitzung</h2>
          <button onClick={onMicrophone}>
            {companion.continuous ? 'Gespräch beenden' : 'Start listening'}
          </button>
          <p>Status: {companion.phase}</p>
          {companion.transcript && <p>Du: {companion.transcript}</p>}
          {companion.answer && <p>Begleiter: {companion.answer}</p>}
          {companion.error && <p>{companion.error}</p>}
        </section>
        <section>
          <h2>Profil-Schlüssel</h2>
          <table>
            <thead><tr><th>Schlüssel</th><th>Kategorie</th><th>Wert</th></tr></thead>
            <tbody>
              {(saved.profile?.properties ?? []).map((property) => (
                <tr key={property.key}>
                  <td><code>{property.key}</code></td><td>{property.category}</td><td>{property.value}</td>
                </tr>
              ))}
              {!saved.loading && !saved.profile?.properties.length && (
                <tr><td colSpan={3}>Noch keine Profilwerte.</td></tr>
              )}
            </tbody>
          </table>
        </section>
        <section>
          <h2>Chat-Verlauf</h2>
          <table>
            <thead><tr><th>Zeit</th><th>Du</th><th>Modell</th><th>Begleiter</th><th>Dauer</th></tr></thead>
            <tbody>
              {history.map((turn) => (
                <tr key={turn.turn_id}>
                  <td>{historyTime(turn.created_at)}</td><td>{turn.user}</td><td>{turn.model || '–'}</td><td>{turn.assistant}</td><td>{turn.duration_ms} ms</td>
                </tr>
              ))}
              {!saved.loading && !history.length && (
                <tr><td colSpan={5}>Noch keine gespeicherten Gespräche.</td></tr>
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
        Zum Musikraum
      </a>
      <header className="site-header">
        <a
          href="#musikraum"
          aria-label="Sound Flux, zum Musikraum"
          className="brand"
        >
          <span className="brand-icon">
            <AudioLines size={27} strokeWidth={2.4} />
          </span>
          <span>
            sound flux<span className="brand-dot">.</span>
          </span>
        </a>
        <nav className="desktop-nav" aria-label="Hauptnavigation">
          <a href="#musikraum" className="nav-link active" aria-current="page">
            Musikraum
          </a>
          <button className="nav-link" onClick={() => setDialog('help')}>
            So funktioniert's
          </button>
        </nav>
        <button
          className="companion-link"
          aria-label="Für Begleitpersonen"
          onClick={openProfile}
        >
          <Users size={18} />
          <span>Für Begleitpersonen</span>
          <ChevronRight size={16} />
        </button>
      </header>
      <main id="musikraum" className="main-content">
        <section className="hero-grid" aria-labelledby="page-title">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="small-sun" /> MUSIK, DIE VERBINDET
            </div>
            <h1 id="page-title">
              MUSIK BLEIBT.
              <br />
              FREUDE{' '}
              <span className="headline-accent">
                AUCH.
                <svg
                  viewBox="0 0 270 16"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path d="M4 11 Q130 1 265 8" />
                </svg>
              </span>
            </h1>
            <p className="hero-serif">
              Ein vertrauter Klang.
              <br />
              Ein gemeinsamer Moment.
            </p>
            <p className="hero-description">
              Höre zu, sing mit oder spiele einfach los.
              <br className="hidden sm:block" /> Alles in deinem Tempo.
            </p>
            <fieldset className="mood-selection">
              <legend>Wie soll es heute klingen?</legend>
              <div className="flex flex-wrap gap-2.5">
                <button
                  onClick={() => void chooseMood('calm')}
                  aria-pressed={mood === 'calm'}
                  className={`mood-button ${mood === 'calm' ? 'selected' : ''}`}
                >
                  <Heart size={17} />
                  Ruhig & vertraut{mood === 'calm' && <Check size={16} />}
                </button>
                <button
                  onClick={() => void chooseMood('bright')}
                  aria-pressed={mood === 'bright'}
                  className={`mood-button ${mood === 'bright' ? 'selected' : ''}`}
                >
                  <Music2 size={17} />
                  Fröhlich & neu{mood === 'bright' && <Check size={16} />}
                </button>
              </div>
            </fieldset>
            <div className="flex flex-wrap items-center gap-5">
              <button
                className="music-button"
                onClick={() => void toggleMusic()}
              >
                {playing ? (
                  <Pause size={20} fill="currentColor" />
                ) : (
                  <Play size={20} fill="currentColor" />
                )}
                {playing ? 'Musik pausieren' : 'Musik starten'}
              </button>
              <a className="try-instruments" href="#instrumente">
                Oder selbst spielen <ArrowDown size={16} />
              </a>
            </div>
            <p className="music-caption" role="status">
              {playing
                ? 'Deine Melodie spielt. Du kannst jederzeit mitspielen.'
                : 'Eine eigene kleine Melodie, nur für diesen Moment.'}
            </p>
            {musicError && (
              <p className="error-message" role="alert">
                {musicError}
              </p>
            )}
          </div>
          <section
            ref={companionRef}
            className={`companion-card ${busy ? 'session-active' : ''}`}
            aria-label="Sprachbegleitung"
            tabIndex={-1}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="card-eyebrow">DEIN MUSIKBEGLEITER</span>
              <button
                className={`connection-status ${connection}`}
                onClick={() => void refreshConnection()}
                title="Verbindung zur Sprachbegleitung erneut prüfen"
                aria-label={`Sprach-API ${connection === 'online' ? 'erreichbar' : connection === 'offline' ? 'offline' : 'wird geprüft'}. Verbindung erneut prüfen`}
              >
                <span />
                {connection === 'checking'
                  ? 'Verbinde …'
                  : connection === 'online'
                    ? 'API verbunden'
                    : 'Sprache offline'}
              </button>
            </div>
            {companion.phase !== 'idle' ? (
              <div className="record-art">
                <SoundFlux
                  state={
                    companion.phase === 'speaking'
                      ? 'speaking'
                      : companion.phase === 'recording'
                        ? 'listening'
                        : 'thinking'
                  }
                  size={176}
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
                <p className="transcript">Du: {companion.transcript}</p>
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
                    ? 'Sprich in Ruhe. Nach einer kurzen Pause antworte ich.'
                    : companion.phase === 'idle'
                      ? 'Erzähl von deiner Lieblingsmusik.'
                      : 'Du kannst jederzeit auf Stopp tippen.'}
                </p>
              )}
            </div>
            {saved.profile?.onboarding &&
              !onboardingDismissed &&
              !busy &&
              !companion.answer && (
                <div className="onboarding-offer">
                  <p>
                    {onboardingQuestion(saved.profile)} <span>Freiwillig.</span>
                  </p>
                  <div>
                    <button onClick={openProfile}>Angaben ergänzen</button>
                    <button onClick={() => setOnboardingDismissed(true)}>
                      Später
                    </button>
                  </div>
                </div>
              )}
            {companion.error && (
              <p role="alert" className="error-message mt-3">
                {companion.error}
              </p>
            )}
            <div className="voice-controls">
              <button
                className={`microphone-button ${companion.phase === 'recording' ? 'recording' : ''}`}
                onClick={onMicrophone}
                disabled={
                  !companion.continuous &&
                  (companion.phase === 'permission' ||
                    companion.phase === 'transcribing')
                }
              >
                {companion.phase === 'recording' ? (
                  <Square size={17} fill="currentColor" />
                ) : companion.phase === 'permission' ||
                  companion.phase === 'transcribing' ? (
                  <LoaderCircle className="animate-spin" size={21} />
                ) : (
                  <Mic size={21} />
                )}
                {companion.continuous
                  ? 'Gespräch beenden'
                  : companion.phase === 'permission'
                      ? 'Mikrofon öffnen …'
                      : companion.phase === 'transcribing'
                        ? 'Worte erkennen …'
                        : 'Mit Sound Flux sprechen'}
              </button>
            </div>
            {companion.canReplay && (
              <button
                className="replay-button"
                onClick={() => void companion.replay()}
                disabled={companion.phase === 'speaking'}
              >
                <Volume2 size={16} />
                Antwort noch einmal hören
              </button>
            )}
            <p className="companion-footnote">
              <ShieldCheck size={13} />
              Gespräche werden lokal auf diesem Mac gespeichert.
            </p>
          </section>
        </section>
        <section
          id="instrumente"
          className="instruments-section"
          aria-labelledby="instrument-title"
        >
          <div className="section-heading">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 id="instrument-title">EINFACH LOSSPIELEN.</h2>
              <p>Ein Tippen. Dein Klang.</p>
            </div>
            <span className="keyboard-hint">
              <Keyboard size={16} />
              Auch mit den Tasten 1 bis 4
            </span>
          </div>
          <div className="instrument-grid">
            {instruments.map(
              (
                { id, name: instrumentName, detail, icon: Icon, className },
                index,
              ) => (
                <button
                  key={id}
                  onClick={() => void playInstrument(id)}
                  className={`instrument-card ${className} ${activeInstrument === id ? 'is-active' : ''}`}
                  aria-label={`${instrumentName} spielen`}
                >
                  <span className="instrument-icon">
                    <Icon size={31} strokeWidth={1.5} />
                  </span>
                  <span className="instrument-description">
                    <strong>{instrumentName}</strong>
                    <span>{detail}</span>
                  </span>
                  <span className="instrument-key">{index + 1}</span>
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
          <span className="gentle-reminder">
            <Heart size={17} />
            Hier gibt es kein Richtig oder Falsch.
          </span>
          <div className="audio-settings">
            <label className="volume-control">
              {volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
              <span className="sr-only">Lautstärke</span>
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
              Antworten vorlesen
            </button>
            <button className="stop-all" onClick={stopAll}>
              <Square size={12} fill="currentColor" />
              Alles stoppen
            </button>
          </div>
        </div>
      </main>
      <footer className="site-footer">
        <span>Mit Musik füreinander da.</span>
        <span>
          Sound Flux <span className="footer-dot">·</span> Music & memories
        </span>
        <button onClick={() => setDialog('help')}>
          <CircleHelp size={15} />
          Brauchst du Hilfe?
        </button>
      </footer>
      {(playing || busy) && (
        <button
          className="immediate-stop"
          onClick={stopAll}
          aria-label="Sofort alles stoppen"
        >
          <Square size={15} fill="currentColor" />
          Stopp
        </button>
      )}
      <Dialog
        open={dialog === 'help'}
        onClose={() => setDialog(null)}
        title="Dein Moment mit Musik"
      >
        <p className="dialog-intro">
          Mach es dir bequem. Du entscheidest, was sich heute gut anfühlt.
        </p>
        <ol className="help-steps">
          <li>
            <span>1</span>
            <div>
              <h3>Mit einer Melodie beginnen</h3>
              <p>
                Wähle ruhige oder fröhliche Klänge und tippe auf „Musik
                starten“.
              </p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <h3>Selbst mitspielen</h3>
              <p>
                Tippe auf ein Instrument. Auf einer Tastatur funktionieren auch
                die Tasten 1 bis 4.
              </p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <h3>Ein wenig erzählen</h3>
              <p>
                Tippe auf das Mikrofon und sprich. Nach einer kurzen Pause wird
                deine Antwort automatisch gesendet.
              </p>
            </div>
          </li>
        </ol>
        <p className="dialog-intro">
          Eine kurze Sprechpause genügt, damit die Begleitung antwortet.
          Nach der Antwort hört Sound Flux wieder zu, bis du das Gespräch
          beendest.
        </p>
        <p className="dialog-note">
          Mit „Alles stoppen“ enden Musik, Aufnahme und Sprachausgabe sofort.
          Wenn die Sprachbegleitung offline ist, funktionieren die Instrumente
          und Melodien weiterhin.
        </p>
        <button className="dialog-primary" onClick={() => setDialog(null)}>
          Zurück zur Musik <ArrowRight size={18} />
        </button>
      </Dialog>
      <Dialog
        open={dialog === 'profile'}
        onClose={() => setDialog(null)}
        title="Gemeinsam Musik erleben"
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
