import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { createMockServer } from './server.mjs'
import { makeWav } from './audio.mjs'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sound-flux-mock-'))
  const dataFile = join(dir, 'state.json')
  let app, origin
  async function start() {
    app = createMockServer({ dataFile })
    app.server.listen(0, '127.0.0.1')
    await once(app.server, 'listening')
    origin = `http://127.0.0.1:${app.server.address().port}`
  }
  await start()
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }) })
  const api = async (path, payload, method = payload === undefined ? 'GET' : 'POST') => {
    const response = await fetch(origin + path, { method, ...(payload === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) })
    return { response, data: response.status === 204 ? null : response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text() }
  }
  await api('/__mock/config', { delayMs: 0, tokenMs: 0, composeMs: 0, liveMs: 0 })
  return { api, url: () => origin, restart: async () => { await app.close(); await start() } }
}
function upload() {
  const form = new FormData()
  form.set('audio', new Blob([makeWav(1)], { type: 'audio/wav' }), 'humming.wav')
  form.set('settings', '{}')
  form.set('turn_id', 'upload-turn')
  return form
}

test('serves independent demo data, settings and playable songs; survives restart', async (t) => {
  const f = await fixture(t)
  assert.equal((await f.api('/health')).data.chat_model, 'mock-chat')
  assert.equal((await f.api('/__mock')).data.service, 'sound-flux-backend-mockup')
  await f.api('/v1/profile/name', { value: 'Robin Example' }, 'PUT')
  const settings = (await f.api('/api/settings')).data
  await f.api('/api/settings', { ...settings, seconds: 20 })
  await f.restart()
  assert.equal((await f.api('/v1/profile')).data.properties.find((p) => p.key === 'name').value, 'Robin')
  assert.equal((await f.api('/api/settings')).data.seconds, 20)
  const songs = (await f.api('/api/compositions')).data
  assert.equal(songs.length, 3)
  const response = await fetch(f.url() + songs[0].url)
  const wav = Buffer.from(await response.arrayBuffer())
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.readUInt32LE(40), songs[0].duration * 16000 * 2)
})

test('onboarding streams real SSE frames, persists turns and switches to music mode', async (t) => {
  const { api } = await fixture(t)
  await api('/__mock/reset', { preset: 'empty' })
  await api('/__mock/config', { delayMs: 0, tokenMs: 0 })
  for (const [key, message, next] of [['name', 'Alex', 'birth_year'], ['birth_year', '1950', 'music_preferences'], ['music_preferences', 'Jazz', null]]) {
    assert.equal((await api('/v1/profile')).data.onboarding.key, key)
    const reply = await api('/v1/chat', { turn_id: key, message, onboarding_key: key })
    assert.match(reply.response.headers.get('content-type'), /text\/event-stream/)
    assert.match(reply.data, /event: token/)
    assert.match(reply.data, /event: done/)
    assert.match(reply.data, new RegExp(`"key":${JSON.stringify(next)}`))
    if (next === null) assert.match(reply.data, /"value":"play"/)
  }
  assert.equal((await api('/v1/profile')).data.onboarding, null)
  assert.equal((await api('/v1/history')).data.items.length, 3)
  await api('/v1/history', undefined, 'DELETE')
  assert.equal((await api('/v1/history')).data.items.length, 0)
  assert.equal((await api('/v1/profile')).data.onboarding, null)
  await api('/v1/data', undefined, 'DELETE')
  assert.equal((await api('/v1/profile')).data.onboarding.key, 'name')
})

test('live WebSocket accepts PCM, sends partial and final; upload and speech use same turn', async (t) => {
  const f = await fixture(t)
  await f.api('/__mock/config', { transcript: 'I love piano.' })
  const socket = new WebSocket(f.url().replace('http', 'ws') + '/v1/live/live-turn')
  t.after(() => socket.terminate())
  await once(socket, 'open')
  const partial = once(socket, 'message')
  socket.send(JSON.stringify({ type: 'start', sample_rate: 16000 }))
  socket.send(Buffer.alloc(32000))
  assert.deepEqual(JSON.parse((await partial)[0]), { type: 'partial', text: 'I love piano.' })
  const final = once(socket, 'message')
  socket.send(JSON.stringify({ type: 'stop' }))
  assert.deepEqual(JSON.parse((await final)[0]), { type: 'final', text: 'I love piano.' })
  const response = await fetch(f.url() + '/v1/transcriptions', { method: 'POST', body: upload() })
  assert.equal((await response.json()).text, 'I love piano.')
  const speech = await fetch(f.url() + '/v1/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hello', turn_id: 'live-turn' }) })
  assert.equal(speech.headers.get('x-turn-id'), 'live-turn')
  assert.equal(Buffer.from(await speech.arrayBuffer()).toString('ascii', 8, 12), 'WAVE')
})

test('mock controls deliver a live transcript and simulate transcription errors', async (t) => {
  const f = await fixture(t)
  const ws = new WebSocket(f.url().replace('http', 'ws') + '/v1/live/controlled')
  t.after(() => ws.terminate())
  await once(ws, 'open')
  const final = once(ws, 'message')
  assert.equal((await f.api('/__mock/transcript', { text: 'Alex' })).data.sent, 1)
  assert.equal(JSON.parse((await final)[0]).text, 'Alex')
  await f.api('/__mock/config', { errors: ['transcription'] })
  const failing = new WebSocket(f.url().replace('http', 'ws') + '/v1/live/failing')
  t.after(() => failing.terminate())
  await once(failing, 'open')
  const error = once(failing, 'message')
  failing.send(JSON.stringify({ type: 'start', sample_rate: 16000 }))
  assert.equal(JSON.parse((await error)[0]).type, 'error')
})

test('composition generation, audible effects, effect removal, and deletion persist', async (t) => {
  const f = await fixture(t)
  const response = await fetch(f.url() + '/api/compose', { method: 'POST', body: upload() })
  assert.equal(response.status, 200)
  const id = response.headers.get('x-composition-id')
  const original = Buffer.from(await response.arrayBuffer())
  const added = await f.api(`/api/compositions/${id}/effects`, { at: 1, effect: 'drum', intensity: 0.7, volume: 0.8, pitch: 'low' })
  assert.equal(added.data.effects.length, 1)
  const rendered = Buffer.from(await (await fetch(f.url() + `/api/compositions/${id}`)).arrayBuffer())
  assert.notDeepEqual(rendered, original)
  await f.restart()
  const list = (await f.api('/api/compositions')).data
  assert.equal(list[0].effects.length, 1)
  await f.api(`/api/compositions/${id}/effects/${added.data.effects[0].id}`, undefined, 'DELETE')
  const restored = Buffer.from(await (await fetch(f.url() + `/api/compositions/${id}`)).arrayBuffer())
  assert.deepEqual(restored, original)
  await f.api(`/api/compositions/${id}`, undefined, 'DELETE')
  assert.equal((await f.api(`/api/compositions/${id}`)).response.status, 404)
  await f.api('/api/compositions', undefined, 'DELETE')
  assert.deepEqual((await f.api('/api/compositions')).data, [])
})

test('cold engine becomes ready after setup; validation and error controls recover', async (t) => {
  const { api } = await fixture(t)
  await api('/__mock/config', { engine: 'cold', errors: ['profile-save'] })
  assert.equal((await api('/v1/profile/name', { value: 'Robin' }, 'PUT')).response.status, 503)
  assert.equal((await api('/v1/profile')).response.status, 200)
  assert.equal((await api('/api/status')).data.ready, false)
  assert.equal((await api('/api/setup', {})).response.status, 202)
  await new Promise((resolve) => setTimeout(resolve, 550))
  assert.equal((await api('/api/status')).data.ready, true)
  await api('/__mock/config', { errors: [] })
  assert.equal((await api('/v1/profile/name', { value: 'Robin' }, 'PUT')).response.status, 200)
  assert.equal((await api('/api/settings', { seconds: 0 })).response.status, 400)
  assert.equal((await api('/__mock/config', { delayMs: -10 })).response.status, 400)
  assert.equal((await api('/v1/chat', { message: '' })).response.status, 422)
  assert.equal((await api('/api/compose', {})).response.status, 422)
})

test('interruption and stream errors never save incomplete conversations', async (t) => {
  const f = await fixture(t)
  const count = (await f.api('/v1/history')).data.items.length
  await f.api('/__mock/config', { tokenMs: 100 })
  const response = await fetch(f.url() + '/v1/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turn_id: 'interrupt-me', message: 'Hello' }) })
  const reader = response.body.getReader()
  await reader.read()
  assert.equal((await f.api('/v1/turns/interrupt-me/interrupt', {})).data.interrupted, true)
  await reader.cancel()
  assert.equal((await f.api('/v1/history')).data.items.length, count)
  assert.equal((await f.api('/v1/speech', { turn_id: 'interrupt-me', text: 'Hello' })).response.status, 409)
  await f.api('/__mock/config', { errors: ['chat-stream'], tokenMs: 0 })
  const failed = await f.api('/v1/chat', { message: 'Hello' })
  assert.match(failed.data, /event: error/)
  assert.doesNotMatch(failed.data, /event: done/)
  assert.equal((await f.api('/v1/history')).data.items.length, count)
})

test('reset prevents an in-flight composition from restoring deleted mock data', async (t) => {
  const f = await fixture(t)
  await f.api('/__mock/config', { composeMs: 350 })
  const pending = fetch(f.url() + '/api/compose', { method: 'POST', body: upload() })
  await new Promise((resolve) => setTimeout(resolve, 100))
  await f.api('/__mock/reset', { preset: 'empty' })
  assert.equal((await pending).status, 409)
  assert.deepEqual((await f.api('/api/compositions')).data, [])
})
