import { expect, test, type Page } from '@playwright/test'
import { mockSavedApi } from './saved-api'
import type { SavedTurn } from '../src/lib/savedData'

const storedTurn: SavedTurn = {
  turn_id: 'saved-turn',
  created_at: '2026-09-12 12:30:00',
  user: 'Ich mag Jazz.',
  assistant: 'Wir können zusammen einen Rhythmus klopfen.',
  model: 'qwen3.5:2b',
  duration_ms: 1200,
}

async function baseApi(page: Page) {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { chat_model: 'test-model' } }),
  )
  await page.route('**/api/v1/turns/*/interrupt', (route) =>
    route.fulfill({ json: { interrupted: true } }),
  )
}

async function openProfile(page: Page) {
  await page.getByRole('button', { name: 'Für Begleitpersonen' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

test('restores profile and history after reload and uses the latest twelve context messages', async ({
  page,
}) => {
  await baseApi(page)
  const savedTurns = Array.from({ length: 8 }, (_, index) => ({
    ...storedTurn,
    turn_id: `turn-${8 - index}`,
    user: `Frage ${8 - index}`,
    assistant: `Antwort ${8 - index}`,
  }))
  await mockSavedApi(
    page,
    {
      name: 'Anna',
      birth_year: '1945',
      mood: 'ruhig',
      music_preferences: 'Jazz',
    },
    savedTurns,
  )
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Willkommen zurück, Anna.' }),
  ).toBeVisible()
  await page.locator('summary').click()
  await expect(page.locator('.history-turn')).toHaveCount(8)
  await page.reload()
  await expect(page.locator('summary')).toContainText('8 Nachrichten')
  await openProfile(page)
  await expect(
    page.getByLabel('In welchem Jahr wurde die Person geboren?'),
  ).toHaveValue('1945')
  await expect(page.getByLabel('Wie geht es der Person heute?')).toHaveValue(
    'ruhig',
  )
  await page.getByRole('button', { name: 'Schließen', exact: true }).click()
  await page.getByRole('button', { name: 'Antworten vorlesen' }).click()
  let context: { role: string; content: string }[] = []
  await page.route('**/api/v1/chat', (route) => {
    context = route.request().postDataJSON().history
    return route.fulfill({
      contentType: 'text/event-stream',
      body: 'event: token\ndata: {"text":"Lass uns anfangen."}\n\nevent: done\ndata: {}\n\n',
    })
  })
  await page.getByLabel('Nachricht an Sound Flux').fill('Weiter bitte')
  await page
    .getByRole('button', { name: 'Nachricht senden', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: 'Lass uns anfangen.' }),
  ).toBeVisible()
  expect(context).toHaveLength(12)
  expect(context[0]).toEqual({ role: 'user', content: 'Frage 3' })
  expect(context[11]).toEqual({ role: 'assistant', content: 'Antwort 8' })
})

test('persists all onboarding fields and uses the canonical first name returned by the API', async ({
  page,
}) => {
  await baseApi(page)
  const state = await mockSavedApi(page)
  await page.goto('/')
  await expect(page.getByText('Wie darf ich dich nennen?')).toBeVisible()
  await page.getByRole('button', { name: 'Angaben ergänzen' }).click()
  await page
    .getByLabel('Wie darf Sound Flux die Person ansprechen?')
    .fill('Anna Beispiel')
  await page
    .getByLabel('In welchem Jahr wurde die Person geboren?')
    .fill('1945')
  await page.getByLabel('Wie geht es der Person heute?').fill('fröhlich')
  await page.getByLabel('Welche Musik mag die Person?').fill('Klavier')
  await page.getByRole('button', { name: 'Angaben speichern' }).click()
  await expect(
    page.getByText('Angaben gespeichert.', { exact: true }),
  ).toBeVisible()
  expect(state.updates.map((item) => item.key)).toEqual([
    'name',
    'birth_year',
    'mood',
    'music_preferences',
  ])
  await expect(
    page.getByLabel('Wie darf Sound Flux die Person ansprechen?'),
  ).toHaveValue('Anna')
  await page.getByRole('button', { name: 'Schließen', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Angaben ergänzen' }),
  ).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Schön, dass du da bist, Anna.' }),
  ).toBeVisible()
})

test('deleting only history retains profile and canceling does not send a delete request', async ({
  page,
}) => {
  await baseApi(page)
  const state = await mockSavedApi(
    page,
    { name: 'Anna', music_preferences: 'Jazz' },
    [storedTurn],
  )
  await page.goto('/')
  await expect(page.locator('summary')).toContainText('1 Nachricht')
  await openProfile(page)
  await page
    .getByRole('button', { name: 'Verlauf löschen', exact: true })
    .click()
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click()
  expect(state.deletions).toEqual([])
  await page
    .getByRole('button', { name: 'Verlauf löschen', exact: true })
    .click()
  await page.getByRole('button', { name: 'Verlauf endgültig löschen' }).click()
  await expect(
    page.getByText(
      'Gesprächsverlauf gelöscht. Die Angaben zur Person bleiben erhalten.',
      { exact: true },
    ),
  ).toBeVisible()
  expect(state.deletions).toEqual(['history'])
  expect(state.values).toEqual({ name: 'Anna', music_preferences: 'Jazz' })
  await page.getByRole('button', { name: 'Schließen', exact: true }).click()
  await expect(page.locator('summary')).toContainText('0 Nachrichten')
  await page.reload()
  await expect(page.locator('summary')).toContainText('0 Nachrichten')
  await expect(
    page.getByRole('heading', { name: 'Willkommen zurück, Anna.' }),
  ).toBeVisible()
})

test('deleting all data resets the profile, greeting, history and next-message context', async ({
  page,
}) => {
  await baseApi(page)
  const state = await mockSavedApi(page, { name: 'Anna' }, [storedTurn])
  await page.goto('/')
  await openProfile(page)
  await page
    .getByRole('button', { name: 'Alle gespeicherten Daten löschen' })
    .click()
  await page
    .getByRole('button', { name: 'Alle Daten endgültig löschen' })
    .click()
  await expect(
    page.getByText('Alle gespeicherten Daten gelöscht.', { exact: true }),
  ).toBeVisible()
  expect(state.deletions).toEqual(['all'])
  await expect(
    page.getByLabel('Wie darf Sound Flux die Person ansprechen?'),
  ).toHaveValue('')
  await page.getByRole('button', { name: 'Schließen', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Schön, dass du da bist.' }),
  ).toBeVisible()
  await expect(page.locator('summary')).toContainText('0 Nachrichten')
  await page.getByRole('button', { name: 'Antworten vorlesen' }).click()
  const request = page.waitForRequest('**/api/v1/chat')
  await page.route('**/api/v1/chat', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: 'event: token\ndata: {"text":"Hallo."}\n\nevent: done\ndata: {}\n\n',
    }),
  )
  await page.getByLabel('Nachricht an Sound Flux').fill('Hallo')
  await page
    .getByRole('button', { name: 'Nachricht senden', exact: true })
    .click()
  expect((await request).postDataJSON().history).toEqual([])
})

test('failed deletion retains data and exposes a retry without closing the dialog', async ({
  page,
}) => {
  await baseApi(page)
  const state = await mockSavedApi(page, { name: 'Anna' }, [storedTurn])
  await page.route('**/api/v1/data', (route) => route.fulfill({ status: 503 }))
  await page.goto('/')
  await openProfile(page)
  await page
    .getByRole('button', { name: 'Alle gespeicherten Daten löschen' })
    .click()
  await page
    .getByRole('button', { name: 'Alle Daten endgültig löschen' })
    .click()
  await expect(page.getByRole('alert')).toContainText(
    'Die Daten konnten nicht gelöscht werden',
  )
  expect(state.values.name).toBe('Anna')
  expect(state.history).toHaveLength(1)
  await expect(
    page.getByRole('button', { name: 'Alle Daten endgültig löschen' }),
  ).toBeEnabled()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('a failed second profile write preserves the first change and retries the remaining field', async ({
  page,
}) => {
  await baseApi(page)
  const state = await mockSavedApi(page)
  await page.route('**/api/v1/profile/music_preferences', (route) =>
    route.fulfill({ status: 503 }),
  )
  await page.goto('/')
  await openProfile(page)
  await page
    .getByLabel('Wie darf Sound Flux die Person ansprechen?')
    .fill('Anna')
  await page.getByLabel('Welche Musik mag die Person?').fill('Jazz')
  await page.getByRole('button', { name: 'Angaben speichern' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Speichern nicht abgeschlossen',
  )
  expect(state.values.name).toBe('Anna')
  expect(state.values.music_preferences).toBeUndefined()
  await page.unroute('**/api/v1/profile/music_preferences')
  await page.getByRole('button', { name: 'Angaben speichern' }).click()
  await expect(
    page.getByText('Angaben gespeichert.', { exact: true }),
  ).toBeVisible()
  expect(state.updates).toEqual([
    { key: 'name', value: 'Anna' },
    { key: 'music_preferences', value: 'Jazz' },
  ])
})

test('newly saved turns are not duplicated after refresh', async ({ page }) => {
  await baseApi(page)
  const state = await mockSavedApi(page)
  await page.route('**/api/v1/chat', (route) => {
    const request = route.request().postDataJSON()
    state.history.unshift({
      ...storedTurn,
      turn_id: request.turn_id,
      user: request.message,
    })
    return route.fulfill({
      contentType: 'text/event-stream',
      body: `event: token\ndata: ${JSON.stringify({ text: storedTurn.assistant })}\n\nevent: done\ndata: {}\n\n`,
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Antworten vorlesen' }).click()
  await page.getByLabel('Nachricht an Sound Flux').fill('Ich mag Jazz.')
  await page
    .getByRole('button', { name: 'Nachricht senden', exact: true })
    .click()
  await expect(page.locator('summary')).toContainText('1 Nachricht')
  await page.locator('summary').click()
  await page
    .getByRole('button', { name: 'Gesprächsverlauf aktualisieren' })
    .click()
  await expect(page.locator('.history-turn')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('summary')).toContainText('1 Nachricht')
})
