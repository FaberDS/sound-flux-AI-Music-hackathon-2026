export interface Message {
  role: 'user' | 'assistant'
  content: string
}

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

async function request(
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
        ? 'Die Aufnahme ist zu groß. Bitte nimm eine kürzere Nachricht auf.'
        : response.status === 422
          ? 'Die Nachricht konnte nicht verarbeitet werden. Bitte versuche eine kürzere Nachricht.'
          : 'Die Sprachbegleitung ist gerade nicht erreichbar. Bitte versuche es später noch einmal.'
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

export async function transcribe(
  blob: Blob,
  turnId: string,
  signal: AbortSignal,
) {
  const form = new FormData()
  const extension = blob.type.includes('mp4')
    ? 'mp4'
    : blob.type.includes('ogg')
      ? 'ogg'
      : 'webm'
  form.append('audio', blob, `aufnahme.${extension}`)
  form.append('turn_id', turnId)
  const response = await request('/v1/transcriptions', {
    method: 'POST',
    body: form,
    signal,
  })
  const data = await response.json()
  if (typeof data.text !== 'string' || !data.text.trim()) {
    throw new Error(
      'Ich konnte keine Worte hören. Sprich noch einmal oder schreibe deine Nachricht.',
    )
  }
  return data.text.trim().slice(0, 4_000) as string
}

export async function streamReply(
  turnId: string,
  message: string,
  history: Message[],
  profile: string[],
  signal: AbortSignal,
  onToken: (text: string) => void,
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
    }),
  })
  if (!response.body)
    throw new Error('Die Antwort ist leer. Bitte versuche es noch einmal.')
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
        'Die Antwort konnte nicht erstellt werden. Bitte versuche es später noch einmal.',
      )
    if (event === 'done') {
      completed = true
      return
    }
    if (event !== 'token') return
    const payload = JSON.parse(data)
    if (typeof payload.text !== 'string')
      throw new Error('Die Antwort konnte nicht gelesen werden.')
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
        'Die Antwort wurde unterbrochen. Bitte versuche es noch einmal.',
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
  void request(
    `/v1/turns/${encodeURIComponent(turnId)}/interrupt`,
    { method: 'POST' },
    4_000,
  ).catch(() => {})
}
