import { test, expect, type APIRequestContext } from '@playwright/test'

const mock = 'http://127.0.0.1:8019'
async function control(request: APIRequestContext, path: string, data: object) {
  const response = await request.post(`${mock}/__mock/${path}`, { data })
  expect(response.ok()).toBeTruthy()
  return response.json()
}
test.beforeEach(async ({ request }) => {
  await control(request, 'reset', { preset: 'demo' })
  await control(request, 'config', { delayMs: 10, tokenMs: 5, liveMs: 100, speechSeconds: 0.2, composeMs: 500 })
})

test('profile saves, reloads, handles a save error, and deletes only the chosen data', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByText('Welcome back, Alex.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'For companions' }).click()
  const name = page.getByPlaceholder('First name, optional')
  await name.fill('Robin')
  await control(request, 'config', { errors: ['profile-save'] })
  await page.getByRole('button', { name: 'Save details', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Saving was not completed')
  await control(request, 'config', { errors: [] })
  await page.getByRole('button', { name: 'Save details', exact: true }).click()
  await expect(page.getByText('Details saved.', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Welcome back, Robin.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'For companions' }).click()
  await expect(name).toHaveValue('Robin')
  await page.getByRole('button', { name: 'Delete history', exact: true }).click()
  await page.getByRole('button', { name: 'Permanently delete history', exact: true }).click()
  await expect(page.getByText('Conversation history deleted. Personal details remain saved.')).toBeVisible()
  expect((await (await request.get('/api/v1/history')).json()).items).toHaveLength(0)
  await expect(name).toHaveValue('Robin')
  await page.getByRole('button', { name: 'Delete all saved data', exact: true }).click()
  await page.getByRole('button', { name: 'Permanently delete all data', exact: true }).click()
  await expect(name).toHaveValue('')
  expect(await (await request.get('/engine/api/compositions')).json()).toHaveLength(3)
})

test('saved songs play real WAVs, remove effects, and support deletion and empty state', async ({ page }) => {
  await page.goto('/songs')
  await expect(page.locator('.song-card')).toHaveCount(3)
  await page.getByRole('button', { name: /Play Composition/ }).first().click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Not now' }).click()
  await expect(page.getByRole('heading', { name: 'Your composition is playing' })).toBeVisible()
  await expect(page.getByLabel('Composition timeline with 1 mouth effect')).toBeVisible()
  await page.getByRole('button', { name: /Remove .* at 0:02/ }).click()
  await expect(page.getByLabel('Composition timeline with 0 mouth effects')).toBeVisible()
  await page.getByRole('button', { name: 'Back to your songs' }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /Delete Composition/ }).first().click()
  await expect(page.locator('.song-card')).toHaveCount(2)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete all songs' }).click()
  await expect(page.getByRole('heading', { name: 'No songs yet' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'No songs yet' })).toBeVisible()
})

test('live onboarding flows through SSE and speech into humming, setup and a saved composition', async ({ page, request }) => {
  await page.clock.install()
  await page.setViewportSize({ width: 1356, height: 657 })
  await control(request, 'reset', { preset: 'empty' })
  await control(request, 'config', { delayMs: 10, tokenMs: 10, liveMs: 100, speechSeconds: 0.2, composeMs: 1200, engine: 'cold' })
  // Keep real getUserMedia, MediaRecorder, audio decoding, WS and HTTP. Only
  // control the local silence detector so a fake microphone ends its hum.
  await page.addInitScript(() => {
    const input = { amplitude: 0.05 }
    Object.assign(window, { mockHum: input })
    AnalyserNode.prototype.getFloatTimeDomainData = function (samples: Float32Array) { samples.fill(input.amplitude) }
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Add details' })).toBeVisible()
  await page.getByRole('button', { name: 'Talk with Sound Flux', exact: true }).click()
  for (const text of ['Alex', '1950', 'Jazz and piano']) {
    await expect(page.locator('.transcript')).toHaveText(`You: ${text}`, { timeout: 10_000 })
    if (text === 'Alex') {
      const artwork = (await page.locator('.record-art > div').boundingBox())!
      const message = (await page.locator('.companion-message').boundingBox())!
      expect(artwork.height).toBeGreaterThanOrEqual(657 / 2)
      expect(artwork.y + artwork.height).toBeLessThanOrEqual(message.y)
    }
    await page.getByRole('button', { name: 'Finish speaking', exact: true }).click()
    await expect.poll(async () => (await (await request.get('/api/v1/history')).json()).items[0]?.user).toBe(text)
  }
  const player = page.getByRole('dialog', { name: 'Voice companion' })
  await expect(player.getByRole('img', { name: 'Music artwork' })).toBeVisible()
  await expect(player).toHaveClass(/focus-mode/)
  await expect(page.getByRole('button', { name: 'Humming…', exact: true })).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(1200)
  await page.evaluate(() => { (window as unknown as { mockHum: { amplitude: number } }).mockHum.amplitude = 0 })
  await expect(page.locator('.composer-overlay')).toBeVisible()
  await page.getByRole('alertdialog', { name: 'Ready to start playing?' })
    .getByRole('button', { name: 'Not now' }).click()
  await expect(player.getByRole('button', { name: 'Pause music' })).toBeVisible({ timeout: 15_000 })
  await page.clock.fastForward(15_000)
  const completion = page.getByRole('alertdialog', { name: 'Is your music complete?' })
  await expect(completion).toBeVisible()
  await expect(player.getByRole('button', { name: 'Play music' })).toBeVisible()
  await completion.getByRole('button', { name: 'Keep making music' }).click()
  await expect(player.getByRole('button', { name: 'Pause music' })).toBeVisible()
  await page.clock.fastForward(15_000)
  await page.getByRole('alertdialog', { name: 'Is your music complete?' })
    .getByRole('button', { name: 'Complete and save' }).click()
  await expect(page).toHaveURL(/\/songs$/)
  await expect(page.locator('.song-card')).toHaveCount(1)
  expect((await (await request.get('/api/v1/profile')).json()).onboarding).toBeNull()
  expect(await (await request.get('/engine/api/compositions')).json()).toHaveLength(1)
  const logs = (await (await request.get(`${mock}/__mock`)).json()).logs
  expect(logs.some((entry: { method: string }) => entry.method === 'WS')).toBeTruthy()
  expect(logs.some((entry: { path: string }) => entry.path === '/api/setup')).toBeTruthy()
})

test('debug settings persist and the mock control page changes scenarios', async ({ page, request }) => {
  await page.goto('/debug')
  const strength = page.getByRole('slider', { name: /Transformation strength/ })
  await expect(strength).toHaveValue('0.8')
  await strength.press('ArrowLeft')
  await expect(page.locator('.debug-settings-status')).toHaveText('Saved for the next composition.')
  await page.reload()
  await expect(strength).toHaveValue('0.75')
  await page.goto(`${mock}/?frontendPort=5179`)
  await expect(page.getByRole('heading', { name: 'Backend-Mockup' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Frontend öffnen/ })).toHaveAttribute('href', 'http://localhost:5179')
  await page.getByRole('button', { name: 'API offline', exact: true }).click()
  await expect.poll(async () => (await request.get('/api/health')).status()).toBe(503)
  await page.getByRole('button', { name: 'Normal', exact: true }).click()
  await expect.poll(async () => (await request.get('/api/health')).status()).toBe(200)
  await page.setViewportSize({ width: 320, height: 900 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})

test('a transcript sent from the controls releases the microphone before playback', async ({ page, request }) => {
  await control(request, 'reset', { preset: 'empty' })
  await control(request, 'config', { delayMs: 10, tokenMs: 5, liveMs: 100, speechSeconds: 2 })
  await page.addInitScript(() => {
    const streams: MediaStream[] = []
    Object.assign(window, { mockStreams: streams })
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await capture(...args)
      streams.push(stream)
      return stream
    }
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Add details' })).toBeVisible()
  await page.getByRole('button', { name: 'Talk with Sound Flux', exact: true }).click()
  await expect(page.locator('.transcript')).toHaveText('You: Alex', { timeout: 10_000 })
  expect(await page.evaluate(() => (window as unknown as { mockStreams: MediaStream[] }).mockStreams.some((stream) => stream.getTracks().some((track) => track.readyState === 'live')))).toBeTruthy()
  expect((await control(request, 'transcript', { text: 'Robin' })).sent).toBe(1)
  await expect(page.locator('.companion-message h2')).toHaveText('Thank you, Robin. What year were you born?')
  expect(await page.evaluate(() => (window as unknown as { mockStreams: MediaStream[] }).mockStreams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')))).toBeTruthy()
  await page.getByRole('button', { name: 'Stop conversation immediately' }).click()
  await expect(page.getByRole('button', { name: 'Stop conversation immediately' })).toHaveCount(0)
  await expect.poll(async () => (await (await request.get(`${mock}/__mock`)).json()).activeTurns.length).toBe(0)
})
