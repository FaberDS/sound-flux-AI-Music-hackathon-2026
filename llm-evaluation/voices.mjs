import { daytimeGreeting } from './time-context.mjs';

export const supertonicVoices = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'];
export const greetingPhrase = () => `${daytimeGreeting()}! Ich bin Tante Emma. Schön, dass du da bist. Wie geht es dir heute?`;
export const germanPhrases = [
  ['Begrüßung', greetingPhrase()],
  ['In Ruhe erzählen', 'Wir haben Zeit und können in Ruhe miteinander sprechen. Was möchtest du mir erzählen?'],
  ['Freude teilen', 'Das klingt nach einem schönen Erlebnis! Was hat dir daran besonders gut gefallen?'],
  ['Zuhören', 'Das tut mir leid. Ich höre dir zu. Magst du erzählen, was dich gerade beschäftigt?'],
  ['Musik und Erinnerungen', 'Manche Lieder erinnern uns an ganz besondere Momente. Welches Lied hörst du besonders gern?'],
  ['Nachfragen', 'Ich habe dich noch nicht ganz verstanden. Kannst du das bitte noch einmal mit anderen Worten sagen?'],
  ['Umlaute und Aussprache', 'Draußen blühen die schönsten Blumen. Über die Brücke führt ein schmaler Weg zum gemütlichen Café.'],
  ['Zahlen und Uhrzeit', 'Wir treffen uns am Donnerstag, dem 24. September, um 15:30 Uhr. Bring bitte zwei Äpfel und drei Brötchen mit.'],
  ['Verabschiedung', 'Danke für unser Gespräch. Ich wünsche dir einen schönen Abend. Bis zum nächsten Mal!'],
];

export function voiceRequest(voice, text) {
  if (!supertonicVoices.includes(voice)) throw new Error('Bitte eine der zehn Supertonic-Stimmen wählen.');
  if (typeof text !== 'string' || !text.trim() || text.length > 1000) {
    throw new Error('Bitte einen Text mit 1–1.000 Zeichen eingeben.');
  }
  return { voice, text: text.trim() };
}

export function initVoicesDemo() {
  const $ = selector => document.querySelector(selector);
  const phrase = $('#voices-phrase');
  const text = $('#voices-text');
  const audio = $('#voices-audio');
  const status = $('#voices-status');
  const buttons = [];
  let pending = null;
  let audioUrl = null;

  for (const [index, [label]] of germanPhrases.entries()) phrase.add(new Option(label, String(index)));
  phrase.add(new Option('Eigener Text', 'custom'));
  text.value = germanPhrases[0][1];

  function updateButtons() {
    for (const button of buttons) button.disabled = !!pending || !text.value.trim();
    $('#voices-stop').disabled = !pending && audio.paused;
  }
  function stop() {
    const active = pending || !audio.paused;
    pending?.abort();
    pending = null;
    audio.pause();
    if (active) status.textContent = 'Gestoppt.';
    updateButtons();
  }
  function clearAudio() {
    audio.removeAttribute('src');
    audio.load();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null;
    $('#voices-result').hidden = true;
  }
  async function speak(voice) {
    let body;
    try { body = voiceRequest(voice, text.value); }
    catch (error) { status.textContent = error.message; return; }
    stop();
    clearAudio();
    const request = new AbortController();
    pending = request;
    updateButtons();
    status.textContent = `${voice} wird vorbereitet … Beim ersten Mal werden die Sprachdateien heruntergeladen.`;
    try {
      const response = await fetch('/api/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: request.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Sprachserver nicht verfügbar (HTTP ${response.status}). Bitte den Evaluationsserver neu starten.`);
      }
      if (!response.headers.get('Content-Type')?.startsWith('audio/wav')) throw new Error('Der Sprachserver hat keine WAV-Datei geliefert.');
      const blob = await response.blob();
      if (pending !== request) return;
      const source = URL.createObjectURL(blob);
      audioUrl = source;
      audio.src = source;
      $('#voices-caption').textContent = `Supertonic 3 · ${voice} · Deutsch`;
      $('#voices-spoken-text').textContent = body.text;
      $('#voices-result').hidden = false;
      status.textContent = `${voice} ist bereit.`;
      try { await audio.play(); }
      catch { if (pending === request) status.textContent = `${voice} ist bereit. Zum Anhören im Audioplayer auf Play drücken.`; }
      if (pending !== request && audio.src === source) audio.pause();
    } catch (error) {
      if (pending === request) status.textContent = `Vorlesen fehlgeschlagen: ${error.message}`;
    } finally {
      if (pending === request) { pending = null; updateButtons(); }
    }
  }
  for (const voice of supertonicVoices) {
    const card = document.createElement('article');
    card.className = 'card space-y-3';
    const heading = document.createElement('h3');
    heading.className = 'text-xl font-bold text-brown';
    heading.textContent = voice;
    const description = document.createElement('p');
    description.className = 'text-sm text-muted';
    description.textContent = voice.startsWith('F') ? 'Weibliche Stimme' : 'Männliche Stimme';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'w-full';
    button.textContent = `${voice} vorlesen`;
    button.onclick = () => void speak(voice);
    buttons.push(button);
    card.append(heading, description, button);
    $('#voices-list').append(card);
  }
  phrase.onchange = () => {
    if (phrase.value === 'custom') { text.focus(); return; }
    stop();
    clearAudio();
    text.value = germanPhrases[Number(phrase.value)][1];
    status.textContent = 'Beispiel geladen. Wähle eine Stimme zum Vorlesen.';
    updateButtons();
  };
  text.oninput = () => { stop(); clearAudio(); phrase.value = 'custom'; updateButtons(); };
  audio.onplay = audio.onpause = audio.onended = updateButtons;
  audio.onerror = () => { status.textContent = 'Die Stimmprobe konnte nicht abgespielt werden. Bitte erneut vorlesen lassen.'; updateButtons(); };
  $('#voices-stop').onclick = stop;
  return { stop, destroy() { stop(); clearAudio(); } };
}
