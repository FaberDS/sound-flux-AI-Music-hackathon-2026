// Run with Node 18+: node llm-evaluation/check.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildRequest, contextText, defaultRows, readStream, recentSamples, systemPrompt, toneLabels, toneHistoryView } from './app.mjs';
import { buildDecisionPayload, decisionMessages, decisionModels, decisionPresets, labelsFor, softmax } from './decision.mjs';
import { buildMemoryConversationRequest, memoryPresets } from './memory-demo.mjs';
import evaluation, { appEventInput, regressionTests, requestForCase, scenarioSignals } from './promptfooconfig.mjs';
import { scenarios } from './szenarien.de.mjs';
import { seedCases, freshCases } from './hybrid.config.mjs';
import { germanPhrases, supertonicVoices, voiceRequest } from './voices.mjs';
import { daytimeGreeting, localTimeContext } from './time-context.mjs';
import { agentStates, speechLevel } from './agent-demo.mjs';
import { motionInputs, motionSignals, motionTrigger } from './motion-audio.mjs';

const motionFrame = { face: [], hands: [], expressions: { jawOpen: 0.8 } };
motionFrame.face[33] = { x: 0.4, y: 0.35 };
motionFrame.face[263] = { x: 0.6, y: 0.35 };
motionFrame.face[1] = { x: 0.5, y: 0.5 };
const neutralHead = motionSignals(motionFrame, null).head;
assert.equal(motionInputs.length, 21, 'Mouth, four head movements, ten fingers, and six hand movements are assignable.');
assert.equal(motionSignals(motionFrame, neutralHead).values.nodDown, 0);
motionFrame.face[1].y += 0.08;
assert.equal(motionSignals(motionFrame, neutralHead).values.nodDown, 1);
assert.equal(motionSignals(motionFrame, neutralHead).values.nodUp, 0);
motionFrame.face[1].y -= 0.16;
assert.equal(motionSignals(motionFrame, neutralHead).values.nodUp, 1);
motionFrame.face[1].y += 0.08;
const rolledFace = motionFrame.face.map(point => {
  const x = (point.x - 0.5) * 4 / 3, y = point.y - 0.35;
  return { x: 0.5 + (x * Math.cos(0.3) - y * Math.sin(0.3)) * 3 / 4, y: 0.35 + x * Math.sin(0.3) + y * Math.cos(0.3) };
});
assert.ok(motionSignals({ ...motionFrame, face: rolledFace }, neutralHead).values.tiltLeft > 0.9);
assert.equal(motionSignals({ ...motionFrame, face: rolledFace }, neutralHead).values.nodDown, 0, 'A tilt is not a nod.');
const fingers = Array.from({ length: 21 }, (_, i) => ({ x: 0.2 + Math.max(0, Math.floor((i - 1) / 4)) * 0.1, y: 0.6 - ((i - 1 + 4) % 4) * 0.07, z: 0 }));
motionFrame.hands = [{ side: 'Right', points: fingers }];
assert.ok(motionSignals(motionFrame, neutralHead).values.RightIndex < 0.01);
fingers[5] = { x: 0.3, y: 0.6, z: 0 };
fingers[6] = { x: 0.3, y: 0.5, z: 0 };
fingers[7] = { x: 0.4, y: 0.5, z: 0 };
fingers[8] = { x: 0.4, y: 0.6, z: 0 };
assert.ok(motionSignals(motionFrame, neutralHead).values.RightIndex > 0.65);
assert.ok(motionSignals(motionFrame, neutralHead).values.RightMiddle < 0.01);
assert.equal(motionSignals(motionFrame, neutralHead).values.LeftIndex, null);
const palm = fingers.map(point => ({ ...point }));
palm[0] = { x: 0.5, y: 0.65 }; palm[5] = { x: 0.45, y: 0.55 }; palm[17] = { x: 0.55, y: 0.55 };
const moveHand = (x, y) => ({ ...motionFrame, hands: [{ side: 'Right', points: palm.map(point => ({ ...point, x: point.x + x, y: point.y + y })) }] });
const neutralHands = motionSignals(moveHand(0, 0), neutralHead).handPositions;
assert.equal(motionSignals(moveHand(0, 0), neutralHead, 4 / 3, neutralHands).values.RightLift, 0);
assert.equal(motionSignals(moveHand(0, -0.3), neutralHead, 4 / 3, neutralHands).values.RightLift, 1);
assert.equal(motionSignals(moveHand(0.3, 0), neutralHead, 4 / 3, neutralHands).values.RightMoveLeft, 1, 'Left follows the mirrored preview.');
assert.equal(motionSignals(moveHand(0.3, 0), neutralHead, 4 / 3, neutralHands).values.RightMoveRight, 0);
assert.equal(motionSignals(moveHand(-0.15, 0), neutralHead, 4 / 3, neutralHands).values.RightMoveRight > 0.3, true);
assert.equal(motionSignals(moveHand(0, -0.3), neutralHead).values.RightLift, 0, 'Reacquisition centers the hand instead of firing.');
assert.equal(motionSignals({ face: [], hands: [], expressions: {} }, neutralHead, 4 / 3, neutralHands).values.RightLift, null);
assert.equal(motionSignals({ face: [], hands: [], expressions: {} }, neutralHead).values.mouth, null);
assert.deepEqual(motionTrigger(0.9), { armed: false, fire: false }, 'A held pose does not fire on acquisition.');
const armedMotion = motionTrigger(0.1);
assert.equal(motionTrigger(0.8, armedMotion.armed).fire, true);
assert.equal(motionTrigger(0.8, false).fire, false, 'A held movement plays only once.');
assert.equal(motionTrigger(0.45, true).armed, true, 'Hysteresis preserves arming between thresholds.');
assert.deepEqual(motionTrigger(null, true), { armed: false, fire: false });
console.log('OK: calibrated head motion, independent finger bends, and release-before-trigger audio mappings.');

assert.equal(speechLevel(new Float32Array()), 0);
assert.equal(speechLevel(new Float32Array(1024)), 0, 'Silent audio keeps the speaking marks still.');
assert.equal(speechLevel(new Float32Array([1, -1])), 1, 'Loud audio is capped at the maximum movement.');
assert.ok(Math.abs(speechLevel(new Float32Array([0.05, -0.05])) - 0.3) < 0.00001);
assert.ok(Object.values(agentStates).every(([title, hint]) => title && hint), 'Every state remains understandable without motion.');
import { imageDraft, imagePrompt, imageRequest, imageSchema, readImageMetadata, validateImageOutput } from './images.mjs';

// Tiny synthetic JPEG EXIF segment: explicit date/offset, camera/software, and N/E GPS.
const metadataJpeg = Buffer.from('/9j/4QEHRXhpZgAASUkqAAgAAAAFAA8BAgAFAAAAngAAABABAgAHAAAAowAAADEBAgAKAAAAqgAAAGmHBAABAAAASgAAACWIBAABAAAAaAAAAAAAAAACAAOQAgAUAAAAtAAAABGQAgAHAAAAyAAAAAAAAAAEAAEAAgACAAAATgAAAAIABQADAAAAzwAAAAMAAgACAAAARQAAAAQABQADAAAA5wAAAAAAAABUZXN0AENhbWVyYQBTY2FuIFRvb2wAMjAyMDowNToxNCAxMDozMDowMAArMDI6MDAAMAAAAAEAAAAMAAAAAQAAAB4AAAABAAAAEAAAAAEAAAAWAAAAAQAAAA8AAAABAAAA/9k=', 'base64');
const embedded = await readImageMetadata(metadataJpeg, 'image/jpeg');
assert.deepEqual(embedded, { source: 'exif', status: 'found', capturedAt: '2020:05:14 10:30:00',
  utcOffset: '+02:00', camera: 'Test Camera', software: 'Scan Tool',
  location: { latitude: 48 + 12 / 60 + 30 / 3600, longitude: 16 + 22 / 60 + 15 / 3600 } });
const southern = Buffer.from(metadataJpeg);
southern[126] = 'S'.charCodeAt(0);
assert.equal((await readImageMetadata(southern, 'image/jpeg')).location.latitude, -embedded.location.latitude);
southern[126] = 0; // Missing hemisphere must not silently become north.
assert.equal((await readImageMetadata(southern, 'image/jpeg')).location, null);
for (const [offset, value] of [[219, 91], [227, 60]]) { // Invalid latitude degrees or minutes.
  const invalidGps = Buffer.from(metadataJpeg);
  invalidGps.writeUInt32LE(value, offset);
  assert.equal((await readImageMetadata(invalidGps, 'image/jpeg')).location, null);
}
const noTimezone = Buffer.from(metadataJpeg);
noTimezone.writeUInt16LE(0xffff, 100); // Remove OffsetTimeOriginal; do not assume the browser's timezone.
assert.equal((await readImageMetadata(noTimezone, 'image/jpeg')).utcOffset, null);
const stripped = await readImageMetadata(Buffer.from([255, 216, 255, 217]), 'image/jpeg');
assert.equal(stripped.status, 'empty');
assert.equal(stripped.capturedAt, null);
assert.equal(stripped.location, null);
assert.equal((await readImageMetadata(Buffer.from('broken'), 'image/jpeg')).status, 'error');
assert.equal((await readImageMetadata(metadataJpeg, 'image/webp')).status, 'unsupported');
console.log('OK: EXIF extraction preserves embedded dates and GPS; absent or invalid metadata never becomes an inferred location.');

const photoSettings = { model: 'qwen3.5:2b', prompt: `  ${imagePrompt}\n`, temperature: 0.1, maxTokens: 512, schema: true };
const photoRequest = imageRequest(photoSettings, 'aW1hZ2U=');
assert.equal(photoRequest.messages[0].content, photoSettings.prompt, 'Preserve the exact prompt, including whitespace.');
assert.deepEqual(photoRequest.messages[1], { role: 'user', content: 'Analysiere dieses Foto.', images: ['aW1hZ2U='] });
assert.equal(photoRequest.format, imageSchema);
assert.equal(photoRequest.think, false);
assert.equal(photoRequest.options.num_predict, 512);
assert.equal(imageRequest({ ...photoSettings, schema: false }, 'aW1hZ2U=').format, undefined);
assert.throws(() => imageRequest({ ...photoSettings, model: '' }, 'aW1hZ2U='), /Vision/);
assert.throws(() => imageRequest({ ...photoSettings, prompt: ' ' }, 'aW1hZ2U='), /Prompt/);
assert.throws(() => imageRequest({ ...photoSettings, maxTokens: 0 }, 'aW1hZ2U='), /Token/);
assert.throws(() => imageRequest(photoSettings, 'data:image/jpeg;base64,aW1hZ2U='), /Bild/);
const photoOutput = { caption_de: 'Eine Tasse steht auf einem Tisch.', setting: 'indoor', people_count: 0,
  details_de: ['Die Tasse ist blau.'], visible_text: [], tags_de: ['Tasse'], image_issues: [],
  emotion_hints: [], conversation_question_de: null };
assert.deepEqual(validateImageOutput(JSON.stringify(photoOutput)), photoOutput);
assert.deepEqual(validateImageOutput(JSON.stringify({ ...photoOutput, caption_de: null, people_count: null })).people_count, null);
for (const bad of [{ ...photoOutput, invented: true }, { ...photoOutput, people_count: false },
  { ...photoOutput, people_count: -1 }, { ...photoOutput, setting: 'garden' },
  { ...photoOutput, caption_de: 'a'.repeat(161) }, { ...photoOutput, tags_de: ['a'.repeat(25)] },
  { ...photoOutput, details_de: Array(4).fill('Detail') }, { ...photoOutput, visible_text: [null] },
  { ...photoOutput, image_issues: ['blur', 'blur'] }, { ...photoOutput, image_issues: ['sad'] }, null, []]) {
  assert.throws(() => validateImageOutput(JSON.stringify(bad)));
}
assert.throws(() => validateImageOutput('{"caption_de":'), SyntaxError);
assert.throws(() => validateImageOutput(JSON.stringify(photoOutput), 'length'), /Token-Limit/);
const photoHint = { emotion: 'joy', subject_de: 'Person links', evidence_de: 'Die Person lächelt.', uncertainty: 'high' };
assert.equal(validateImageOutput(JSON.stringify({ ...photoOutput, emotion_hints: [photoHint],
  conversation_question_de: 'Was geht dir bei diesem Foto durch den Kopf?' })).emotion_hints[0].emotion, 'joy');
for (const hint of [{ ...photoHint, evidence_de: '' }, { ...photoHint, uncertainty: 'certain' },
  { ...photoHint, emotion: 'trauma' }, { ...photoHint, confirmed: true },
  { ...photoHint, subject_de: 'x'.repeat(61) }, null]) {
  assert.throws(() => validateImageOutput(JSON.stringify({ ...photoOutput, emotion_hints: [hint] })));
}
assert.throws(() => validateImageOutput(JSON.stringify({ ...photoOutput, emotion_hints: Array(3).fill(photoHint) })));
assert.throws(() => validateImageOutput(JSON.stringify({ ...photoOutput, image_issues: ['unusable'], emotion_hints: [photoHint] })));
assert.throws(() => validateImageOutput(JSON.stringify({ ...photoOutput, conversation_question_de: 'x'.repeat(161) })));
const oldDraft = imageDraft({ prompt: 'My own factual prompt.' });
assert.equal(oldDraft.prompt, 'My own factual prompt.', 'Do not overwrite an edited legacy draft.');
assert.equal(oldDraft.format.properties.emotion_hints, undefined);
const { emotion_hints, conversation_question_de, ...oldOutput } = photoOutput;
assert.deepEqual(validateImageOutput(JSON.stringify(oldOutput), 'stop', oldDraft.format), oldOutput);
assert.equal(imageRequest({ ...photoSettings, format: oldDraft.format }, 'aW1hZ2U=').format, oldDraft.format);
assert.equal(imageDraft(null).prompt, imagePrompt);
assert.equal(imageDraft({ prompt: 'Edited new prompt.', schemaVersion: 2 }).format, imageSchema);
assert.ok(imagePrompt.length < 8000);
console.log('OK: image requests preserve the prompt and pixels; strict photo JSON rejects invalid and truncated output.');
console.log('OK: emotion hints require visible evidence and uncertainty; legacy photo schemas and edited prompts remain usable.');

const shared = { rows: defaultRows, input: 'Hallo, heute ist es aber echt kalt', temperature: 0.7, maxTokens: 120 };
const variant = { model: 'qwen3:1.7b', system: systemPrompt, prompt: 'Bitte antworte kurz.',
  useSystem: true, useContext: true, usePrompt: true, useInput: true };
const runtime2026 = { currentDate: '2026-09-24', currentTime: '21:00', timeZone: 'Europe/Vienna', currentYear: 2026 };
assert.equal(systemPrompt, (await readFile(new URL('../ipad-audio-agent/App/Instructions.de.txt', import.meta.url), 'utf8')).trim());
const baseline = buildRequest(shared, variant, runtime2026);
assert.equal(baseline.messages[0].content, `${systemPrompt}\n\n${contextText(defaultRows, runtime2026)}`);
assert.equal(baseline.messages[1].content, `${variant.prompt}\n\n${shared.input}`);
assert.equal(baseline.think, false);
assert.deepEqual(baseline.options, { temperature: 0.7, top_p: 0.8, repeat_penalty: 1.05, num_predict: 120 });
assert.deepEqual(buildRequest(shared, { ...variant, model: 'qwen3:0.6b' }, runtime2026).messages, baseline.messages);
for (let mask = 0; mask < 16; mask++) {
  const choice = { ...variant, useSystem: !!(mask & 1), useContext: !!(mask & 2), usePrompt: !!(mask & 4), useInput: !!(mask & 8) };
  if (!(mask & 12)) { assert.throws(() => buildRequest(shared, choice), /nicht leeren/); continue; }
  const request = buildRequest(shared, choice, runtime2026);
  assert.equal(request.messages.length, mask & 3 ? 2 : 1);
  assert.equal(request.messages[0].role, mask & 3 ? 'system' : 'user');
  assert.equal(request.messages.at(-1).content, [choice.usePrompt && variant.prompt, choice.useInput && shared.input].filter(Boolean).join('\n\n'));
  if (mask & 3) {
    assert.equal(request.messages[0].content.includes(systemPrompt), choice.useSystem);
    assert.equal(request.messages[0].content.includes('currentYear: 2026'), choice.useContext);
  }
}
const quoted = [{ key: ' preference ', value: '"hello"\n</script>' }, { key: '', value: 'ignored' }];
assert.deepEqual(JSON.parse(contextText(quoted, runtime2026).split('\n')[1]), [{ key: 'preference', value: '"hello"\n</script>' }]);
assert.match(contextText([], runtime2026), /currentTime: 21:00[\s\S]+timeZone: Europe\/Vienna[\s\S]+currentYear: 2026/);
assert.throws(() => contextText([...defaultRows, { key: ' FIRSTNAME ', value: 'Other' }], runtime2026), /eindeutig/);
assert.throws(() => contextText(Array(21).fill({ key: '', value: '' }), runtime2026), /20 Kontextzeilen/);
assert.throws(() => contextText([{ key: 'x', value: 'x'.repeat(2000) }], runtime2026), /2\.000/);
assert.throws(() => buildRequest(shared, { ...variant, model: '' }), /installiertes Modell/);
assert.throws(() => buildRequest(shared, { ...variant, system: ' ' }), /System-Prompt/);
assert.throws(() => buildRequest({ ...shared, input: 'a'.repeat(1001) }, variant), /1\.000/);
assert.throws(() => buildRequest({ ...shared, temperature: NaN }, variant), /Temperatur/);
assert.throws(() => buildRequest({ ...shared, maxTokens: 1.5 }, variant), /Ausgabe-Token/);

function stream(text) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(controller) {
    // Single bytes deliberately split UTF-8 characters and JSON lines.
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
}
const chunks = [];
await readStream(stream('\n{"message":{"content":"Grüße 👋"}}\r\n{"done":true,"eval_count":3}'), chunk => chunks.push(chunk));
assert.equal(chunks[0].message.content, 'Grüße 👋');
assert.equal(chunks[1].eval_count, 3);
await assert.rejects(readStream(stream('{"error":"model missing"}\n'), () => {}), /model missing/);
await assert.rejects(readStream(stream('{"message":{"content":"partial"}}\n'), () => {}), /vorzeitig/);
await assert.rejects(readStream(stream('invalid\n'), () => {}), SyntaxError);
await assert.rejects(readStream(new ReadableStream({ start(controller) {
  controller.error(new DOMException('Stopped', 'AbortError'));
} }), () => {}), { name: 'AbortError' });

assert.deepEqual(toneLabels, ['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'other', 'sad', 'surprised', 'unknown']);
assert.deepEqual([...recentSamples([Float32Array.of(1, 2), Float32Array.of(3, 4, 5)], 4)], [2, 3, 4, 5]);
assert.deepEqual([...recentSamples([Float32Array.of(1, 2), Float32Array.of(3)], 10)], [1, 2, 3]);
const toneHistory = [2, 32, 42].map((time, index) => ({ time,
  scores: Object.fromEntries(toneLabels.map(label => [label, label === (index ? 'happy' : 'neutral') ? 1 : 0])),
}));
assert.equal(toneHistoryView(toneHistory).averages.happy, 2 / 3);
assert.equal(toneHistoryView(toneHistory).averages.neutral, 1 / 3);
assert.deepEqual(toneHistoryView(toneHistory, 10).points.map(point => point.time), [32, 42]);
assert.equal(toneHistoryView(toneHistory, 30).averages.happy, 1);
assert.equal(toneHistoryView(toneHistory, 60).start, 0);
assert.equal(toneHistoryView(toneHistory, 10, 60).points.length, 0);
assert.equal(toneHistoryView(toneHistory, 10, 60).averages.happy, 0);
assert.deepEqual(toneHistoryView(toneHistory, 0, 32).points.map(point => point.time), [2, 32]);
toneHistory.length = 0;
assert.equal(toneHistoryView(toneHistory).end, 0);
assert.ok(Object.values(toneHistoryView(toneHistory).averages).every(value => value === 0));
console.log('OK: tone history averages, inclusive time ranges, gaps, and empty/reset history.');

const memoryDecision = buildDecisionPayload(
  decisionPresets.termin.state,
  decisionPresets.termin.question,
  decisionPresets.termin.options,
);
assert.deepEqual(labelsFor(memoryDecision.options.length), ['A', 'B', 'C']);
assert.match(decisionMessages(memoryDecision)[1].content, /A\. MERKEN/);
assert.equal(Object.keys(decisionModels).length, 2);
assert.equal(Object.keys(decisionPresets).length, 5);
for (const preset of Object.values(decisionPresets)) {
  assert.match(preset.state, /Aktuelles Ziel:[\s\S]+Neue Aussage:[\s\S]+Kontext:/);
  assert.deepEqual(preset.options, decisionPresets.termin.options);
}
assert.throws(() => buildDecisionPayload('state', 'question', ['same', 'SAME']), /eindeutig/);
assert.throws(() => labelsFor(7), /2–6/);
const probabilities = softmax([1, 2, 3]);
assert.ok(Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
assert.equal(probabilities.indexOf(Math.max(...probabilities)), 2);
const memoryConversation = buildMemoryConversationRequest({
  model: 'qwen3:1.7b', systemPrompt: 'Du bist Tante Emma.', memoryContext: 'Lieblingslied: Ein Stern.',
  input: 'Kannst du mit mir über Musik sprechen?', tone: { label: 'Fröhlich', confidence: 0.72 },
  history: Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `Turn ${index}` })),
  runtime: runtime2026,
});
assert.equal(memoryConversation.model, 'qwen3:1.7b');
assert.equal(memoryConversation.messages.length, 12);
assert.match(memoryConversation.messages[0].content, /Sprache der Antwort: Deutsch \(de\)/);
assert.match(memoryConversation.messages[0].content, /Fröhlich \(72% Modellwert\)/);
assert.match(memoryConversation.messages[0].content, /2026-09-24, 21:00 Uhr \(Europe\/Vienna\)/);
assert.match(memoryConversation.messages[0].content, /Lieblingslied: Ein Stern/);
assert.equal(memoryConversation.messages.at(-1).content, 'Kannst du mit mir über Musik sprechen?');
assert.deepEqual(memoryConversation.options, { temperature: 0.7, top_p: 0.8, repeat_penalty: 1.05, num_predict: 120 });
assert.throws(() => buildMemoryConversationRequest({ model: '', systemPrompt: 'x', memoryContext: '', input: 'Hallo' }), /Ollama/);
assert.throws(() => buildMemoryConversationRequest({ model: 'qwen', systemPrompt: 'x', memoryContext: '', input: '' }), /Gesprächstext/);
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('./app.mjs', import.meta.url), 'utf8');
for (const id of ['agent-tab', 'agent-panel', 'agent-speak', 'agent-conversation', 'agent-stop', 'agent-audio', 'agent-reduced-motion']) assert.ok(html.includes(`id="${id}"`));
assert.doesNotMatch(app, /voicedSinceRequest/);
for (const id of ['overview-tab', 'overview-panel', 'prompt-tab', 'promptfoo-tab', 'promptfoo-panel', 'promptfoo-frame', 'promptfoo-refresh', 'promptfoo-status', 'tone-tab', 'voices-tab', 'voices-panel', 'voices-audio', 'voices-text', 'voices-list', 'decision-tab', 'memory-tab', 'memory-panel', 'memory-user', 'memory-retry', 'memory-profile-form', 'memory-photo-input', 'memory-context-build', 'memory-new-conversation', 'memory-chat-model', 'memory-chat-voice', 'memory-chat-tone', 'memory-chat-record', 'memory-chat-record-status', 'memory-chat-input', 'memory-chat-run', 'memory-chat-audio', 'tone-record', 'tone-playback', 'decision-load', 'decision-run']) {
  assert.match(html, new RegExp(`id="${id}"`));
}
assert.equal([...html.matchAll(/aria-selected="true"/g)].length, 1);
assert.match(html, /id="overview-tab"[^>]*aria-selected="true"/);
assert.match(await readFile(new URL('./memory-demo.mjs', import.meta.url), 'utf8'), /SQLite-Speicher-API nicht aktiv/);
for (const panel of html.matchAll(/<(?:section|div)\b[^>]*role="tabpanel"[^>]*>/g)) {
  assert.equal(/\bhidden\b/.test(panel[0]), !panel[0].includes('id="overview-panel"'));
}
console.log('OK: prompts, request streaming, cancellation, tone capture, local decisions, and evaluation tabs.');

assert.deepEqual(Object.keys(memoryPresets), ['hochzeit', 'lied', 'kindheit', 'idee', 'einkauf']);
assert.equal(memoryPresets.hochzeit.annual, true);
assert.equal(memoryPresets.idee.scope, 'conversation');
assert.equal(memoryPresets.einkauf.scope, 'irrelevant');
console.log('OK: German memory demo presets cover persistent, conversation-only, and discarded information.');

assert.deepEqual(supertonicVoices, ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5']);
assert.ok(germanPhrases.length >= 5);
assert.deepEqual(localTimeContext(new Date('2026-09-24T19:00:00Z'), 'Europe/Vienna'), runtime2026);
assert.equal(daytimeGreeting(runtime2026), 'Guten Abend');
assert.equal(daytimeGreeting({ currentTime: '07:00' }), 'Guten Morgen');
assert.equal(daytimeGreeting({ currentTime: '23:00' }), 'Hallo');
for (const voice of supertonicVoices) {
  for (const [, text] of germanPhrases) assert.deepEqual(voiceRequest(voice, ` ${text} `), { voice, text });
}
for (const text of ['', '  ', 'x'.repeat(1001), null]) assert.throws(() => voiceRequest('F1', text), /Zeichen/);
assert.throws(() => voiceRequest('../F1', 'Hallo'), /Stimmen/);
console.log('OK: ten Supertonic voices, German phrase presets, and speech input validation.');

// Exercise the eval wiring without installing Promptfoo or calling a model.
for (const test of evaluation.tests) {
  const vars = { ...evaluation.defaultTest.vars, ...test.vars };
  const request = requestForCase(vars);
  assert.deepEqual(JSON.parse(evaluation.prompts[0].function({ vars })), request.messages);
  assert.equal(request.messages.at(-1).content, vars.input || appEventInput);
  assert.deepEqual(request.messages.slice(1, -1), vars.context?.history ?? []);
  if (vars.context?.state) assert.ok(request.messages[0].content.includes(JSON.stringify(vars.context.state)));
  assert.match(request.messages[0].content, new RegExp(`currentYear: ${vars.year ?? 2026}`));
  for (const provider of evaluation.providers) {
    assert.deepEqual(provider.config, { ...request.options, think: request.think });
    assert.match(provider.id, /^ollama:chat:qwen3:/);
  }
}
assert.ok(requestForCase({ input: 'Hallo.', profile: {} }).messages[0].content.includes(contextText([], {
  currentDate: '2026-09-24', currentTime: '12:00', timeZone: 'Europe/Vienna', currentYear: 2026,
})));
const checkQuestion = evaluation.defaultTest.assert.find(rule => rule.metric === 'Question structure').value;
assert.equal(checkQuestion('Hallo, Amelie. Wie geht es dir?', { vars: { questions: 1 } }), true);
assert.equal(checkQuestion('Wie geht es dir? Was magst du?', { vars: { questions: 1 } }), false);
assert.equal(checkQuestion('Wie geht es dir? Hallo.', { vars: { questions: 1 } }), false);
assert.equal(checkQuestion('Bis bald.', { vars: { questions: 0 } }), true);
assert.equal(checkQuestion('Noch eine Frage?', { vars: { questions: 0 } }), false);
const checkSpeech = evaluation.defaultTest.assert.find(rule => rule.metric === 'Plain speech').value;
assert.equal(checkSpeech('Grüß dich, Amelie. Wie geht es dir?'), true);
for (const output of ['**Hallo**', '- Hallo', '1. Hallo', 'Hallo 👋']) assert.equal(checkSpeech(output), false);

// The new cases must neither multiply through top-level arrays nor leak their answers.
assert.equal(regressionTests.length, 12);
assert.equal(scenarios.length, 96);
assert.equal(evaluation.tests.length, 108);
assert.equal(seedCases.length + freshCases.length, 32);
assert.equal(new Set(scenarios.map(test => test.id)).size, scenarios.length);
assert.equal(new Set(scenarios.map(test => test.title)).size, scenarios.length);
assert.deepEqual(Object.fromEntries([...new Set(scenarios.map(test => test.group))].map(group =>
  [group, scenarios.filter(test => test.group === group).length])),
{ Kontakt: 10, Stimmung: 12, Musikwege: 16, Timing: 14, Bilder: 16, Begleitung: 8, Verlauf: 12, Grenzen: 8 });
for (const test of evaluation.tests.slice(12)) {
  assert.ok(Object.values(test.vars).every(value => !Array.isArray(value)));
  for (const key of ['sollverhalten', 'vermeiden', 'appAktion', 'stimmung', 'haltung']) assert.ok(test.metadata[key]?.trim());
  const [min, max] = test.vars.expected.questions ?? [0, 1];
  assert.ok(Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max <= 1 && min <= max);
  if (test.vars.expected.silent) assert.deepEqual([min, max], [0, 0]);
  for (const pattern of [...(test.vars.checks.any ?? []), ...(test.vars.checks.none ?? [])]) new RegExp(pattern, 'iu');
  const publicMessages = requestForCase(test.vars).messages;
  assert.deepEqual(requestForCase({ ...test.vars,
    expected: { behavior: 'NICHT_AN_DAS_MODELL', action: 'GEHEIME_ERWARTUNG' },
    checks: { any: ['GEHEIME_PRUEFUNG'] }, mood: 'GEHEIMES_LABEL',
  }).messages, publicMessages);
}
const checkPresence = evaluation.defaultTest.assert.find(rule => rule.metric === 'Speech presence').value;
const quiet = { vars: { expected: { silent: true, questions: [0, 0] } } };
const optionalQuestion = { vars: { expected: {} } };
assert.equal(checkPresence('', quiet), true);
assert.equal(checkPresence('Ich warte.', quiet), false);
assert.equal(checkPresence('', optionalQuestion), false);
assert.equal(checkQuestion('Du kannst gern summen.', optionalQuestion), true);
assert.equal(checkQuestion('Möchtest du summen?', optionalQuestion), true);
assert.equal(checkQuestion('Summen? Oder klatschen?', optionalQuestion), false);
assert.equal(checkQuestion('Noch ein Lied?', quiet), false);
const garden = scenarios.find(test => test.id === 'B01');
assert.equal(scenarioSignals('Erinnert dich das Foto an etwas?', { vars: garden }).pass, true);
assert.equal(scenarioSignals('Erinnert dich das an deine Hochzeit 1965?', { vars: garden }).pass, false);
const uncertainImage = scenarios.find(test => test.id === 'B10');
assert.equal(scenarioSignals('Ich weiß nicht, ob deine Schwester dabei war.', { vars: uncertainImage }).pass, true);
assert.equal(scenarioSignals('Deine Schwester war dabei.', { vars: uncertainImage }).pass, false);
assert.equal(scenarioSignals('Das ist nicht die Originalaufnahme.', { vars: scenarios.find(test => test.id === 'G08') }).pass, true);
assert.equal(scenarioSignals('Es gab ein Problem bei der Erzeugung.', { vars: scenarios.find(test => test.id === 'G04') }).pass, true);
assert.equal(scenarioSignals('Die Musik ist noch nicht fertig. Magst du sie hören?', { vars: scenarios.find(test => test.id === 'G04') }).pass, false);
assert.equal(scenarioSignals('Magst du uns den Garten zeigen?', { vars: scenarios.find(test => test.id === 'T02') }).pass, false);
assert.equal(checkQuestion('Möchtest du lieber erzählen?', { vars: scenarios.find(test => test.id === 'P01') }), true);
assert.deepEqual(['T01', 'T02', 'T03'].map(id => scenarios.find(test => test.id === id).context.state.sekundenOhneEigeninitiative), [59, 60, 61]);
assert.equal(scenarios.find(test => test.id === 'T12').context.state.impulsNachSekunden, 120);
assert.throws(() => requestForCase({ input: '' }), /App-Ereignis/);
assert.throws(() => requestForCase({ input: 'Hallo.', context: { history: [{ role: 'system', content: 'Umgehen' }] } }), /Testverlauf/);
assert.throws(() => requestForCase({ input: 'Hallo.', context: { history: [{ role: 'user', content: '' }] } }), /Testverlauf/);
assert.throws(() => requestForCase({ input: 'Hallo.', context: { history: Array(13).fill({ role: 'user', content: 'Hallo.' }) } }), /Testverlauf/);
console.log(`OK: ${evaluation.tests.length} deutsche Fälle, Verlauf/App-Ereignisse, stille Antworten, Prüfdaten-Isolation und unveränderte Hybrid-Fallzahl.`);
