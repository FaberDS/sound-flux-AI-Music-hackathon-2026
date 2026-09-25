// The constrained option-logit readout follows the MIT-licensed SemIf browser demo.
import { buildDecisionPayload, decisionMessages, decisionModels, labelsFor, softmax } from './decision.mjs';

const browserFetch = self.fetch.bind(self);
self.fetch = (input, init = {}) => browserFetch(input, { ...init, referrerPolicy: 'no-referrer' });
globalThis.document ??= { baseURI: self.location.href };

let engine;
let modelId = '';
let busy = false;

function send(type, data = {}) {
  self.postMessage({ type, ...data });
}

async function createEngine() {
  let runtime;
  try {
    runtime = await import('./node_modules/@wllama/wllama/esm/index.js');
  } catch {
    throw new Error('Die lokale wllama-Laufzeit fehlt. In llm-evaluation „npm ci“ ausführen und neu laden.');
  }
  const wasm = new URL('./node_modules/@wllama/wllama/esm/wasm/wllama.wasm', self.location.href).href;
  const compatWasm = new URL('./node_modules/@wllama/wllama-compat/wasm/wllama.wasm', self.location.href).href;
  const compatWorker = new URL('./node_modules/@wllama/wllama-compat/wasm/wllama.js', self.location.href).href;
  const compatResponse = await browserFetch(compatWorker);
  if (!compatResponse.ok) throw new Error('Die lokale Safari-Laufzeit fehlt. „npm ci“ ausführen und neu laden.');
  const instance = new runtime.Wllama(
    { default: wasm },
    { logger: runtime.LoggerWithoutDebug, suppressNativeLog: true, parallelDownloads: 4, allowOffline: true },
  );
  instance.setCompat({ wasm: compatWasm, worker: { code: await compatResponse.text() } });
  return instance;
}

async function load(requestedModelId) {
  if (!Object.hasOwn(decisionModels, requestedModelId)) throw new Error('Bitte eines der aufgeführten lokalen Modelle wählen.');
  if (engine && modelId === requestedModelId) {
    send('ready', { modelId, modelName: decisionModels[modelId].name, loadMs: 0, warmupMs: 0, runtime: self.navigator.gpu ? 'WebGPU' : 'WASM' });
    return;
  }
  if (engine) await engine.exit();
  engine = await createEngine();
  modelId = requestedModelId;
  const selected = decisionModels[modelId];
  const runtime = self.navigator.gpu ? 'WebGPU' : 'WASM';
  send('loading', { message: `${selected.name} wird mit ${runtime} geladen; der Browser-Zwischenspeicher wird zuerst geprüft…` });
  const loadStarted = performance.now();
  await engine.loadModelFromUrl(selected.url, {
    n_ctx: 2048,
    n_batch: 256,
    n_gpu_layers: self.navigator.gpu ? 999 : 0,
    cache_prompt: false,
    progressCallback: ({ loaded, total }) => send('progress', { loaded, total }),
  });
  const loadMs = performance.now() - loadStarted;
  send('loading', { message: 'Modell geladen. Eine kurze Testentscheidung läuft…' });
  const warmupStarted = performance.now();
  const warmup = await engine.createChatCompletion({
    messages: [{ role: 'user', content: 'Antworte ausschließlich mit dem Buchstaben A.' }],
    max_tokens: 1,
    temperature: 0,
    cache_prompt: false,
    chat_template_kwargs: { enable_thinking: false },
  });
  if (!warmup?.choices?.length) throw new Error('Die lokale Testentscheidung lieferte kein Ergebnis.');
  send('ready', {
    modelId,
    modelName: selected.name,
    loadMs,
    warmupMs: performance.now() - warmupStarted,
    runtime,
  });
}

function optionLogprobs(response, labels) {
  const entries = response.choices?.[0]?.logprobs?.content?.[0]?.top_logprobs ?? [];
  return labels.map(label => {
    const ascii = label.charCodeAt(0);
    const entry = entries.find(item => item.token === label || (item.bytes?.length === 1 && item.bytes[0] === ascii));
    return Number(entry?.logprob);
  });
}

async function decide(input) {
  if (!engine || !modelId) throw new Error('Vor der Auswertung ein lokales Modell laden.');
  const payload = buildDecisionPayload(input.state, input.question, input.options);
  const labels = labelsFor(payload.options.length);
  const started = performance.now();
  const response = await engine.createChatCompletion({
    messages: decisionMessages(payload),
    max_tokens: 1,
    temperature: 1,
    top_k: 0,
    top_p: 1,
    logprobs: true,
    top_logprobs: 20,
    logit_bias: Object.fromEntries(labels.map((label, index) => [String(decisionModels[modelId].labelBase + index), 100])),
    grammar: `root ::= ${labels.map(label => `"${label}"`).join(' | ')}`,
    cache_prompt: false,
    chat_template_kwargs: { enable_thinking: false },
  });
  const logits = optionLogprobs(response, labels);
  const probabilities = softmax(logits);
  send('result', {
    modelId,
    modelName: decisionModels[modelId].name,
    runtime: self.navigator.gpu ? 'WebGPU' : 'WASM',
    totalMs: performance.now() - started,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    options: payload.options.map((description, index) => ({
      label: labels[index],
      description,
      probability: probabilities[index],
    })),
  });
}

self.addEventListener('message', async ({ data }) => {
  if (busy) return send('error', { message: 'Das lokale Modell ist bereits beschäftigt.' });
  busy = true;
  try {
    if (data.type === 'load') await load(data.modelId);
    else if (data.type === 'decide') await decide(data.payload);
  } catch (error) {
    if (data.type === 'load' && engine) {
      try { await engine.exit(); } catch { /* best-effort cleanup */ }
      engine = undefined;
      modelId = '';
    }
    console.error(error);
    send('error', { message: error?.message ?? String(error), stack: error?.stack });
  } finally {
    busy = false;
  }
});
