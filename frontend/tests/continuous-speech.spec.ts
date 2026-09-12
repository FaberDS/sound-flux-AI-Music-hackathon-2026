import { expect, test, type Page } from '@playwright/test'
import { mockSavedApi } from './saved-api'

async function prepare(page: Page) {
  await page.route('**/api/health', route => route.fulfill({ json: { chat_model: 'test-model' } }))
  await page.route('**/api/v1/turns/*/interrupt', route => route.fulfill({ json: { interrupted: true } }))
  await mockSavedApi(page)
  await page.addInitScript(() => {
    const state = { amplitude: 0, streams: [] as MediaStream[] }
    Object.assign(window, { speechTest: state })
    AnalyserNode.prototype.getFloatTimeDomainData = function (samples: Float32Array) { samples.fill(state.amplitude) }
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await capture(...args)
      state.streams.push(stream)
      return stream
    }
  })
}

async function speakThenPause(page: Page) {
  await page.evaluate(() => { (window as unknown as { speechTest: { amplitude: number } }).speechTest.amplitude = 0.06 })
  await page.waitForTimeout(350)
  await page.evaluate(() => { (window as unknown as { speechTest: { amplitude: number } }).speechTest.amplitude = 0 })
}

test('sends after speech and silence, listens again after the reply, and stops every microphone track', async ({ page }) => {
  await prepare(page)
  let uploads = 0
  await page.route('**/api/v1/transcriptions', route => { uploads++; return route.fulfill({ json: { text: 'Ich mag Musik.' } }) })
  await page.route('**/api/v1/chat', route => route.fulfill({ contentType: 'text/event-stream', body: 'event: token\ndata: {"text":"Lass uns spielen."}\n\nevent: done\ndata: {}\n\n' }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Antworten vorlesen' }).click()
  await page.getByLabel('Nach Sprechpausen automatisch senden').check()
  await page.getByRole('button', { name: 'Mit Sound Flux sprechen' }).click()
  await expect(page.getByRole('img', { name: 'Sound Flux: Ich höre zu' })).toBeVisible()
  await page.waitForTimeout(1400)
  expect(uploads).toBe(0)
  await speakThenPause(page)
  await expect.poll(() => uploads).toBe(1)
  await expect.poll(() => page.evaluate(() => (window as unknown as { speechTest: { streams: MediaStream[] } }).speechTest.streams.length)).toBe(2)
  await expect(page.getByRole('img', { name: 'Sound Flux: Ich höre zu' })).toBeVisible()
  await page.getByRole('button', { name: 'Gespräch beenden', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Mit Sound Flux sprechen' })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { speechTest: { streams: MediaStream[] } }).speechTest.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true)
  expect(uploads).toBe(1)
})

test('transcription failures end automatic listening instead of starting a retry loop', async ({ page }) => {
  await prepare(page)
  await page.route('**/api/v1/transcriptions', route => route.fulfill({ status: 503 }))
  await page.goto('/')
  await page.getByLabel('Nach Sprechpausen automatisch senden').check()
  await page.getByRole('button', { name: 'Mit Sound Flux sprechen' }).click()
  await expect(page.getByRole('img', { name: 'Sound Flux: Ich höre zu' })).toBeVisible()
  await speakThenPause(page)
  await expect(page.getByRole('alert')).toContainText('Die Sprachbegleitung ist gerade nicht erreichbar')
  await expect(page.getByRole('button', { name: 'Gespräch beenden', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { speechTest: { streams: MediaStream[] } }).speechTest.streams.length)).toBe(1)
})
