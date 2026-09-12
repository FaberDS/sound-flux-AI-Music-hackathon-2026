# Sound Flux Voice API

Start with the [local-speech guide](../README.md).

## Run

```bash
uv sync
uv run uvicorn app:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000/docs for the API UI. The app uses local MLX Whisper, Ollama at port 11434, and Kokoro TTS; models download once and are then cached locally.

For a browser microphone test, open http://127.0.0.1:8000. It streams PCM audio over a WebSocket and shows rolling MLX Whisper transcripts.

## Conversation flow

1. Upload recorded browser audio to `POST /v1/transcriptions` as multipart `audio` and reuse the returned `turn_id`.
2. Send the text to `POST /v1/chat`; it responds as server-sent events named `token`.
3. Send the completed response to `POST /v1/speech` using the same `turn_id`; play the returned WAV in the browser.

The system prompt is `SYSTEM_INSTRUCTIONS` in `app.py`. Keep personal profile facts in the chat request's `profile` list; do not place raw sensor telemetry in it.

## Interruptions

Create a fresh `turn_id` for each user utterance. When the user begins speaking again:

```js
controller.abort();          // abort the streaming /v1/chat fetch
audio.pause();               // stop browser playback immediately
fetch(`/v1/turns/${turnId}/interrupt`, { method: "POST" });
```

The endpoint cancels the active Ollama stream and terminates any active Whisper or Kokoro subprocess for that turn. The server never plays audio through its own speakers, so it cannot keep speaking after the browser stops playback.
