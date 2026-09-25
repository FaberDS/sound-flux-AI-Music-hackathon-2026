import { germanPhrases, greetingPhrase, supertonicVoices, voiceRequest } from './voices.mjs';

export const agentStates = {
  idle: ['Bereit für ein Gespräch', 'Welche Musik magst du?'],
  preparing: ['Stimme wird vorbereitet', 'Einen Moment, bitte.'],
  listening: ['Ich höre zu', 'Du kannst jetzt sprechen.'],
  speaking: ['Deine Musikassistenz spricht', 'Du kannst unten mitlesen.'],
  paused: ['Sprechen pausiert', 'Mit Play geht es weiter.'],
  creating: ['Deine Musik entsteht', 'Du kannst in Ruhe warten.'],
  ready: ['Deine Musik ist bereit', 'Du entscheidest, wann es losgeht.'],
};

export function speechLevel(samples) {
  if (!samples.length) return 0;
  return Math.min(1, Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length) * 6);
}

export function initAgentDemo() {
  const $ = selector => document.querySelector(selector);
  const root = $('#agent-panel');
  const audio = $('#agent-audio');
  const text = $('#agent-text');
  const phrase = $('#agent-phrase');
  const voice = $('#agent-voice');
  const status = $('#agent-status');
  const motion = $('#agent-reduced-motion');
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  let active = null;
  let audioUrl = null;
  let context = null;
  let analyser = null;
  let samples = null;
  let frame = 0;
  let currentText = '';

  germanPhrases.forEach(([label], index) => phrase.add(new Option(label, String(index))));
  phrase.add(new Option('Eigener Text', 'custom'));
  text.value = germanPhrases[0][1];
  supertonicVoices.forEach(id => voice.add(new Option(`${id} · ${id.startsWith('F') ? 'weiblich' : 'männlich'}`, id)));

  const icons = {
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
    note: '<path d="M9 18V5l11-3v13M9 8l11-3"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="15" rx="3" ry="2"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
  };
  root.querySelectorAll('.agent-art').forEach((svg, index) => {
    const [x, y] = [[139, 46], [88, 65], [152, 69]][index];
    for (const [name, paths] of Object.entries(icons)) {
      svg.insertAdjacentHTML('beforeend', `<g class="agent-state-mark agent-${name}" transform="translate(${x} ${y})" stroke-width="2.5" stroke="#965033">${paths}</g>`);
    }
  });

  function setState(state) {
    root.dataset.state = state;
    root.querySelectorAll('[data-agent-title]').forEach(el => { el.textContent = agentStates[state][0]; });
    root.querySelectorAll('[data-agent-hint]').forEach(el => { el.textContent = agentStates[state][1]; });
    root.querySelectorAll('[data-agent-state]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.agentState === state)));
  }
  function showCaption(speaker, caption) {
    $('#agent-transcript').hidden = false;
    $('#agent-speaker').textContent = speaker;
    $('#agent-caption').textContent = caption;
  }
  function buttons() {
    $('#agent-speak').disabled = !!active || !text.value.trim();
    $('#agent-conversation').disabled = !!active;
    $('#agent-stop').disabled = !active && audio.paused;
  }
  function animate() {
    cancelAnimationFrame(frame);
    if (audio.paused || audio.ended || motion.checked || motionPreference.matches || !analyser) {
      root.style.setProperty('--agent-level', '0');
      return;
    }
    analyser.getFloatTimeDomainData(samples);
    root.style.setProperty('--agent-level', String(speechLevel(samples)));
    frame = requestAnimationFrame(animate);
  }
  function updateMotion() {
    root.dataset.reducedMotion = String(motion.checked || motionPreference.matches);
    animate();
  }
  motion.checked = motionPreference.matches;
  motion.onchange = updateMotion;
  motionPreference.addEventListener('change', updateMotion);
  updateMotion();

  function clearAudio() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio.hidden = true;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }
  function stop() {
    const wasActive = !!active || !audio.paused;
    active?.abort();
    active = null;
    clearAudio();
    cancelAnimationFrame(frame);
    root.style.setProperty('--agent-level', '0');
    setState('idle');
    $('#agent-transcript').hidden = true;
    if (wasActive) status.textContent = 'Gestoppt. Du kannst ein anderes Beispiel auswählen.';
    buttons();
  }
  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  async function speakLine(line, selectedVoice, signal) {
    signal.throwIfAborted();
    clearAudio();
    setState('preparing');
    status.textContent = 'Supertonic bereitet die Stimme vor. Beim ersten Mal kann das Laden länger dauern.';
    const response = await fetch('/api/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(voiceRequest(selectedVoice, line)), signal,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Sprachausgabe nicht verfügbar (HTTP ${response.status}). Bitte den Laborserver starten.`);
    }
    if (!response.headers.get('Content-Type')?.startsWith('audio/wav')) throw new Error('Der Sprachserver hat keine WAV-Datei geliefert.');
    const blob = await response.blob();
    signal.throwIfAborted();
    currentText = line;
    audioUrl = URL.createObjectURL(blob);
    audio.src = audioUrl;
    audio.hidden = false;
    showCaption('Musikassistenz · gesprochener Text', line);
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        audio.removeEventListener('ended', ended);
        audio.removeEventListener('error', failed);
        signal.removeEventListener('abort', aborted);
      };
      const ended = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('Die Sprachausgabe konnte nicht abgespielt werden. Bitte erneut versuchen.')); };
      const aborted = () => { cleanup(); reject(signal.reason); };
      audio.addEventListener('ended', ended, { once: true });
      audio.addEventListener('error', failed, { once: true });
      signal.addEventListener('abort', aborted, { once: true });
      audio.play().catch(() => {
        if (signal.aborted) return;
        setState('paused');
        status.textContent = 'Die Stimme ist bereit. Bitte im Audioplayer auf Play drücken.';
      });
    });
  }
  async function start(conversation) {
    stop();
    let request;
    try { request = voiceRequest(voice.value, conversation ? greetingPhrase() : text.value); }
    catch (error) { status.textContent = error.message; return; }
    const controller = new AbortController();
    active = controller;
    buttons();
    root.scrollIntoView({ block: 'start' });
    try {
      // Resume on the click so Safari can unlock audio before the TTS request.
      if (!context) {
        context = new AudioContext();
        analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        samples = new Float32Array(analyser.fftSize);
        context.createMediaElementSource(audio).connect(analyser);
        analyser.connect(context.destination);
      }
      await context.resume();
      controller.signal.throwIfAborted();
      await speakLine(request.text, request.voice, controller.signal);
      if (conversation) {
        clearAudio();
        setState('listening');
        showCaption('Du · Beispielantwort, nur als Text', 'Ich hätte gern einen ruhigen Walzer.');
        status.textContent = 'Zuhören als Vorschau. Es ist kein Mikrofon eingeschaltet.';
        await wait(3500, controller.signal);
        await speakLine('Gern. Ich bereite einen ruhigen Walzer für dich vor. Du kannst in Ruhe warten.', request.voice, controller.signal);
        clearAudio();
        setState('creating');
        status.textContent = 'Musikerstellung als Vorschau. Es wird keine Musik erzeugt.';
        await wait(4000, controller.signal);
        setState('ready');
        status.textContent = 'Gesprächsvorschau beendet. Die Musik ist in diesem Entwurf nur dargestellt.';
      } else {
        setState('listening');
        status.textContent = 'Satz beendet. Zuhören als Vorschau; kein Mikrofon aktiv.';
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        clearAudio();
        setState('idle');
        status.textContent = `Vorlesen fehlgeschlagen: ${error.message}`;
      }
    } finally {
      if (active === controller) { active = null; buttons(); }
    }
  }
  audio.onplaying = () => {
    void context?.resume().catch(() => {});
    setState('speaking');
    showCaption('Musikassistenz · gesprochener Text', currentText);
    status.textContent = 'Die Sprechzeichen folgen der tatsächlichen Lautstärke. Stoppen ist jederzeit möglich.';
    animate();
    buttons();
  };
  audio.onpause = () => { animate(); if (audio.hasAttribute('src') && !audio.ended) setState('paused'); buttons(); };
  audio.onended = () => { animate(); setState('listening'); buttons(); };
  audio.onwaiting = () => { cancelAnimationFrame(frame); root.style.setProperty('--agent-level', '0'); if (audio.hasAttribute('src')) setState('preparing'); };
  phrase.onchange = () => {
    stop();
    if (phrase.value === 'custom') { text.focus(); return; }
    text.value = germanPhrases[Number(phrase.value)][1];
    buttons();
  };
  text.oninput = () => { stop(); phrase.value = 'custom'; buttons(); };
  voice.onchange = stop;
  $('#agent-speak').onclick = () => void start(false);
  $('#agent-conversation').onclick = () => void start(true);
  $('#agent-stop').onclick = stop;
  root.querySelectorAll('[data-agent-state]').forEach(button => {
    button.onclick = () => { stop(); setState(button.dataset.agentState); status.textContent = 'Zustandsvorschau ohne Mikrofon oder Musikgenerierung.'; };
  });
  return { stop, destroy() { stop(); motionPreference.removeEventListener('change', updateMotion); void context?.close().catch(() => {}); } };
}
