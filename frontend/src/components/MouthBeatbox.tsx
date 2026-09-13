import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { useEffect, useRef, useState } from 'react'
import { mouthBeat } from './mouth-beatbox'

export function MouthBeatbox({
  active,
  onBeat,
}: {
  active: boolean
  onBeat: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [enabled, setEnabled] = useState(false)
  const [status, setStatus] = useState('Camera is off')

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
        setStatus('Open and close your mouth to add a beat')

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
              onBeat()
              setStatus('Beat! Close, then open your mouth again')
            } else if (wasOpen && !mouthOpen) {
              setStatus('Open and close your mouth to add a beat')
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
    : status

  return (
    <section className="mouth-beatbox" aria-label="Mouth beatbox">
      {enabled && active && (
        <video ref={video} className="mouth-camera" muted playsInline />
      )}
      <div>
        <strong>Mouth beatbox</strong>
        <p aria-live="polite">{displayStatus}</p>
        <button
          type="button"
          className="mouth-beatbox-toggle"
          onClick={() => {
            if (enabled) setStatus('Camera is off')
            setEnabled(!enabled)
          }}
          aria-pressed={enabled}
        >
          {enabled ? 'Turn camera off' : 'Enable camera'}
        </button>
      </div>
    </section>
  )
}
