import type { Page } from '@playwright/test'
import type { ProfileKey, ProfileState, ProfileValues, SavedTurn } from '../src/lib/savedData'

export async function mockSavedApi(page: Page, initial: Partial<ProfileValues> = {}, history: SavedTurn[] = []) {
  const state = {
    values: { ...initial } as Partial<ProfileValues>,
    history,
    updates: [] as { key: ProfileKey; value: string }[],
    deletions: [] as string[],
    greeting: Object.keys(initial).length ? 'Welcome back.' : 'Welcome today.',
  }
  const profile = (): ProfileState => ({
    greeting: state.greeting,
    properties: Object.entries(state.values).map(([key, value]) => ({ key: key as ProfileKey, value, label: key, category: 'Personal', is_profile_property: true, updated_at: '2026-09-12 12:00:00' })),
    onboarding: (() => { const key = (['name', 'birth_year', 'mood', 'music_preferences'] as const).find((key) => !state.values[key]); return key ? { key, label: key, question: key, category: 'Personal' } : null })(),
  })
  await page.route('**/api/v1/profile', (route) => route.fulfill({ json: profile() }))
  await page.route('**/api/v1/profile/*', (route) => {
    const key = route.request().url().split('/').pop() as ProfileKey
    const { value } = route.request().postDataJSON()
    state.values[key] = key === 'name' ? value.split(' ')[0] : value
    state.updates.push({ key, value })
    return route.fulfill({ json: profile() })
  })
  await page.route('**/api/v1/history', (route) => {
    if (route.request().method() === 'DELETE') { state.history = []; state.deletions.push('history') }
    return route.fulfill({ json: { items: state.history } })
  })
  await page.route('**/api/v1/data', (route) => {
    state.values = {}; state.history = []; state.greeting = 'Welcome today.'; state.deletions.push('all')
    return route.fulfill({ json: profile() })
  })
  return state
}
