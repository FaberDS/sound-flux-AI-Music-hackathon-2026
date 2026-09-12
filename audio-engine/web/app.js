import { encodeWav, formatTime, joinSamples, mixToMono } from "./audio-utils.js";

const $ = (id) => document.getElementById(id);
const state = { phase: "idle", ready: false, setupBusy: false, setupRequested: false, setupStarting: false, checking: false, disposed: false, file: null, context: null, stream: null, input: null, recorder: null, worklet: null, muted: null, analyser: null, chunks: [], nativeChunks: [], stopped: null, animation: null, timer: null, statusTimer: null, loop: null, gain: null, loopStarted: 0, request: null, tune: null, lastSeed: null };
const TUNE_FIELDS = [
  ["seconds", "Length (s)", 5, 60, 1],
  ["strength", "Strength (lower keeps more hum)", 0.1, 0.95, 0.05],
  ["steps", "Steps", 1, 32, 1],
  ["cfg", "Prompt guidance (cfg)", 1, 10, 0.1],
  ["input_mix", "Mix input into output (0 = off)", 0, 1, 0.05],
];
const toMono = (buffer) => mixToMono(Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))).subarray(0, buffer.sampleRate * 30);

function setPhase(phase, message) {
  state.phase = phase;
  const busy = ["requesting", "decoding", "waiting", "generating"].includes(phase);
  const labels = { idle: "Record", requesting: "Microphone…", recording: "Stop recording", decoding: "Listening…", waiting: "Preparing…", generating: "Composing…", playing: "Record again", error: "Try again" };
  $("studio").dataset.phase = phase;
  $("studio").setAttribute("aria-busy", String(busy));
  $("record").disabled = busy;
  $("record").setAttribute("aria-pressed", String(phase === "recording"));
  $("record").setAttribute("aria-label", phase === "recording" ? "Stop recording and create music" : phase === "playing" ? "Record a new melody" : labels[phase]);
  $("button-label").textContent = labels[phase];
  $("microphone-icon").toggleAttribute("hidden", busy || phase === "recording");
  $("stop-icon").hidden = phase !== "recording";
  $("busy-icon").hidden = !busy;
  $("status").textContent = message;
  $("progress").hidden = phase !== "waiting" && phase !== "generating";
  if (phase === "generating") $("progress").removeAttribute("value");
  syncGenerateButton();
}

function fail(message) {
  $("error").textContent = message;
  $("error").hidden = false;
  setPhase("error", "Tap to record a new melody and try again.");
}

function drawWaveform(samples) {
  const canvas = $("waveform");
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = state.phase === "recording" ? "#b77a60" : "#9bab82";
  for (let bar = 0; bar < 75; bar++) {
    let amplitude = 0;
    if (samples?.length) {
      const start = Math.floor(bar * samples.length / 75);
      const end = Math.max(start + 1, Math.floor((bar + 1) * samples.length / 75));
      for (let index = start; index < end; index++) amplitude = Math.max(amplitude, Math.abs(samples[index] || 0));
    }
    const height = Math.max(3, Math.min(110, amplitude * 240));
    context.beginPath();
    context.roundRect(bar * canvas.width / 75, (canvas.height - height) / 2, 4, height, 2);
    context.fill();
  }
}

function visualize() {
  cancelAnimationFrame(state.animation);
  const samples = new Float32Array(state.analyser.fftSize);
  const frame = () => {
    if (!state.analyser || !["recording", "playing"].includes(state.phase)) return;
    state.analyser.getFloatTimeDomainData(samples);
    drawWaveform(samples);
    if (state.phase === "playing" && state.loop) {
      const duration = state.loop.buffer.duration;
      $("timer").textContent = `${formatTime((state.context.currentTime - state.loopStarted) % duration)} / ${formatTime(duration)} · on repeat`;
    }
    state.animation = requestAnimationFrame(frame);
  };
  frame();
}

function stopLoop() {
  cancelAnimationFrame(state.animation);
  if (state.loop) {
    state.loop.stop();
    state.loop.disconnect();
    state.loop = null;
  }
  state.gain?.disconnect();
  state.analyser?.disconnect();
  state.gain = null;
  state.analyser = null;
}

function releaseMicrophone() {
  clearInterval(state.timer);
  cancelAnimationFrame(state.animation);
  if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop();
  state.stream?.getTracks().forEach((track) => track.stop());
  state.input?.disconnect();
  state.worklet?.disconnect();
  state.muted?.disconnect();
  state.analyser?.disconnect();
  state.stream = state.input = state.worklet = state.recorder = state.muted = state.analyser = null;
  state.nativeChunks = [];
  state.chunks = [];
}

async function startRecording() {
  $("error").hidden = true;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || (!window.MediaRecorder && !window.AudioWorkletNode)) {
    fail("Recording needs a supported browser on localhost or HTTPS.");
    return;
  }
  stopLoop();
  state.file = null;
  state.setupRequested = false;
  setPhase("requesting", "Allow microphone access, then hum your melody.");
  try {
    if (!state.context || state.context.state === "closed") state.context = new AudioContext();
    await state.context.resume();
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
    if (state.disposed) { releaseMicrophone(); return; }
    state.input = state.context.createMediaStreamSource(state.stream);
    state.muted = state.context.createGain();
    state.muted.gain.value = 0;
    state.analyser = state.context.createAnalyser();
    state.analyser.fftSize = 2048;
    state.input.connect(state.analyser).connect(state.muted).connect(state.context.destination);
    if (window.MediaRecorder) {
      state.nativeChunks = [];
      state.recorder = new MediaRecorder(state.stream);
      state.recorder.ondataavailable = ({ data }) => { if (data.size) state.nativeChunks.push(data); };
      state.recorder.start(250);
    } else {
      let timeout;
      try {
        await Promise.race([
          state.context.audioWorklet.addModule("/static/recorder-worklet.js"),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Audio capture could not start. Try a different browser.")), 5000); }),
        ]);
      } finally { clearTimeout(timeout); }
      state.chunks = [];
      state.worklet = new AudioWorkletNode(state.context, "hum-recorder");
      state.worklet.port.onmessage = ({ data }) => {
        if (data.type === "samples") state.chunks.push(data.samples);
        else if (data.type === "stopped") state.stopped?.();
      };
      state.input.connect(state.worklet).connect(state.muted);
    }
    setPhase("recording", "Hum your tune. Tap again to turn it into music.");
    const started = performance.now();
    $("timer").textContent = "00:00 / 00:30";
    state.timer = setInterval(() => {
      const elapsed = (performance.now() - started) / 1000;
      $("timer").textContent = `${formatTime(elapsed)} / 00:30`;
      if (elapsed >= 30) void finishRecording();
    }, 200);
    visualize();
  } catch (error) {
    releaseMicrophone();
    fail(error.name === "NotAllowedError" ? "Allow microphone access in your browser, then tap to try again." : error.message);
  }
}

async function finishRecording() {
  if (state.phase !== "recording") return;
  setPhase("decoding", "Your melody is becoming something new.");
  clearInterval(state.timer);
  let samples;
  const sampleRate = state.context.sampleRate;
  try {
    if (state.recorder) {
      await new Promise((resolve, reject) => {
        state.recorder.onstop = resolve;
        state.recorder.onerror = () => reject(new Error("The browser could not finish recording. Please try again."));
        state.recorder.stop();
      });
      const blob = new Blob(state.nativeChunks, { type: state.recorder.mimeType });
      const decoded = await state.context.decodeAudioData(await blob.arrayBuffer());
      samples = toMono(decoded);
    } else {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 1500);
        state.stopped = () => { clearTimeout(timeout); resolve(); };
        state.worklet.port.postMessage("stop");
      });
      samples = joinSamples(state.chunks, sampleRate * 30);
    }
    if (samples.length < sampleRate) throw new Error("Give your melody at least one second. Tap to record again.");
    state.file = new File([encodeWav(samples, sampleRate)], "my-hum.wav", { type: "audio/wav" });
  } catch (error) {
    fail(error.message);
  } finally {
    releaseMicrophone();
    state.stopped = null;
  }
  if (!state.file || state.disposed) return;
  drawWaveform(samples);
  if (state.ready) await generate();
  else {
    setPhase("waiting", "Preparing the audio engine. Your melody will start automatically.");
    await ensureSetup();
    await checkEngine();
  }
}

async function ensureSetup() {
  if (state.setupRequested) return;
  state.setupRequested = true;
  if (state.setupBusy) return;
  state.setupStarting = true;
  try {
    const response = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!response.ok) throw new Error("Could not prepare the model. Check that the local server is running.");
  } catch (error) { fail(error.message); }
  finally { state.setupStarting = false; }
}

async function generate() {
  if (!state.file || state.phase === "generating" || state.disposed) return;
  setPhase("generating", "Creating your composition. It will play automatically.");
  const started = performance.now();
  $("timer").textContent = "Composing on your Mac…";
  state.timer = setInterval(() => { $("timer").textContent = `${Math.floor((performance.now() - started) / 1000)} seconds elapsed`; }, 1000);
  try {
    const form = new FormData();
    form.append("audio", state.file);
    form.append("settings", state.tune ? JSON.stringify(readSettings()) : "{}");
    state.request = new AbortController();
    const response = await fetch("/api/compose", { method: "POST", body: form, signal: state.request.signal });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(typeof payload.detail === "string" ? payload.detail : `Generation failed (${response.status}). Tap to try a new melody.`);
    }
    const buffer = await state.context.decodeAudioData(await response.arrayBuffer());
    if (state.disposed) return;
    const fade = Math.min(Math.round(buffer.sampleRate * 0.01), Math.floor(buffer.length / 2));
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let index = 0; index < fade; index++) {
        samples[index] *= index / fade;
        samples[samples.length - 1 - index] *= index / fade;
      }
    }
    await state.context.resume();
    state.loop = state.context.createBufferSource();
    state.loop.buffer = buffer;
    state.loop.loop = true;
    state.gain = state.context.createGain();
    state.gain.gain.value = 0.35;
    state.analyser = state.context.createAnalyser();
    state.analyser.fftSize = 2048;
    state.loop.connect(state.gain).connect(state.analyser).connect(state.context.destination);
    state.loopStarted = state.context.currentTime;
    state.loop.start();
    if (state.tune) {
      state.lastSeed = response.headers.get("X-Generation-Seed");
      $("keep-seed").disabled = false;
      $("tune-status").textContent = `Seed ${state.lastSeed} · generated in ${Math.round((performance.now() - started) / 1000)} s.`;
    }
    setPhase("playing", "Your melody, on repeat. Tap to record something new.");
    visualize();
  } catch (error) {
    if (!state.disposed) fail(error.message);
  } finally {
    clearInterval(state.timer);
    state.request = null;
  }
}

async function checkEngine() {
  if (state.checking || state.disposed) return;
  clearTimeout(state.statusTimer);
  state.checking = true;
  try {
    const response = await fetch("/api/status");
    if (!response.ok) throw new Error("Engine status unavailable.");
    const status = await response.json();
    if (status.studio_url) {
      const studio = new URL(status.studio_url);
      if (["localhost", "127.0.0.1"].includes(studio.hostname) && studio.origin !== window.location.origin) {
        window.location.replace(studio.origin + window.location.pathname + window.location.search);
        return;
      }
    }
    state.ready = status.ready;
    state.setupBusy = Boolean(status.setup?.busy);
    $("engine-status").textContent = status.ready ? "Stable Audio 3 Medium · Ready on your Mac" : status.setup?.busy ? status.message : "First use prepares a 5.53 GB model automatically after recording.";
    if (state.phase === "waiting") {
      $("progress").value = Math.min(1, (status.setup?.downloaded_bytes || 0) / (status.setup?.total_bytes || 1));
      if (state.ready) void generate();
      else if (state.setupRequested && !state.setupStarting && !state.setupBusy) fail(status.message);
    }
  } catch {
    state.ready = false;
    $("engine-status").textContent = "Cannot reach the audio engine. Start it with: uv run python app.py";
    if (state.phase === "waiting") fail("The audio engine is unavailable. Restart it, then record again.");
  } finally {
    state.checking = false;
    if (!state.disposed) state.statusTimer = setTimeout(checkEngine, state.ready ? 15000 : 2000);
  }
}

// Developer-only tuning panel, mounted by opening /?tune. The default studio stays one button.
function mountTuner() {
  const form = document.createElement("form");
  form.id = "tune";
  form.className = "tune";
  form.setAttribute("aria-label", "Generation settings");
  form.innerHTML = `<h2>Tune</h2>
    <label class="wide"><span>Input audio</span><select name="source"><option value="">Last recorded or loaded audio</option></select></label>
    <label class="wide"><span>Prompt</span><textarea name="prompt" rows="3" maxlength="2000"></textarea></label>
    <label class="wide"><span>Negative prompt (what to avoid; needs cfg above 1)</span><textarea name="negative_prompt" rows="2" maxlength="2000"></textarea></label>
    ${TUNE_FIELDS.map(([name, label, min, max, step]) => `<label><span>${label} <output></output></span><input type="range" name="${name}" min="${min}" max="${max}" step="${step}"></label>`).join("")}
    <label><span>Seed (-1 = random)</span><input type="number" name="seed" min="-1" max="2147483647" step="1"></label>
    <label class="check"><input type="checkbox" name="repeat"> Loop short hums to fill the length</label>
    <label class="check"><input type="checkbox" name="match_input"> Match length to input (overrides Length, 5 s minimum)</label>
    <div class="tune-actions">
      <button type="button" id="regenerate" disabled>Generate from input</button>
      <button type="button" id="keep-seed" disabled>Use last seed</button>
      <button type="button" id="save-settings">Save as default</button>
      <button type="button" id="load-settings">Revert to saved</button>
    </div>
    <p id="tune-status" role="status"></p>`;
  document.querySelector("main").after(form);
  state.tune = form;
  form.addEventListener("input", () => { syncOutputs(); syncGenerateButton(); });
  form.addEventListener("submit", (event) => event.preventDefault());
  $("regenerate").addEventListener("click", generateFromTuner);
  $("keep-seed").addEventListener("click", () => { form.elements.seed.value = state.lastSeed; });
  $("save-settings").addEventListener("click", saveSettings);
  $("load-settings").addEventListener("click", loadSettings);
  void loadSettings();
  void loadSamples();
}

async function loadSamples() {
  const names = await fetch("/api/samples").then((response) => response.ok ? response.json() : []).catch(() => []);
  for (const name of names) state.tune.elements.source.add(new Option(`audio/${name}`, name));
  syncGenerateButton();
}

function syncGenerateButton() {
  if (state.tune) $("regenerate").disabled = !(state.file || state.tune.elements.source.value) || !["idle", "playing", "error"].includes(state.phase);
}

async function generateFromTuner() {
  const source = state.tune.elements.source.value;
  stopLoop();
  $("error").hidden = true;
  if (source) {
    setPhase("decoding", `Loading audio/${source}…`);
    try {
      if (!state.context || state.context.state === "closed") state.context = new AudioContext();
      await state.context.resume();
      const response = await fetch(`/samples/${encodeURIComponent(source)}`);
      if (!response.ok) throw new Error(`Could not load audio/${source}.`);
      const samples = toMono(await state.context.decodeAudioData(await response.arrayBuffer()));
      if (samples.length < state.context.sampleRate) throw new Error(`audio/${source} is shorter than one second.`);
      state.file = new File([encodeWav(samples, state.context.sampleRate)], "sample.wav", { type: "audio/wav" });
      drawWaveform(samples);
    } catch (error) {
      fail(error.name === "EncodingError" ? `This browser cannot decode audio/${source}. Convert it to WAV.` : error.message);
      return;
    }
  }
  await generate();
}

function syncOutputs() {
  state.tune.elements.seconds.disabled = state.tune.elements.match_input.checked;
  for (const input of state.tune.querySelectorAll("input[type=range]")) input.previousElementSibling.querySelector("output").value = input.value;
}

function readSettings() {
  const fields = state.tune.elements;
  return { prompt: fields.prompt.value, negative_prompt: fields.negative_prompt.value, seconds: +fields.seconds.value, strength: +fields.strength.value, steps: +fields.steps.value, cfg: +fields.cfg.value, input_mix: +fields.input_mix.value, seed: +fields.seed.value, repeat: fields.repeat.checked, match_input: fields.match_input.checked };
}

async function loadSettings() {
  try {
    const response = await fetch("/api/settings");
    if (!response.ok) throw new Error();
    for (const [name, value] of Object.entries(await response.json())) {
      const field = state.tune.elements[name];
      if (field?.type === "checkbox") field.checked = value;
      else if (field) field.value = value;
    }
    syncOutputs();
    $("tune-status").textContent = "Loaded saved defaults.";
  } catch {
    $("tune-status").textContent = "Could not load saved settings.";
  }
}

async function saveSettings() {
  try {
    const response = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(readSettings()) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : `Save failed (${response.status}).`);
    $("tune-status").textContent = "Saved. The one-button studio now uses these settings.";
  } catch (error) {
    $("tune-status").textContent = error.message;
  }
}

if (new URLSearchParams(window.location.search).has("tune")) mountTuner();
$("record").addEventListener("click", () => state.phase === "recording" ? finishRecording() : startRecording());
window.addEventListener("pageshow", (event) => { if (event.persisted) window.location.reload(); });
window.addEventListener("pagehide", () => {
  state.disposed = true;
  clearTimeout(state.statusTimer);
  state.request?.abort();
  stopLoop();
  releaseMicrophone();
  if (state.context && state.context.state !== "closed") void state.context.close();
});
drawWaveform();
void checkEngine();
