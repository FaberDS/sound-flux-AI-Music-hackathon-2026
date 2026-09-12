# Sound Flux — Audio Engine

Hum a melody, and Stable Audio 3 Medium turns it into a looping composition. Everything runs locally on an Apple Silicon Mac with MLX; no audio leaves the machine.

The studio has a single button: tap to record, tap again to stop. The composition is generated and starts looping automatically. Tap again to record a new melody.

## Requirements

- macOS on Apple Silicon, Python 3.11+, [uv](https://docs.astral.sh/uv/)
- About 13 GB of free disk space: a 5.53 GB download plus about 7 GB of converted runtime weights

## Setup

```sh
cd audio-engine
uv sync --locked
uv run --locked python prepare.py   # downloads and converts the pinned model weights
```

If the Hugging Face download stalls, run `HF_HUB_DISABLE_XET=1 uv run --locked python prepare.py`. You can also skip this step: the studio starts setup on first use and shows download progress.

## Run

```sh
uv run --locked python app.py
```

Open [http://127.0.0.1:7860](http://127.0.0.1:7860). The server only listens on loopback. Browsers only allow microphone access on `localhost` or HTTPS.

## In the Sound Flux music room

From the repository root, `./start.sh` starts this engine together with the frontend and the speech API. The music room's **Melodie summen** card records a hum, sends it through the Vite proxy (`/engine` → `127.0.0.1:7860`) with empty settings, and loops the result. So whatever you save in tuning mode is what the music room plays.

## Tuning mode

Open [http://127.0.0.1:7860/?tune](http://127.0.0.1:7860/?tune) to show a settings panel below the button. Use it to find good settings:

1. Choose **Input audio**: your last recording, or any file in `audio/` (m4a, mp3, wav, and so on, 1–30 s; the browser decodes it).
2. Adjust the settings, then press **Generate from input**. It reuses the same input, so you don't need to hum again.
3. The panel shows the seed and generation time. Press **Use last seed** to fix the seed, then change one setting at a time to compare.
4. Press **Save as default** to write the settings to `settings.json`. The one-button studio then uses them. **Revert to saved** discards unsaved changes.

| Setting | Range | Effect |
|---|---|---|
| `prompt` | 1–2000 chars | Describes the music |
| `negative_prompt` | 0–2000 chars | What to steer away from; only works when `cfg` is above 1 |
| `seconds` | 5–60 | Output length |
| `match_input` | on/off | Output is exactly as long as the input (minimum 5 s); overrides `seconds` |
| `strength` | 0.1–0.95 | Noise added to the input: lower keeps more of the hum, higher follows the prompt more |
| `steps` | 1–32 | Denoising steps: more is slower |
| `cfg` | 1–10 | How strongly the output follows the prompt |
| `seed` | -1 to 2³¹−1 | -1 picks a random seed each time |
| `repeat` | on/off | Loops a short input to fill the length; off pads with silence |
| `input_mix` | 0–1 | Mixes the input into the output, sample-aligned with it; limited to avoid clipping |

Changing any setting, including `input_mix`, means generating again.

## Command line

```sh
uv run --locked python engine.py hum.wav --out composition.wav \
  --prompt "Warm piano and strings" --negative-prompt "vocals, noise" \
  --strength 0.5 --match-input --input-mix 0.3
```

Input must be a libsndfile format such as WAV or FLAC; convert m4a first, for example `afconvert -f WAVE -d LEI16 in.m4a hum.wav`. The command line uses the defaults in `engine.Options`, not `settings.json`.

## API

- `GET /api/status`: model readiness and setup progress. It never starts a download.
- `POST /api/setup`: starts the model download and conversion in the background.
- `POST /api/compose`: multipart form with `audio` (WAV) and `settings` (JSON using the setting names above). Saved defaults fill in any missing settings. Returns a stereo WAV and an `X-Generation-Seed` header.
- `GET` / `POST /api/settings`: reads or saves the defaults in `settings.json`.
- `GET /api/samples`: lists the files in `audio/`, which are served at `/samples/<name>`.

## Check

```sh
uv run --locked python -m unittest -v
node --test test.mjs
```

Browser smoke test (start the server first):

```sh
uv run --with playwright==1.55.0 python -m playwright install chromium
uv run --with playwright==1.55.0 python browser_smoke.py
```

To use the real model instead of mocks, set `AUDIO_ENGINE_MODEL_TEST=1` on the unit test and smoke test commands.

## Notes

- Audio-to-audio generation does not guarantee exact melody preservation.
- Weights: Stability AI Community License; the T5Gemma text encoder also falls under the Gemma Terms of Use.
- Model caches, virtual environments and generated WAVs are git-ignored. `settings.json` is tracked, so saved defaults are committed with the project.
