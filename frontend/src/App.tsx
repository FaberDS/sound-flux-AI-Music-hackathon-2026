import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BellRing,
  Cable,
  Camera,
  CameraOff,
  Check,
  ChevronRight,
  Drum,
  Guitar,
  Heart,
  ListMusic,
  LoaderCircle,
  Mic,
  Music2,
  Pause,
  Piano,
  Play,
  ShieldCheck,
  Square,
  Trash2,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { checkConnection, preseedOnboarding } from './lib/api'
import {
  DEFAULT_MUSIC_SETTINGS,
  deleteAllCompositions,
  deleteComposition,
  deleteCompositionEffect,
  getCompositions,
  getMusicSettings,
  MusicRoom,
  saveCompositionEffect,
  saveMusicSettings,
  type CapturePhase,
  type EffectPitch,
  type Instrument,
  type Mood,
  type MusicSettings,
  type SavedComposition,
} from './lib/music'
import { useCompanion, type Phase } from './hooks/useCompanion'
import SoundFlux from './components/sound-flux/SoundFlux.jsx'
import BrandLogo from './components/sound-flux/BrandLogo.jsx'
import { FloatingSessionControls } from './components/FloatingSessionControls'
import { ChordcatRhythm } from './components/ChordcatRhythm'
import { MouthBeatbox } from './components/MouthBeatbox'
import { ProfilePanel } from './components/ProfilePanel'
import { SavedHistory } from './components/SavedHistory'
import { useSavedData } from './hooks/useSavedData'
import { useChordcatRhythm } from './hooks/useChordcatRhythm'
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
const layerVolumeKey = 'sound-flux-layer-volumes'

function savedLayerVolumes() {
  try {
    const saved = JSON.parse(localStorage.getItem(layerVolumeKey) ?? '{}')
    return {
      music:
        typeof saved.music === 'number' && saved.music >= 0 && saved.music <= 1
          ? saved.music
          : 1,
      effects:
        typeof saved.effects === 'number' && saved.effects >= 0 && saved.effects <= 1
          ? saved.effects
          : 1,
    }
  } catch {
    return { music: 1, effects: 1 }
  }
}

function compositionArtwork(identifier: string) {
  const seed = Array.from(identifier).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  )
  return amazingGraceImages[seed % amazingGraceImages.length]
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
  alert = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  dismissible?: boolean
  fullPage?: boolean
  alert?: boolean
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
      role={alert ? 'alertdialog' : undefined}
      className={`room-dialog ${fullPage ? 'journey-dialog' : ''}`}
    >
      <div className="dialog-header flex items-start justify-between gap-6">
        <h2>{title}</h2>
        <button
          onClick={onClose}
          className="dialog-close shrink-0"
          aria-label="Close"
          disabled={!dismissible}
        >
          <X size={22} />
          <span>Close</span>
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

function CompositionTimeline({
  composition,
  onRemove,
}: {
  composition?: SavedComposition
  onRemove: (effectId: string) => void
}) {
  if (!composition?.duration) return null
  const time = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
  return (
    <div
      className="composition-timeline"
      aria-label={`Composition timeline with ${composition.effects.length} mouth ${composition.effects.length === 1 ? 'effect' : 'effects'}`}
    >
      <div className="timeline-scale" aria-hidden="true">
        <span>0:00</span>
        <div className="timeline-track">
          {composition.effects.map((effect) => {
            const option = instruments.find(({ id }) => id === effect.effect)
            const Icon = option?.icon ?? Drum
            return (
              <span
                key={effect.id}
                className={`timeline-effect instrument-${effect.effect}`}
                style={{ left: `${Math.max(2, Math.min(98, effect.at / composition.duration * 100))}%` }}
                title={`${option?.name ?? 'Effect'}, ${effect.pitch} pitch, ${Math.round(effect.intensity * 100)}% intensity, ${Math.round(effect.volume * 100)}% volume at ${time(effect.at)}`}
              >
                <Icon size={18} />
              </span>
            )
          })}
        </div>
        <span>{time(composition.duration)}</span>
      </div>
      {composition.effects.length > 0 && (
        <ul className="timeline-effect-list">
          {composition.effects.map((effect) => {
            const option = instruments.find(({ id }) => id === effect.effect)
            const Icon = option?.icon ?? Drum
            return (
              <li key={effect.id}>
                <span className={`timeline-effect-icon instrument-${effect.effect}`}>
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span className="timeline-effect-details">
                  <strong>{option?.name ?? 'Effect'}</strong>
                  <span>
                    {time(effect.at)} · {effect.pitch} pitch · {Math.round(effect.intensity * 100)}% intensity · {Math.round(effect.volume * 100)}% volume
                  </span>
                </span>
                <button
                  type="button"
                  className="timeline-remove"
                  aria-label={`Remove ${option?.name ?? 'effect'} at ${time(effect.at)}`}
                  onClick={() => onRemove(effect.id)}
                >
                  <X size={18} aria-hidden="true" /> Remove
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default function App({ debug = false }: { debug?: boolean }) {
  const [page, setPage] = useState<'home' | 'songs'>(() =>
    window.location.pathname === '/songs' ? 'songs' : 'home',
  )
  const [mood, setMood] = useState<Mood>('calm')
  const [playing, setPlaying] = useState(false)
  const [focusMode, setFocusMode] = useState(true)
  const [autoReplay, setAutoReplay] = useState(true)
  const [capturePhase, setCapturePhase] = useState<CapturePhase>('idle')
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [cameraPromptOpen, setCameraPromptOpen] = useState(false)
  const [volume, setVolume] = useState(0.45)
  const [layerVolumes, setLayerVolumes] = useState(savedLayerVolumes)
  const [readAloud, setReadAloud] = useState(true)
  const [dialog, setDialog] = useState<'help' | 'profile' | null>(null)
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
  const [connection, setConnection] = useState<
    'checking' | 'online' | 'offline'
  >('checking')
  const [musicError, setMusicError] = useState('')
  const [musicSettings, setMusicSettings] = useState<MusicSettings>(DEFAULT_MUSIC_SETTINGS)
  const [musicSettingsStatus, setMusicSettingsStatus] = useState('Loading music settings…')
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
  const [music] = useState(() => new MusicRoom(() => setPlaying(false)))
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const musicSettingsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const musicSettingsVersion = useRef(0)
  const healthRequest = useRef<AbortController | null>(null)
  const compositionsRequest = useRef<AbortController | null>(null)
  const handledMusicRequest = useRef(0)
  const cameraPromptShown = useRef(false)
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
  const focusedComposition = compositionMode && focusMode
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
  const previousPage = useRef(page)

  useEffect(() => {
    document.title = page === 'songs' ? 'Your songs · Sound Flux' : 'Sound Flux · Your music room'
    if (previousPage.current !== page) {
      document.getElementById('musikraum')?.focus({ preventScroll: true })
      previousPage.current = page
    }
  }, [page])

  useEffect(() => {
    const room = companionRef.current
    if (!busy || !room) return
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    room.focus()
    function keepFocusInRoom(event: KeyboardEvent) {
      if (event.key !== 'Tab' || document.querySelector('dialog[open]')) return
      const controls = Array.from(document.querySelectorAll<HTMLElement>(
        '.session-active button:not(:disabled), .session-active input:not(:disabled), .session-active select:not(:disabled), .immediate-stop',
      )).filter((element) => element.getClientRects().length > 0)
      const first = controls[0]
      const last = controls.at(-1)
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === room)) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', keepFocusInRoom)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', keepFocusInRoom)
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
      else document.getElementById('musikraum')?.focus({ preventScroll: true })
    }
  }, [busy])
  useEffect(() => {
    if (compositionMode && !cameraPromptShown.current) {
      cameraPromptShown.current = true
      setCameraPromptOpen(true)
    }
  }, [compositionMode])

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
    if (!debug) return
    let active = true
    void getMusicSettings().then(
      (settings) => {
        if (active) {
          setMusicSettings(settings)
          setMusicSettingsStatus('Loaded saved defaults.')
        }
      },
      () => {
        if (active) setMusicSettingsStatus('Music engine unavailable. Reload to try again.')
      },
    )
    return () => {
      active = false
    }
  }, [debug])
  useEffect(() => {
    const showCurrentPage = () =>
      setPage(window.location.pathname === '/songs' ? 'songs' : 'home')
    window.addEventListener('popstate', showCurrentPage)
    return () => window.removeEventListener('popstate', showCurrentPage)
  }, [])
  useEffect(() => {
    music.setVolume(volume)
  }, [music, volume])
  useEffect(() => {
    music.setMusicVolume(layerVolumes.music)
    music.setEffectsVolume(layerVolumes.effects)
  }, [layerVolumes, music])
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
        setFocusMode(true)
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
    }, musicRequest === 1 ? 2_000 : 500)
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
  const beat = useCallback((effect: Instrument, intensity: number, volume: number, pitch: EffectPitch) => {
    const at = music.beat(effect, intensity, volume, pitch)
    if (at === null || !activeCompositionId) return
    void saveCompositionEffect(activeCompositionId, {
      at,
      effect,
      intensity,
      volume,
      pitch,
    }).then(
      ({ effects, duration }) => {
        setCompositions((items) =>
          items.map((item) =>
            item.id === activeCompositionId ? { ...item, effects, duration } : item,
          ),
        )
        setMusicError('')
        if (playing && activeComposition)
          void music.refreshCompositionEffects(activeComposition.effectsUrl).catch(() =>
            setMusicError(
              'The sound was saved. Pause and play the song to hear it.',
            ),
          )
      },
      () => setMusicError('The effect played, but could not be saved.'),
    )
  }, [activeComposition, activeCompositionId, music, playing])
  const playRhythm = useCallback((effect: Instrument, pitch: EffectPitch) => {
    if (compositionMode && playing) beat(effect, 0.8, 1, pitch)
    else void playInstrument(effect)
  }, [beat, compositionMode, playInstrument, playing])
  const chordcat = useChordcatRhythm({
    effects: instruments,
    savesToSong: compositionMode && playing,
    onPlay: playRhythm,
  })
  const removeEffect = useCallback((effectId: string) => {
    if (!activeCompositionId) return
    void deleteCompositionEffect(activeCompositionId, effectId).then(
      ({ effects, duration }) => {
        setCompositions((items) =>
          items.map((item) =>
            item.id === activeCompositionId ? { ...item, effects, duration } : item,
          ),
        )
        setMusicError('')
        if (playing && activeComposition)
          void music.refreshCompositionEffects(activeComposition.effectsUrl).catch(() =>
            setMusicError('Pause and play the song to update its effects.'),
          )
      },
      () => setMusicError('The effect could not be removed.'),
    )
  }, [activeComposition, activeCompositionId, music, playing])
  const stopAll = () => {
    music.stop()
    setCameraEnabled(false)
    setCapturePhase('idle')
    setPlaying(false)
    setFocusMode(true)
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
            ? await music.playComposition(
                composition.url,
                composition.effects.length ? composition.effectsUrl : undefined,
              )
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
  async function regenerateMusic() {
    if (
      capturePhase !== 'idle' ||
      !music.canRegenerate(activeCompositionId)
    )
      return
    setPlaying(false)
    setMusicError('')
    try {
      setPlaying(
        await music.regenerate(setCapturePhase, (identifier) => {
          setActiveCompositionId(identifier)
          void refreshCompositions()
        }),
      )
    } catch (error) {
      setMusicError(
        error instanceof Error
          ? error.message
          : 'The audio engine could not regenerate the music.',
      )
    }
  }
  async function playSavedComposition(composition: SavedComposition) {
    music.stop()
    setPlaying(false)
    void companion.stop()
    setFocusMode(true)
    setActiveCompositionId(composition.id)
    navigatePage('home')
    try {
      setPlaying(Boolean(await music.playComposition(
        composition.url,
        composition.effects.length ? composition.effectsUrl : undefined,
      )))
      setMusicError('')
    } catch {
      setActiveCompositionId(null)
      setMusicError('The saved composition could not be played.')
    }
  }
  async function removeComposition(composition: SavedComposition) {
    if (!window.confirm('Delete this song from this device? This cannot be undone.')) return
    try {
      await deleteComposition(composition.id)
      if (activeCompositionId === composition.id) stopAll()
      setCompositions((items) => items.filter((item) => item.id !== composition.id))
      setMusicError('')
    } catch {
      setMusicError('The song could not be deleted. Please try again.')
    }
  }
  async function removeAllCompositions() {
    if (!window.confirm('Delete all songs from this device? This cannot be undone.')) return
    try {
      await deleteAllCompositions()
      stopAll()
      setCompositions([])
      setMusicError('')
    } catch {
      setMusicError('The songs could not be deleted. Please try again.')
    }
  }
  function navigatePage(next: 'home' | 'songs') {
    const path = next === 'songs' ? '/songs' : '/'
    if (window.location.pathname !== path) window.history.pushState(null, '', path)
    setPage(next)
    window.scrollTo({ top: 0 })
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

  function updateLayerVolume(layer: 'music' | 'effects', value: number) {
    setLayerVolumes((current) => {
      const next = { ...current, [layer]: value }
      try {
        localStorage.setItem(layerVolumeKey, JSON.stringify(next))
      } catch {
        /* The controls still work when browser storage is unavailable. */
      }
      return next
    })
  }

  function updateMusicSetting<Key extends keyof MusicSettings>(
    key: Key,
    value: MusicSettings[Key],
  ) {
    saveDebugMusicSettings({ ...musicSettings, [key]: value })
  }

  function saveDebugMusicSettings(next: MusicSettings) {
    const version = ++musicSettingsVersion.current
    setMusicSettings(next)
    setMusicSettingsStatus('Saving…')
    if (musicSettingsTimer.current) clearTimeout(musicSettingsTimer.current)
    musicSettingsTimer.current = setTimeout(() => {
      void saveMusicSettings(next).then(
        () => {
          if (version === musicSettingsVersion.current)
            setMusicSettingsStatus('Saved for the next composition.')
        },
        () => {
          if (version === musicSettingsVersion.current)
            setMusicSettingsStatus('Could not save music settings.')
        },
      )
    }, 400)
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
          <h2>Composition defaults</h2>
          <p>Changes save automatically and apply to the next composition.</p>
          <form className="debug-music-settings" onSubmit={(event) => event.preventDefault()}>
              <label className="wide">
                <span>Music description</span>
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={musicSettings.prompt}
                  onChange={(event) => updateMusicSetting('prompt', event.currentTarget.value)}
                />
                <small>Describe the instruments, mood, rhythm, and production style.</small>
              </label>
              <label className="wide">
                <span>What to avoid</span>
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={musicSettings.negative_prompt}
                  onChange={(event) => updateMusicSetting('negative_prompt', event.currentTarget.value)}
                />
                <small>For example: vocals, speech, distortion, noise.</small>
              </label>
              <label htmlFor="music-strength">
                <span>Transformation strength <output>{musicSettings.strength.toFixed(2)}</output></span>
                <input
                  id="music-strength"
                  type="range"
                  min="0.1"
                  max="0.95"
                  step="0.05"
                  value={musicSettings.strength}
                  onChange={(event) => updateMusicSetting('strength', event.currentTarget.valueAsNumber)}
                />
                <small>0.40 keeps the hum · 0.55 balanced · 0.70 more creative</small>
              </label>
              <label htmlFor="music-input-mix">
                <span>Original hum mix <output>{musicSettings.input_mix.toFixed(2)}</output></span>
                <input
                  id="music-input-mix"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={musicSettings.input_mix}
                  onChange={(event) => updateMusicSetting('input_mix', event.currentTarget.valueAsNumber)}
                />
                <small>Mixes the raw recording back in; 0.00–0.30 is usually useful.</small>
              </label>
              <label htmlFor="music-cfg">
                <span>Prompt guidance <output>{musicSettings.cfg.toFixed(1)}</output></span>
                <input
                  id="music-cfg"
                  type="range"
                  min="1"
                  max="10"
                  step="0.1"
                  value={musicSettings.cfg}
                  onChange={(event) => updateMusicSetting('cfg', event.currentTarget.valueAsNumber)}
                />
                <small>2–4 is a practical range; higher values follow the prompt harder.</small>
              </label>
              <label htmlFor="music-steps">
                <span>Generation steps <output>{musicSettings.steps}</output></span>
                <input
                  id="music-steps"
                  type="range"
                  min="1"
                  max="32"
                  step="1"
                  value={musicSettings.steps}
                  onChange={(event) => updateMusicSetting('steps', event.currentTarget.valueAsNumber)}
                />
                <small>8 is fast · 12 may sound more refined · more is slower.</small>
              </label>
              <label htmlFor="music-seconds">
                <span>Length <output>{musicSettings.seconds} s</output></span>
                <input
                  id="music-seconds"
                  type="range"
                  min="5"
                  max="60"
                  step="1"
                  value={musicSettings.seconds}
                  disabled={musicSettings.match_input}
                  onChange={(event) => updateMusicSetting('seconds', event.currentTarget.valueAsNumber)}
                />
                <small>Ignored while “match recorded length” is enabled.</small>
              </label>
              <label>
                <span>Seed</span>
                <input
                  type="number"
                  min="-1"
                  max="2147483647"
                  step="1"
                  value={musicSettings.seed}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber
                    if (Number.isInteger(value) && value >= -1 && value <= 2_147_483_647)
                      updateMusicSetting('seed', value)
                  }}
                  onBlur={(event) => {
                    if (!event.currentTarget.validity.valid)
                      event.currentTarget.value = String(musicSettings.seed)
                  }}
                />
                <small>Keep fixed for comparisons; use −1 for a new variation each time.</small>
              </label>
              <label className="check wide">
                <input
                  type="checkbox"
                  checked={musicSettings.match_input}
                  onChange={(event) => updateMusicSetting('match_input', event.currentTarget.checked)}
                />
                <span>Match the composition length to the recording</span>
              </label>
              <label className="check wide">
                <input
                  type="checkbox"
                  checked={musicSettings.repeat}
                  onChange={(event) => updateMusicSetting('repeat', event.currentTarget.checked)}
                />
                <span>Repeat a short hum to fill a longer composition</span>
              </label>
              <button
                type="button"
                className="wide"
                onClick={() => saveDebugMusicSettings(DEFAULT_MUSIC_SETTINGS)}
              >
                Reset to defaults
              </button>
            </form>
          <p className="debug-settings-status" role="status">{musicSettingsStatus}</p>
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
      <a className="skip-link" href="#musikraum" inert={busy}>
        Skip to music room
      </a>
      <header className="site-header" inert={busy}>
        <a
          href="/"
          aria-label="Sound Flux, music room"
          className="brand"
          onClick={(event) => {
            event.preventDefault()
            navigatePage('home')
          }}
        >
          <BrandLogo />
        </a>
        <nav className="desktop-nav" aria-label="Main navigation">
          <a
            className="nav-link"
            href="/songs"
            aria-current={page === 'songs' ? 'page' : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              navigatePage('songs')
            }}
          >
            <ListMusic size={21} /> Your songs
          </a>
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
      {page === 'songs' ? (
        <main id="musikraum" className="main-content songs-page" tabIndex={-1}>
          <button className="songs-back" onClick={() => navigatePage('home')}>
            <ArrowLeft size={20} /> Back to music
          </button>
          <div className="songs-heading">
            <div>
              <p>Your music library</p>
              <h1>Your songs</h1>
              <span>Play the music you created with Sound Flux.</span>
            </div>
            {compositions.length > 0 && (
              <button className="delete-all-songs" onClick={() => void removeAllCompositions()}>
                <Trash2 size={18} /> Delete all songs
              </button>
            )}
          </div>
          {musicError && <p className="error-message" role="alert">{musicError}</p>}
          {compositions.length > 0 ? (
            <div className="songs-grid">
              {compositions.map((composition) => {
                const name = `Composition — ${historyTime(composition.created_at)}`
                return <article className="song-card" key={composition.id}>
                  <button
                    className="song-play"
                    onClick={() => void playSavedComposition(composition)}
                    aria-label={`Play ${name}`}
                  >
                    <img src={compositionArtwork(composition.id)} alt="" />
                    <span className="song-play-icon"><Play size={24} fill="currentColor" /> Play song</span>
                  </button>
                  <div className="song-details">
                    <div>
                      <strong>{name}</strong>
                      <time dateTime={composition.created_at}>{historyTime(composition.created_at)}</time>
                    </div>
                    <button
                      className="delete-song"
                      onClick={() => void removeComposition(composition)}
                      aria-label={`Delete ${name}`}
                    >
                      <Trash2 size={19} />
                      <span>Delete</span>
                    </button>
                  </div>
                </article>
              })}
            </div>
          ) : (
            <div className="songs-empty">
              <ListMusic size={38} />
              <h2>No songs yet</h2>
              <p>Create music with Sound Flux and it will appear here.</p>
              <button className="music-button" onClick={() => navigatePage('home')}>Create music</button>
            </div>
          )}
        </main>
      ) : (
      <main id="musikraum" className="main-content" tabIndex={-1}>
        <section className="hero-grid" aria-labelledby="page-title">
          <div className="hero-copy" inert={busy}>
            <p className="hero-eyebrow"><Music2 size={22} /> Your personal music room</p>
            <h1 id="page-title">Make music.<br /><span>At your pace.</span></h1>
            <p className="hero-description">
              Enjoy a familiar sound. Try an instrument.<br className="hero-line-break" /> Or make a song together with Sound Flux.
            </p>
            <fieldset className="mood-selection">
              <legend>Choose a sound</legend>
              <div className="flex flex-wrap gap-2.5">
                <button
                  onClick={() => void chooseMood('calm')}
                  aria-pressed={mood === 'calm'}
                  className={`mood-button ${mood === 'calm' ? 'selected' : ''}`}
                >
                  <Heart size={22} />
                  Calm{mood === 'calm' && <Check size={18} />}
                </button>
                <button
                  onClick={() => void chooseMood('bright')}
                  aria-pressed={mood === 'bright'}
                  className={`mood-button ${mood === 'bright' ? 'selected' : ''}`}
                >
                  <Music2 size={22} />
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
            <p className="hero-hint">You can pause or stop whenever you like.</p>
            {musicError && (
              <p className="error-message" role="alert">
                {musicError}
              </p>
            )}
          </div>
          <section
            ref={companionRef}
            className={`companion-card ${busy ? 'session-active' : ''} ${compositionMode ? 'composition-mode' : ''} ${focusedComposition ? 'focus-mode' : ''}`}
            aria-label="Voice companion"
            role={busy ? 'dialog' : undefined}
            aria-modal={busy || undefined}
            tabIndex={-1}
          >
            <div className="companion-content">
            {compositionMode && !focusedComposition && <div className="connection-row">
              {compositionMode && (
                <button
                  type="button"
                  className={`camera-permission ${cameraEnabled ? 'online' : ''}`}
                  aria-pressed={cameraEnabled}
                  aria-label={cameraEnabled ? 'Turn camera off' : 'Enable camera'}
                  onClick={() => setCameraEnabled(!cameraEnabled)}
                >
                  {cameraEnabled ? <Camera size={22} /> : <CameraOff size={22} />}
                  <span className="camera-copy">
                    <strong>{cameraEnabled ? 'Camera on' : 'Camera off'}</strong>
                    <span>{cameraEnabled ? 'Turn camera off' : 'Enable camera'}</span>
                  </span>
                </button>
              )}
              {compositionMode && (
                <button
                  type="button"
                  className={`camera-permission chordcat-permission ${chordcat.connected ? 'online' : ''}`}
                  aria-pressed={chordcat.connected}
                  aria-label={chordcat.connected ? 'Disconnect Chordcat' : 'Connect Chordcat'}
                  onClick={() => {
                    if (chordcat.connected) chordcat.disconnect()
                    else void chordcat.connect()
                  }}
                  disabled={chordcat.connecting}
                >
                  {chordcat.connected
                    ? <Check size={22} />
                    : <Cable size={22} />}
                  <span className="camera-copy">
                    <strong>{chordcat.connected ? 'Chordcat ready' : 'Chordcat'}</strong>
                    <span>
                      {chordcat.connecting
                        ? 'Connecting…'
                        : chordcat.connected
                          ? chordcat.status
                          : chordcat.status === 'Connect your Chordcat to begin.'
                            ? 'Connect music board'
                            : chordcat.status}
                    </span>
                  </span>
                </button>
              )}
            </div>}
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
            {focusedComposition && (
              <div className="focus-controls" aria-label="Focus mode controls">
                <button className="focus-back" onClick={() => {
                  stopAll()
                  navigatePage('home')
                }}>
                  <ArrowLeft size={20} /> Back to home
                </button>
                <button className="music-button focus-play" onClick={() => void toggleMusic()}>
                  {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
                  {playing ? 'Pause music' : 'Play music'}
                </button>
                <button className="focus-show-all" onClick={() => setFocusMode(false)}>
                  Show all
                </button>
              </div>
            )}
            {!focusedComposition && <div
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
                  ? `Your composition is ${playing ? 'playing' : 'paused'}`
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
            </div>}
            {compositionMode && !focusedComposition && (
              <>
                <div className="composition-controls">
                  <button className="music-button" onClick={() => void toggleMusic()}>
                    {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
                    {playing ? 'Pause music' : 'Play music'}
                  </button>
                  <button onClick={() => setFocusMode(true)}>Focus mode</button>
                  <button
                    className="read-aloud"
                    aria-pressed={autoReplay}
                    onClick={() => {
                      const next = !autoReplay
                      setAutoReplay(next)
                      music.setAutoReplay(next)
                    }}
                  >
                    <span className={`toggle-track ${autoReplay ? 'on' : ''}`}>
                      <span />
                    </span>
                    Auto replay
                  </button>
                  {music.canRegenerate(activeCompositionId) && (
                    <button
                      onClick={() => void regenerateMusic()}
                      disabled={capturePhase !== 'idle'}
                    >
                      {capturePhase === 'composing'
                        ? 'Regenerating…'
                        : 'Regenerate music'}
                    </button>
                  )}
                  <button onClick={() => {
                    setActiveCompositionId(null)
                    setCameraEnabled(false)
                    onMicrophone()
                  }}>Start new song</button>
                  <button onClick={() => {
                    stopAll()
                    navigatePage('songs')
                  }}>Back to your songs</button>
                  <fieldset className="layer-volume-controls">
                    <legend>Layer volumes</legend>
                    <label>
                      <span>
                        Generated music
                        <output>{Math.round(layerVolumes.music * 100)}%</output>
                      </span>
                      <input
                        aria-label="Generated music volume"
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={layerVolumes.music}
                        onChange={(event) =>
                          updateLayerVolume('music', Number(event.target.value))
                        }
                      />
                    </label>
                    <label>
                      <span>
                        Effects
                        <output>{Math.round(layerVolumes.effects * 100)}%</output>
                      </span>
                      <input
                        aria-label="Effects volume"
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={layerVolumes.effects}
                        onChange={(event) =>
                          updateLayerVolume('effects', Number(event.target.value))
                        }
                      />
                    </label>
                  </fieldset>
                </div>
                <CompositionTimeline
                  composition={activeComposition}
                  onRemove={removeEffect}
                />
                <MouthBeatbox
                  active={playing}
                  enabled={cameraEnabled}
                  effects={instruments}
                  onBeat={beat}
                />
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
            </div>
            {busy && <FloatingSessionControls conversation={!compositionMode} onStop={stopAll} />}
          </section>
        </section>
        <div className="room-sections" inert={busy}>
        <section
          id="instrumente"
          className="instruments-section"
          aria-labelledby="instrument-title"
        >
          <div className="section-heading">
            <div>
              <h2 id="instrument-title">Play an instrument</h2>
              <p>Tap an instrument to hear its sound. No experience needed.</p>
            </div>
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
                    <span>Tap to play</span>
                  </span>
                  <ArrowRight className="instrument-arrow" size={17} />
                </button>
              ),
            )}
          </div>
        </section>
        <ChordcatRhythm effects={instruments} chordcat={chordcat} />
        <SavedHistory
          turns={history}
          loading={saved.loading}
          error={saved.errors.history}
          onRefresh={() => void saved.refresh()}
          onManage={openProfile}
        />
        <section className="session-toolbar" aria-labelledby="audio-settings-title">
          <div className="audio-settings-intro">
            <h2 id="audio-settings-title">Sound settings</h2>
            <p>Make yourself comfortable.</p>
          </div>
          <div className="audio-settings">
            <label className="volume-control">
              {volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
              <span>Volume</span>
              <input
                aria-label="Volume"
                aria-valuetext={`${Math.round(volume * 100)} percent`}
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
              />
              <output aria-hidden="true">{Math.round(volume * 100)}%</output>
            </label>
            <button
              className="read-aloud"
              onClick={() => setReadAloud(!readAloud)}
              aria-pressed={readAloud}
            >
              <span className={`toggle-track ${readAloud ? 'on' : ''}`}>
                <span />
              </span>
              <span>Read answers aloud <span className="toggle-state">{readAloud ? 'On' : 'Off'}</span></span>
            </button>
            <button className="stop-all" onClick={stopAll}>
              <Square size={12} fill="currentColor" />
              Stop everything
            </button>
          </div>
        </section>
        </div>
      </main>
      )}
      {playing && !busy && <FloatingSessionControls conversation={false} onStop={stopAll} />}
      <Dialog
        open={cameraPromptOpen}
        onClose={() => setCameraPromptOpen(false)}
        title="Add sounds to your music?"
        alert
      >
        <div className="camera-alert-copy">
          <span aria-hidden="true">
            <svg
              className="mouth-sound-pictogram"
              viewBox="0 0 64 64"
              width="42"
              height="42"
              fill="none"
            >
              <path
                d="M5 31c6-8 12-11 19-7 7-4 13-1 19 7-6 8-12 11-19 11S11 39 5 31Z"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinejoin="round"
              />
              <path
                d="M9 31c10 3 20 3 30 0"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
              />
              <path
                d="M48 26c3 3 3 9 0 12M55 20c7 7 7 17 0 24"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <p>
            Use the camera for mouth sounds or connect your Chordcat music
            board. Camera video is processed on this device and never recorded.
          </p>
        </div>
        <div className="camera-alert-actions">
          <button
            type="button"
            className="dialog-primary"
            onClick={() => {
              setCameraPromptOpen(false)
              setCameraEnabled(true)
            }}
          >
            <Camera size={20} /> Enable camera
          </button>
          <button
            type="button"
            className="dialog-primary"
            onClick={() => {
              setCameraPromptOpen(false)
              if (!chordcat.connected) void chordcat.connect()
            }}
          >
            {chordcat.connected ? <Check size={20} /> : <Cable size={20} />}
            {chordcat.connected ? 'Use Chordcat' : 'Connect Chordcat'}
          </button>
          <button type="button" onClick={() => setCameraPromptOpen(false)}>
            Not now
          </button>
        </div>
      </Dialog>
      <Dialog
        open={dialog === 'help'}
        onClose={() => setDialog(null)}
        title="How it works"
        fullPage
      >
        <div className="journey-intro">
          <p>Make music with Sound Flux</p>
          <h3>A song that starts with you.</h3>
          <span>
            Talk about music you enjoy, share a memory, or hum a tune.
            Sound Flux helps you turn it into your own song.
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
              <span>Step 1 · Talk</span>
              <h4>Tell us what you like</h4>
              <p>
                Tap “Talk with Sound Flux” and tell us about your favorite music.
                Take as much time as you need.
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
              <span>Step 2 · Remember</span>
              <h4>Share a memory</h4>
              <p>
                You can talk about a person, a place, or a song you remember.
                Share only what you want to.
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
              <span>Step 3 · Play</span>
              <h4>Make it your own</h4>
              <p>
                Hum a tune when Sound Flux asks, then listen to your song.
                You can add instrument sounds or simply enjoy the music.
              </p>
            </div>
          </li>
        </ol>
        <div className="journey-finish">
          <p><ShieldCheck size={16} /> You can stop the conversation at any time.</p>
          <button className="dialog-primary" onClick={() => {
            setDialog(null)
            onMicrophone()
          }}>
            Talk with Sound Flux <ArrowRight size={18} />
          </button>
        </div>
      </Dialog>
      <Dialog
        open={dialog === 'profile'}
        onClose={() => setDialog(null)}
        title="For companions"
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
