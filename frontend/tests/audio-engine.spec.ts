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

test('opens a saved composition in the artwork player', async ({ page }) => {
  await page.addInitScript(() => {
    class Context {
      state = 'running'
      destination = {}
      async resume() {}
      createGain() {
        return {
          gain: { value: 0, setTargetAtTime() {} },
          connect() {},
        }
      }
      async decodeAudioData() {
        return {
          sampleRate: 8_000,
          getChannelData() {
            return new Float32Array(8_000)
          },
        } as unknown as AudioBuffer
      }
      createBufferSource() {
        return { buffer: null, loop: false, connect() {}, disconnect() {}, start() {}, stop() {} }
      }
    }
    Object.defineProperty(window, 'AudioContext', { value: Context })
  })
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { chat_model: 'test-model' } }),
  )
  await mockSavedApi(page)
  await page.route('**/engine/api/compositions/*', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: wav() }),
  )
  await page.route('**/engine/api/compositions', (route) =>
    route.fulfill({
      json: [{
        id: '20260913T123456123456Z-42',
        created_at: '2026-09-13T12:34:56Z',
        duration: 2,
        beats: [0.5],
      }],
    }),
  )

  await page.goto('/')
  await page.getByRole('button', { name: /Play composition from/ }).click()
  await expect(
    page.getByRole('heading', { name: 'Your composition is playing' }),
  ).toBeVisible()
  await expect(
    page.getByRole('img', { name: 'Artwork for your saved composition' }),
  ).toBeVisible()
  await expect(
    page.getByRole('img', { name: 'Composition timeline with 1 mouth beat' }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Voice companion' })
      .getByRole('button', { name: 'Pause music' }),
  ).toBeVisible()
})

test('prepares music, then records the hum before composing', async ({ page }) => {
  let uploads = 0
  let body = ''
  await page.addInitScript(() => {
    const state = { level: 0.05 }
    navigator.mediaDevices.getUserMedia = async () =>
      ({ getTracks: () => [{ stop() {} }] }) as unknown as MediaStream
    class Context {
      state = 'running'
      currentTime = 0
      destination = {}
      async resume() {}
      async close() {}
      createGain() {
        return {
          gain: {
            value: 0,
            setTargetAtTime() {},
            setValueAtTime() {},
            linearRampToValueAtTime() {},
            exponentialRampToValueAtTime() {},
          },
          connect() {},
          disconnect() {},
        }
      }
      createOscillator() {
        return {
          type: 'sine',
          frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
          disconnect() {},
          start() {},
          stop() {},
        }
      }
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} }
      }
      createAnalyser() {
        return {
          fftSize: 2048,
          getFloatTimeDomainData(samples: Float32Array) {
            samples.fill(state.level)
          },
          disconnect() {},
        }
      }
      async decodeAudioData() {
        return {
          sampleRate: 8_000,
          getChannelData() {
            return new Float32Array(8_000)
          },
        } as unknown as AudioBuffer
      }
      createBufferSource() {
        return { buffer: null, loop: false, connect() {}, disconnect() {}, start() {}, stop() {} }
      }
    }
    Object.defineProperty(window, 'AudioContext', { value: Context })
    class Recorder {
      state: RecordingState = 'inactive'
      mimeType = 'audio/wav'
      ondataavailable: ((event: BlobEvent) => void) | null = null
      onstop: (() => void) | null = null
      start() {
        this.state = 'recording'
        setTimeout(() => {
          state.level = 0
        }, 1_200)
      }
      stop() {
        if (this.state === 'inactive') return
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob([new Uint8Array(8_000)], { type: this.mimeType }) } as BlobEvent)
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
    return route.fulfill({ contentType: 'audio/wav', body: wav() })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Talk with Sound Flux' }).click()
  await expect(
    page.getByText('Preparing your style of music'),
  ).toBeVisible()
  await expect(page.getByRole('img', { name: 'Music artwork' })).toHaveCount(0)
  await expect(page.getByRole('img', { name: 'Music artwork' })).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole('button', { name: 'Humming…' })).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Voice companion' }),
  ).toHaveClass(/session-active/)
  await expect.poll(() => uploads).toBe(1)
  expect(body).toContain('name="audio"')
  await expect(page.getByRole('button', { name: 'Pause music' })).toBeVisible()
})
