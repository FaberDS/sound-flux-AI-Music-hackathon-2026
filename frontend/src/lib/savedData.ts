import { request, type Message } from './api'

export const profileFields = [
  {
    key: 'name',
    label: 'First name',
    question: 'What would this person like Sound Flux to call them?',
    placeholder: 'First name, optional',
    maxLength: 80,
  },
  {
    key: 'birth_year',
    label: 'Year of birth',
    question: 'What year was this person born?',
    placeholder: 'For example, 1945',
    maxLength: 4,
  },
  {
    key: 'mood',
    label: 'Mood',
    question: 'How is this person feeling today?',
    placeholder: 'For example, calm or cheerful',
    maxLength: 80,
  },
  {
    key: 'music_preferences',
    label: 'Music preferences',
    question: 'What music does this person enjoy?',
    placeholder: 'For example, piano, waltz, or guitar music',
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
  music_preferences: { value: string }[]
  onboarding: {
    key: string
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
    music_preferences:
      profile?.music_preferences.map(({ value }) => value).join(', ') ?? '',
  }
  for (const property of profile?.properties ?? []) {
    if (Object.hasOwn(values, property.key))
      values[property.key] = property.value
  }
  return values
}

export function welcomeText(profile: ProfileState | null) {
  if (!profile) return 'What sounds like joy to you?'
  const name = profileValues(profile).name
  const greeting = profile.greeting.startsWith(
    'Welcome back after a short break',
  )
    ? 'It’s lovely to have you back'
    : profile.greeting.startsWith('Welcome back')
      ? 'Welcome back'
      : 'It’s lovely to have you here'
  return `${greeting}${name ? `, ${name}` : ''}.`
}

export function profileQuestion(key: string, fallback: string) {
  return (
    {
    name: 'What may I call you?',
    birth_year: 'Would you like to share your year of birth?',
    mood: 'How are you feeling today?',
    music_preferences: 'What music do you enjoy?',
    }[key] ?? fallback
  )
}

export function onboardingQuestion(profile: ProfileState | null) {
  if (!profile?.onboarding) return null
  return profileQuestion(profile.onboarding.key, profile.onboarding.question)
}

export async function getProfile(signal: AbortSignal): Promise<ProfileState> {
  const response = await request('/v1/profile', { signal }, 10_000)
  const data = await response.json()
  if (!Array.isArray(data.properties) || typeof data.greeting !== 'string')
    throw new Error('The profile could not be read.')
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
    throw new Error('The history could not be read.')
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
    : new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
}
