import AxeBuilder from '@axe-core/playwright'
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

test('connects Chordcat and turns note taps into the chosen sound', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const listeners = new Set<(event: MIDIMessageEvent) => void>()
    let sounds = 0
    const input = {
      name: 'CHORDCAT',
      state: 'connected',
      async open() { return input },
      async close() { return input },
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (type === 'midimessage' && typeof listener === 'function')
          listeners.add(listener as (event: MIDIMessageEvent) => void)
      },
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (type === 'midimessage' && typeof listener === 'function')
          listeners.delete(listener as (event: MIDIMessageEvent) => void)
      },
    }
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async () => ({ inputs: new Map([['chordcat', input]]) }),
    })
    Object.assign(window, {
      playChordcatNote() {
        const event = { data: new Uint8Array([0x90, 60, 100]) } as MIDIMessageEvent
        listeners.forEach((listener) => listener(event))
      },
      chordcatSounds: () => sounds,
    })
    class Context {
      state = 'running'
      currentTime = 0
      destination = {}
      async resume() {}
      createGain() {
        return {
          gain: {
            value: 0,
            setTargetAtTime() {},
            setValueAtTime() {},
            linearRampToValueAtTime() {},
            exponentialRampToValueAtTime() {},
          },
          connect(destination: AudioNode) { return destination },
          disconnect() {},
        }
      }
      createOscillator() {
        return {
          type: 'sine',
          frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect(destination: AudioNode) { return destination },
          disconnect() {},
          start() { sounds++ },
          stop() {},
          onended: null,
        }
      }
    }
    Object.defineProperty(window, 'AudioContext', { value: Context })
  })
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { chat_model: 'test-model' } }),
  )
  await mockSavedApi(page)
  await page.route('**/engine/api/compositions', (route) =>
    route.fulfill({ json: [] }),
  )

  await page.goto('/')
  const rhythm = page.getByRole('region', { name: 'FIND YOUR RHYTHM' })
  await expect(rhythm).toBeVisible()
  await rhythm.getByRole('button', { name: 'Connect Chordcat' }).click()
  await expect(rhythm.getByRole('status')).toHaveText(
    'Ready. Tap any key when you feel the music.',
  )
  await rhythm.getByRole('button', { name: 'Glockenspiel' }).click()
  await page.evaluate(() =>
    (window as unknown as { playChordcatNote: () => void }).playChordcatNote(),
  )
  await page.evaluate(() =>
    (window as unknown as { playChordcatNote: () => void }).playChordcatNote(),
  )
  await expect(rhythm.getByRole('status')).toHaveText('Glockenspiel played.')
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { chordcatSounds: () => number }).chordcatSounds(),
  )).toBe(2)
  await expect(rhythm.getByRole('button', { name: 'Glockenspiel' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.setViewportSize({ width: 320, height: 1000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320)
  await rhythm.getByRole('button', { name: 'Disconnect' }).click()
  await expect(rhythm.getByRole('button', { name: 'Connect Chordcat' }))
    .toBeVisible()
})

test('controls and refreshes audio layers independently', async ({ page }) => {
  await page.addInitScript(() => {
    const audio = {
      currentTime: 0,
      starts: [] as number[],
      gains: [] as number[],
      sources: [] as Array<{ loop: boolean; onended: null | (() => void) }>,
    }
    class Context {
      state = 'running'
      destination = {}
      get currentTime() { return audio.currentTime }
      async resume() {}
      createGain() {
        const index = audio.gains.push(0) - 1
        return {
          gain: {
            get value() { return audio.gains[index] },
            set value(value: number) { audio.gains[index] = value },
            setTargetAtTime(value: number) { audio.gains[index] = value },
            cancelScheduledValues() {},
            setValueAtTime(value: number) { audio.gains[index] = value },
            linearRampToValueAtTime(value: number) { audio.gains[index] = value },
          },
          connect() {},
        }
      }
      async decodeAudioData() { return { duration: 2 } as AudioBuffer }
      createBufferSource() {
        const source = {
          buffer: null,
          loop: false,
          onended: null as null | (() => void),
          connect() {},
          disconnect() {},
          start(_when = 0, offset = 0) { audio.starts.push(offset) },
          stop() {},
        }
        audio.sources.push(source)
        return source
      }
    }
    Object.defineProperty(window, 'AudioContext', { value: Context })
    Object.assign(window, { roomAudio: audio })
  })
  await page.route('**/song.wav', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: wav() }),
  )
  await page.goto('/')

  const starts = await page.evaluate(async () => {
    const { MusicRoom } = await import('/src/lib/music.ts')
    let ended = 0
    const room = new MusicRoom(() => ended++)
    await room.playComposition('/song.wav')
    const audio = (window as unknown as {
      roomAudio: {
        currentTime: number
        starts: number[]
        sources: Array<{ loop: boolean; onended: null | (() => void) }>
      }
    }).roomAudio
    audio.currentTime = 1.25
    await room.refreshCompositionEffects('/song.wav')
    room.setMusicVolume(0.35)
    room.setEffectsVolume(0.65)
    room.fadeVolume(0.55, 2)
    room.setAutoReplay(false)
    audio.sources[0].onended?.()
    return {
      starts: audio.starts,
      gains: audio.gains,
      loops: audio.sources.map((source) => source.loop),
      ended,
    }
  })

  expect(starts).toEqual({
    starts: [0, 1.25],
    gains: [0.45 * 0.45 * 0.55, 0.35, 0.65],
    loops: [false, false],
    ended: 1,
  })
})

test('opens a saved composition in the artwork player', async ({ page }) => {
  await page.addInitScript(() => {
    let currentTime = 0
    class Context {
      state = 'running'
      destination = {}
      get currentTime() { return currentTime }
      async resume() {}
      createGain() {
        return {
          gain: { value: 0, setTargetAtTime() {} },
          connect() {},
        }
      }
      async decodeAudioData() {
        return {
          duration: 2,
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
    Object.assign(window, {
      advancePlayback(seconds: number) { currentTime += seconds },
    })
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
  await page.route('**/engine/api/compositions/*/base', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: wav() }),
  )
  await page.route('**/engine/api/compositions/*/effects', (route) =>
    route.fulfill({ contentType: 'audio/wav', body: wav() }),
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
  const songsButton = page.getByRole('link', { name: /Your songs/ })
  await expect(songsButton).toBeVisible()
  expect((await songsButton.boundingBox())!.y).toBeLessThan(
    (await page.getByRole('button', { name: 'Start music' }).boundingBox())!.y,
  )
  await songsButton.click()
  await expect(page).toHaveURL(/\/songs$/)
  await expect(page.getByRole('heading', { name: 'Music Memory Garden', exact: true })).toBeVisible()
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
  await page.getByRole('button', { name: /Play Composition/ }).first().click()
  const player = page.getByRole('dialog', { name: 'Voice companion' })
  await expect(player.getByRole('button', { name: 'Pause music' })).toBeVisible()
  await player.getByRole('button', { name: 'Show all' }).click()
  await expect(player.getByRole('button', { name: 'Connect Chordcat' }))
    .not.toContainText('Connect music board')
  await page.getByRole('button', { name: 'Turn camera off' }).click()
  await page.getByRole('button', { name: 'Focus mode' }).click()
  await expect(player.getByRole('button', { name: 'Back to home' })).toBeVisible()
  await expect(player.getByRole('button', { name: 'Auto replay' })).toHaveCount(0)
  await expect(player).toHaveAttribute('aria-modal', 'true')
  await expect(player.locator('.session-footer')).toHaveCount(0)
  await expect(player.getByRole('img', { name: 'Saved on this device.' })).toBeVisible()
  await expect(page.locator('.site-header')).toHaveAttribute('inert', '')
  await player.getByRole('button', { name: 'Stop music immediately' }).focus()
  await page.keyboard.press('Tab')
  await expect(player.getByRole('button', { name: 'Back to home' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(player.getByRole('button', { name: 'Stop music immediately' })).toBeFocused()
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
  await page.setViewportSize({ width: 320, height: 1000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await player.getByRole('button', { name: 'Show all' }).click()
  await expect(
    page.getByRole('heading', { name: 'Your composition is playing' }),
  ).toBeVisible()
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
  const autoReplay = page.getByRole('button', { name: 'Auto replay' })
  await expect(autoReplay).toHaveAttribute('aria-pressed', 'true')
  await autoReplay.click()
  await expect(autoReplay).toHaveAttribute('aria-pressed', 'false')
  await expect(
    page.getByRole('img', { name: 'Artwork for your saved composition' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enable camera' })).toBeVisible()
  await expect(
    page.getByRole('dialog', { name: 'Voice companion' })
      .getByRole('button', { name: 'Connect Chordcat' }),
  ).toBeVisible()
  const layerVolumes = page.getByRole('group', { name: 'Layer volumes' })
  await layerVolumes.getByRole('slider', { name: 'Generated music volume' })
    .fill('0.35')
  await layerVolumes.getByRole('slider', { name: 'Effects volume' }).fill('0.65')
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem('sound-flux-layer-volumes') ?? '{}'),
  )).toEqual({ music: 0.35, effects: 0.65 })
  await page.reload()
  await page.getByRole('link', { name: /Your songs/ }).click()
  await page.getByRole('button', { name: /Play Composition/ }).first().click()
  await page.getByRole('button', { name: 'Show all' }).click()
  await expect(
    page.getByRole('slider', { name: 'Generated music volume' }),
  ).toHaveValue('0.35')
  await expect(page.getByRole('slider', { name: 'Effects volume' }))
    .toHaveValue('0.65')
  const timeline = page.getByLabel('Composition timeline with 1 mouth effect')
  await expect(timeline).toBeVisible()
  await expect(timeline.locator('.timeline-effect')).toHaveAttribute('title', /60% volume/)
  const playhead = timeline.getByRole('img', { name: 'Current playback position 0:00' })
  await expect(playhead).toHaveCSS('left', '0px')
  await page.evaluate(() =>
    (window as unknown as { advancePlayback: (seconds: number) => void })
      .advancePlayback(1),
  )
  await expect(timeline.getByRole('img', { name: 'Current playback position 0:01' }))
    .toHaveAttribute('style', /left: 50%/)
  await player.getByRole('button', { name: 'Pause music' }).click()
  await expect(timeline.getByRole('img', { name: 'Current playback position 0:00' }))
    .toHaveAttribute('style', /left: 0%/)
  await player.getByRole('button', { name: 'Play music' }).click()
  const removeEffect = page.getByRole('button', { name: 'Remove Piano at 0:00' })
  await expect(removeEffect).toBeVisible()
  expect((await removeEffect.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.getByRole('button', { name: 'Focus mode' }).click()
  await expect(timeline.locator('.timeline-scale')).toBeVisible()
  await expect(timeline.locator('.timeline-effect')).toBeVisible()
  await expect(timeline.locator('.timeline-effect-list')).toBeHidden()
  await player.getByRole('button', { name: 'Show all' }).click()
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
  await page.getByRole('region', { name: 'Mouth beatbox' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('region', { name: 'Mouth beatbox' })).toBeVisible()
  await removeEffect.click()
  await expect(page.getByLabel('Composition timeline with 0 mouth effects')).toBeVisible()
  await expect(page.getByLabel('Effect', { exact: true })).toHaveValue('drum')
  await expect(
    page.getByRole('region', { name: 'Mouth beatbox' }).getByRole('slider', { name: 'Effect volume' }),
  ).toHaveValue('1')
  await expect(page.getByRole('group', { name: 'Pitch' })).toBeVisible()
  await expect(
    page.getByRole('dialog', { name: 'Voice companion' })
      .getByRole('button', { name: 'Pause music' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Turn camera off' })).toBeVisible()
  await expect(player.locator('.mouth-camera')).toHaveCount(1)
  await page.getByRole('button', { name: 'Turn camera off' }).click()
  await page.getByRole('button', { name: 'Focus mode' }).click()
  const focusInstrument = player.getByLabel('Current instrument: Drum')
  await expect(focusInstrument).toBeVisible()
  expect((await focusInstrument.locator('span').boundingBox())!.width)
    .toBeGreaterThanOrEqual(90)
  const focusInstrumentBox = (await focusInstrument.boundingBox())!
  const focusArtworkBox = (await player.getByRole('img', {
    name: 'Artwork for your saved composition',
  }).boundingBox())!
  expect(focusInstrumentBox.y + focusInstrumentBox.height)
    .toBeLessThan(focusArtworkBox.y)
  await expect(player.getByLabel('Effect', { exact: true })).toBeHidden()
  await expect(player.locator('.mouth-camera')).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to home' }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.getByRole('link', { name: /Your songs/ }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete all songs' }).click()
  await expect(page.getByRole('heading', { name: 'No songs yet' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to music' }).click()
  await expect(page.getByRole('link', { name: /Your songs/ })).toBeVisible()
})

test('prepares music, then records the hum before composing', async ({ page }) => {
  let uploads = 0
  let body = ''
  await page.addInitScript(() => {
    const state = { level: 0.05 }
    let recorderStarts = 0
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
        recorderStarts++
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
    Object.assign(window, {
      MediaRecorder: Recorder,
      recorderStarts: () => recorderStarts,
    })
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
  await page.route('**/engine/api/compositions', (route) =>
    route.fulfill({ json: [] }),
  )
  await page.route('**/engine/api/compose', (route) => {
    uploads++
    body = route.request().postDataBuffer()!.toString('latin1')
    return route.fulfill({
      contentType: 'audio/wav',
      headers: { 'X-Composition-ID': 'composition-1' },
      body: wav(),
    })
  })
  await page.goto('/')
  const firstStartedAt = Date.now()
  await page.getByRole('button', { name: 'Talk with Sound Flux' }).click()
  await expect(page.getByRole('button', { name: 'Preparing your music…' })).toBeVisible()
  const stopConversation = page.getByRole('button', { name: 'Stop conversation immediately' })
  await expect(stopConversation).toBeVisible()
  const savedIcon = await page.getByRole('img', { name: 'Saved on this device.' }).boundingBox()
  const stopButton = await stopConversation.boundingBox()
  expect(savedIcon!.x + savedIcon!.width).toBeLessThan(stopButton!.x)
  const artwork = page.getByRole('img', { name: 'Music artwork' })
  await expect(artwork).toBeVisible()
  const artworkSource = await artwork.getAttribute('src')
  await expect(page.getByRole('dialog', { name: 'Voice companion' })).toHaveClass(/focus-mode/)
  await expect(page.getByRole('button', { name: 'Humming…' })).toBeVisible()
  expect(Date.now() - firstStartedAt).toBeLessThan(3_000)
  await expect(
    page.getByRole('dialog', { name: 'Voice companion' }),
  ).toHaveClass(/session-active/)
  await expect(page.locator('.composer-overlay')).toBeVisible()
  const composingAt = Date.now()
  await page.waitForTimeout(3_500)
  expect(uploads).toBe(0)
  await expect.poll(() => uploads, { timeout: 2_000 }).toBe(1)
  expect(Date.now() - composingAt).toBeGreaterThanOrEqual(3_500)
  expect(body).toContain('name="audio"')
  const player = page.getByRole('dialog', { name: 'Voice companion' })
  await expect(player.getByRole('button', { name: 'Pause music' })).toBeVisible()
  await expect(player.getByRole('img', { name: 'Artwork for your saved composition' }))
    .toHaveAttribute('src', artworkSource!)
  await player.getByRole('button', { name: 'Show all' }).click()
  await player.getByRole('button', { name: 'Regenerate music' }).click()
  await expect.poll(() => uploads).toBe(2)
  expect(
    await page.evaluate(() =>
      (window as unknown as { recorderStarts: () => number }).recorderStarts(),
    ),
  ).toBe(1)
  const repeatStartedAt = Date.now()
  await player.getByRole('button', { name: 'Start new song' }).click()
  await expect(page.getByRole('button', { name: 'Humming…' })).toBeVisible()
  expect(Date.now() - repeatStartedAt).toBeLessThan(1_500)
})
