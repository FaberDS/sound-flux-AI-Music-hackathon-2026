import { initMotionAudio } from './motion-audio.mjs';

export function initMotionDemo() {
  const root = document.querySelector('#motion-panel');
  const $ = selector => root.querySelector(selector);
  const camera = $('#motion-video');
  const button = $('#motion-toggle');
  const status = $('#motion-status');
  const error = $('#motion-error');
  const sound = initMotionAudio(root);
  const layers = [...root.querySelectorAll('[data-motion-layer]')];
  const emptyFrame = { body: [], face: [], hands: [], expressions: {} };
  let latest = emptyFrame;
  let active = null;
  let drawing = null;

  const colors = ['#ffd76a', '#a4dfc5', '#8dccff', '#ff9da9', '#d5b2ff'];
  for (const legend of root.querySelectorAll('.motion-fingers')) {
    legend.innerHTML = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']
      .map((finger, index) => `<span><i style="background:${colors[index]}"></i>${finger}</span>`).join('');
  }

  function paint() {
    const width = camera.videoWidth || 640;
    const height = camera.videoHeight || 480;
    const selection = Object.fromEntries(layers.map(input => [input.dataset.motionLayer, input.checked]));
    for (const detail of ['overlay', 'skeleton', 'face', 'Left', 'Right']) {
      const canvas = $(`#motion-${detail}`);
      const full = detail === 'overlay' || detail === 'skeleton';
      if (full && (canvas.width !== width || canvas.height !== height)) {
        canvas.width = width;
        canvas.height = height;
      }
      if (drawing) drawing.drawMotion(canvas, latest, selection, width, height, full ? undefined : detail);
      else canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function updateStats(fps = 0) {
    const counts = {
      face: latest.face.length,
      Left: latest.hands.find(({ side }) => side === 'Left')?.points.length ?? 0,
      Right: latest.hands.find(({ side }) => side === 'Right')?.points.length ?? 0,
    };
    const total = latest.body.filter(point => drawing.visiblePoint(point, 0.5)).length
      + counts.face + counts.Left + counts.Right;
    $('#motion-total').textContent = total;
    $('#motion-fps').textContent = fps;
    $('#motion-dot').classList.toggle('live', !!active && total > 0);
    $('#motion-skeleton-placeholder').hidden = total > 0;
    for (const [detail, count] of Object.entries(counts)) {
      $(`[data-motion-count="${detail}"]`).textContent = count;
      $(`[data-motion-empty="${detail}"]`).hidden = count > 0;
    }
    for (const meter of root.querySelectorAll('[data-motion-expression]')) {
      const score = latest.expressions[meter.dataset.motionExpression] ?? 0;
      meter.value = score;
      meter.nextElementSibling.textContent = counts.face ? `${Math.round(score * 100)}%` : '—';
    }
    if (active) status.textContent = total ? 'Tracking live' : 'Looking for a person — move into view';
  }

  function stop() {
    sound.stop();
    const previous = active;
    active = null;
    previous?.release();
    latest = emptyFrame;
    paint();
    updateStats();
    button.textContent = 'Start camera';
    button.classList.remove('is-on');
    status.textContent = 'Camera is off';
    $('#motion-camera-placeholder').hidden = false;
  }

  async function start() {
    let stream = null;
    let face = null, body = null, hands = null;
    let frameId = 0, lastTime = -1, lastInference = -Infinity;
    let lastStats = performance.now(), frames = 0;
    const session = { release() {
      cancelAnimationFrame(frameId);
      stream?.getTracks().forEach(track => track.stop());
      if (camera.srcObject === stream) camera.srcObject = null;
      face?.close(); body?.close(); hands?.close();
      face = null; body = null; hands = null;
    } };
    active = session;
    const cancelled = () => active !== session;
    error.hidden = true;
    button.textContent = 'Stop camera';
    button.classList.add('is-on');
    status.textContent = 'Opening camera…';
    $('#motion-camera-placeholder').hidden = true;

    function fail(reason) {
      if (cancelled()) return;
      stop();
      error.textContent = reason.name === 'NotAllowedError'
        ? 'Camera permission was blocked. Allow camera access in your browser, then try again.'
        : reason.name === 'NotFoundError'
          ? 'No webcam found. Connect a camera, then try again.'
          : reason.name === 'NotReadableError'
            ? 'The camera is busy or unavailable. Close other apps using it, then try again.'
            : reason.message || 'Tracking failed. Please try again.';
      error.hidden = false;
    }

    function track(now) {
      if (cancelled()) return;
      try {
        // ponytail: cap synchronous inference at 15 Hz; use a worker if it causes UI jank.
        if (camera.readyState >= 2 && camera.currentTime !== lastTime && now - lastInference >= 1000 / 15) {
          lastTime = camera.currentTime;
          lastInference = now;
          const faceResult = face.detectForVideo(camera, now);
          const bodyResult = body.detectForVideo(camera, now);
          const handResult = hands.detectForVideo(camera, now);
          latest = {
            body: bodyResult.landmarks[0] ?? [],
            face: faceResult.faceLandmarks[0] ?? [],
            hands: handResult.landmarks.map((points, index) => ({
              side: handResult.handedness[index]?.[0]?.categoryName ?? 'Unknown', points,
            })),
            expressions: Object.fromEntries((faceResult.faceBlendshapes[0]?.categories ?? [])
              .map(({ categoryName, score }) => [categoryName, score])),
          };
          paint();
          sound.update(latest, camera.videoWidth / camera.videoHeight);
          frames++;
          if (now - lastStats >= 300) {
            updateStats(Math.round(frames * 1000 / (now - lastStats)));
            lastStats = now;
            frames = 0;
          }
        }
        frameId = requestAnimationFrame(track);
      } catch (reason) { fail(reason); }
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error('Camera access needs localhost or HTTPS and a browser that supports webcams.');
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
      });
      if (cancelled()) { session.release(); return; }
      stream.getVideoTracks()[0]?.addEventListener('ended', () => fail(new Error('The camera disconnected. Reconnect it, then try again.')));
      camera.srcObject = stream;
      await camera.play();
      if (cancelled()) return;
      status.textContent = 'Loading face, body & hand tracking…';
      drawing = await import('./motion-capture.mjs?v=2');
      if (cancelled()) return;
      const { FaceLandmarker, FilesetResolver, HandLandmarker, PoseLandmarker } = drawing;
      const vision = await FilesetResolver.forVisionTasks('./node_modules/@mediapipe/tasks-vision/wasm');
      if (cancelled()) return;
      for (const delegate of ['GPU', 'CPU']) {
        try {
          face = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: './motion-models/face_landmarker.task', delegate },
            runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
          });
          if (cancelled()) { session.release(); return; }
          body = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: './motion-models/pose_landmarker_lite.task', delegate },
            runningMode: 'VIDEO', numPoses: 1,
          });
          if (cancelled()) { session.release(); return; }
          hands = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: './motion-models/hand_landmarker.task', delegate },
            runningMode: 'VIDEO', numHands: 2,
          });
          if (cancelled()) { session.release(); return; }
          break;
        } catch {
          face?.close(); body?.close(); hands?.close();
          face = null; body = null; hands = null;
          if (cancelled()) return;
          if (delegate === 'CPU') throw new Error('Could not load tracking models. Reload the page and try again.');
        }
      }
      lastStats = performance.now();
      status.textContent = 'Looking for a person — move into view';
      frameId = requestAnimationFrame(track);
    } catch (reason) { fail(reason); }
  }
  for (const input of layers) input.onchange = paint;
  button.onclick = () => { if (active) stop(); else void start(); };
  return { stop };
}
