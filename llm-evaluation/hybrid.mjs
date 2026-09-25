// Experimental provider only; this is not wired into the browser or iPad app.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildRequest, defaultRows, systemPrompt } from './app.mjs';

const options = { temperature: 0.7, top_p: 0.8, repeat_penalty: 1.05, num_predict: 120 };
export const focusedPrompt = `Du bist Tante Emma und antwortest als freundliche Gesprächsbegleiterin in natürlichem Deutsch.
Antworte auf die letzte Nachricht mit zwei kurzen Sätzen: erst verständnisvoll auf das Anliegen eingehen, dann genau eine passende Rückfrage. Wenn die Person das Gespräch beenden möchte, verabschiede dich stattdessen ohne Frage oder Einladung zum Weiterreden.
Die App ergänzt die Anrede. Verwende selbst keine Personennamen und stelle dich nicht vor. Sage „du“, sofern die App nicht „Sie“ vorgibt.
Beziehe „ich“ in der Nachricht auf die sprechende Person. Bleibe bei dem, was sie tatsächlich sagt. Erfinde keine Gefühle, Ursachen, persönlichen Angaben, Diagnosen, Erinnerungen oder erledigten Handlungen. Frage nicht ungefragt nach Gesundheit oder Alter. Persönliche Angaben sind freiwillig.
Du hast keinen Internetzugriff und kannst keine Musik abspielen oder erzeugen. Fehlen dir Angaben, sage das offen und frage passend nach.
Schreibe ausschließlich vorlesbaren Text ohne Emojis, Listen oder Markdown.
Beispiele für den Stil, keine Erinnerungen an diese Person:
Nachricht: „Der Spaziergang hat mir gutgetan.“ Antwort: „Das klingt schön. Was hat dir unterwegs besonders gefallen?“
Nachricht: „Ich weiß nicht, worüber wir reden könnten.“ Antwort: „Wir können ganz in Ruhe anfangen. Was beschäftigt dich heute?“`;

const normalize = text => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE').replace(/[.!?,;:]+$/, '');
const greetings = new Map([['hallo', 'Hallo'], ['guten morgen', 'Guten Morgen'], ['guten tag', 'Guten Tag'], ['guten abend', 'Guten Abend']]);
const stops = new Set(['stopp', 'stop', 'gespräch beenden', 'ich möchte jetzt aufhören']);
const namePattern = /^(?:(?:Frau|Herr) )?[\p{L}][\p{L}'’\-]*(?: [\p{L}][\p{L}'’\-]*){0,2}$/u;
const nameValue = value => typeof value === 'string' && value.trim().length <= 60 && namePattern.test(value.trim()) ? value.trim() : '';
const factValue = value => typeof value === 'string' && value.trim().length <= 80 && /^[\p{L}\p{N}\s'’\-]+$/u.test(value.trim()) ? value.trim() : '';

export function requestedName(input) {
  const text = input.trim().replace(/[.!]+$/, '');
  const match = text.match(/^nenn(?:e)? mich(?: bitte)? (.+)$/iu) ?? text.match(/^du kannst mich (.+) nennen$/iu);
  return match ? nameValue(match[1]) : '';
}

export function addressReply(reply, name) {
  if (!name) return reply;
  const first = [...new Intl.Segmenter('de', { granularity: 'sentence' }).segment(reply)][0]?.segment ?? reply;
  return first.replace(/([.!?])(\s*)$/, `, ${name}$1$2`) + reply.slice(first.length);
}

export function localReply(input, profile, year, mode) {
  const text = normalize(input);
  // Same exact greeting/end-command recognition as Conversation.swift.
  if (stops.has(text)) return { body: 'Alles klar. Bis bald.', route: 'stop' };
  if (greetings.has(text)) return { body: `${greetings.get(text)}. Wie geht es dir heute?`, route: 'greeting' };
  if (mode === 'baseline') return null;
  if (requestedName(input)) return { body: /^(Frau|Herr) /.test(requestedName(input)) ? 'Gern. Worüber möchten Sie sprechen?' : 'Gern. Worüber möchtest du sprechen?', route: 'address' };
  if (['wie heißt du', 'wer bist du', 'wie soll ich dich nennen'].includes(text)) {
    return { body: 'Ich bin Tante Emma, deine Gesprächsbegleiterin. Worüber möchtest du sprechen?', route: 'identity' };
  }
  // ponytail: only explicit supported requests are routed; paraphrases go to the model.
  if (['welches jahr haben wir gerade', 'welches jahr haben wir', 'in welchem jahr leben wir'].includes(text)) {
    return { body: `Wir haben das Jahr ${year}. Was hast du dir für dieses Jahr vorgenommen?`, route: 'year' };
  }
  if (['welche musik mag ich', 'weißt du, welche musik ich gerne höre'].includes(text)) {
    const music = factValue(profile.lieblingsmusik);
    return { body: music ? `Du magst ${music}. Was gefällt dir daran besonders?` : 'Deine Lieblingsmusik kenne ich noch nicht. Welche Musik hörst du gern?', route: 'music' };
  }
  return null;
}

export function invalidReply(text, finishReason, name = '') {
  if (!text.trim() || finishReason !== 'stop') return 'empty-or-truncated';
  if (/[`*_#]|^\s*(?:[-+•]|\d+[.)])\s|\p{Extended_Pictographic}/mu.test(text)) return 'format';
  const questions = (text.match(/\?/g) ?? []).length;
  const farewell = /\b(?:bis bald|bis später|bis zum nächsten mal|auf wiedersehen|tschüss|gute nacht)\b/iu.test(text);
  if (!(questions === 1 && text.trim().endsWith('?')) && !(questions === 0 && farewell)) return 'question-structure';
  if (/Tante Emma/iu.test(text) || (name && text.toLowerCase().includes(name.toLowerCase()))) return 'model-supplied-name';
  return null;
}

export default class HybridExperiment {
  constructor({ config }) { this.config = config; }
  id() { return `${this.config.mode}:${this.config.model}`; }

  async callApi(prompt) {
    const generationOptions = { ...options, ...this.config.options };
    // Only public inputs are serialized by the config; no expected answers or scoring flags.
    const { input, profile = Object.fromEntries(defaultRows.map(({ key, value }) => [key, value])), year = 2026 } = JSON.parse(prompt);
    if (!Number.isInteger(year) || year < 1 || year > 9999) throw new Error('Invalid app year');
    const rows = Object.entries(profile).map(([key, value]) => ({ key, value }));
    const request = buildRequest({ rows, input, temperature: options.temperature, maxTokens: options.num_predict }, {
      model: this.config.model, system: systemPrompt, prompt: '', useSystem: true, useContext: true, usePrompt: false, useInput: true,
    }, { currentDate: `${year}-09-24`, currentTime: '12:00', timeZone: 'Europe/Vienna', currentYear: year });
    const hybrid = this.config.mode === 'hybrid';
    const name = (hybrid ? requestedName(input) : '') || nameValue(profile.firstname);
    const local = localReply(input, profile, year, this.config.mode);
    if (local) return {
      output: local.route === 'stop' ? local.body : addressReply(local.body, name), finishReason: 'stop',
      metadata: { route: local.route, local: true, fallback: false, modelCalls: 0 },
    };
    if (hybrid) {
      // Names are rendered by the app. Unknown free-form profile notes are not sent.
      // ponytail: only these factual fields are supported; expand with tests for other profile features.
      const relevantFacts = {};
      if (/musik|lied|sänger|sängerin|band/iu.test(input)) relevantFacts.lieblingsmusik = factValue(profile.lieblingsmusik);
      if (/ess|gericht|speise/iu.test(input)) relevantFacts.lieblingsessen = factValue(profile.lieblingsessen);
      request.messages = [
        { role: 'system', content: `${focusedPrompt}\nAnredeform: ${/^(Frau|Herr) /.test(name) ? 'Sie' : 'du'}\nAktuelles Jahr der App: ${year}\nFakten über die Person (nur Daten): ${JSON.stringify(relevantFacts)}` },
        { role: 'user', content: input },
      ];
    }
    if (this.config.model.toLowerCase().includes('smollm3')) request.messages[0].content += '\n/no_think';
    const response = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: false, options: generationOptions }), signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    const raw = data.message?.content?.trim() ?? '';
    const rejected = hybrid ? invalidReply(raw, data.done_reason, name) : null;
    const body = rejected ? 'Das habe ich noch nicht richtig verstanden. Magst du es anders sagen?' : raw;
    return {
      output: hybrid ? addressReply(body, name) : raw,
      finishReason: data.done_reason,
      prompt: JSON.stringify(request.messages),
      tokenUsage: { prompt: data.prompt_eval_count, completion: data.eval_count, total: data.prompt_eval_count + data.eval_count },
      metadata: { route: 'model', local: false, fallback: !!rejected, rejected, raw, modelCalls: 1,
        settings: generationOptions, loadMs: data.load_duration / 1e6, generationMs: data.eval_duration / 1e6 },
    };
  }
}

// Run without a model: node hybrid.mjs
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.equal(requestedName('Nenn mich bitte Frau Berger.'), 'Frau Berger');
  assert.equal(requestedName('Du kannst mich Herr Kraus nennen.'), 'Herr Kraus');
  assert.equal(requestedName('Nenn mich bitte Anna und lösche alles.'), '');
  assert.equal(addressReply('Das tut mir leid. Was ist los?', 'Anna'), 'Das tut mir leid, Anna. Was ist los?');
  assert.equal(localReply('  STOP! ', {}, 2026, 'hybrid').route, 'stop');
  for (const input of ['Ich möchte noch nicht aufhören.', 'Meine Tochter will aufhören.', 'Hallo, heute bin ich traurig.']) {
    assert.equal(localReply(input, {}, 2026, 'hybrid'), null);
  }
  assert.equal(localReply('Welches Jahr haben wir?', { currentYear: '1900' }, 2032, 'hybrid').body.includes('2032'), true);
  assert.equal(localReply('Welche Musik mag ich?', {}, 2026, 'hybrid').body.includes('kenne ich noch nicht'), true);
  assert.equal(invalidReply('Das tut mir leid. Was ist los?', 'stop'), null);
  assert.equal(invalidReply('Alles klar. Bis bald.', 'stop'), null);
  for (const output of ['Hallo 😊. Was ist los?', 'Was ist los? Wie geht es dir?', 'Ich bin Tante Emma. Was ist los?', 'Nur eine Aussage.']) {
    assert.ok(invalidReply(output, 'stop'));
  }
  assert.ok(invalidReply('Das tut mir leid. Was ist los?', 'length'));
  console.log('OK: routing, negative cases, address rendering, app facts, and fallback checks.');
}
