# Tonumo evaluation lab

A small browser harness for refining the iPad's Tante Emma prompts with Ollama,
trying live tone-of-voice detection, comparing all ten Supertonic voices in German,
and testing local typed decisions.
The browser lab uses plain HTML + JavaScript + Tailwind, with no frontend build.
Its small Python server runs emotion2vec locally and starts the Promptfoo viewer
inside the lab. Automated prompt evaluations use the Promptfoo CLI below.

## Setup for teammates and coding agents

Use the **full repository checkout**, not a copy of this folder alone:
`check.mjs` reads `../ipad-audio-agent/App/Instructions.de.txt` to check prompt
parity. The lab does not need Xcode, the main frontend, `start.sh`, or the speech
and audio-engine servers. There is no frontend build, `.env` file, API key, or
account to configure for the local defaults.

Prerequisites:

- **Node.js 22.22.0+ and npm**; Node 24 was used for the JavaScript checks.
- **[uv](https://docs.astral.sh/uv/getting-started/installation/)** on `PATH`.
  The Python project requires **3.11 or 3.12**; the command below selects 3.12,
  which uv can download if needed.
- **[Ollama](https://ollama.com/download)** for prompt comparison, image analysis,
  memory-demo answers, and automated model evaluations. Other tools can run
  without Ollama.
- Internet for dependency/model downloads and CDN styling; allow several GB of
  disk space for the Python environment and whichever models you enable.

Commands below use a macOS/Linux shell. Verification was on macOS Apple Silicon;
native Windows PowerShell is not supported by the current npm shell scripts.

### Install and check

Start in the repository root. Run this block once; **all later commands assume
you are already inside `llm-evaluation/`**, including commands in new terminals.

```sh
cd llm-evaluation
node --version
uv --version
npm ci
env -u VIRTUAL_ENV uv sync --locked --python 3.12
npm run check
env -u VIRTUAL_ENV uv run --locked python -m unittest test_server.py
```

Keep `package-lock.json` and `uv.lock`: `npm ci` installs the npm lockfile, and
[`uv sync --locked`](https://docs.astral.sh/uv/concepts/projects/sync/) rejects a
stale Python lockfile instead of updating it. These checks make no model calls
or model downloads. The Python tests bind temporary loopback ports. No virtual
environment activation is needed; `env -u VIRTUAL_ENV` avoids inheriting another
project's environment. Repeat the install/check commands after dependency updates.

### Start the lab

For a first setup check without downloading/loading emotion2vec:

```sh
npm start -- --skip-tone-model
```

Open [http://127.0.0.1:8088](http://127.0.0.1:8088) and leave the terminal running.
The **Promptfoo** tab uses the viewer automatically started on port **15500**.
`Ctrl+C` stops the lab and its viewer. Do not substitute a static file server:
the lab's memory, speech, tone, and viewer-status APIs are in `server.py`.

To enable tone analysis, stop that server and restart normally:

```sh
npm start
```

Normal startup loads emotion2vec in the background, downloading about **1.12 GB**
on first use into `.cache/huggingface` (unless `HF_HOME` is already set).
The page can load before tone analysis is ready. The skip flag
disables only this model; it still requires the Python dependencies and permits
on-demand speech-model downloads when you use those features.

In a second terminal, check startup:

```sh
curl --fail http://127.0.0.1:8088/api/promptfoo/status
curl --fail http://127.0.0.1:8088/api/tone/status
```

Promptfoo should eventually report `"ready": true` and `"error": null`.
Tone should also become ready on normal startup; with `--skip-tone-model`,
`"ready": false`, `"loading": false`, and `"error": null` are expected.

### Enable Ollama features

Open the Ollama application, or run `ollama serve` in a separate terminal if
it is not already running. Then pull the two text-comparison defaults:

```sh
ollama pull qwen3:1.7b
ollama pull qwen3:0.6b
curl --fail http://127.0.0.1:11434/api/tags
```

The last command should return both model names. Open **Prompts vergleichen**,
refresh the models, and run a comparison. For a single automated setup check:

```sh
npm run eval -- --filter-pattern '^R01 ' --filter-providers 'qwen3:1.7b'
```

This makes one local model request. An assertion failure is a model result;
a connection or missing-model error is a setup problem. Full suites are below.

### Which feature needs what?

| Feature | Inference location and first-use requirement |
| --- | --- |
| Prompt comparison / automated evaluations | Ollama host; pull the two Qwen models above. CLI evaluations do not require the lab server. |
| Image evaluation | Ollama host; additionally `ollama pull qwen3.5:2b`. |
| Tone of voice | Python server CPU; emotion2vec loads on normal startup. |
| Supertonic voices / agent appearance | Python server; Supertonic 3 downloads about 400 MB on the first speech request. |
| Memory demo | Python server for SQLite; Ollama for answers, Whisper for recorded input, Supertonic for spoken output. Models load when first needed. |
| Local decisions | Browser/device; load one GGUF model (639 MB or 1.56 GB) in the tab. This is separate from Ollama's model store. |
| Motion capture / gesture sound | Browser/device; `npm ci` runtime plus the three supplied `motion-models/*.task` files. No Ollama or audio engine. |

The browser's Ollama default is `http://127.0.0.1:11434`. The text comparison's
**Ollama-Adresse** also controls memory-demo answers; image evaluation has its
own address field. The npm evaluation scripts and hybrid provider use the local
Ollama address independently of these browser settings.
Tailwind and the DM Sans / Lora fonts load from CDNs, so styling needs internet.
Prompts go to the endpoint you select; the supplied local models keep inference
on that host. Camera/microphone access needs localhost or trusted HTTPS; see
[iPad browser use](#ipad-browser-use) before trying a LAN URL.

### Files to share and edit

Share the repository with both lockfiles, `ipad-audio-agent/App/Instructions.de.txt`,
and all three `motion-models/*.task` assets. Verify those files are included in
the commit/archive you give the team; a local untracked folder is not part of a
teammate's clone. Reinstall dependencies on each machine.

| Files | Purpose |
| --- | --- |
| `package.json`, `pyproject.toml`, lockfiles | Commands and dependency versions. |
| `server.py`, `test_server.py` | HTTP APIs, model loading, SQLite storage, Python checks. |
| `index.html`, `app.mjs`, `time-context.mjs` | Lab UI, copied iPad prompt, comparison requests, recording. |
| `decision*.mjs`, `images.mjs`, `memory-demo.mjs`, `voices.mjs`, `agent-demo.*`, `motion-*` | Individual experiments and bundled motion assets. |
| `promptfooconfig.mjs`, `szenarien.de.mjs`, `check.mjs` | Main automated cases, assertions, and no-model checks. |
| `hybrid.mjs`, `hybrid.config.mjs`, `run-hybrid.mjs` | Separate hybrid experiment and batch runner. |

Do not include generated `node_modules/`, `.venv/`, `.cache/`, `.data/`, or
`.promptfoo/` directories in a source handoff. `.data/` holds saved profiles,
memories, and original photos; `.promptfoo/` holds evaluation results/logs.
Browser edits and image attempts stay in that browser and origin; share an
intentional export when needed. `results*.json/html/csv` exports are ignored by
Git, so they are not included automatically either.

## Overview

The lab opens on **Überblick**, a compact map of the planned speech pipeline:
parallel STT and tone analysis → memory/context and tokenization → LLM evaluation
→ TTS, with memory updates feeding the next turn. It distinguishes the existing
experiments from the full pipeline and links to the available tools. The extra checks
cover turn-taking, latency/fallbacks, shared test cases, and memory consent/deletion.

## Compare

- Edit the shared key/value rows and input text at the top.
- A starts with **Qwen3 1.7B**, B with **Qwen3 0.6B**. Pick the same model on both
  sides to isolate prompt changes.
- Each side has a system prompt and an optional input prompt, placed before the
  shared input text. Checkboxes select exactly which parts are sent. Context is
  appended to the system message independently of the system-prompt checkbox.
- Expand **Next request** to inspect the exact payload. **Last sent request**
  stays attached to the response, even after editing the next setup.
- **Run comparison** sends A, then B without competing for generation resources.
  **Run A/B** reruns one side; **Stop** cancels the active request and skips any
  remaining variant. Partial output stays visible.
- First-text time, total time, generated tokens, and tokens/second appear below
  each variant. Total time includes model loading; repeat runs for warm timings.
  Editing saves locally in this browser; responses are not persisted.

Install any other model with `ollama pull <model:tag>`, then **Refresh models**.
Both selectors use Ollama's [`GET /api/tags`](https://docs.ollama.com/api/tags);
generation uses [`POST /api/chat`](https://docs.ollama.com/api/chat) with streaming.

## Tone of voice

Open **Tone of voice**, choose **Start recording**, and speak naturally. The tab
records locally for playback while updating nine emotion scores live. Stop it
manually or let the 60-second limit finish the recording.

**Stimmwirkung im Verlauf** plots all nine scores as stacked columns, one per
evaluated audio section. The default is the entire history; choose the last 10,
30, or 60 seconds to focus on recent sections. The legend shows the mean scores
for the selected range. Time runs from the first recording, with gaps between
recordings; the range freezes when recording stops. History stays across
recordings in this tab until reload or **Zurücksetzen**, which stops recording
and clears the history, live scores, summary, and playback. Pending results are
discarded on reset.

The local server keeps `emotion2vec/emotion2vec_plus_base` warm and evaluates an
overlapping window about every two seconds. It returns angry, disgusted, fearful,
happy, neutral, other, sad, surprised, and unknown. Audio and results are not
persisted; playback stays in browser memory and disappears on reload. Scores are
uncertain model estimates, not facts about emotion, intent, health, or truth.

## Supertonic voices

Open **Supertonic-Stimmen**, choose one of nine German phrases (or edit the text),
then press **F1 vorlesen** through **M5 vorlesen** to hear any of the ten supplied
voices. The same text is used for each voice; the player shows the voice and the
exact text of its generated sample. Text is limited to 1,000 characters.

The existing Python server uses the [Supertonic SDK](https://github.com/supertone-oss-archive/supertonic-py)
with `supertonic-3`, German (`de`), eight synthesis steps, and speed 1.0.
The first request downloads about 400 MB into `.cache/supertonic3`; subsequent
requests reuse the local model. After a dependency update, repeat the locked
Python sync above and restart `npm start`. No additional server is needed.
If the model download stalls, restart with `HF_HUB_DISABLE_XET=1 npm start`.
This browser comparison runs ONNX on the Mac; it does not measure the iPad's Core ML speed.

**Stoppen**, switching tabs, or editing the phrase stops playback and discards
pending browser responses. An already running server generation/download finishes
in the background; while busy, the server asks subsequent requests to retry.
Generated audio stays in memory. Supertonic speech is AI-generated and the model
uses [OpenRAIL-M](https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE).

## Agent appearance

Open **Agent-Darstellung** or [the agent tab](http://127.0.0.1:8088/#agent) to compare
a person outline, a speech bubble, and a minimal face. **Satz abspielen** reads an
editable German example through the existing Supertonic endpoint. All three
designs react to the same audio amplitude; the figures themselves stay still.
**Kurzes Gespräch abspielen** adds a scripted user reply (text only), a spoken
answer, and previews of music creation and completion. No microphone or music
generation is used. Separate state buttons let you inspect each waiting state.

**Ohne Animation** and the device's reduced-motion preference keep the symbols
still. Captions and large state labels remain visible. Stop, edit, change voice,
or leave the tab to cancel pending requests and playback. The audio player also
supports pause/resume if the browser requires a second click to play.

## Motion capture

Open **Motion capture** or [the motion tab](http://127.0.0.1:8088/#motion), then
click **Start camera**. The lab shows a mirrored webcam overlay, a separate
skeleton, and enlarged face and hand details. Checkboxes select body/arms,
face/nose, eyes/eyebrows, mouth, and hands/fingers. Blink and mouth-opening meters
show the model's expression scores. Keep one person in view with good lighting;
step back to include legs. Hand labels are model estimates.

Tracking runs locally in the browser, capped at 15 Hz, with GPU acceleration and
a CPU fallback. Video is neither recorded nor uploaded. **Stop camera**, leaving
the tab, and leaving the page release the camera and trackers. Webcam access
requires localhost or HTTPS; ordinary HTTP over a LAN does not support it.
This is a 2D landmark demo, not calibrated 3D motion capture.

**Start sound** plays a quiet browser-generated melody. Expand **Choose your
movements & effects** to map mouth opening, tilt up/forward/left/right, every
finger bend, and lifting or moving either hand left/right. Choose kick, snare,
hi-hat, bell, or pluck for an accent; filter, echo, pitch lift, stereo pan, and
volume swell change continuously with movement. Next phrase cycles three melodies;
Play / pause loop toggles the melody while leaving gesture accents available.
**Off** disables a mapping. Multiple mappings can play together; continuous
mappings to the same effect use the strongest movement. Live meters show each
input even while sound is off. Readouts below each sketch show 0–100% movement,
the assigned effect, and whether it is applying or has just triggered.

Relax a movement before triggering it: holding a pose does not repeatedly fire
accents. Accents and music controls fire at 65% and rearm below 30%.
**Center pose** sets a comfortable neutral position for head and hands; **Sensitivity**
adjusts how much movement is needed. Finger bends use joint-angle estimates and
may need sensitivity adjustment. Head percentages estimate motion, not degrees.
Hand travel uses wrist displacement from center, scaled by palm width; left/right
follow the mirrored preview. Keep your body still, since body travel also moves
the wrists. Reacquiring a hand sets a new center. For example, map Lift hand to
Volume swell (25–100% of the volume slider) and Move left to Next phrase.
Lost tracking resets its effects and trigger
state. **Stop sound** silences the loop and accents; stopping the camera or leaving
the tab stops all demo audio too. The source is this small demo loop, independent
of the music room and microphone; mappings last until the lab page is reloaded.

The lab owns the MediaPipe runtime (`npm ci`) and the three bundled models in
`motion-models/`; the Sound Flux frontend and its server are not needed.
The [hand model](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)
comes from Google's official `hand_landmarker/hand_landmarker/float16/latest`
bundle (SHA-256 `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`).
After starting the lab, run `npm run test:motion` for the simulated webcam,
tab-switch cleanup, layer selection, error, and real-model startup checks.
If Chromium is missing, run `npx playwright install chromium` once.

## Local decisions

Open **Local decisions** and load either Qwen3 0.6B (639 MB, smaller download)
or MiniCPM5 2B (1.56 GB). These are checkpoint sizes, not total runtime RAM needs.
The first run downloads the pinned
GGUF checkpoint from Hugging Face; wllama stores it in browser-managed local
storage and performs inference on the device. Ollama and the Python server do not
receive the decision text.

The German demo classifies information as **MERKEN**, **NUR IM AKTUELLEN
GESPRÄCH**, or **NICHT RELEVANT**. Five editable examples cover an appointment,
preferred form of address, a message to a grandchild, today's shopping list,
and an unrelated observation. The result is a probability distribution over
only the declared options, not a calibrated correctness guarantee. Keep security
rules, active requests, commitments, names, identifiers, and dates with
deterministic code; never remove context solely because this demo selects
`NICHT RELEVANT`.

The implementation is split between `decision.mjs` (validation, prompt contract,
and UI) and `decision-worker.mjs` (wllama inference), so the decision contract can
be reused without the evaluation UI. The constrained option-logit approach follows
the MIT-licensed [SemIf browser demo](https://github.com/TheoLeeCJ/SemIf-OpenJev/tree/master/webgpu-demo),
using the MIT-licensed [wllama runtime](https://github.com/ngxson/wllama).

### iPad browser use

[Safari 26 / iPadOS 26 supports WebGPU](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/#webgpu).
The decision worker requests GPU offload when `navigator.gpu` exists, otherwise
CPU/WASM. This is not a guarantee that every device has enough memory to load
either model. Start with Qwen3 0.6B. Browser model caches can be evicted.

**Plain `http://<mac-address>:8088` is currently not a working setup for the full
lab.** In addition to microphone/camera restrictions, initialization calls
[`crypto.randomUUID()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID),
which requires a secure context. On an insecure LAN origin this can stop page
initialization before the remaining tools load. The WASM fallback does not fix it.

`npm run start:lan` binds the Python server to `0.0.0.0`; it does **not** add HTTPS
or configure Ollama. For an iPad setup, provide trusted HTTPS for the lab and
its `/api/*` routes using your own local proxy. No TLS/proxy configuration is
included here. Ollama also needs a browser-reachable HTTPS endpoint, and the
embedded Promptfoo viewer needs HTTPS on the lab hostname at its reported port
(15500 by default). Use the Mac's localhost setup until those are configured.

The browser contacts Ollama directly: `127.0.0.1` on an iPad means the iPad,
not the Mac. Set **Ollama-Adresse** to the reachable endpoint in the prompt tab
(also used by memory chat) and separately in the image tab. Allow the lab's
exact HTTPS origin with `OLLAMA_ORIGINS`. If the proxy is on another machine,
Ollama must also listen on a reachable address via `OLLAMA_HOST`; a proxy on
the Mac can use Ollama's default loopback listener. See
[Ollama's network and origin configuration](https://docs.ollama.com/faq).

The lab has no authentication; keep any LAN setup on a trusted development
network. Memory files and server-side inference still belong to the Mac.

## Image evaluation

Open **Bilder vergleichen** (or [the image tab](http://127.0.0.1:8088/#images)).
Select a JPEG, PNG, or WebP up to 10 MB / 40 MP, edit the prefilled factual
photo-analysis prompt, and choose an installed Ollama vision model. Start with
`ollama pull qwen3.5:2b` on the Ollama host. The browser resizes the photo to at
most 1,024 px on its longest edge and sends a JPEG copy with the exact prompt.
Temperature defaults to 0.1, output to 512 tokens, and thinking is disabled for
models that advertise thinking support. Every attempt starts with empty history.

Before JPEG re-encoding strips metadata, the browser reads EXIF from the original
JPEG or PNG using the locally served `exifr` dependency. Capture time (with an
explicit unknown timezone when absent), camera/software, and valid GPS coordinates
appear next to the photo and persist in `image.metadata` with each attempt/export.
An optional OpenStreetMap link opens the embedded coordinates only when clicked;
there is no automatic geocoding or metadata upload. The model receives pixels
only, so metadata remains separate from its visual observations. Missing GPS
stays unknown. EXIF may be edited, and a scan's metadata may describe digitization
rather than the historical scene. WebP metadata is explicitly unsupported for
now; failed extraction never blocks image analysis. Re-upload originals to read
metadata for attempts saved before this feature.

The default JSON schema is passed to Ollama and checked again after generation.
Turn off **JSON-Schema des Entwurfs erzwingen** to experiment with other formats.
Invalid, truncated, failed, and cancelled outputs remain available for inspection;
the lab never silently repairs or retries a result. Schema validity does not
establish factual accuracy or family approval.

The current draft also returns `emotion_hints`: at most two possible emotions
(`joy`, `affection`, `calm`, `excitement`, `sadness`, `tension`), each tied to a
scene/person description, visible evidence, and medium/high uncertainty. A
`conversation_question_de` suggests an open, non-leading follow-up. No supported
cues means an empty list; unusable images receive no hints or question. The UI
shows these unconfirmed impressions separately from factual descriptions, and
the app records `emotionReview: "unconfirmed"` in each new attempt/export.
They are not automatically mapped into patient memory or assumed to represent
the patient's present feelings. Personal meaning requires human confirmation.

Unedited older default prompts upgrade automatically. Custom drafts and old
attempts retain their original factual format when restored. Use **Aktuellen
Entwurf laden** to switch both prompt and schema to the new emotional-hints
draft; saved attempts remain unchanged.

Attempts persist in this browser's IndexedDB, including the exact processed
image, prompt, model/settings, raw output, status, and timing. Two selectors show
any saved attempts side by side; the newest run is compared with the previously
selected run. **Als neuen Versuch laden** restores the same image and settings
for another iteration. Individual attempts can be exported as JSON or deleted.
History is specific to the browser and origin; clearing browser data removes it.
An interrupted page reload may leave an attempt marked **Nicht abgeschlossen**.

Times measure the selected **Ollama host**, not native iPad MLX performance.
Opening this page on an iPad does not move inference from the Mac to the iPad.
This evaluation history is separate from the patient-memory demo.

## Personal memory demo

Open **Gedächtnis-Demo** to exercise the complete German flow: select or create a
person, save the optional onboarding profile, classify a confirmed statement as
persistent/current-conversation/irrelevant, and build the exact context for a
date and topic. The wedding preset demonstrates the deterministic ±7-day
anniversary check. Nothing classified as irrelevant is written.
Conversation-only entries carry a test-conversation ID and, without annual
recurrence, are excluded after **Neues Testgespräch**; they remain visible for
inspection or deletion. Only mark persistent entries as annual: the current
anniversary lookup does not filter by conversation ID.

Step 5 runs the communicational path end to end. Choose an installed Ollama model
and one of the ten Supertonic voices, record the German utterance, and generate
an answer. The request combines the iPad system prompt, fixed language `de`, the
person's retrieved memory context, the current conversation history, and the last
emotion2vec result from **Stimmwirkung**. The tone estimate is explicitly marked
as uncertain so the model can adjust its manner without asserting an emotion as
fact. The same recording is transcribed locally with `openai/whisper-base`; its
editable transcript is then sent to Ollama. The first transcription downloads the
model into `.cache/huggingface`. The answer is synthesized through `/api/tts` and
played in the same tab. On iPad the equivalent boundary can use Apple's native
SpeechTranscriber while keeping the same German transcript-to-context flow.

The local server stores the small profile registry in `.data/profiles.sqlite`.
Every person gets a separate `.data/users/<id>/memory.sqlite`; their original
images live under the same private directory while SQLite stores only captions,
dates, and file references. Images are never placed wholesale into every model
prompt. A photo description is selected only for a matching topic, or with an
anniversary when an approved annual memory has the same month and day. Users can
delete individual memories and images in the demo.

This deliberately starts with structured dates plus small keyword matching, not
embeddings: it is inspectable, cheap, and sufficient for the first validation.
Add a per-person vector index only after German retrieval tests show that this
baseline misses paraphrases. For iPad access, follow the HTTPS requirements in
[iPad browser use](#ipad-browser-use); the Mac still owns the SQLite files.
A native iPad version can keep
the same schema in its app container and store protected image files beside it.

The demo has no login and is for local development only. Production use needs
device/file protection, caretaker roles, an audit trail for consent, whole-profile
deletion, backups, and a tested restore path. `.data/` is ignored by Git and
blocked by the static file server.

## iPad alignment

The defaults are copied from `ipad-audio-agent/App/Instructions.de.txt`,
`UserContext.swift`, and `QwenLanguageModel.swift` as of 2026-09-24:

- `firstname: Amelie`, `lastname: Fischer`, `yearOfBirth: 1955`.
- The same JSON context envelope, assistant identity, and runtime `currentDate`,
  `currentTime`, `timeZone`, and `currentYear`.
- Thinking disabled; 120 output tokens; temperature 0.7, top-p 0.8,
  repetition penalty 1.05. Temperature and output limit are editable.
- Up to 20 context rows / 2,000 characters; blank pairs omitted; duplicate keys
  rejected without case sensitivity. System prompt ≤4,000 and input text ≤1,000 characters.

Every browser-comparison request starts with **empty conversation history** and goes to the LLM,
including greetings and stop phrases that the iPad may handle locally.
Ollama uses different model conversions/runtime than the iPad's MLX 4-bit models;
use this for prompt iteration, then confirm wording and latency on the iPad.
This folder is independent; it does not edit or sync the iPad application.

## Connection troubleshooting

Check `curl http://127.0.0.1:11434/api/tags`. If it fails, start Ollama.
Use the HTTP page above, not a `file://` URL. If the browser reports a CORS error,
quit Ollama, then run:

```sh
OLLAMA_ORIGINS=http://127.0.0.1:8088 ollama serve
```

For the Mac menu-bar app instead, run
`launchctl setenv OLLAMA_ORIGINS "http://127.0.0.1:8088"` and restart Ollama.
These follow [Ollama's origin configuration](https://docs.ollama.com/faq#how-can-i-allow-additional-web-origins-to-access-ollama).
Allow local-network access if your browser asks. An empty selector means its
model has not been pulled yet; install it and refresh, or select an installed model.

## Check

After the install step, run from `llm-evaluation/` with Node 22.22+:

```sh
npm run check
env -u VIRTUAL_ENV uv run --locked python -m unittest test_server.py
```

Checks prompt parity with the iPad source, all message-part selections, context
validation, split UTF-8 streaming, interrupted responses, cancellation, and the
automated evaluation's request wiring, PCM windowing, local decision contract,
image metadata/schema validation, memory storage, and mocked speech APIs.
`npm run check` also validates the Promptfoo configuration. These checks call no
models and need no running lab or Ollama server. The npm install is required
even for `node check.mjs`, because image checks import the local `exifr` module.

The optional browser check needs a running lab and Playwright Chromium:

```sh
npx playwright install chromium
npm run test:motion
```

It uses simulated camera input but also loads the real bundled MediaPipe models.
For another lab port, use `LAB_URL=http://127.0.0.1:8089 npm run test:motion`.

Verified on **2026-09-25**, on macOS Apple Silicon with the existing dependency
and model caches: npm install dry-run, locked Python sync, `npm run check`, all
five Python tests, lab/viewer health, cached emotion2vec loading, and the current
motion browser test passed. A single `M11` evaluation on Qwen3 1.7B completed
with one assertion failure and zero provider errors. Fresh full model downloads
and a physical iPad HTTPS setup were not exercised. The insecure-origin startup
failure described above was reproduced in Chromium.

## Promptfoo in the lab

Open **Promptfoo** to compare saved evaluations, filter failures, inspect replies,
and use the native Promptfoo interface. The viewer loads when you first open the
tab and stays on the selected evaluation when switching between lab tools.
**Neu laden** refreshes it; **In eigenem Tab öffnen** gives it a full browser tab.

The lab starts the installed viewer on port **15500**, using this folder's
`.promptfoo/` database, with telemetry and update checks disabled. CLI evaluations
and hybrid results therefore appear in the same viewer. Run `npm run eval` or
`npm run eval:hybrid` to execute the existing suites; browser prompt edits are
still separate from those checked-in configurations.

If Node or Promptfoo is missing, the status API reports setup instructions.
Run `npm ci` and restart the lab; other browser tools also depend on npm assets.
If the viewer exits, inspect the server terminal and restart the lab. If port
15500 is already in use, stop your separate viewer or use
`npm start -- --promptfoo-port 15501`. For an occupied lab port, use
`npm start -- --port 8089`; the viewer port must differ from the lab port.
The embedded viewer uses the lab page's hostname **and protocol**, replacing
only the port. An HTTPS lab therefore also requires HTTPS at the viewer port.

## Automated evaluation — free and local

[Promptfoo's open-source CLI](https://www.promptfoo.dev/docs/intro/) runs these
evaluations locally against [Ollama](https://www.promptfoo.dev/docs/providers/ollama/).
No Promptfoo account, subscription, API key, or paid model service is required.
This starter uses code-based assertions only; there is no paid or remote judge.
The initial npm install and model downloads need internet; inference uses your Mac.

With Node **22.22+**, start Ollama and install the two Qwen models using the
commands above. From `llm-evaluation/` (no Python/lab server needed for this path):

```sh
npm ci
npm run check
npm run eval
```

Use the lab's **Promptfoo** tab to compare replies and inspect failures.
Alternatively, with the lab stopped, `npm run view` starts the standalone viewer
at [http://localhost:15500](http://localhost:15500); `Ctrl+C` stops it.
An evaluation exits nonzero when assertions fail: those failures are useful model
results, not necessarily a broken setup. Connection errors mean Ollama needs to
be started; a missing-model error means running the relevant `ollama pull` command.

### Deutscher Datensatz für Musik und Erinnerungsimpulse

[`promptfooconfig.mjs`](promptfooconfig.mjs) enthält **108 Fälle × 2 Modelle**:
die 12 bisherigen Regressionen und **96 Anwendungsszenarien** in
[`szenarien.de.mjs`](szenarien.de.mjs). Die
[kritische Bewertung, Abdeckung und Prüfanleitung](DATENSATZ_BEWERTUNG.de.md)
erläutert die Grenzen der Ergebnisse.

Die neuen Fälle behandeln Anrede, Stimmung, unterschiedliche Musikwege,
Zeitsteuerung, Bilder und Erinnerungen, Begleitpersonen, Gesprächsverläufe,
Einwilligung und technische Grenzen. 16 Fälle enthalten einen bisherigen
Dialog, 58 einen simulierten App-Zustand; in 13 Fällen ist **keine gesprochene
Antwort** erwünscht. Alle Personen und Erinnerungen sind erfunden.

Der bestehende System-Prompt und die Modellparameter bleiben gleich:
Temperatur 0,7, Top-p 0,8, Wiederholungsstrafe 1,05, 120 Ausgabetoken,
Thinking aus. Das Testjahr ist 2026, sofern der Fall nichts anderes vorgibt.
Nur der Evaluationsadapter ergänzt Verlauf und App-Zustand. Browseränderungen
aus dem lokalen Speicher fließen nicht in diese Tests ein.

Automatisch geprüft werden Ausgabe beziehungsweise gewünschte Stille,
Abschneiden am Tokenlimit, vorlesbares Format, Frageanzahl, Kürze und ausgewählte
Inhaltssignale. Für die neuen Fälle sind standardmäßig **null bis eine Frage**
zulässig; bei Ruhe oder Ende keine, bei einem ersten Bildimpuls genau eine.
Die 12 alten Regressionen behalten ihre bisherigen Regeln.

**Ein automatischer Pass bestätigt weder Empathie noch eine ausgeführte
App-Aktion.** Jeder neue Fall enthält deshalb zusätzlich ein deutsches
Sollverhalten, unerwünschte Reaktionen und die erwartete App-Aktion zur
gesonderten Prüfung. Diese Prüfdaten und die Stimmungs-/Haltungslabels werden
dem Modell nicht geschickt. Die aktuelle Gesprächsversion kann noch keine
Musik oder Bilder steuern; entsprechende Fälle machen die Lücke sichtbar.

Alle Fälle lokal ausführen und Ergebnisse speichern:

```sh
npm run eval -- --output results-usecase-de.json
```

Gezielt prüfen:

```sh
# Nur die bisherigen 12 Regressionen:
npm run eval -- --filter-pattern '^R[0-9]'
# Nur Zeitsteuerung oder nur Bilder:
npm run eval -- --filter-metadata group=Timing
npm run eval -- --filter-metadata group=Bilder
# Einzelner Fall, ein Modell:
npm run eval -- --filter-pattern '^M11 ' --filter-providers 'qwen3:1.7b'
```

Die Anfragen laufen einzeln und ohne Antwortcache. Für drei Variationsläufe:

```sh
npm run eval -- --repeat 3 --output results.json
```

Das ergibt **648 Modellaufrufe**, keine 648 unabhängigen Szenarien.
Ergebnisse und Protokolle bleiben in der ignorierten `.promptfoo/`-Ablage;
Exporte `results*.json`, `results*.html` und `results*.csv` sind ebenfalls
ignoriert. Die npm-Skripte deaktivieren Telemetrie und Updateprüfungen;
Sharing ist in der Konfiguration ausgeschaltet.

Zum Ergänzen einen Eintrag in `szenarien.de.mjs` kopieren. `input` enthält
ausschließlich den aktuellen Beitrag; bei einem reinen App-Ereignis bleibt
er leer und `context.state` beschreibt den Anlass. `context.history` enthält
frühere Beiträge mit ihren Rollen. `expected` und `checks` sind ausschließlich
Prüfdaten. Keine Arrays direkt in Promptfoo-`vars` ergänzen, weil sie dort
zu zusätzlichen Testkombinationen expandieren können. Danach `npm run check`
ausführen und die bewussten Abdeckungszahlen in `check.mjs` aktualisieren.

Die Tests messen weder echte Audio-/Bilderkennung noch Timer, Speicherung,
Unterbrechungslatenz oder MLX-Leistung. Auch ein mitgelieferter Dialogverlauf
ist kein vollständig ausgespieltes Gespräch. Diese Grenzen und die manuelle
Bewertungsrubrik stehen in der deutschen Datensatzbewertung.

## Hybrid reliability experiment

See [the four-model results and reply-quality findings](HYBRID_RESULTS.md) from
2026-09-24 before interpreting the automated pass rates.

`npm run eval:hybrid` compares the current prompt with an experimental hybrid on
Qwen3 1.7B, Qwen3 14B, LiquidAI LFM2.5 1.2B Instruct Q4_K_M, and Impulse2000
SmolLM3 Q4_K_M. Pull the extra models first:

```sh
ollama pull qwen3:14b
ollama pull LiquidAI/lfm2.5-1.2b-instruct:q4_k_m
ollama pull Impulse2000/smollm3:3b-q4_k_m
npm run eval:hybrid
```

Each model runs separately to avoid repeated model loading. To select one, use
`EVAL_MODELS=qwen3:1.7b npm run eval:hybrid`. There are 32 inputs × 3 repetitions
× 2 variants per model. Assertion failures exit with code 100 after all batches.
Results are saved as ignored `results-hybrid-*.json` files and in the local viewer.

Both variants include the existing exact greeting/end-command behavior. The
hybrid adds narrow routes for name changes, identity, years and music preferences;
renders names outside generation; uses a focused conversational prompt; and
replaces detected malformed replies with a clarification. Fallbacks count as
failed answers. The prototype supports only selected profile fields, has no
conversation history, and is not connected to the browser or iPad app.

The tests include 20 fresh cases with rephrased requests, negated and third-person
stop statements, missing facts and profile injections. Expected answers and checks
are excluded from provider input. Rule-based scoring remains a smoke check;
review meaning, German and empathy before drawing quality conclusions.

Qwen keeps the existing sampler. LFM uses temperature 0.1, top-k 50, top-p 1;
SmolLM3 uses temperature 0.6 and top-p 0.95. All use a 120-token limit and
repetition penalty 1.05. SmolLM3 also receives its documented `/no_think` flag.
Baseline and hybrid use the same settings within each model. See the
[LFM model card](https://ollama.com/LiquidAI/lfm2.5-1.2b-instruct) and
[SmolLM3 model card](https://ollama.com/Impulse2000/smollm3:3b-q4_k_m).
