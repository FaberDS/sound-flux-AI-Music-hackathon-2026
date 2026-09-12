import { expect, test } from '@playwright/test'
import { mockSavedApi } from './saved-api'

function wav() {
  const samples = 8_000 * 2
  const output = Buffer.alloc(44 + samples * 2)
  output.write('RIFF')
  output.writeUInt32LE(36 + samples * 2, 4)
  output.write('WAVEfmt ', 8)
  output.writeUInt32LE(16, 16)
  output.writeUInt16LE(1, 20)
  output.writeUInt16LE(1, 22)
  output.writeUInt32LE(8_000, 24)
  output.writeUInt32LE(16_000, 28)
  output.writeUInt16LE(2, 32)
  output.writeUInt16LE(16, 34)
  output.write('data', 36)
  output.writeUInt32LE(samples * 2, 40)
  return output
}

test('hands the post-greeting microphone over to the audio engine', async ({ page }) => {
  let uploads = 0
  let body = ''
  let releaseComposition!: () => void
  const composition = new Promise<void>((resolve) => {
    releaseComposition = resolve
  })
  await page.addInitScript(() => {
    const state = { level: 0.05 }
    Object.assign(window, { audioEngineTest: state })
    navigator.mediaDevices.getUserMedia = async () =>
      ({ getTracks: () => [{ stop() {} }] }) as unknown as MediaStream
    AudioContext.prototype.createMediaStreamSource = () =>
      ({ connect() {}, disconnect() {} }) as unknown as MediaStreamAudioSourceNode
    AudioContext.prototype.createAnalyser = () =>
      ({
        fftSize: 2048,
        getFloatTimeDomainData(samples: Float32Array) {
          samples.fill(state.level)
        },
        disconnect() {},
      }) as unknown as AnalyserNode
    class Recorder {
      state: RecordingState = 'inactive'
      mimeType = 'audio/wav'
      ondataavailable: ((event: BlobEvent) => void) | null = null
      onstop: (() => void) | null = null
      onerror: (() => void) | null = null
      start() {
        this.state = 'recording'
        setTimeout(() => {
          state.level = 0
        }, 1_200)
      }
      stop() {
        if (this.state === 'inactive') return
        this.state = 'inactive'
        const samples = new Uint8Array(44 + 8_000 * 2)
        const view = new DataView(samples.buffer)
        const text = (offset: number, value: string) =>
          [...value].forEach((character, index) =>
            view.setUint8(offset + index, character.charCodeAt(0)),
          )
        text(0, 'RIFF')
        view.setUint32(4, 36 + 8_000 * 2, true)
        text(8, 'WAVEfmt ')
        view.setUint32(16, 16, true)
        view.setUint16(20, 1, true)
        view.setUint16(22, 1, true)
        view.setUint32(24, 8_000, true)
        view.setUint32(28, 16_000, true)
        view.setUint16(32, 2, true)
        view.setUint16(34, 16, true)
        text(36, 'data')
        view.setUint32(40, 8_000 * 2, true)
        this.ondataavailable?.({ data: new Blob([samples], { type: this.mimeType }) } as BlobEvent)
        setTimeout(() => this.onstop?.(), 0)
      }
    }
    Object.assign(window, { MediaRecorder: Recorder })
    HTMLMediaElement.prototype.play = function () {
      setTimeout(() => this.onended?.(new Event('ended')), 0)
      return Promise.resolve()
    }
  })
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { chat_model: 'test-model' } }),
  )
  await page.route('**/api/v1/speech', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: wav() }),
  )
  await page.route('**/api/v1/turns/*/interrupt', (route) =>
    route.fulfill({ json: { interrupted: true } }),
  )
  await mockSavedApi(page, {
    name: 'Alex',
    birth_year: '1950',
    mood: 'calm',
    music_preferences: 'piano',
  })
  await page.route('**/engine/api/status', (route) =>
    route.fulfill({ json: { ready: true } }),
  )
  await page.route('**/engine/api/compose', (route) => {
    uploads++
    body = route.request().postDataBuffer()!.toString('latin1')
    return composition.then(() =>
      route.fulfill({ contentType: 'audio/wav', body: wav() }),
    )
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Talk with Sound Flux' }).click()
  await expect(
    page.getByRole('heading', { name: /Hum a melody for me/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Humming…' }),
  ).toBeVisible()
  await expect.poll(() => uploads).toBe(1)
  expect(uploads).toBe(1)
  expect(body).toContain('name="audio"')
  expect(body).toContain('RIFF')
  expect(body).toContain('name="settings"')
  await expect(page.locator('.composer-overlay')).toBeVisible()
  releaseComposition()
  await expect(page.getByRole('button', { name: 'Pause music' })).toBeVisible()
})
