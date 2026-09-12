# Sound Flux — Local Speech Companion

Speak to a local music companion in your browser. It transcribes with MLX Whisper, thinks with Ollama, and answers with Kokoro TTS.

Everything runs on your Mac after the models have been cached.

## Requirements

- Apple Silicon Mac
- [uv](https://docs.astral.sh/uv/)
- [Ollama](https://ollama.com/)
- FFmpeg: `brew install ffmpeg`

## Start

In one terminal, make sure Ollama is available and download the chat model once:

```sh
ollama serve
ollama pull qwen3:14b
```

If `ollama serve` says the address is already in use, it is already running—continue.

In a second terminal:

```sh
cd /Users/denisschule/dev/sound-flux-AI-Music-hackathon-2026/local-speech/api
uv sync
uv run uvicorn app:app --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000> and allow microphone access.

## Use it

1. Click **Start speaking**.
2. Say a short question or musical idea.
3. Click **Stop and ask**.

The page shows your transcript, streams the companion response, then plays its voice. Starting a new recording immediately stops the previous reply.

You can also type into **Say or type a message**. Typed and spoken turns share the same in-browser conversation history.

The first transcription and speech request download and cache the MLX Whisper and Kokoro models. Later runs stay local.

## Defaults

| Part | Model |
| --- | --- |
| Speech to text | `mlx-community/whisper-large-v3-turbo-asr-fp16` |
| Chat | `qwen3:14b` via Ollama |
| Text to speech | `mlx-community/Kokoro-82M-8bit` |

Choose another installed Ollama model when starting the server:

```sh
CHAT_MODEL=qwen3.5:27b uv run uvicorn app:app --host 127.0.0.1 --port 8000
```

## If something is missing

- No transcript: refresh the page, allow microphone access, then speak for a few seconds before stopping.
- No companion reply: run `ollama list`; pull the configured model if it is absent.
- `ffmpeg` not found: run `brew install ffmpeg`.
- After changing code: stop the server with `Ctrl+C` and start it again.

For the API endpoints, see [api/README.md](api/README.md).
