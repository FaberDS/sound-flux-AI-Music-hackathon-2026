import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { EffectPitch, Instrument } from '../lib/music'
import { mouthBeat } from './mouth-beatbox'

export function MouthBeatbox({
  active,
  enabled,
  effects,
  onBeat,
}: {
  active: boolean
  enabled: boolean
  effects: readonly { id: Instrument; name: string; icon: LucideIcon }[]
  onBeat: (effect: Instrument, intensity: number, pitch: EffectPitch) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState('Camera is off')
  const [effect, setEffect] = useState<Instrument>('drum')
  const [intensity, setIntensity] = useState(1)
  const [pitch, setPitch] = useState<EffectPitch>('low')
  const settings = useRef({ effect, intensity, pitch })

  useEffect(() => {
    settings.current = { effect, intensity, pitch }
  }, [effect, intensity, pitch])

  useEffect(() => {
    if (!enabled || !active) {
      return
    }

    const videoElement = video.current
    if (!videoElement) return
    const camera = videoElement
    let cancelled = false
    let stream: MediaStream | null = null
    let tracker: FaceLandmarker | null = null
    let frame = 0
    let lastVideoTime = -1
    let mouthOpen = false

    async function start() {
      try {
        setStatus('Opening camera…')
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 320, height: 240 },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        camera.srcObject = stream
        await camera.play()

        const base = import.meta.env.BASE_URL
        const vision = await FilesetResolver.forVisionTasks(`${base}mediapipe`)
        tracker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `${base}face_landmarker.task`,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
        })
        if (cancelled) {
          tracker.close()
          return
        }
        setStatus('Open and close your mouth to add the selected effect')

        const track = () => {
          if (cancelled || !tracker) return
          if (
            camera.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            camera.currentTime !== lastVideoTime
          ) {
            lastVideoTime = camera.currentTime
            const blendshape = tracker
              .detectForVideo(camera, performance.now())
              .faceBlendshapes[0]?.categories.find(
                ({ categoryName }) => categoryName === 'jawOpen',
              )
            const jawOpen = blendshape?.score ?? 0
            const wasOpen = mouthOpen
            const next = mouthBeat(jawOpen, mouthOpen)
            mouthOpen = next.isOpen
            if (next.beat) {
              onBeat(
                settings.current.effect,
                settings.current.intensity,
                settings.current.pitch,
              )
              setStatus('Effect added! Close, then open your mouth again')
            } else if (wasOpen && !mouthOpen) {
              setStatus('Open and close your mouth to add the selected effect')
            }
          }
          frame = requestAnimationFrame(track)
        }
        track()
      } catch (error) {
        tracker?.close()
        stream?.getTracks().forEach((track) => track.stop())
        if (!cancelled) {
          setStatus(
            error instanceof DOMException && error.name === 'NotAllowedError'
              ? 'Camera permission was blocked'
              : 'Face tracking is unavailable',
          )
        }
      }
    }

    void start()
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      tracker?.close()
      stream?.getTracks().forEach((track) => track.stop())
      camera.srcObject = null
    }
  }, [active, enabled, onBeat])

  const displayStatus = enabled && !active
    ? 'Play your composition to use mouth beats'
    : enabled
      ? status
      : 'Camera is off'
  const EffectIcon = effects.find((option) => option.id === effect)?.icon ?? effects[0].icon

  return (
    <section className="mouth-beatbox" aria-label="Mouth beatbox">
      <div className="mouth-camera-row">
        {enabled && active && (
          <video ref={video} className="mouth-camera" muted playsInline />
        )}
        <div>
          <strong>Mouth beatbox</strong>
          <p aria-live="polite">{displayStatus}</p>
        </div>
      </div>
      <div className="mouth-effect-settings">
        <div className="effect-picker">
          <label htmlFor="mouth-effect">Effect</label>
          <span className="effect-dropdown">
            <EffectIcon size={34} strokeWidth={1.6} aria-hidden="true" />
            <select
              id="mouth-effect"
              value={effect}
              onChange={(event) => setEffect(event.target.value as Instrument)}
            >
              {effects.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </span>
        </div>
        <label className="effect-intensity">
          <span>Intensity <output>{Math.round(intensity * 100)}%</output></span>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.1"
            value={intensity}
            onChange={(event) => setIntensity(Number(event.target.value))}
          />
        </label>
        <fieldset className="effect-pitch">
          <legend>Pitch</legend>
          {(['low', 'high'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={pitch === value}
              onClick={() => setPitch(value)}
            >
              {value === 'low' ? 'Low' : 'High'}
            </button>
          ))}
        </fieldset>
      </div>
    </section>
  )
}
