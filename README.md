# Sound Flux

Sound Flux is an accessible, local-first music companion. It helps people make
and enjoy music through simple gestures, humming, speech, and large on-screen
instruments—without needing musical training.

The project grew through two early browser prototypes before becoming the
integrated application in [`frontend`](frontend/):

| Version | Idea explored | What it contributed |
| --- | --- | --- |
| [Draft 1](denis-v1/) | A camera-controlled instrument for people who prefer or need hands-free interaction | Face tracking, personalised movement calibration, head-gesture drums, and optional MIDI |
| [Draft 2](denis-v2/) | A calm music session for people living with dementia or Alzheimer’s and their care partners | A low-pressure flow, familiar-music prompts, humming and clapping, tap instruments, and a care profile |
| [Current app](frontend/) | One shared music room built from the strongest parts of both drafts | Local voice conversation, saved profiles and history, browser instruments, beatboxing, and humming-to-music generation |

The drafts are intentionally kept in the repository as small, runnable records
of the product's evolution. Each has its own README and product specification.

## How it works

- The **React frontend** provides the music room, instruments, microphone controls,
  profile, and conversation history.
- The **local speech companion** transcribes speech, talks through Ollama, and
  reads replies aloud.
- The **audio engine** turns a hummed melody into a looping composition with
  Stable Audio 3 Medium on Apple Silicon.

Speech, profile data, and generated music stay on the local machine.

## Run the project

For frontend development without loading any models, run:

```sh
./start-dev.sh
```

The script asks for frontend and mock ports in the terminal. Press Enter to use
5173 and 8001; occupied ports can be replaced at the prompt. It connects the
frontend to the selected mock port automatically. With the defaults, open the
frontend on [localhost:5173](http://localhost:5173) and the [mock controls](http://127.0.0.1:8001/?frontendPort=5173)
to load example profiles and songs, restart onboarding, or simulate delays and
errors. Only Node.js 22.12 or newer and npm are needed; mock data persists separately.
See [backend-mockup/README.md](backend-mockup/README.md) for the test flows and
simulation limits. `Ctrl+C` stops both services.

To run with the real speech and music models, use the setup below.

You need macOS on Apple Silicon, Node.js 22.12 or newer, npm,
[`uv`](https://docs.astral.sh/uv/), Ollama, and FFmpeg. Follow the one-time model
setup in [`local-speech/README.md`](local-speech/README.md) and
[`audio-engine/README.md`](audio-engine/README.md), then run from the repository
root:

```sh
./start.sh
```

Open [localhost:5173](http://localhost:5173). The script also starts the speech
API on port `8000` and the audio engine on port `7860`; `Ctrl+C` stops all three.
If port `5173` is unavailable, choose another one:

```sh
FRONTEND_PORT=5174 ./start.sh
```

## Project map

```text
frontend/      Current React application
backend-mockup/ Lightweight speech and music APIs for frontend development
local-speech/  Local transcription, conversation, and text-to-speech
audio-engine/  Local humming-to-music generation
denis-v1/      Draft 1: camera and head-gesture instrument
denis-v2/      Draft 2: memory-focused music session
sensors/       Arduino sensor experiment
start.sh       Shared development launcher
start-dev.sh   Frontend and mock launcher, without model loading
```

For development commands, API details, and tests, see the README in each
component directory.
