import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { Check, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { EffectPitch, Instrument } from '../lib/music'
import {
  headControl,
  mouthBeat,
  poseFromLandmarks,
  type HeadControl,
  type HeadPose,
} from './mouth-beatbox'

export function MouthBeatbox({
  active,
  enabled,
  effects,
  onBeat,
}: {
  active: boolean
  enabled: boolean
  effects: readonly { id: Instrument; name: string; icon: LucideIcon }[]
  onBeat: (effect: Instrument, intensity: number, volume: number, pitch: EffectPitch) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState('Camera is off')
  const [effect, setEffect] = useState<Instrument>('drum')
  const [intensity, setIntensity] = useState(1)
  const [volume, setVolume] = useState(1)
  const [pitch, setPitch] = useState<EffectPitch>('low')
  const settings = useRef({ effect, intensity, volume, pitch })

  useEffect(() => {
    settings.current = { effect, intensity, volume, pitch }
  }, [effect, intensity, volume, pitch])

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
    let baseline: HeadPose | null = null
    let baselineFrames = 0
    let smoothedPose: HeadPose | null = null
    let activeControl: HeadControl | null = null

    const applyHeadControl = (control: HeadControl) => {
      if (control === 'previous' || control === 'next') {
        const current = effects.findIndex(({ id }) => id === settings.current.effect)
        const direction = control === 'previous' ? -1 : 1
        const option = effects[(current + direction + effects.length) % effects.length]
        settings.current.effect = option.id
        setEffect(option.id)
        setStatus(`${option.name} selected`)
        return
      }
      const change = control === 'softer' ? -0.1 : 0.1
      const next = Math.max(0.1, Math.min(1, settings.current.intensity + change))
      settings.current.intensity = next
      setIntensity(next)
      setStatus(`Intensity ${Math.round(next * 100)}%`)
    }

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
        setStatus('Face the camera for hands-free controls')

        const track = () => {
          if (cancelled || !tracker) return
          if (
            camera.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            camera.currentTime !== lastVideoTime
          ) {
            lastVideoTime = camera.currentTime
            const result = tracker.detectForVideo(camera, performance.now())
            const pose = poseFromLandmarks(result.faceLandmarks[0] ?? [])
            if (pose) {
              smoothedPose = smoothedPose
                ? {
                    nod: smoothedPose.nod * 0.75 + pose.nod * 0.25,
                    turn: smoothedPose.turn * 0.75 + pose.turn * 0.25,
                  }
                : pose
              if (baselineFrames < 15) {
                baselineFrames++
                baseline = baseline
                  ? {
                      nod: baseline.nod + (smoothedPose.nod - baseline.nod) / baselineFrames,
                      turn: baseline.turn + (smoothedPose.turn - baseline.turn) / baselineFrames,
                    }
                  : smoothedPose
                if (baselineFrames === 15)
                  setStatus('Turn left or right for instruments; nod forward or up for intensity')
              } else if (baseline) {
                const movement = headControl(smoothedPose, baseline, activeControl)
                activeControl = movement.active
                if (movement.control) applyHeadControl(movement.control)
              }
            }
            const blendshape = result.faceBlendshapes[0]?.categories.find(
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
                settings.current.volume,
                settings.current.pitch,
              )
              setStatus('Effect added! Close, then open your mouth again')
            } else if (wasOpen && !mouthOpen) {
              setStatus('Ready for your next movement')
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
  }, [active, effects, enabled, onBeat])

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
        <div className="effect-levels">
          <label className="effect-intensity">
            <span>Intensity <output>{Math.round(intensity * 100)}%</output></span>
            <input
              aria-label="Intensity"
              type="range"
              min="0.1"
              max="1"
              step="0.1"
              value={intensity}
              onChange={(event) => setIntensity(Number(event.target.value))}
            />
          </label>
          <label className="effect-volume">
            <span>Volume <output>{Math.round(volume * 100)}%</output></span>
            <input
              aria-label="Effect volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
          </label>
        </div>
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
              {pitch === value && <Check size={19} aria-hidden="true" />}
            </button>
          ))}
        </fieldset>
      </div>
    </section>
  )
}
