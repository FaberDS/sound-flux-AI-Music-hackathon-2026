import http from 'node:http'
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocketServer, WebSocket } from 'ws'
import { makeWav } from './audio.mjs'
import { questions, demoProfile, defaultConfig, failureKeys, seedData, profileState, chatAnswer, transcriptFor } from './fixtures.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const maxUpload = 25 * 1024 * 1024
function problem(status, detail) { return Object.assign(new Error(detail), { status }) }
function check(condition, detail, status = 400) { if (!condition) throw problem(status, detail) }
function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}
async function body(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    check(size <= maxUpload + 65536, 'Audio is limited to 25 MB', 413)
    chunks.push(chunk)
  }
  const bytes = Buffer.concat(chunks)
  if (req.headers['content-type']?.startsWith('multipart/form-data')) {
    try {
      const form = await new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': req.headers['content-type'] }, body: bytes }).formData()
      const audio = form.get('audio')
      check(audio && typeof audio.size === 'number' && audio.size > 0, 'Provide an audio recording.', 422)
      check(audio.size <= maxUpload, 'Audio is limited to 25 MB', 413)
      return Object.fromEntries(form)
    } catch (error) { throw error.status ? error : problem(422, 'Invalid audio upload.') }
  }
  try {
    const value = JSON.parse(bytes.toString() || '{}')
    check(value && typeof value === 'object' && !Array.isArray(value), 'Expected a JSON object.', 422)
    return value
  } catch (error) { throw error.status ? error : problem(422, 'Invalid JSON.') }
}
function validateSettings(value) {
  check(typeof value.prompt === 'string' && value.prompt.trim().length > 0 && value.prompt.length <= 2000, 'Describe the composition using 1 to 2000 characters.')
  check(typeof value.negative_prompt === 'string' && value.negative_prompt.length <= 2000, 'Invalid negative prompt.')
  for (const [key, min, max] of [['seconds', 5, 60], ['strength', 0.1, 0.95], ['cfg', 1, 10], ['input_mix', 0, 1], ['steps', 1, 32], ['seed', -1, 2147483647]]) {
    check(Number.isFinite(value[key]) && value[key] >= min && value[key] <= max, `Invalid ${key}.`)
  }
  check(Number.isInteger(value.steps) && Number.isInteger(value.seed), 'Steps and seed must be integers.')
  for (const key of ['repeat', 'match_input', 'use_default']) check(typeof value[key] === 'boolean', `Invalid ${key}.`)
  check(value.default_file === 'default_sound.wav', 'Choose a valid default audio file.')
  return value
}
function failureKey(method, path) {
  if (path === '/health') return 'health'
  if (path.startsWith('/v1/live/') || path === '/v1/transcriptions') return 'transcription'
  if (method === 'DELETE' && !path.includes('/effects/')) return 'delete'
  if (path === '/v1/profile') return 'profile'
  if (path.startsWith('/v1/profile/')) return 'profile-save'
  if (path === '/v1/history') return 'history'
  if (path === '/v1/chat') return 'chat'
  if (path === '/v1/speech') return 'speech'
  if (path === '/api/settings') return method === 'POST' ? 'settings-save' : 'settings'
  if (path.includes('/effects')) return 'effects'
  if (path === '/api/compositions') return 'compositions'
  if (path.startsWith('/api/compositions/')) return 'playback'
  if (path === '/api/compose') return 'compose'
  if (path === '/api/setup') return 'setup'
  return null
}

export function createMockServer({ dataFile = resolve(here, '.data/state.json') } = {}) {
  let data
  try { data = JSON.parse(readFileSync(dataFile, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error; data = seedData() }
  check(data.version === 1 && data.profile && Array.isArray(data.history) && Array.isArray(data.compositions) && data.settings, 'Invalid mock data. Restore or remove only the mock state.json file.')
  let config = structuredClone(defaultConfig)
  let setupUntil = 0
  let revision = 0
  const logs = []
  const turns = new Map()
  const cancelled = new Set()
  const live = new Map()
  function persist() {
    mkdirSync(dirname(dataFile), { recursive: true })
    writeFileSync(`${dataFile}.tmp`, `${JSON.stringify(data, null, 2)}\n`)
    renameSync(`${dataFile}.tmp`, dataFile)
  }
  persist()
  function log(method, path, status) {
    logs.unshift({ time: new Date().toISOString(), method, path, status })
    logs.splice(100)
  }
  function interrupt(id) {
    const active = turns.get(id)
    const socket = live.get(id)
    cancelled.add(id)
    if (cancelled.size > 1000) cancelled.delete(cancelled.values().next().value)
    active?.abort()
    socket?.close(1000, 'Interrupted')
    return Boolean(active || socket)
  }
  function interruptAll() {
    revision++
    for (const id of new Set([...turns.keys(), ...live.keys()])) interrupt(id)
  }
  function updateConfig(patch) {
    check(patch && typeof patch === 'object' && !Array.isArray(patch), 'Expected mock settings.')
    for (const key of Object.keys(patch)) check(Object.hasOwn(defaultConfig, key), `Unknown mock setting: ${key}`)
    const next = { ...config, ...patch }
    for (const key of ['delayMs', 'tokenMs', 'composeMs', 'liveMs']) check(Number.isFinite(next[key]) && next[key] >= 0 && next[key] <= 30000, `${key} must be between 0 and 30000.`)
    check(Number.isFinite(next.speechSeconds) && next.speechSeconds >= 0.1 && next.speechSeconds <= 30, 'Invalid speech duration.')
    for (const key of ['transcript', 'reply']) check(typeof next[key] === 'string' && next[key].length <= 4000, `Invalid ${key}.`)
    check(typeof next.silence === 'boolean', 'Invalid silence setting.')
    check(['ready', 'cold', 'error'].includes(next.engine), 'Invalid engine state.')
    check(Array.isArray(next.errors) && next.errors.every((key) => failureKeys.includes(key)), 'Invalid error selection.')
    config = next
    if (Object.hasOwn(patch, 'engine')) setupUntil = 0
  }
  function engineState() {
    if (config.engine === 'cold' && setupUntil && Date.now() >= setupUntil) { config.engine = 'ready'; setupUntil = 0 }
    const busy = config.engine === 'cold' && setupUntil > Date.now()
    const ready = config.engine === 'ready' || data.settings.use_default
    const message = data.settings.use_default ? 'Default audio ready. Generation is disabled.' : ready ? 'Mock audio ready.' : config.engine === 'error' ? 'Mock model setup failed.' : busy ? 'Preparing mock audio…' : 'Mock audio needs setup.'
    return { ready, message, model: 'mock-audio', setup: { busy, message }, studio_url: '/' }
  }
  function wav(res, composition, extra = {}) {
    const bytes = makeWav(composition.duration, composition.seed, composition.effects)
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': bytes.length, ...extra })
    res.end(bytes)
  }
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    const method = req.method
    const controller = new AbortController()
    const signal = controller.signal
    const requestRevision = revision
    res.on('close', () => controller.abort())
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Sound-Flux-Mock', '1')
    if (!path.startsWith('/__mock') && path !== '/') res.on('finish', () => log(method, path, res.statusCode))
    let turnId
    try {
      if (method === 'GET' && path === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        return res.end(readFileSync(resolve(here, 'index.html')))
      }
      if (method === 'GET' && path === '/__mock') return json(res, { service: 'sound-flux-backend-mockup', config, profile: profileState(data), history: data.history, compositions: data.compositions, settings: data.settings, activeTurns: [...live.keys()], logs, failureKeys })
      if (method === 'POST' && path === '/__mock/config') { updateConfig(await body(req)); return json(res, config) }
      if (method === 'POST' && path === '/__mock/reset') {
        const { preset = 'demo' } = await body(req)
        check(['demo', 'empty'].includes(preset), 'Choose demo or empty.')
        interruptAll()
        data = seedData(preset); config = structuredClone(defaultConfig); setupUntil = 0
        persist()
        return json(res, { preset, profile: profileState(data) })
      }
      if (method === 'POST' && path === '/__mock/transcript') {
        const { text } = await body(req)
        check(typeof text === 'string' && text.length <= 4000, 'Provide a transcript.')
        let sent = 0
        for (const socket of live.values()) if (socket.readyState === WebSocket.OPEN) { socket.finish(text); sent++ }
        if (!sent) config.transcript = text
        return json(res, { sent, queued: !sent })
      }
      const interruption = path.match(/^\/v1\/turns\/([^/]+)\/interrupt$/)
      if (method === 'POST' && interruption) return json(res, { turn_id: interruption[1], interrupted: interrupt(interruption[1]) })
      const payload = ['POST', 'PUT'].includes(method) ? await body(req) : {}
      if (['/v1/chat', '/v1/speech', '/v1/transcriptions'].includes(path)) {
        turnId = payload.turn_id || randomUUID()
        check(typeof turnId === 'string', 'Invalid turn_id.', 422)
        check(!cancelled.has(turnId), 'Turn interrupted', 409)
        turns.set(turnId, controller)
      }
      await delay(config.delayMs, undefined, { signal })
      if (config.errors.includes(failureKey(method, path))) throw problem(503, `Simulated ${failureKey(method, path)} failure. Disable it in the mock controls.`)
      check(requestRevision === revision, 'Mock data changed. Retry the request.', 409)
      if (method === 'GET' && path === '/health') return json(res, { stt_model: 'mock-stt', chat_model: 'mock-chat', tts_model: 'mock-tts', profile_properties: Object.keys(data.profile).length })
      if (method === 'GET' && path === '/v1/profile') return json(res, profileState(data))
      const property = path.match(/^\/v1\/profile\/([^/]+)$/)
      if (method === 'PUT' && property) {
        const key = property[1]
        check(Object.hasOwn(questions, key), 'Unknown profile property.')
        check(typeof payload.value === 'string' && payload.value.trim().length > 0 && payload.value.length <= 500, 'Provide 1 to 500 characters.', 422)
        data.profile[key] = key === 'name' ? payload.value.trim().split(/\s/)[0] : payload.value.trim()
        data.updatedAt = new Date().toISOString(); persist()
        return json(res, profileState(data))
      }
      if (method === 'POST' && path === '/v1/debug/preseed-onboarding') { data.profile = { ...data.profile, ...demoProfile }; data.updatedAt = new Date().toISOString(); persist(); return json(res, profileState(data)) }
      if (path === '/v1/history' && method === 'GET') return json(res, { items: data.history })
      if (method === 'DELETE' && ['/v1/history', '/v1/data'].includes(path)) {
        interruptAll(); data.history = []
        if (path === '/v1/data') data.profile = {}
        persist()
        return json(res, path === '/v1/data' ? profileState(data) : { items: [] })
      }
      if (method === 'GET' && path === '/v1/music/search') {
        const query = new URL(req.url, 'http://localhost').searchParams.get('query')
        check(query?.trim().length > 0 && query.length <= 120, 'Provide a search query.', 422)
        const songs = [{ id: 'mock-moon-river', title: 'Moon River', artist: 'Audrey Hepburn' }, { id: 'mock-amazing-grace', title: 'Amazing Grace', artist: 'Traditional' }]
        return json(res, { items: songs.filter((song) => `${song.title} ${song.artist}`.toLowerCase().includes(query.toLowerCase())) })
      }
      if (method === 'POST' && path === '/v1/transcriptions') {
        check(payload.audio, 'Provide audio.', 422)
        return json(res, { turn_id: turnId, text: transcriptFor(data, config), segments: [] })
      }
      if (method === 'POST' && path === '/v1/chat') {
        check(typeof payload.message === 'string' && payload.message.trim() && payload.message.length <= 4000, 'Provide a message.', 422)
        const beforeProfile = { ...data.profile }
        const working = structuredClone(data)
        const answer = chatAnswer(working, payload.message, payload.onboarding_key)
        const text = config.reply || answer.text
        const started = Date.now()
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' })
        res.flushHeaders()
        const event = (name, value) => res.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`)
        if (answer.mode) event('mode', { value: answer.mode })
        if (Object.hasOwn(answer, 'next')) event('onboarding', { key: answer.next })
        const chunks = text.match(/\S+\s*|\s+/g) || []
        for (let i = 0; i < chunks.length; i++) {
          await delay(config.tokenMs, undefined, { signal })
          if (config.errors.includes('chat-stream') && i === Math.min(2, chunks.length - 1)) { event('error', { detail: 'Simulated stream failure.' }); return res.end() }
          event('token', { turn_id: turnId, text: chunks[i] })
        }
        check(!cancelled.has(turnId) && requestRevision === revision, 'Turn interrupted', 409)
        // Only apply fields changed by this turn, preserving concurrent profile edits.
        for (const [key, value] of Object.entries(working.profile)) if (value !== beforeProfile[key]) data.profile[key] = value
        data.updatedAt = new Date().toISOString()
        data.history = [{ turn_id: turnId, created_at: data.updatedAt, user: payload.message, model: answer.mode === 'play' ? 'play_mode' : 'mock-chat', assistant: text, duration_ms: Date.now() - started }, ...data.history.filter((turn) => turn.turn_id !== turnId)]
        persist(); event('done', { turn_id: turnId }); return res.end()
      }
      if (method === 'POST' && path === '/v1/speech') {
        check(typeof payload.text === 'string' && payload.text.trim() && payload.text.length <= 2000, 'Provide speech text.', 422)
        const bytes = makeWav(config.speechSeconds, 0, [], true)
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'X-Turn-ID': turnId, 'Content-Length': bytes.length })
        return res.end(bytes)
      }
      if (method === 'GET' && path === '/api/status') return json(res, engineState())
      if (method === 'POST' && path === '/api/setup') {
        if (config.engine === 'cold' && !setupUntil) setupUntil = Date.now() + Math.max(config.composeMs, 500)
        return json(res, engineState().setup, 202)
      }
      if (method === 'GET' && path === '/api/settings') return json(res, data.settings)
      if (method === 'POST' && path === '/api/settings') { data.settings = validateSettings({ ...data.settings, ...payload }); persist(); return json(res, data.settings) }
      if (method === 'GET' && path === '/api/assets') return json(res, ['default_sound.wav'])
      if (method === 'GET' && path === '/api/samples') return json(res, ['mock-humming.wav'])
      if (method === 'GET' && path === '/samples/mock-humming.wav') return wav(res, { duration: 5, seed: 0, effects: [] })
      if (method === 'GET' && path === '/api/compositions') return json(res, data.compositions.map((item) => ({ ...item, url: `/api/compositions/${item.id}` })))
      if (method === 'DELETE' && path === '/api/compositions') { revision++; data.compositions = []; persist(); res.writeHead(204); return res.end() }
      if (method === 'POST' && path === '/api/compose') {
        check(payload.audio, 'Provide audio.', 422)
        let overrides
        try { overrides = JSON.parse(payload.settings || '{}') } catch { throw problem(400, 'Invalid generation settings.') }
        const settings = validateSettings({ ...data.settings, ...overrides })
        engineState()
        check(settings.use_default || config.engine === 'ready', 'The mock audio engine is not ready.', 503)
        if (!settings.use_default) await delay(config.composeMs, undefined, { signal })
        check(requestRevision === revision, 'Mock data changed. Retry the request.', 409)
        const seed = settings.seed < 0 ? data.compositions.length + 3 : settings.seed
        const item = { id: `mock-${randomUUID()}`, created_at: new Date().toISOString(), duration: settings.seconds, seed, effects: [] }
        data.compositions.unshift(item); persist()
        return wav(res, item, { 'X-Composition-ID': item.id, 'X-Generation-Seed': String(seed), 'Content-Disposition': `attachment; filename="${item.id}.wav"` })
      }
      const composition = path.match(/^\/api\/compositions\/([^/]+)(?:\/effects(?:\/([^/]+))?)?$/)
      if (composition) {
        const item = data.compositions.find((item) => item.id === composition[1])
        check(item, 'Composition not found.', 404)
        if (path.includes('/effects')) {
          if (method === 'POST' && !composition[2]) {
            const { at, effect, intensity, volume = 1, pitch } = payload
            check(Number.isFinite(at) && at >= 0 && at < item.duration && ['piano', 'guitar', 'bells', 'drum'].includes(effect) && Number.isFinite(intensity) && intensity >= 0.1 && intensity <= 1 && Number.isFinite(volume) && volume >= 0 && volume <= 1 && ['low', 'high'].includes(pitch), 'Choose a valid effect, intensity, volume, pitch, and timestamp.')
            item.effects.push({ id: randomUUID(), at, effect, intensity, volume, pitch })
            item.effects.sort((a, b) => a.at - b.at)
          } else if (method === 'DELETE' && composition[2]) {
            check(item.effects.some((effect) => effect.id === composition[2]), 'Effect not found.', 404)
            item.effects = item.effects.filter((effect) => effect.id !== composition[2])
          } else throw problem(405, 'Method not allowed.')
          persist(); return json(res, { duration: item.duration, effects: item.effects })
        }
        if (method === 'GET') return wav(res, item)
        if (method === 'DELETE') { data.compositions = data.compositions.filter((other) => other !== item); persist(); res.writeHead(204); return res.end() }
      }
      throw problem(404, `No mock route for ${method} ${path}`)
    } catch (error) {
      if (signal.aborted) return res.end()
      if (res.headersSent) { res.end(); return }
      if (!error.status) console.error(error)
      json(res, { detail: error.status ? error.message : 'Mock server error. Check the terminal.' }, error.status || 500)
    } finally { if (turnId && turns.get(turnId) === controller) turns.delete(turnId) }
  })
  const sockets = new WebSocketServer({ noServer: true, maxPayload: maxUpload })
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url, 'http://localhost').pathname
    const match = path.match(/^\/v1\/live\/([^/]+)$/)
    if (!match) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      const id = match[1]
      let timer, finalTimer, received = false, finishing = false, total = 0
      const transcript = transcriptFor(data, config)
      const send = (payload) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)) }
      log('WS', path, 101)
      live.set(id, ws)
      ws.finish = (text = received ? transcript : '') => {
        if (finishing) return
        finishing = true; clearTimeout(timer)
        finalTimer = setTimeout(() => { send({ type: 'final', text }); ws.close(1000, 'Transcript complete') }, config.delayMs)
      }
      ws.on('message', (bytes, binary) => {
        if (finishing) return
        try {
          if (config.errors.includes('transcription') || cancelled.has(id)) { send({ type: 'error', detail: 'Mock transcription unavailable.' }); ws.close(); return }
          if (binary) {
            total += bytes.length
            check(total <= maxUpload, 'Audio is limited to 25 MB')
            if (!received) timer = setTimeout(() => send({ type: 'partial', text: transcript }), config.liveMs)
            received = true
          } else {
            const message = JSON.parse(bytes.toString())
            if (message.type === 'start') check(Number.isFinite(message.sample_rate) && message.sample_rate >= 8000 && message.sample_rate <= 96000, 'Unsupported sample rate')
            else if (message.type === 'stop') ws.finish()
            else throw problem(400, 'Unknown live message')
          }
        } catch (error) { send({ type: 'error', detail: error.message }); ws.close() }
      })
      ws.on('error', () => ws.close())
      ws.on('close', () => { clearTimeout(timer); clearTimeout(finalTimer); if (live.get(id) === ws) live.delete(id) })
    })
  })
  return {
    server,
    async close() {
      interruptAll()
      for (const ws of sockets.clients) ws.terminate()
      sockets.close()
      const closed = new Promise((resolve) => server.close(resolve))
      server.closeAllConnections()
      await closed
    },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.MOCK_PORT || 8001)
  check(Number.isInteger(port) && port >= 1 && port <= 65535, 'MOCK_PORT must be between 1 and 65535.')
  const app = createMockServer(process.env.MOCK_DATA_FILE ? { dataFile: resolve(process.env.MOCK_DATA_FILE) } : {})
  app.server.on('error', (error) => { console.error(`[Mock] ${error.message}`); process.exitCode = 1 })
  app.server.listen(port, '127.0.0.1', () => console.log(`[Mock] http://127.0.0.1:${port} · controls and both APIs ready`))
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close() })
}
