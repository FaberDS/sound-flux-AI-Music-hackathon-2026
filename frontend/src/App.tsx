import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
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
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { checkConnection } from './lib/api'
import { MusicRoom, type Instrument, type Mood } from './lib/music'
import { useCompanion, type Phase } from './hooks/useCompanion'
import SoundFlux from './components/sound-flux/SoundFlux.jsx'

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
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
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
      onClick={(event) => {
        if (event.target === ref.current) onClose()
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

export default function App() {
  const [mood, setMood] = useState<Mood>('calm')
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.45)
  const [readAloud, setReadAloud] = useState(true)
  const [dialog, setDialog] = useState<'help' | 'profile' | null>(null)
  const [name, setName] = useState('')
  const [preferences, setPreferences] = useState('')
  const [profile, setProfile] = useState<string[]>([])
  const [profileSaved, setProfileSaved] = useState(false)
  const [connection, setConnection] = useState<
    'checking' | 'online' | 'offline'
  >('checking')
  const [message, setMessage] = useState('')
  const [musicError, setMusicError] = useState('')
  const [activeInstrument, setActiveInstrument] = useState<Instrument | null>(
    null,
  )
  const [music] = useState(() => new MusicRoom())
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const healthRequest = useRef<AbortController | null>(null)
  const companion = useCompanion(profile, readAloud, volume)
  const busy = companion.phase !== 'idle'

  const refreshConnection = useCallback(() => {
    healthRequest.current?.abort()
    const controller = new AbortController()
    healthRequest.current = controller
    return checkConnection(controller.signal).then(
      () => {
        if (!controller.signal.aborted) setConnection('online')
      },
      () => {
        if (!controller.signal.aborted) setConnection('offline')
      },
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
    if (companion.phase === 'recording') {
      companion.finishRecording()
      return
    }
    music.stop()
    setPlaying(false)
    void companion.startRecording()
  }
  function sendMessage(event: FormEvent) {
    event.preventDefault()
    if (!message.trim()) return
    music.stop()
    setPlaying(false)
    void companion.send(message)
    setMessage('')
  }
  function saveProfile(event: FormEvent) {
    event.preventDefault()
    setProfile([
      ...(name.trim() ? [`Preferred name: ${name.trim()}`] : []),
      ...(preferences.trim()
        ? [`Music preferences: ${preferences.trim()}`]
        : []),
    ])
    setProfileSaved(Boolean(name.trim() || preferences.trim()))
    setDialog(null)
  }
  function resetSession() {
    stopAll()
    companion.reset()
    setProfile([])
    setName('')
    setPreferences('')
    setProfileSaved(false)
    setMessage('')
    setDialog(null)
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
          onClick={() => setDialog('profile')}
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
          <section className="companion-card" aria-label="Sprachbegleitung">
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
            {companion.phase === 'speaking' ? (
              <div className="record-art">
                <SoundFlux
                  state="speaking"
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
                    ? 'Was klingt für dich nach Freude?'
                    : phaseText[companion.phase])}
              </h2>
              {!companion.answer && (
                <p>
                  {companion.phase === 'recording'
                    ? 'Sprich in Ruhe. Tippe danach auf „Aufnahme senden“.'
                    : companion.phase === 'idle'
                      ? 'Erzähl von deiner Lieblingsmusik.'
                      : 'Du kannst jederzeit auf Stopp tippen.'}
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
                className={`microphone-button ${companion.phase === 'recording' ? 'recording' : ''}`}
                onClick={onMicrophone}
                disabled={
                  companion.phase === 'permission' ||
                  companion.phase === 'transcribing'
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
                {companion.phase === 'recording'
                  ? `Aufnahme senden · ${Math.floor(companion.seconds / 60)}:${String(companion.seconds % 60).padStart(2, '0')}`
                  : companion.phase === 'permission'
                    ? 'Mikrofon öffnen …'
                    : companion.phase === 'transcribing'
                      ? 'Worte erkennen …'
                      : 'Mit Sound Flux sprechen'}
              </button>
              {busy && (
                <button
                  className="voice-stop"
                  onClick={companion.stop}
                  aria-label="Sprachbegleitung stoppen"
                >
                  <Square size={17} fill="currentColor" />
                </button>
              )}
            </div>
            <form className="message-form" onSubmit={sendMessage}>
              <Keyboard size={20} aria-hidden="true" />
              <label className="sr-only" htmlFor="message">
                Nachricht an Sound Flux
              </label>
              <input
                id="message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={4_000}
                placeholder="Oder schreibe eine Nachricht …"
                autoComplete="off"
              />
              <button
                type="submit"
                aria-label="Nachricht senden"
                disabled={!message.trim()}
              >
                <Send size={19} />
              </button>
            </form>
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
              Dein Gespräch bleibt in dieser Sitzung.
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
        {companion.history.length > 0 && (
          <details className="conversation-history">
            <summary>
              Unser Gespräch{' '}
              <span>
                {companion.history.length / 2}{' '}
                {companion.history.length === 2 ? 'Nachricht' : 'Nachrichten'}
              </span>
            </summary>
            <div className="history-content">
              {companion.history.map((item, index) => (
                <p key={index}>
                  <strong>{item.role === 'user' ? 'Du' : 'Sound Flux'}</strong>
                  {item.content}
                </p>
              ))}
            </div>
          </details>
        )}
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
                Tippe auf das Mikrofon, sprich und wähle „Aufnahme senden“. Du
                kannst auch eine Nachricht schreiben.
              </p>
            </div>
          </li>
        </ol>
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
      >
        <p className="dialog-intro">
          Ein paar freiwillige Angaben helfen Sound Flux, auf die Person
          einzugehen, die du begleitest.
        </p>
        <form onSubmit={saveProfile} className="profile-form">
          <label>
            Wie darf Sound Flux die Person ansprechen?
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="Vorname, optional"
              autoComplete="off"
            />
          </label>
          <label>
            Welche Musik mag die Person?
            <textarea
              value={preferences}
              onChange={(event) => setPreferences(event.target.value)}
              maxLength={600}
              placeholder="Zum Beispiel: Klavier, Walzer oder ruhige Gitarrenmusik"
              rows={3}
            />
          </label>
          <p className="dialog-note">
            <ShieldCheck size={19} />
            Die Angaben werden mit Nachrichten an die lokale Sprach-API
            gesendet. Das Frontend speichert sie nur im Arbeitsspeicher. Nach
            dem Neuladen sind sie weg.
          </p>
          <p className="text-sm leading-relaxed text-muted">
            Die Instrumente und Melodien entstehen direkt im Browser. Die
            Sprachbegleitung kann musikalische Ideen vorschlagen, aber keine
            Lieblingsaufnahme abspielen.
          </p>
          <button className="dialog-primary" type="submit">
            {profileSaved ? 'Angaben übernehmen' : 'Musikraum öffnen'}
            <ArrowRight size={18} />
          </button>
        </form>
        <button className="reset-session" onClick={resetSession}>
          <RotateCcw size={16} />
          Sitzung beenden und Angaben löschen
        </button>
      </Dialog>
    </div>
  )
}
