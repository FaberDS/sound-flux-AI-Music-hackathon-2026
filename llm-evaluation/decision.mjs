export const decisionModels = Object.freeze({
  'qwen3-0.6b': {
    name: 'Qwen3 0.6B',
    size: '639 MB',
    url: 'https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/23749fefcc72300e3a2ad315e1317431b06b590a/Qwen3-0.6B-Q8_0.gguf',
    labelBase: 32,
  },
  'minicpm5-2b': {
    name: 'MiniCPM5 2B',
    size: '1.56 GB',
    url: 'https://huggingface.co/openbmb/MiniCPM5-2B-GGUF/resolve/2079a22f3beaa4e306449978533478fe0522f4b3/MiniCPM5-2B-Q4_K_M.gguf',
    labelBase: 54,
  },
});

export const memoryOptions = Object.freeze([
  'MERKEN — für spätere Gespräche',
  'NUR IM AKTUELLEN GESPRÄCH — für die laufende Aufgabe',
  'NICHT RELEVANT — weder jetzt noch später',
]);

const memoryQuestion = 'Wie soll die neue Aussage für den Gesprächskontext behandelt werden?';

export const decisionPresets = Object.freeze({
  termin: {
    state: `Aktuelles Ziel: Den Alltag und anstehende Termine unterstützen.

Neue Aussage: „Am 17. Oktober um 9 Uhr habe ich einen Termin bei Frau Dr. Berger. Bitte erinnere mich am Vorabend daran.“

Kontext: Die Person bittet ausdrücklich darum, die Information später wieder zu verwenden.`,
    question: memoryQuestion,
    options: memoryOptions,
  },
  anrede: {
    state: `Aktuelles Ziel: Die Person bei zukünftigen Gesprächen passend ansprechen.

Neue Aussage: „Ich heiße Hannelore Meier. Bitte nennen Sie mich immer Frau Meier und erklären Sie technische Dinge langsam in kurzen Schritten.“

Kontext: Die Person beschreibt eine dauerhafte Anrede- und Kommunikationspräferenz.`,
    question: memoryQuestion,
    options: memoryOptions,
  },
  nachricht: {
    state: `Aktuelles Ziel: Jetzt eine kurze Nachricht an die Enkelin formulieren.

Neue Aussage: „Schreib bitte, dass ich heute ungefähr zehn Minuten später komme.“

Kontext: Die Angabe wird nur für diese eine Nachricht benötigt.`,
    question: memoryQuestion,
    options: memoryOptions,
  },
  einkauf: {
    state: `Aktuelles Ziel: Eine Einkaufsliste für heute erstellen.

Neue Aussage: „Für den Einkauf heute brauche ich Milch, Brot und zwei Äpfel.“

Kontext: Nach Abschluss des heutigen Einkaufs wird die Liste nicht mehr benötigt.`,
    question: memoryQuestion,
    options: memoryOptions,
  },
  nebensache: {
    state: `Aktuelles Ziel: Gemeinsam den nächsten Arzttermin planen.

Neue Aussage: „Im Fernsehen trägt der Nachrichtensprecher gerade eine blaue Krawatte.“

Kontext: Die Beobachtung hat keinen Bezug zur Terminplanung oder zu einem späteren Wunsch.`,
    question: memoryQuestion,
    options: memoryOptions,
  },
});

export function labelsFor(count) {
  if (!Number.isInteger(count) || count < 2 || count > 6) throw new Error('Verwende 2–6 Entscheidungsoptionen.');
  return Array.from({ length: count }, (_, index) => String.fromCharCode(65 + index));
}

export function buildDecisionPayload(state, question, options) {
  const cleanState = String(state ?? '').trim();
  const cleanQuestion = String(question ?? '').trim();
  const cleanOptions = Array.isArray(options) ? options.map(option => String(option ?? '').trim()) : [];
  labelsFor(cleanOptions.length);
  if (!cleanState || cleanState.length > 4000) throw new Error('Die Situation muss 1–4.000 Zeichen enthalten.');
  if (!cleanQuestion || cleanQuestion.length > 300) throw new Error('Die Frage muss 1–300 Zeichen enthalten.');
  if (cleanOptions.some(option => !option || option.length > 240)) throw new Error('Jede Option muss 1–240 Zeichen enthalten.');
  if (new Set(cleanOptions.map(option => option.toLowerCase())).size !== cleanOptions.length) throw new Error('Die Entscheidungsoptionen müssen eindeutig sein.');
  return { state: cleanState, question: cleanQuestion, options: cleanOptions };
}

export function decisionMessages(payload) {
  const data = buildDecisionPayload(payload.state, payload.question, payload.options);
  const labels = labelsFor(data.options.length);
  const optionBlock = data.options.map((option, index) => `${labels[index]}. ${option}`).join('\n');
  return [
    { role: 'system', content: 'Triff die gewünschte Entscheidung nur anhand der angegebenen Situation. Halte das Ausgabeformat genau ein.' },
    { role: 'user', content: `Situation:\n${data.state}\n\nFrage:\n${data.question}\n\nErlaubte Antworten:\n${optionBlock}\n\nAntworte ausschließlich mit genau einem dieser Buchstaben: ${labels.join(', ')}.` },
  ];
}

export function softmax(values) {
  if (!values.length || values.some(value => !Number.isFinite(value))) throw new Error('Die Entscheidungswerte müssen endlich sein.');
  const maximum = Math.max(...values);
  const exponents = values.map(value => Math.exp(value - maximum));
  const total = exponents.reduce((sum, value) => sum + value, 0);
  return exponents.map(value => value / total);
}

export function initDecisionDemo(root = document) {
  const $ = selector => root.querySelector(selector);
  const model = $('#decision-model');
  const loadButton = $('#decision-load');
  const runButton = $('#decision-run');
  const addButton = $('#decision-add-option');
  const status = $('#decision-status');
  const progress = $('#decision-progress');
  const progressTrack = $('#decision-progress-track');
  const state = $('#decision-state');
  const question = $('#decision-question');
  const optionList = $('#decision-options');
  const results = $('#decision-results');
  const heading = $('#decision-result-heading');
  const summary = $('#decision-result-summary');
  const metrics = $('#decision-metrics');
  let worker;
  let loadedModel = '';
  let loading = false;
  let running = false;
  let options = [...decisionPresets.termin.options];

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function setControls() {
    model.disabled = loading || running;
    loadButton.disabled = loading || running;
    addButton.disabled = running || options.length >= 6;
    runButton.disabled = loading || running || loadedModel !== model.value;
  }

  function readOptions() {
    return [...optionList.querySelectorAll('input')].map(input => input.value);
  }

  function renderOptions(nextOptions, focus = -1) {
    options = nextOptions;
    optionList.replaceChildren();
    labelsFor(options.length).forEach((label, index) => {
      const row = document.createElement('div');
      row.className = 'grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2';
      const badge = document.createElement('strong');
      badge.className = 'text-center text-brown';
      badge.textContent = label;
      const input = document.createElement('input');
      input.value = options[index];
      input.maxLength = 240;
      input.setAttribute('aria-label', `Entscheidungsoption ${label}`);
      input.addEventListener('input', () => { options = readOptions(); });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Entscheidungsoption ${label} entfernen`);
      remove.disabled = options.length <= 2;
      remove.addEventListener('click', () => {
        const next = readOptions();
        next.splice(index, 1);
        renderOptions(next, Math.min(index, next.length - 1));
      });
      row.append(badge, input, remove);
      optionList.append(row);
    });
    setControls();
    if (focus >= 0) optionList.querySelectorAll('input')[focus]?.focus();
  }

  function applyPreset(name) {
    const preset = decisionPresets[name];
    state.value = preset.state;
    question.value = preset.question;
    renderOptions([...preset.options]);
    results.replaceChildren();
    heading.textContent = 'Bereit für die Entscheidung';
    summary.textContent = 'Dieses Beispiel auswerten oder zuerst beliebig anpassen.';
  }

  function bytes(value) {
    return value >= 1e9 ? `${(value / 1e9).toFixed(2)} GB` : `${Math.round(value / 1e6)} MB`;
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./decision-worker.mjs', import.meta.url), { type: 'module' });
    worker.addEventListener('error', event => {
      loading = running = false;
      setControls();
      setStatus(`Die lokale Laufzeit konnte nicht starten. „npm ci“ ausführen und neu laden. ${event.message || ''}`.trim(), true);
    });
    worker.addEventListener('message', ({ data }) => {
      if (data.type === 'progress' && Number.isFinite(data.loaded) && Number.isFinite(data.total) && data.total > 0) {
        const percent = Math.min(100, data.loaded / data.total * 100);
        progress.style.width = `${percent}%`;
        progressTrack.setAttribute('aria-valuenow', String(Math.round(percent)));
        setStatus(`Modell wird geladen: ${Math.round(percent)} % · ${bytes(data.loaded)} von ${bytes(data.total)}`);
      }
      if (data.type === 'loading') setStatus(data.message);
      if (data.type === 'ready') {
        loading = false;
        loadedModel = data.modelId;
        progress.style.width = '100%';
        progressTrack.setAttribute('aria-valuenow', '100');
        loadButton.textContent = 'Modell bereit';
        metrics.textContent = `Modell       ${data.modelName}\nLaufzeit     ${data.runtime}\nLaden        ${(data.loadMs / 1000).toFixed(2)} s\nAufwärmen    ${(data.warmupMs / 1000).toFixed(2)} s\nKontext      2.048 Token`;
        setStatus(`${data.modelName} ist über ${data.runtime} bereit. Alle Entscheidungen bleiben auf diesem Gerät.`);
        setControls();
      }
      if (data.type === 'result') {
        running = false;
        renderResult(data);
        setControls();
      }
      if (data.type === 'error') {
        loading = running = false;
        setControls();
        setStatus(data.message, true);
        heading.textContent = 'Entscheidung fehlgeschlagen';
        summary.textContent = data.message;
      }
    });
    return worker;
  }

  function renderResult(data) {
    const winner = data.options.reduce((best, item) => item.probability > best.probability ? item : best);
    const shortWinner = winner.description.split(/\s+[—–-]\s+/)[0];
    heading.textContent = shortWinner;
    summary.textContent = shortWinner === 'MERKEN'
      ? 'Als mögliche Erinnerung behandeln und nur mit Zustimmung dauerhaft speichern.'
      : shortWinner === 'NUR IM AKTUELLEN GESPRÄCH'
        ? 'Für die laufende Aufgabe verwenden und danach nicht in den Langzeitkontext übernehmen.'
        : 'Nicht in den Kontext übernehmen; wichtige Informationen müssen zusätzlich durch feste Regeln geschützt sein.';
    results.replaceChildren(...data.options.map(item => {
      const row = document.createElement('div');
      row.className = `rounded-2xl border p-4 ${item === winner ? 'border-brown bg-sage' : 'border-line'}`;
      const line = document.createElement('div');
      line.className = 'flex items-start justify-between gap-3';
      const label = document.createElement('span');
      label.className = 'font-semibold';
      label.textContent = `${item.label} · ${item.description}`;
      const score = document.createElement('strong');
      score.className = 'shrink-0 text-brown';
      score.textContent = `${Math.round(item.probability * 100)}%`;
      const bar = document.createElement('div');
      bar.className = 'mt-3 h-2 overflow-hidden rounded-full bg-white';
      const fill = document.createElement('div');
      fill.className = 'h-full rounded-full bg-orange';
      fill.style.width = `${Math.max(1, item.probability * 100)}%`;
      line.append(label, score);
      bar.append(fill);
      row.append(line, bar);
      return row;
    }));
    metrics.textContent = `Modell       ${data.modelName}\nLaufzeit     ${data.runtime}\nEntscheidung ${(data.totalMs / 1000).toFixed(3)} s\nEingabe      ${data.inputTokens} Token\nAusgabe      1 begrenzte Auswahl\nSicherheit   bedingt, nicht kalibriert`;
    setStatus(`Lokale Entscheidung in ${(data.totalMs / 1000).toFixed(2)} Sekunden abgeschlossen.`);
  }

  loadButton.addEventListener('click', () => {
    if (loading || running) return;
    loading = true;
    loadedModel = '';
    progress.style.width = '0%';
    progressTrack.setAttribute('aria-valuenow', '0');
    loadButton.textContent = 'Wird geladen…';
    heading.textContent = 'Lokales Modell wird geladen';
    summary.textContent = 'Beim ersten Mal werden die Modelldaten geladen. Danach nutzt der Browser seinen Zwischenspeicher.';
    setControls();
    ensureWorker().postMessage({ type: 'load', modelId: model.value });
  });
  runButton.addEventListener('click', () => {
    if (running || loadedModel !== model.value) return;
    try {
      const payload = buildDecisionPayload(state.value, question.value, readOptions());
      running = true;
      setControls();
      heading.textContent = 'Wird ausgewertet…';
      summary.textContent = 'Das lokale Modell bewertet ausschließlich die drei angegebenen Möglichkeiten.';
      results.replaceChildren();
      ensureWorker().postMessage({ type: 'decide', payload });
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  model.addEventListener('change', () => {
    loadButton.textContent = loadedModel === model.value ? 'Modell bereit' : 'Lokales Modell laden';
    if (loadedModel !== model.value) setStatus(`${decisionModels[model.value].name} vor der Auswertung laden.`);
    setControls();
  });
  addButton.addEventListener('click', () => {
    const next = readOptions();
    if (next.length < 6) renderOptions([...next, 'Neue Entscheidungsoption'], next.length);
  });
  root.querySelectorAll('[data-decision-preset]').forEach(button => {
    button.addEventListener('click', () => applyPreset(button.dataset.decisionPreset));
  });

  renderOptions(options);
  const runtime = navigator.gpu ? 'WebGPU ist verfügbar.' : 'WebGPU ist nicht verfügbar; die langsamere WASM-Variante wird verwendet.';
  setStatus(`Das Modell einmal laden und im Browser speichern. ${runtime}`);
  return { destroy: () => worker?.terminate() };
}
