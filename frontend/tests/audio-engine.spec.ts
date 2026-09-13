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
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 204 })
      : route.fulfill({ contentType: 'audio/wav', body: wav() }),
  )
  await page.route('**/engine/api/compositions', (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 204 })
      : route.fulfill({
        json: [{
        id: '20260913T123456123456Z-42',
        created_at: '2026-09-13T12:34:56Z',
        duration: 2,
        effects: [{
          id: 'effect-1',
          at: 0.5,
          effect: 'piano',
          intensity: 0.8,
          volume: 0.6,
          pitch: 'high',
        }],
      }, {
        id: '20260913T123457123456Z-43',
        created_at: '2026-09-13T12:35:57Z',
        duration: 2,
        effects: [],
      }],
      }),
  )
  await page.route('**/engine/api/compositions/*/effects/*', (route) =>
    route.fulfill({ json: { duration: 2, effects: [] } }),
  )

  await page.goto('/')
  const songsButton = page.getByRole('button', { name: /Your songs/ })
  await expect(songsButton).toBeVisible()
  expect((await songsButton.boundingBox())!.y).toBeLessThan(
    (await page.getByRole('button', { name: 'Start music' }).boundingBox())!.y,
  )
  await songsButton.click()
  await expect(page).toHaveURL(/\/songs$/)
  await expect(page.getByRole('heading', { name: 'YOUR SONGS' })).toBeVisible()
  await expect(page.locator('.song-card')).toHaveCount(2)
  const names = await page.locator('.song-details strong').allTextContents()
  expect(new Set(names).size).toBe(2)
  for (const name of names) {
    await expect(page.getByRole('button', { name: `Play ${name}` })).toBeVisible()
    await expect(page.getByRole('button', { name: `Delete ${name}` })).toContainText('Delete')
  }
  expect(await page.locator('.song-card img').evaluateAll((images) =>
    new Set(images.map((image) => image.getAttribute('src'))).size,
  )).toBe(2)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /Delete Composition/ }).last().click()
  await expect(page.locator('.song-card')).toHaveCount(1)
  await page.getByRole('button', { name: /Play Composition/ }).click()
  const cameraAlert = page.getByRole('alertdialog', {
    name: 'Add effects with your mouth?',
  })
  await expect(cameraAlert).toBeVisible()
  await expect(cameraAlert.locator('.mouth-sound-pictogram')).toBeVisible()
  await cameraAlert.getByRole('button', { name: 'Not now' }).click()
  await expect(
    page.getByRole('heading', { name: 'Your composition is playing' }),
  ).toBeVisible()
  await expect(
    page.getByRole('img', { name: 'Artwork for your saved composition' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enable camera' })).toBeVisible()
  const timeline = page.getByLabel('Composition timeline with 1 mouth effect')
  await expect(timeline).toBeVisible()
  await expect(timeline.locator('.timeline-effect')).toHaveAttribute('title', /60% volume/)
  const removeEffect = page.getByRole('button', { name: 'Remove Piano at 0:00' })
  await expect(removeEffect).toBeVisible()
  expect((await removeEffect.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.setViewportSize({ width: 320, height: 1000 })
  await expect(timeline.locator('.timeline-scale')).toBeHidden()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const mouthControls = await page
    .getByRole('region', { name: 'Mouth beatbox' })
    .boundingBox()
  const timelineBox = await timeline.boundingBox()
  expect(mouthControls).not.toBeNull()
  expect(timelineBox).not.toBeNull()
  expect(mouthControls!.y + mouthControls!.height).toBeLessThanOrEqual(timelineBox!.y)
  expect(Math.abs(mouthControls!.width - timelineBox!.width)).toBeLessThan(1)
  expect(mouthControls!.y + mouthControls!.height).toBeLessThanOrEqual(1000)
  await removeEffect.click()
  await expect(page.getByLabel('Composition timeline with 0 mouth effects')).toBeVisible()
  await expect(page.getByLabel('Effect', { exact: true })).toHaveValue('drum')
  await expect(
    page.getByRole('region', { name: 'Mouth beatbox' }).getByRole('slider', { name: 'Effect volume' }),
  ).toHaveValue('1')
  await expect(page.getByRole('group', { name: 'Pitch' })).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Voice companion' })
      .getByRole('button', { name: 'Pause music' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Back to your songs' }).click()
  await expect(page).toHaveURL(/\/songs$/)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete all songs' }).click()
  await expect(page.getByRole('heading', { name: 'No songs yet' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to music' }).click()
  await expect(page.getByRole('button', { name: /Your songs/ })).toHaveCount(0)
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
  const firstStartedAt = Date.now()
  await page.getByRole('button', { name: 'Talk with Sound Flux' }).click()
  await expect(
    page.getByText('Preparing your style of music'),
  ).toBeVisible()
  await expect(page.getByRole('img', { name: 'Music artwork' })).toHaveCount(0)
  await expect(page.getByRole('img', { name: 'Music artwork' })).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole('button', { name: 'Humming…' })).toBeVisible()
  expect(Date.now() - firstStartedAt).toBeLessThan(3_000)
  await expect(
    page.getByRole('region', { name: 'Voice companion' }),
  ).toHaveClass(/session-active/)
  await expect.poll(() => uploads).toBe(1)
  expect(body).toContain('name="audio"')
  await expect(page.getByRole('button', { name: 'Pause music' })).toBeVisible()
  const repeatStartedAt = Date.now()
  await page.getByRole('button', { name: 'Talk with Sound Flux' }).click()
  await expect(page.getByRole('button', { name: 'Humming…' })).toBeVisible()
  expect(Date.now() - repeatStartedAt).toBeLessThan(1_500)
})
