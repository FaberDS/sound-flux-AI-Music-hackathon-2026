import { clamp, detectGesture, poseFromLandmarks } from "./motion.js";

const $ = (id) => document.getElementById(id);
const screens = [$("setup-screen"), $("calibration-screen"), $("play-screen")];
const state = {
  preset: null, stream: null, tracker: null, baseline: null, previousGesture: null,
  lastPose: null, lastGestureAt: 0, audio: null, playing: false, timer: null,
  nextFluteAt: 0, fluteStep: 0, midi: null, midiOutput: null,
};

function show(screen) {
  screens.forEach((item) => item.classList.toggle("hidden", item !== screen));
}

function setConnection(message, kind = "") {
  const status = $("connection-status");
  status.textContent = `● ${message}`;
  status.className = `status ${kind}`;
}

function cameraErrorMessage(error) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return "Camera needs https or http://localhost:8000 — browser file previews cannot access it.";
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "Camera permission was blocked. Allow camera access for localhost, then press Calibrate & play again.";
  if (error?.name === "NotFoundError") return "No camera was found. Connect one or use the keyboard demo.";
  if (error?.name === "NotReadableError") return "Your camera is busy in another app. Close it there, then try again.";
  return "Camera could not start. Use the keyboard demo or check browser camera permissions.";
}

function buildPreset(request) {
  const words = `${request} ${$("mood").value} ${$("artists").value}`.toLowerCase();
  const rock = /rock|intense|dynamic|foo fighters/.test(words);
  const calm = /calm|ambient|soft/.test(words);
  // ponytail: local keyword preset is a demo substitute; swap this function for constrained AI JSON when a backend exists.
  return {
    name: rock ? "Rock Motion Kit" : calm ? "Calm Motion Kit" : "Motion Music Kit",
    bpm: rock ? 128 : calm ? 84 : 108,
    key: rock ? "E minor" : calm ? "D minor" : "C minor",
    flutePattern: rock ? [64, 67, 71, 72, 71, 67, 64, 62] : [62, 65, 69, 72, 69, 65, 62, 60],
  };
}

function applyPreset(preset) {
  state.preset = preset;
  $("preset-name").textContent = preset.name;
  $("preset-summary").textContent = `${preset.bpm} BPM · ${preset.key} · Flute accompaniment`;
  $("playing-name").textContent = preset.name;
  $("tempo-readout").textContent = `${preset.bpm} BPM`;
  $("key-readout").textContent = preset.key;
  $("preset-card").classList.remove("hidden");
}

async function startCamera() {
  if (state.stream) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("insecure-context");
  state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
  await Promise.all([$("camera"), $("play-camera")].map(async (video) => { video.srcObject = state.stream; await video.play(); }));
  setConnection("Camera connected", "connected");
  await loadTracker();
}

async function loadTracker() {
  try {
    const { FaceLandmarker, FilesetResolver } = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22");
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm");
    state.tracker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task", delegate: "GPU" },
      runningMode: "VIDEO", numFaces: 1,
    });
    trackFrame();
  } catch (error) {
    $("calibration-status").textContent = "Face tracking could not load. You can still test with arrow keys.";
    $("camera-overlay").textContent = "Keyboard controls active";
  }
}

function trackFrame() {
  if (!state.tracker || !state.stream) return;
  const video = $("camera");
  if (video.readyState >= 2) {
    const result = state.tracker.detectForVideo(video, performance.now());
    const pose = result.faceLandmarks?.[0] && poseFromLandmarks(result.faceLandmarks[0]);
    if (pose) onPose(pose);
  }
  requestAnimationFrame(trackFrame);
}

function onPose(pose) {
  state.lastPose = pose;
  $("calibration-status").textContent = "Face detected. Keep a comfortable neutral pose.";
  if (!state.playing || !state.baseline) return;
  const level = Number($("sensitivity").value);
  const threshold = { nod: [0.11, 0.08, 0.055][level - 1], tilt: [22, 16, 11][level - 1] };
  const gesture = detectGesture(pose, state.baseline, threshold, state.previousGesture);
  const now = performance.now();
  if (gesture && now - state.lastGestureAt > 150) {
    trigger(gesture, clamp(Math.abs(pose.tilt - state.baseline.tilt) / 30, 0.45, 1));
    state.lastGestureAt = now;
  }
  state.previousGesture = gesture;
}

function getAudio() {
  if (!state.audio) state.audio = new AudioContext();
  state.audio.resume().catch(() => {});
  return state.audio;
}

function noiseBuffer(ctx, seconds = 0.18) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function percussion(kind, velocity, at = getAudio().currentTime) {
  const ctx = getAudio();
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(velocity * 0.4, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + (kind === "kick" ? 0.23 : 0.14));
  if (kind === "kick") {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(140, at); osc.frequency.exponentialRampToValueAtTime(42, at + 0.16);
    osc.connect(gain); osc.start(at); osc.stop(at + 0.23);
  } else {
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    filter.type = kind === "snare" ? "bandpass" : "highpass";
    filter.frequency.value = kind === "snare" ? 1600 : 5000;
    source.buffer = noiseBuffer(ctx, kind === "crash" ? 0.35 : 0.18);
    source.connect(filter).connect(gain); source.start(at); source.stop(at + (kind === "crash" ? 0.35 : 0.18));
  }
}

function midiNote(note, velocity = 90, duration = 0.25, at = 0) {
  if (!state.midiOutput) return;
  const when = performance.now() + at * 1000;
  state.midiOutput.send([0x90, note, velocity], when);
  state.midiOutput.send([0x80, note, 0], when + duration * 1000);
}

function trigger(kind, velocity = 0.8) {
  const ctx = getAudio();
  const sixteenth = 60 / state.preset.bpm / 4;
  const now = ctx.currentTime;
  const at = Math.ceil(now / sixteenth) * sixteenth;
  percussion(kind, velocity, at);
  midiNote({ kick: 36, snare: 38, crash: 49 }[kind], Math.round(velocity * 100), 0.08, Math.max(0, at - now));
  $("drum-meter").classList.add("hit");
  setTimeout(() => $("drum-meter").classList.remove("hit"), 100);
}

function playFlute(note, at) {
  const ctx = getAudio();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = 440 * 2 ** ((note - 69) / 12);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(0.08, at + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.43);
  osc.connect(gain).connect(ctx.destination); osc.start(at); osc.stop(at + 0.45);
  midiNote(note, 65, 0.43, Math.max(0, at - ctx.currentTime));
}

function scheduleFlute() {
  if (!state.playing) return;
  const ctx = getAudio();
  const step = 60 / state.preset.bpm / 2;
  while (state.nextFluteAt < ctx.currentTime + 0.12) {
    playFlute(state.preset.flutePattern[state.fluteStep % state.preset.flutePattern.length], state.nextFluteAt);
    state.fluteStep += 1; state.nextFluteAt += step;
  }
}

function startPlaying() {
  getAudio();
  state.playing = true; state.fluteStep = 0; state.nextFluteAt = state.audio.currentTime + 0.08;
  state.timer = setInterval(scheduleFlute, 50);
  show($("play-screen"));
}

function stopPlaying() {
  state.playing = false; clearInterval(state.timer); state.timer = null;
  if (state.audio) state.audio.close();
  state.audio = null; state.baseline = null;
  show($("setup-screen"));
}

async function connectMidi() {
  if (!navigator.requestMIDIAccess) { $("midi-status").textContent = "Web MIDI is unavailable in this browser."; return; }
  state.midi = await navigator.requestMIDIAccess();
  state.midiOutput = [...state.midi.outputs.values()][0] || null;
  $("midi-status").textContent = state.midiOutput ? `Connected: ${state.midiOutput.name}` : "No MIDI output found";
}

$("onboarding-form").addEventListener("submit", (event) => { event.preventDefault(); applyPreset(buildPreset($("music-request").value)); });
$("calibrate-button").addEventListener("click", async () => {
  getAudio(); // Create/resume while this click is still a trusted browser gesture.
  show($("calibration-screen"));
  $("calibration-status").textContent = "Requesting camera access…";
  try {
    await startCamera();
  } catch (error) {
    const message = cameraErrorMessage(error);
    setConnection("Camera unavailable", "error");
    $("calibration-status").textContent = message;
    $("camera-overlay").textContent = "Keyboard controls active";
  }
});
$("capture-neutral-button").addEventListener("click", () => {
  if (!state.lastPose) { $("calibration-status").textContent = "Keep your face in view, then try again."; return; }
  $("capture-neutral-button").disabled = true;
  $("calibration-status").textContent = "Holding neutral pose…";
  const readings = [];
  const sampler = setInterval(() => state.lastPose && readings.push(state.lastPose), 60);
  setTimeout(() => {
    clearInterval(sampler); $("capture-neutral-button").disabled = false;
    if (readings.length < 10) { $("calibration-status").textContent = "Calibration needs a clearer camera view."; return; }
    state.baseline = { nod: readings.reduce((sum, item) => sum + item.nod, 0) / readings.length, tilt: readings.reduce((sum, item) => sum + item.tilt, 0) / readings.length };
    startPlaying();
  }, 3000);
});
$("keyboard-demo-button").addEventListener("click", () => {
  getAudio();
  state.baseline = { nod: 0, tilt: 0 };
  $("camera-overlay").textContent = "Keyboard controls active";
  startPlaying();
});
$("sensitivity").addEventListener("input", (event) => { $("sensitivity-value").textContent = ["Low", "Medium", "High"][event.target.value - 1]; });
$("midi-button").addEventListener("click", () => connectMidi().catch(() => { $("midi-status").textContent = "MIDI access was not granted."; }));
$("stop-button").addEventListener("click", stopPlaying);
document.addEventListener("keydown", (event) => {
  if (!state.playing || event.repeat) return;
  const kind = { ArrowDown: "kick", ArrowLeft: "snare", ArrowRight: "crash" }[event.key];
  if (kind) { event.preventDefault(); trigger(kind); }
});

$("voice-button").addEventListener("click", () => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) { $("voice-status").textContent = "Voice input is not available here; type your request instead."; return; }
  const recognition = new Recognition(); recognition.lang = "en-US";
  recognition.onstart = () => { $("voice-status").textContent = "Listening…"; };
  recognition.onresult = (event) => { $("music-request").value = event.results[0][0].transcript; $("voice-status").textContent = "Request captured. Create your music kit when ready."; };
  recognition.onerror = () => { $("voice-status").textContent = "Voice input could not start; type your request instead."; };
  recognition.start();
});
