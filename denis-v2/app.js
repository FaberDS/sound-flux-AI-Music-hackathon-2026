import { clamp, frequencyFromNote, nearestNote, rms } from "./music.js";

const $ = (id) => document.getElementById(id);
const screens = [$("profile-screen"), $("welcome-screen"), $("studio-screen")];
const state = { profile: null, mode: null, audio: null, mic: null, analyser: null, listening: false, accompaniment: null, lastVoiceAt: 0, lastClapAt: 0, beat: 0 };

function show(screen) { screens.forEach((item) => item.classList.toggle("hidden", item !== screen)); }
function status(text) { $("device-status").textContent = text; }
function ensureAudio() {
  if (!state.audio) state.audio = new AudioContext();
  state.audio.resume().catch(() => {});
  return state.audio;
}

function makeProfile() {
  return {
    name: $("person-name").value.trim(), songs: $("songs").value.trim(), style: $("music-style").value.trim(),
    instruments: $("instruments").value.trim(), background: $("background").value.trim(), memory: $("memory").value.trim(),
  };
}

function voice(message) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(message));
}

function tone(note, seconds = 0.45, instrument = "piano", volume = .12, at = ensureAudio().currentTime) {
  const ctx = ensureAudio();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = instrument === "flute" ? "triangle" : instrument === "bell" ? "sine" : "sine";
  oscillator.frequency.setValueAtTime(frequencyFromNote(note), at);
  gain.gain.setValueAtTime(.0001, at);
  gain.gain.linearRampToValueAtTime(volume, at + .04);
  gain.gain.exponentialRampToValueAtTime(.0001, at + seconds);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(at); oscillator.stop(at + seconds + .02);
}

function drum(volume = .35, at = ensureAudio().currentTime) {
  const ctx = ensureAudio();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.frequency.setValueAtTime(110, at); oscillator.frequency.exponentialRampToValueAtTime(50, at + .16);
  gain.gain.setValueAtTime(volume, at); gain.gain.exponentialRampToValueAtTime(.001, at + .2);
  oscillator.connect(gain).connect(ctx.destination); oscillator.start(at); oscillator.stop(at + .21);
}

function pad(sound) {
  const notes = { piano: 64, flute: 69, bell: 72 };
  if (sound === "drum") drum(); else tone(notes[sound], .55, sound);
  $("companion-status").textContent = `Lovely. The ${sound} is part of the music.`;
}

function startAccompaniment() {
  if (state.accompaniment) return;
  ensureAudio();
  const progression = state.mode === "familiar" ? [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]] : [[60, 64, 67], [62, 65, 69], [57, 60, 64], [55, 59, 62]];
  state.beat = 0;
  state.accompaniment = setInterval(() => {
    const chord = progression[Math.floor(state.beat / 2) % progression.length];
    chord.forEach((note) => tone(note, 1.7, "piano", .035));
    if (state.beat % 2 === 0) drum(.09);
    state.beat += 1;
  }, 900);
  $("play-button").textContent = "Accompaniment playing";
  $("play-button").disabled = true;
  $("companion-status").textContent = "The music is playing gently with you.";
}

function stopAccompaniment() {
  clearInterval(state.accompaniment); state.accompaniment = null;
}

function estimatePitch(samples, sampleRate) {
  let bestLag = 0; let bestScore = .55;
  for (let lag = Math.floor(sampleRate / 1000); lag < Math.floor(sampleRate / 70); lag += 1) {
    let score = 0;
    for (let i = 0; i < samples.length - lag; i += 1) score += samples[i] * samples[i + lag];
    score /= samples.length - lag;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  return bestLag ? sampleRate / bestLag : null;
}

function watchMicrophone() {
  if (!state.listening) return;
  const ctx = ensureAudio();
  const samples = new Float32Array(state.analyser.fftSize);
  state.analyser.getFloatTimeDomainData(samples);
  const level = rms([...samples]);
  $("sound-level").style.width = `${clamp(level * 700, 3, 100)}%`;
  const now = performance.now();
  if (level > .16 && now - state.lastClapAt > 450) {
    drum(clamp(level * 1.5, .25, .65)); state.lastClapAt = now;
    $("voice-status").textContent = "I heard a clap — it became a beat.";
  } else if (level > .025 && now - state.lastVoiceAt > 600) {
    const note = nearestNote(estimatePitch(samples, ctx.sampleRate));
    if (note) { tone(note, .55, "flute", .06); state.lastVoiceAt = now; $("voice-status").textContent = "I hear your melody — the flute is answering."; }
  }
  requestAnimationFrame(watchMicrophone);
}

async function toggleMicrophone() {
  if (state.listening) {
    state.mic?.getTracks().forEach((track) => track.stop());
    state.mic = null; state.listening = false; $("microphone-button").innerHTML = "<span>◎</span> Start listening";
    $("voice-status").textContent = "Microphone is off"; return;
  }
  ensureAudio(); // runs within the click that requests microphone permission
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("Microphone needs http://localhost:8000 or https.");
  state.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  state.analyser = ensureAudio().createAnalyser(); state.analyser.fftSize = 1024;
  ensureAudio().createMediaStreamSource(state.mic).connect(state.analyser);
  state.listening = true; $("microphone-button").innerHTML = "<span>◉</span> Stop listening";
  $("voice-status").textContent = "Listening for humming, singing, or clapping…"; status("Microphone connected"); watchMicrophone();
}

function startSession(mode) {
  ensureAudio(); // create sound access while this button click remains trusted
  state.mode = mode;
  const { name, songs, memory, style } = state.profile;
  $("session-kind").textContent = mode === "familiar" ? "FAMILIAR MUSIC" : "SOMETHING NEW";
  $("session-title").textContent = mode === "familiar" ? `Music for ${name}` : `Let's make something, ${name}.`;
  $("memory-line").textContent = mode === "familiar"
    ? (songs ? `Inspired by music you love: ${songs}.` : "A gentle, familiar-feeling accompaniment.")
    : `An original musical space${style ? ` with a ${style} feeling` : ""}.`;
  $("companion-status").textContent = memory ? `We can make something for: ${memory}.` : "A gentle accompaniment is ready.";
  $("play-button").textContent = "Play accompaniment";
  $("play-button").disabled = false;
  $("microphone-button").innerHTML = "<span>◎</span> Start listening";
  $("voice-status").textContent = "Microphone is off";
  $("sound-level").style.width = "3%";
  show($("studio-screen"));
}

$("profile-form").addEventListener("submit", (event) => {
  event.preventDefault(); state.profile = makeProfile(); $("welcome-title").textContent = `Hello, ${state.profile.name}.`;
  $("familiar-copy").textContent = state.profile.songs || "A gentle musical companion";
  show($("welcome-screen"));
});
$("familiar-button").addEventListener("click", () => startSession("familiar"));
$("new-button").addEventListener("click", () => startSession("new"));
$("listen-button").addEventListener("click", () => voice(`Hello ${state.profile.name}. Would you like to create something new, or start with music you already love?`));
$("microphone-button").addEventListener("click", () => toggleMicrophone().catch((error) => { $("voice-status").textContent = error.message.includes("localhost") ? error.message : "Microphone permission was not granted. You can still tap the instruments."; status("Microphone unavailable"); }));
$("play-button").addEventListener("click", startAccompaniment);
$("end-button").addEventListener("click", () => { state.listening = false; state.mic?.getTracks().forEach((track) => track.stop()); state.mic = null; stopAccompaniment(); window.speechSynthesis?.cancel(); if (state.audio) state.audio.close(); state.audio = null; status("Ready when you are"); show($("welcome-screen")); });
document.querySelectorAll(".pad").forEach((button) => button.addEventListener("click", () => pad(button.dataset.sound)));
document.addEventListener("keydown", (event) => { if (event.code === "Space" && !$("studio-screen").classList.contains("hidden")) { event.preventDefault(); drum(); } });
