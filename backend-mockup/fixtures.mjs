export const questions = {
  name: { label: 'Name', category: 'Personal', question: 'What should I call you?' },
  birth_year: { label: 'Birth year', category: 'Personal', question: 'What year were you born?' },
  mood: { label: 'Mood', category: 'Session', question: 'How are you feeling today?' },
  music_preferences: { label: 'Music preferences', category: 'Music', question: 'What music do you enjoy?' },
  played_instrument: { label: 'Played an instrument', category: 'Musical ability', question: 'Did you ever play an instrument?' },
  can_whistle: { label: 'Can whistle', category: 'Musical ability', question: 'Can you whistle?' },
  childhood_song: { label: 'Childhood song', category: 'Music & memories', question: 'Is there a song that reminds you of your childhood?' },
  strong_memory_song: { label: 'Strong memory song', category: 'Music & memories', question: 'Is there a song that brings back a strong memory?' },
  memorable_item: { label: 'Memorable item', category: 'Memories', question: 'What would you like to remember: a person, a song, or a movie?' },
}
export const flow = ['name', 'birth_year', 'music_preferences']
export const demoProfile = {
  name: 'Alex', birth_year: '1950', mood: 'calm', music_preferences: 'Jazz, Classical',
  played_instrument: 'Piano', can_whistle: 'Yes', childhood_song: 'Moon River', strong_memory_song: 'Amazing Grace',
}
export const defaultSettings = {
  prompt: 'Warm piano, soft acoustic guitar and a gentle rhythm.',
  negative_prompt: 'noise, distortion', seconds: 15, strength: 0.8, steps: 8,
  cfg: 2, seed: -1, repeat: false, input_mix: 0.95, match_input: true,
  use_default: false, default_file: 'default_sound.wav',
}
export const defaultConfig = {
  delayMs: 180, tokenMs: 45, composeMs: 1800, liveMs: 700,
  speechSeconds: 2, transcript: '', reply: '', silence: false,
  engine: 'ready', errors: [],
}
export const failureKeys = [
  'health', 'profile', 'profile-save', 'history', 'delete', 'chat', 'chat-stream',
  'transcription', 'speech', 'settings', 'settings-save', 'compositions',
  'playback', 'compose', 'effects', 'setup',
]
export function seedData(preset = 'demo') {
  const now = Date.now()
  return {
    version: 1,
    profile: preset === 'empty' ? {} : { ...demoProfile },
    updatedAt: new Date(now).toISOString(),
    history: preset === 'empty' ? [] : [
      { turn_id: 'mock-welcome', created_at: new Date(now - 60_000).toISOString(), user: 'I enjoy piano music.', model: 'mock-chat', assistant: 'Let’s make a gentle piano melody together.', duration_ms: 450 },
      { turn_id: 'mock-memory', created_at: new Date(now - 3_600_000).toISOString(), user: 'Moon River reminds me of dancing.', model: 'mock-chat', assistant: 'That sounds like a lovely memory. Would you like to make some music?', duration_ms: 620 },
    ],
    compositions: preset === 'empty' ? [] : [0, 1, 2].map((i) => ({
      id: `mock-demo-${i + 1}`, created_at: new Date(now - i * 3_600_000).toISOString(),
      duration: 12 + i * 4, seed: i,
      effects: i === 0 ? [{ id: 'mock-effect', at: 2, effect: 'bells', intensity: 0.6, volume: 0.7, pitch: 'high' }] : [],
    })),
    settings: { ...defaultSettings },
  }
}
export function profileState(data) {
  const pending = flow.find((key) => !data.profile[key])
  return {
    greeting: Object.keys(data.profile).length ? 'Welcome back.' : 'Welcome today.',
    properties: Object.entries(data.profile).filter(([key]) => key !== 'music_preferences').map(([key, value]) => ({
      key, value, ...questions[key], is_profile_property: true, updated_at: data.updatedAt,
    })),
    music_preferences: (data.profile.music_preferences || '').split(/[,;]+/).map((value) => value.trim()).filter(Boolean).map((value) => ({ value })),
    memorable_items: data.profile.memorable_item ? [{ value: data.profile.memorable_item }] : [],
    onboarding: pending ? { key: pending, ...questions[pending] } : null,
    questions: Object.fromEntries(Object.entries(questions).map(([key, value]) => [key, { key, ...value }])),
    auto_start_onboarding: Boolean(pending),
  }
}
export const playPrompt = "Wonderful. Let's play some music. What does this picture remind you of?\n\nHum a melody for me."
export function chatAnswer(data, message, key) {
  const play = /\b(play|make|create)\b.*\bmusic\b|musik.*(machen|spielen)/i.test(message)
  if (play) return { text: playPrompt, mode: 'play' }
  const skip = /^(skip|later|no thanks|überspringen|später)[.!]?$/i.test(message.trim())
  if (key && questions[key] && !skip) {
    let value = message.trim()
    if (key === 'name') value = value.replace(/^(my name is|call me|ich heiße)\s+/i, '').split(/\s/)[0]
    if (key === 'birth_year') value = value.match(/\b(?:18|19|20)\d{2}\b/)?.[0] || ''
    if (value) data.profile[key] = value
  } else if (!key) {
    const name = message.match(/\b(?:my name is|call me|ich heiße)\s+([\p{L}'-]+)/iu)
    if (name) data.profile.name = name[1]
  }
  if (key === 'name') return { text: `Thank you${data.profile.name ? `, ${data.profile.name}` : ''}. What year were you born?`, next: 'birth_year' }
  if (key === 'birth_year') return { text: questions.music_preferences.question, next: 'music_preferences' }
  if (key === 'music_preferences') return { text: playPrompt, mode: 'play', next: null }
  if (/song|lied|recommend|suggest/i.test(message)) return { text: 'You might enjoy Moon River or Amazing Grace. Which would you like to remember?' }
  return { text: `That sounds lovely${data.profile.name ? `, ${data.profile.name}` : ''}. We can try a gentle melody together.` }
}
export function transcriptFor(data, config) {
  if (config.silence) return ''
  if (config.transcript) return config.transcript
  return { name: 'Alex', birth_year: '1950', music_preferences: 'Jazz and piano' }[profileState(data).onboarding?.key] || "Let's play music."
}
