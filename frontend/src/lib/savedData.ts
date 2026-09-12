import { request, type Message } from './api'

export const profileFields = [
  {
    key: 'name',
    label: 'Vorname',
    question: 'Wie darf Sound Flux die Person ansprechen?',
    placeholder: 'Vorname, optional',
    maxLength: 80,
  },
  {
    key: 'birth_year',
    label: 'Geburtsjahr',
    question: 'In welchem Jahr wurde die Person geboren?',
    placeholder: 'Zum Beispiel 1945',
    maxLength: 4,
  },
  {
    key: 'mood',
    label: 'Stimmung',
    question: 'Wie geht es der Person heute?',
    placeholder: 'Zum Beispiel ruhig oder fröhlich',
    maxLength: 80,
  },
  {
    key: 'music_preferences',
    label: 'Musikvorlieben',
    question: 'Welche Musik mag die Person?',
    placeholder: 'Zum Beispiel Klavier, Walzer oder Gitarrenmusik',
    maxLength: 500,
  },
] as const

export type ProfileKey = (typeof profileFields)[number]['key']
export type ProfileValues = Record<ProfileKey, string>
export interface ProfileProperty {
  key: ProfileKey
  label: string
  value: string
  category: string
  is_profile_property: boolean
  updated_at: string
}
export interface ProfileState {
  greeting: string
  properties: ProfileProperty[]
  onboarding: {
    key: ProfileKey
    label: string
    category: string
    question: string
  } | null
}
export interface SavedTurn {
  turn_id: string
  created_at: string
  user: string
  model: string
  assistant: string
  duration_ms: number
}
export type DeleteScope = 'history' | 'all'

export function profileValues(profile: ProfileState | null): ProfileValues {
  const values: ProfileValues = {
    name: '',
    birth_year: '',
    mood: '',
    music_preferences: '',
  }
  for (const property of profile?.properties ?? []) {
    if (Object.hasOwn(values, property.key))
      values[property.key] = property.value
  }
  return values
}

export function welcomeText(profile: ProfileState | null) {
  if (!profile) return 'Was klingt für dich nach Freude?'
  const name = profileValues(profile).name
  const greeting = profile.greeting.startsWith(
    'Welcome back after a short break',
  )
    ? 'Schön, dass du wieder da bist'
    : profile.greeting.startsWith('Welcome back')
      ? 'Willkommen zurück'
      : 'Schön, dass du da bist'
  return `${greeting}${name ? `, ${name}` : ''}.`
}

export function onboardingQuestion(profile: ProfileState | null) {
  if (!profile?.onboarding) return null
  return {
    name: 'Wie darf ich dich nennen?',
    birth_year: 'Magst du mir dein Geburtsjahr verraten?',
    mood: 'Wie geht es dir heute?',
    music_preferences: 'Welche Musik hörst du gerne?',
  }[profile.onboarding.key]
}

export async function getProfile(signal: AbortSignal): Promise<ProfileState> {
  const response = await request('/v1/profile', { signal }, 10_000)
  const data = await response.json()
  if (!Array.isArray(data.properties) || typeof data.greeting !== 'string')
    throw new Error('Das Profil konnte nicht gelesen werden.')
  return data
}

export async function putProfile(
  key: ProfileKey,
  value: string,
  signal: AbortSignal,
): Promise<ProfileState> {
  const response = await request(
    `/v1/profile/${key}`,
    {
      method: 'PUT',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    },
    10_000,
  )
  return response.json()
}

export async function getHistory(signal: AbortSignal): Promise<SavedTurn[]> {
  const response = await request('/v1/history', { signal }, 10_000)
  const data = await response.json()
  if (!Array.isArray(data.items))
    throw new Error('Der Verlauf konnte nicht gelesen werden.')
  return data.items
}

export async function deleteSavedData(
  scope: DeleteScope,
  signal: AbortSignal,
): Promise<ProfileState | null> {
  const response = await request(
    scope === 'all' ? '/v1/data' : '/v1/history',
    { method: 'DELETE', signal },
    10_000,
  )
  return scope === 'all' ? response.json() : null
}

// The API orders saved turns newest first. Prefer its canonical values when a local turn is saved.
export function mergeTurns(saved: SavedTurn[], session: SavedTurn[]) {
  const savedIds = new Set(saved.map((turn) => turn.turn_id))
  return [
    ...session.filter((turn) => !savedIds.has(turn.turn_id)).reverse(),
    ...saved,
  ]
}

export function chatContext(turns: SavedTurn[]): Message[] {
  return turns
    .slice(0, 6)
    .reverse()
    .flatMap((turn) => [
      { role: 'user' as const, content: turn.user.slice(0, 4_000) },
      { role: 'assistant' as const, content: turn.assistant.slice(0, 4_000) },
    ])
}

export function historyTime(value: string) {
  // SQLite CURRENT_TIMESTAMP is UTC, without a timezone suffix.
  const date = new Date(
    value.includes('T') ? value : `${value.replace(' ', 'T')}Z`,
  )
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('de-AT', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
}
