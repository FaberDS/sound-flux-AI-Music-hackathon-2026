export interface Message {
  role: 'user' | 'assistant'
  content: string
}

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export function liveSocketUrl(turnId: string) {
  const url = new URL(baseUrl || '/', location.origin)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/live/${encodeURIComponent(turnId)}`
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export async function request(
  path: string,
  options: RequestInit = {},
  timeout = 180_000,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout),
  })
  if (!response.ok) {
    const reason =
      response.status === 413
        ? 'The recording is too large. Please record a shorter message.'
        : response.status === 422
          ? 'The message could not be processed. Please try a shorter message.'
          : 'The voice companion is unavailable right now. Please try again later.'
    throw new Error(reason)
  }
  return response
}

export async function checkConnection(signal: AbortSignal) {
  const response = await request('/health', { signal }, 4_000)
  const data = await response.json()
  if (typeof data.chat_model !== 'string')
    throw new Error('Unexpected health response')
}

export async function preseedOnboarding(signal: AbortSignal) {
  const response = await request('/v1/debug/preseed-onboarding', {
    method: 'POST',
    signal,
  }, 10_000)
  return response.json()
}

export async function streamReply(
  turnId: string,
  message: string,
  history: Message[],
  profile: string[],
  signal: AbortSignal,
  onToken: (text: string) => void,
  onboardingKey?: string | null,
  onMode?: (mode: string) => void,
  onOnboardingKey?: (key: string | null) => void,
) {
  const response = await request('/v1/chat', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      turn_id: turnId,
      message,
      history: history.slice(-12),
      profile,
      onboarding_key: onboardingKey,
    }),
  })
  if (!response.body)
    throw new Error('The answer is empty. Please try again.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let answer = ''
  let completed = false

  function consume(frame: string) {
    const lines = frame.split(/\r?\n/)
    const event = lines
      .find((line) => line.startsWith('event:'))
      ?.slice(6)
      .trim()
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) return
    if (event === 'error')
      throw new Error(
        'The answer could not be created. Please try again later.',
      )
    if (event === 'done') {
      completed = true
      return
    }
    if (event === 'mode') {
      const payload = JSON.parse(data)
      if (typeof payload.value === 'string') onMode?.(payload.value)
      return
    }
    if (event === 'onboarding') {
      const payload = JSON.parse(data)
      if (typeof payload.key === 'string' || payload.key === null)
        onOnboardingKey?.(payload.key)
      return
    }
    if (event !== 'token') return
    const payload = JSON.parse(data)
    if (typeof payload.text !== 'string')
      throw new Error('The answer could not be read.')
    answer += payload.text
    onToken(answer)
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true })
      let boundary: RegExpExecArray | null
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        consume(buffer.slice(0, boundary.index))
        buffer = buffer.slice(boundary.index + boundary[0].length)
      }
      if (done) break
    }
    if (buffer.trim()) consume(buffer)
    if (!completed || !answer.trim())
      throw new Error(
        'The answer was interrupted. Please try again.',
      )
    return answer
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function createSpeech(
  turnId: string,
  text: string,
  signal: AbortSignal,
) {
  const response = await request('/v1/speech', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ turn_id: turnId, text: text.slice(0, 2_000) }),
  })
  return response.blob()
}

export function interruptTurn(turnId: string) {
  // Local capture and playback stop first, even if the server cannot be reached.
  return request(
    `/v1/turns/${encodeURIComponent(turnId)}/interrupt`,
    { method: 'POST' },
    4_000,
  ).then(() => {})
}
