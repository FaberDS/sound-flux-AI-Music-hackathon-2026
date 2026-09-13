import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { Check, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { EffectPitch, Instrument } from '../lib/music'
import {
  headControl,
  handControl,
  mouthBeat,
  poseFromLandmarks,
  type HandControl,
  type HeadControl,
  type HeadPose,
} from './mouth-beatbox'

export function MouthBeatbox({
  active,
  enabled,
  effects,
  focused = false,
  onBeat,
}: {
  active: boolean
  enabled: boolean
  effects: readonly { id: Instrument; name: string; icon: LucideIcon }[]
  focused?: boolean
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
    let faceTracker: FaceLandmarker | null = null
    let poseTracker: PoseLandmarker | null = null
    let frame = 0
    let lastVideoTime = -1
    let lastPoseAt = 0
    let mouthOpen = false
    let baseline: HeadPose | null = null
    let baselineFrames = 0
    let smoothedPose: HeadPose | null = null
    let activeHeadControl: HeadControl | null = null
    let activeHandControl: HandControl | null = null

    const applyControl = (control: HeadControl | HandControl) => {
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
        faceTracker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `${base}face_landmarker.task`,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
        })
        poseTracker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `${base}pose_landmarker_lite.task`,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        })
        if (cancelled) {
          faceTracker?.close()
          poseTracker?.close()
          faceTracker = null
          poseTracker = null
          return
        }
        setStatus('Keep your face, shoulders, and hands in view')

        const track = () => {
          if (cancelled || !faceTracker || !poseTracker) return
          if (
            camera.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            camera.currentTime !== lastVideoTime
          ) {
            lastVideoTime = camera.currentTime
            const now = performance.now()
            const result = faceTracker.detectForVideo(camera, now)
            const pose = poseFromLandmarks(result.faceLandmarks[0] ?? [])
            if (pose) {
              smoothedPose = smoothedPose
                ? {
                    nod: smoothedPose.nod * 0.75 + pose.nod * 0.25,
                  }
                : pose
              if (baselineFrames < 15) {
                baselineFrames++
                baseline = baseline
                  ? {
                      nod: baseline.nod + (smoothedPose.nod - baseline.nod) / baselineFrames,
                    }
                  : smoothedPose
                if (baselineFrames === 15)
                  setStatus('Raise left hand for previous instrument or right for next; nod for intensity')
              } else if (baseline) {
                const movement = headControl(smoothedPose, baseline, activeHeadControl)
                activeHeadControl = movement.active
                if (movement.control) applyControl(movement.control)
              }
            }
            // ponytail: 10 Hz is enough for hand lifts; use a worker if tracking janks.
            if (now - lastPoseAt >= 100) {
              lastPoseAt = now
              const landmarks = poseTracker.detectForVideo(camera, now).landmarks[0] ?? []
              const movement = handControl(landmarks, activeHandControl)
              activeHandControl = movement.active
              if (movement.control) applyControl(movement.control)
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
        faceTracker?.close()
        poseTracker?.close()
        faceTracker = null
        poseTracker = null
        stream?.getTracks().forEach((track) => track.stop())
        if (!cancelled) {
          setStatus(
            error instanceof DOMException && error.name === 'NotAllowedError'
              ? 'Camera permission was blocked'
              : 'Camera tracking is unavailable',
          )
        }
      }
    }

    void start()
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      faceTracker?.close()
      poseTracker?.close()
      faceTracker = null
      poseTracker = null
      stream?.getTracks().forEach((track) => track.stop())
      camera.srcObject = null
    }
  }, [active, effects, enabled, onBeat])

  const displayStatus = enabled && !active
    ? 'Play your composition to use mouth beats'
    : enabled
      ? status
      : 'Camera is off'
  const selectedEffect = effects.find((option) => option.id === effect) ?? effects[0]
  const EffectIcon = selectedEffect.icon

  return (
    <>
      {focused && (
        <div
          className="mouth-focus-instrument"
          aria-label={`Current instrument: ${selectedEffect.name}`}
          aria-live="polite"
        >
          <span className="mouth-focus-instrument-icon">
            <EffectIcon size={48} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <small>Lift left for previous · right for next</small>
        </div>
      )}
      <section
        className={`mouth-beatbox ${focused ? 'mouth-beatbox-focus' : ''}`}
        aria-label="Mouth beatbox"
      >
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
    </>
  )
}
