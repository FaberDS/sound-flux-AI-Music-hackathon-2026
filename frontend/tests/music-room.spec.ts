import { expect, test, type Page } from '@playwright/test'

const reply = 'Lass uns mit ein paar sanften Klaviertönen beginnen.'
const sse = (text = reply) =>
  `event: token\ndata: ${JSON.stringify({ text })}\n\nevent: done\ndata: {}\n\n`

async function mockApi(page: Page) {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { chat_model: 'test-model' } }),
  )
  await page.route('**/api/v1/turns/*/interrupt', (route) =>
    route.fulfill({ json: { interrupted: true } }),
  )
}

test('offline music, instruments and stop work without the speech API', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/health', (route) => route.fulfill({ status: 503 }))
  await page.goto('/')
  await expect(
    page.getByRole('button', { name: /Sprach-API offline/ }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Musik starten', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Musik pausieren' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Fröhlich & neu' }).click()
  await expect(
    page.getByRole('button', { name: 'Fröhlich & neu' }),
  ).toHaveAttribute('aria-pressed', 'true')
  for (const instrument of ['Klavier', 'Gitarre', 'Glockenspiel', 'Trommel']) {
    await page.getByRole('button', { name: `${instrument} spielen` }).click()
  }
  await page.getByRole('button', { name: 'Alles stoppen', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Musik starten', exact: true }),
  ).toBeVisible()
  expect(errors).toEqual([])
})

test('sends the profile and conversation history, then clears session data', async ({
  page,
}) => {
  await mockApi(page)
  const requests: {
    turn_id: string
    history: unknown[]
    profile: string[]
    message: string
  }[] = []
  await page.route('**/api/v1/chat', async (route) => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ contentType: 'text/event-stream', body: sse() })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Antworten vorlesen' }).click()
  await page.getByRole('button', { name: 'Für Begleitpersonen' }).click()
  await page
    .getByLabel('Wie darf Sound Flux die Person ansprechen?')
    .fill('Anna')
  await page
    .getByLabel('Welche Musik mag die Person?')
    .fill('Klavier und Walzer')
  await page.getByRole('button', { name: 'Musikraum öffnen' }).click()
  await page.getByLabel('Nachricht an Sound Flux').fill('Ich mag Klavier.')
  await page
    .getByRole('button', { name: 'Nachricht senden', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: reply })).toBeVisible()
  await page.getByLabel('Nachricht an Sound Flux').fill('Spielen wir zusammen?')
  await page
    .getByRole('button', { name: 'Nachricht senden', exact: true })
    .click()
  await expect(page.locator('summary')).toContainText('2 Nachrichten')
  expect(requests[0].profile).toEqual([
    'Preferred name: Anna',
    'Music preferences: Klavier und Walzer',
  ])
  expect(requests[0].history).toEqual([])
  expect(requests[1].history).toHaveLength(2)
  expect(requests[1].turn_id).not.toBe(requests[0].turn_id)
  await page.getByRole('button', { name: 'Für Begleitpersonen' }).click()
  await page
    .getByRole('button', { name: 'Sitzung beenden und Ansicht leeren' })
    .click()
  await expect(page.locator('summary')).toHaveCount(0)
  await page.getByRole('button', { name: 'Für Begleitpersonen' }).click()
  await expect(
    page.getByLabel('Wie darf Sound Flux die Person ansprechen?'),
  ).toHaveValue('')
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0)
})

test('records real browser audio and reuses the turn ID for transcription, chat and speech', async ({
  page,
}) => {
  await mockApi(page)
  let form = ''
  let chatTurn = ''
  let speechTurn = ''
  await page.route('**/api/v1/transcriptions', async (route) => {
    form = route.request().postDataBuffer()!.toString('latin1')
    await route.fulfill({ json: { text: 'Ich mag Musik.' } })
  })
  await page.route('**/api/v1/chat', async (route) => {
    chatTurn = route.request().postDataJSON().turn_id
    await route.fulfill({ contentType: 'text/event-stream', body: sse() })
  })
  await page.route('**/api/v1/speech', async (route) => {
    speechTurn = route.request().postDataJSON().turn_id
    const audioBytes = 8_000 * 4 * 2
    const wav = Buffer.alloc(44 + audioBytes)
    wav.write('RIFF')
    wav.writeUInt32LE(36 + audioBytes, 4)
    wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(8000, 24)
    wav.writeUInt32LE(16000, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(audioBytes, 40)
    await route.fulfill({ contentType: 'audio/wav', body: wav })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Mit Sound Flux sprechen' }).click()
  await expect(
    page.getByRole('button', { name: /Aufnahme senden · 0:01/ }),
  ).toBeVisible()
  await page.getByRole('button', { name: /Aufnahme senden/ }).click()
  await expect(page.getByRole('heading', { name: reply })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Antwort noch einmal hören' }),
  ).toBeVisible()
  const voiceIndicator = page.getByRole('img', { name: 'Sound Flux: Ich spreche' })
  await expect(voiceIndicator).toBeVisible()
  expect(chatTurn).toBeTruthy()
  expect(form).toContain('name="audio"')
  expect(form).toContain(chatTurn)
  expect(speechTurn).toBe(chatTurn)
  await page.getByRole('button', { name: 'Alles stoppen', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Antwort noch einmal hören' }),
  ).toBeEnabled()
  await expect(voiceIndicator).toHaveCount(0)
  await page.getByRole('button', { name: 'Antwort noch einmal hören' }).click()
  await expect(voiceIndicator).toBeVisible()
  await expect(voiceIndicator).toHaveCount(0, { timeout: 6_000 })
  await expect(page.locator('.record-art .vinyl')).toBeVisible()
})

test('microphone denial offers the working text path', async ({ page }) => {
  await mockApi(page)
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Denied', 'NotAllowedError')
    }
  })
  await page.route('**/api/v1/chat', (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: sse() }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'Antworten vorlesen' }).click()
  await page.getByRole('button', { name: 'Mit Sound Flux sprechen' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Das Mikrofon ist nicht freigegeben',
  )
  await page.getByLabel('Nachricht an Sound Flux').fill('Hallo')
  await page
    .getByRole('button', { name: 'Nachricht senden', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: reply })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('server-sent errors stay visible and failed turns do not enter history', async ({
  page,
}) => {
  await mockApi(page)
  await page.route('**/api/v1/chat', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: 'event: error\ndata: {"detail":"Ollama unavailable"}\n\n',
    }),
  )
  await page.goto('/')
  await page.getByLabel('Nachricht an Sound Flux').fill('Hallo')
  await page
    .getByRole('button', { name: 'Nachricht senden', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText(
    'Die Antwort konnte nicht erstellt werden',
  )
  await expect(page.locator('summary')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Mit Sound Flux sprechen' }),
  ).toBeEnabled()
})

test('stopping a pending answer prevents stale output and speech', async ({
  page,
}) => {
  await mockApi(page)
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let speechCalls = 0
  await page.route('**/api/v1/chat', async (route) => {
    await pending
    await route
      .fulfill({
        contentType: 'text/event-stream',
        body: sse('Diese Antwort darf nicht erscheinen.'),
      })
      .catch(() => {})
  })
  await page.route('**/api/v1/speech', (route) => {
    speechCalls++
    return route.fulfill({ status: 500 })
  })
  await page.goto('/')
  await page.getByLabel('Nachricht an Sound Flux').fill('Hallo')
  const request = page.waitForRequest('**/api/v1/chat')
  await page
    .getByRole('button', { name: 'Nachricht senden', exact: true })
    .click()
  await request
  const interruption = page.waitForRequest('**/api/v1/turns/*/interrupt')
  await page.getByRole('button', { name: 'Alles stoppen', exact: true }).click()
  await interruption
  release()
  await expect(
    page.getByRole('heading', { name: 'Was klingt für dich nach Freude?' }),
  ).toBeVisible()
  await expect(page.locator('summary')).toHaveCount(0)
  expect(speechCalls).toBe(0)
})

test('stream parser preserves UTF-8 across byte boundaries and rejects incomplete replies', async ({
  page,
}) => {
  await mockApi(page)
  await page.goto('/')
  const result = await page.evaluate(async () => {
    // Exercise the network parser with one-byte chunks, including split umlauts and CRLF.
    const api = await import('/src/lib/api.ts' as string)
    const originalFetch = window.fetch
    const run = async (wire: string) => {
      window.fetch = async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const byte of new TextEncoder().encode(wire))
                controller.enqueue(new Uint8Array([byte]))
              controller.close()
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        )
      return api.streamReply(
        'test',
        'Hallo',
        [],
        [],
        new AbortController().signal,
        () => {},
      )
    }
    try {
      const text = await run(
        'event: token\r\ndata: {"text":"Schöne Töne 🎵"}\r\n\r\nevent: done\r\ndata: {}\r\n\r\n',
      )
      let incomplete = false
      try {
        await run('event: token\ndata: {"text":"Teilantwort"}\n\n')
      } catch {
        incomplete = true
      }
      return { text, incomplete }
    } finally {
      window.fetch = originalFetch
    }
  })
  expect(result).toEqual({ text: 'Schöne Töne 🎵', incomplete: true })
})

test('mobile layout has no horizontal overflow and dialogs support Escape', async ({
  page,
}) => {
  await mockApi(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.getByRole('button', { name: 'Für Begleitpersonen' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Für Begleitpersonen' }),
  ).toBeFocused()
})

test('a microphone permission granted after stopping cannot start a recording', async ({
  page,
}) => {
  await mockApi(page)
  await page.addInitScript(() => {
    const capture = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    )
    navigator.mediaDevices.getUserMedia = () =>
      new Promise((resolve) => {
        window.addEventListener(
          'grant-test-microphone',
          async () => {
            const stream = await capture({ audio: true })
            Object.assign(window, { testCapture: stream })
            resolve(stream)
          },
          { once: true },
        )
      })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Mit Sound Flux sprechen' }).click()
  await expect(
    page.getByRole('button', { name: 'Mikrofon öffnen …' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Sofort alles stoppen' }).click()
  await page.evaluate(() =>
    window.dispatchEvent(new Event('grant-test-microphone')),
  )
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stream = (window as unknown as { testCapture?: MediaStream })
          .testCapture
        return stream
          ?.getTracks()
          .every((track) => track.readyState === 'ended')
      }),
    )
    .toBe(true)
  await expect(
    page.getByRole('button', { name: /Aufnahme senden/ }),
  ).toHaveCount(0)
})

test('a speech failure preserves the answer and history for the next turn', async ({
  page,
}) => {
  await mockApi(page)
  const historyLengths: number[] = []
  await page.route('**/api/v1/chat', (route) => {
    historyLengths.push(route.request().postDataJSON().history.length)
    return route.fulfill({ contentType: 'text/event-stream', body: sse() })
  })
  await page.route('**/api/v1/speech', (route) =>
    route.fulfill({ status: 500 }),
  )
  await page.goto('/')
  await page.getByLabel('Nachricht an Sound Flux').fill('Hallo')
  await page
    .getByRole('button', { name: 'Nachricht senden', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText(
    'Die Sprachausgabe ist gerade nicht verfügbar',
  )
  await expect(page.getByRole('heading', { name: reply })).toBeVisible()
  await page.getByRole('button', { name: 'Antworten vorlesen' }).click()
  await page.getByLabel('Nachricht an Sound Flux').fill('Wie geht es weiter?')
  await page
    .getByRole('button', { name: 'Nachricht senden', exact: true })
    .click()
  await expect(page.locator('summary')).toContainText('2 Nachrichten')
  expect(historyLengths).toEqual([0, 2])
  await expect(page.getByRole('alert')).toHaveCount(0)
})
