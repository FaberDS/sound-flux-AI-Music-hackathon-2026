# Tante Emma — local German voice companion

A small native iOS/iPadOS 26+ app using SwiftUI, SpeechTranscriber, Foundation Models,
and AVSpeechSynthesizer, with optional Pocket and Supertonic 3 TTS through FluidAudio.
Apple Foundation Models, Qwen3 (0.6B / 1.7B), or Qwen3.5 2B through MLX Swift generate replies locally. All Qwen models use 4-bit weights. No companion server.

**Implemented:** German voice input and output, typed messages, short conversation
memory, on-device model availability checks, German speech-asset installation,
stop/end controls, and cancellation on backgrounding or audio interruption.

**Verified here:** an arm64 Release build with Xcode 26.5, the focused checks below,
and the Apple voice loop on an iPad Pro 11-inch (3rd generation, M1). After prewarming,
observed greeting waits were about 4.3 seconds cold and 1.1–1.2 seconds warm.
**Not yet verified:** Pocket/Supertonic perceived voice quality, sustained playback performance, and offline
relaunch on a physical iPad. This Mac has no usable iPadOS 26 simulator runtime.
Passing a build does not prove the voice loop.

## User context

Open **Weitere Optionen (⋯) → Benutzerkontext** to edit keys and values,
**Zeile hinzufügen**, and removing individual rows. The initial profile is
`firstname: Amelie`, `lastname: Fischer`, `yearOfBirth: 1955`.
Changes save locally as you type and apply to the next generated reply in Apple
and all Qwen models. Removing every row leaves an empty profile after relaunch.
Only complete pairs are injected; duplicate keys and more than 2,000 context
characters prevent sending until corrected. Up to 20 rows are supported.

The editable system prompt is followed by the context as escaped JSON and
app-supplied `currentDate`, `currentTime`, `timeZone`, and `currentYear`, derived
from the device clock using the Gregorian calendar at request time. The default prompt explains the fields and avoids
claiming an exact age from a birth year alone. Custom prompts also receive the
runtime context and Tante Emma identity. Resetting the system prompt
or ending a conversation leaves the profile intact. Earlier conversation history
remains available; removing a profile row does not erase facts from that history.
Apple's prepared instructions are checked before reuse, including across a year change.

The app display name and conversation labels are **Tante Emma**. The existing
bundle identifier and Xcode target remain unchanged to retain downloads and settings.

## Comparing local LLMs

Use **Sprachmodell** on the main screen to choose **Apple**, **Qwen3.5 2B**, **Qwen3 1.7B**, or **Qwen3 0.6B**.
Choose **Weitere Optionen (⋯) → Testnachricht einsetzen** to fill the message field with
“Hallo, heute ist es aber echt kalt”, then tap **Nachricht senden**.
The button only inserts text; it does not send it or clear the conversation.
Use **Gespräch beenden** between comparisons if you want identical empty history.

Selecting Qwen automatically prepares it: approximately 1.75 GB (Qwen3.5 2B),
983 MB (Qwen3 1.7B), or 350 MB (Qwen3 0.6B) downloaded once from Hugging Face. Keep the app foregrounded.
Progress, cancellation, and retry are available. Completed files live in Application
Support, excluded from backups; later preparation loads them without network access.
Switching models releases the previous Qwen model from memory, but keeps downloaded files.
The selected model, voice engine, and Supertonic speaker persist across launches.
At startup, the selected model and voice prepare automatically, in that order.
Only missing runtime models load; ready selections are reused. Cancellation or a
failure leaves an explicit retry, without a restart loop. Apple is the first-install
default. Qwen does not require Apple Intelligence.

All Qwen models use pinned MLX community 4-bit conversions, Apache-2.0 licenses,
and the same German instructions and bounded conversation history as Apple.
Thinking is explicitly disabled in the chat template. Responses are limited to
120 tokens; Qwen uses temperature 0.7 / top-p 0.8. The timeline identifies the model,
shows Qwen's first text separately, and measures the complete response before speech.
First use can include GPU compilation; compare repeated runs as well as a cold run.
MLX Swift LM is pinned to 2.31.3 for Qwen3.5 support, with MLX Swift pinned to
0.31.4; Xcode's Metal Toolchain component is required
(`xcodebuild -downloadComponent MetalToolchain`).

### Editing the system prompt

Open **Weitere Optionen (⋯) → Systemprompt**. Edit the instructions
and tap **Übernehmen**; **Auf Standard zurücksetzen** immediately restores the bundled
German prompt, including discarding unsaved edits in the field. Saved edits apply
to all models from the next message and survive app relaunch and conversation
reset. The current conversation history remains available. Empty prompts and prompts
longer than 4,000 characters cannot be applied; editing is disabled during a turn.
Apple's prepared session is rebuilt after applying or resetting instructions.
Custom prompts also route standalone greetings through the selected LLM; fixed greeting
replies are used only with the default prompt. Stop commands still end the conversation.

### Qwen device check — 2026-09-24

Signed Release build on the connected M1 iPad Pro 11-inch (3rd generation),
using the exact test phrase above with empty history and Supertonic F1:

| Model | First text, warm | Full text, warm | Send to actual speech, separate run |
|---|---:|---:|---:|
| Qwen3 0.6B | 0.415 s | 0.622 s | 1.042 s |
| Qwen3 1.7B | 1.061 s | 1.365 s | 1.678 s |

These are individual observations, not benchmark medians or voice-input timings.
The first 0.6B generation took 2.453 s including initial runtime work; the first
1.7B generation took 1.391 s after the runtime had already run 0.6B.
Both models generated nonempty output without reasoning tags, survived cancellation
250 ms after sending without a late reply, reloaded from the completed local cache,
and completed speech playback. No airplane-mode relaunch test was performed.
The 0.6B replies included awkward German and ignored the no-emoji instruction;
1.7B answered naturally in this small sample. Keep 0.6B as a speed/quality comparison.

## Run on your iPad or iPhone

1. Open [`SoundFlux.xcodeproj`](SoundFlux.xcodeproj) in Xcode 26 or newer.
2. Under **SoundFlux → Signing & Capabilities**, choose your development team.
   Change `com.soundflux.ipadagent` if your signing setup requires a unique bundle ID.
3. Connect an Apple Intelligence-capable iPad or iPhone with iOS/iPadOS 26+,
   enable Developer Mode if requested,
   choose it as the run destination, and run. Install the matching iOS platform
   component in **Xcode → Settings → Components** if Xcode requests it.
4. On the device, enable **Apple Intelligence** and finish its model downloads.
   German device and Siri language settings are the recommended initial setup.
5. In Sound Flux, tap **„Deutsch vorbereiten“** if speech assets are missing.
   Initial downloads require internet and free storage. Readiness is checked again
   when returning to the app; **„Bereitschaft erneut prüfen“** refreshes model status.
   Setup shows the current stage, elapsed time, and percentage when Apple supplies
   measurable progress. **„Vorbereitung abbrechen“** cancels the wait; retry with
   **„Deutsch vorbereiten“** or use **„Status erneut prüfen“** to check installation.
6. Tap **„Mit Sound Flux sprechen“**, allow microphone access, speak German, then
   tap **„Fertig“**. The transcript and reply appear, and the reply is read aloud.
   If processing is still underway after 250 ms, the app starts a brief
   **„Einen Moment bitte“** acknowledgement. Supertonic prepares this audio for
   all ten voices during setup, so feedback needs no inference after the tap.
   A ready answer interrupts the acknowledgement. Stop/end/backgrounding stops both.
   Feedback respects **„Antworten vorlesen“** and leaves announcements to VoiceOver
   when VoiceOver is active.

If no German system voice is available, load one in the device's accessibility
speech settings. Typed conversation works independently of microphone permission
and speech-recognition assets, once the on-device language model is ready.
For a more natural voice, download a German Premium or enhanced voice under
**Settings → Accessibility → Read & Speak → Voices**. The app prefers Premium,
then enhanced, then the basic installed German voice; equal quality prefers de-DE.
It shows the selected voice under **„Stimme“**. Return to the app
after downloading a voice to refresh its status.

Open **Weitere Optionen (⋯) → Ablauf & Zeiten** to see the latest operation's
live timeline. It records transcription start/completion, local greeting or LLM
request/response, acknowledgement, speech request/start, completion, and errors
or cancellation. **+ seconds** means time since **„Fertig“**, send, or voice test;
**Dauer** measures the completed stage. The running clock includes playback, so
use the **„Sprachausgabe gestartet“** row for time to the actual spoken answer.
The acknowledgement has its own row. The log contains timing and stage labels,
not prompts or transcripts, stays in memory, and clears on the next operation or
**„Gespräch beenden“**. Collapsing it does not interrupt the conversation.

If speech setup stalls, keep the app open and check the connection and free
storage. Use regular Wi-Fi for initial setup: Personal Hotspots can be classified
as expensive networks, and Apple's speech downloader may defer these downloads.
On the connected iPad, the speech asset service logged `OverExpensive:N`; retrying
on regular Wi-Fi is needed to confirm whether this explains the observed wait.
After ten minutes without completion, the app stops waiting and allows
a retry. Apple may continue managing the download, so check the status first.
Expand **„Fehlerdetails“** after a failure for the error domain, code, and message;
the same setup diagnostics appear in Xcode's console. A 100% download is only
ready once Apple reports that installation has finished. These speech assets are
separate from the Apple Intelligence conversation model.

## Compare Apple, Pocket, and Supertonic voices

Under **„Stimme“**, switch between **Apple**, **Pocket**, and **Supertonic**. Selecting a downloaded engine starts
its first-time setup: model files from Hugging Face, followed by local Core ML
loading. Keep the app open. Progress, cancellation, and retry are available.
**„Stimme testen“** reads the same German phrase with each engine; generated replies
and **„Antwort vorlesen“** also use the selected engine. An engine error is shown and
can be retried or handled by selecting Apple. The selected engine is restored and
prepared automatically on launch. **Weitere Optionen (⋯) → Stimme & Wiedergabe**
contains voice tests, Supertonic speakers, and the read-aloud toggle.

Pocket uses the German v2.1 model and the **Alba** voice. Models stay on the device,
are excluded from backups, and are reused on subsequent launches. Synthesized audio
is streamed through AVAudioEngine and is not written to disk. Initial loading can take
longer than later playback. CPU/GPU compute avoids an upstream documented Neural Engine
failure on M1 with OS 26.6; performance still needs measuring on the target iPad.

Supertonic 3 offers all ten supplied voices in German: **F1–F5** (female) and
**M1–M5** (male). Choose one under **„Supertonic-Stimme“**, then tap **„Stimme testen“**
to compare the same sentence. The selected voice also reads replies. Selection
defaults to F1 on first install and is saved; switching is disabled during setup and active turns.
The first download is about 200 MB plus the small voice profiles. Existing F1-only
caches fetch the missing profiles during setup. All ten profiles are prepared
together and reused offline; switching voices does not reload the shared model.
It uses the existing FluidAudio package, with a separate local model cache.
Supertonic first tries the fixed-shape INT4 Neural Engine variant, with a silent
German warm-up during setup. Its three acceleration bundles add about 98 MB;
the FP16 CPU/GPU model stays cached as an offline fallback. If acceleration setup
or inference throws, the app switches to CPU/GPU (one retry for that utterance).
Cancellation does not trigger fallback. Synthesis keeps eight steps and speed 1.0.
Each short reply is generated in full before playback. Stop discards late results and stops playback immediately;
an in-flight Core ML calculation may finish in the background before releasing its work.
Compare measured startup and perceived quality with the same test phrase.

### Measured Supertonic acceleration

On 2026-09-24, a signed Release build on the connected **M1 iPad Pro 11-inch
(3rd generation)** generated the standard German test sentence with F1, eight
steps, and speed 1.0. Three timed runs after warm-up produced these medians:

| Synthesis path | Time to generate 7.10 seconds of audio |
| --- | --- |
| FP16 CPU/GPU baseline | 1.130 s |
| INT4 fixed-shape Neural Engine configuration | 0.284 s |

This is about **4× faster synthesis**, saving **0.85 s** on that sentence, not a
4× improvement to the entire conversation. A second run measured 1.128 s versus
0.275 s. Quantization changes the model weights; equal duration does not prove
equal perceived quality, and these short tests do not establish sustained latency.

A temporary on-device harness also generated nonempty, finite audio for all ten
voices, confirmed cancellation during synthesis never started playback, and
simulated an unavailable accelerated engine to verify CPU/GPU recovery and actual
playback. The temporary harness is not part of the normal app build. The normal
app's `TurnTiming` logs retain separate transcription, generation, synthesis, and
playback-start measurements for further testing.

### Feedback after finishing speech

The later end-to-end test on the same iPad used fixed locally synthesized German
recordings through the real file-transcription and response paths. After the
feedback change, the actual standalone **„Guten Morgen“** reply started in **0.51 s**.
For **„Was könnte ich heute machen? Nenne mir zwei einfache Ideen.“**, acknowledgement
audio was scheduled at **0.47 s**, and the actual answer started at **5.29 s**.
The previous build took 4.30 s and 7.71 s to start the respective actual answers.
These are individual observations, not a controlled latency distribution: generated
answers and device load vary. The acknowledgement does not make general reasoning
instant. Cancellation during acknowledgement/generation passed on-device.

An experimental sentence-streaming path delayed first output in the device trial
and was removed. The shipped app retains full-response generation, earlier session
prewarming, cached Supertonic acknowledgement, and direct standalone greeting replies.

### Try ReadSpeaker

Under **Weitere Optionen (⋯) → Stimme & Wiedergabe**, **„ReadSpeaker online ausprobieren“** opens the
[official online demo](https://www.readspeaker.com/demo/) in the browser. Select
German there and compare this same phrase with **„Stimme testen“**:

> Guten Morgen. Schön, Sie zu hören. Wir haben Zeit und können in Ruhe miteinander sprechen.

This is an online audition, not an integrated fourth speech engine. The app passes
no conversation text to the website. The demo does not establish offline voice
quality or latency on the iPad.

To enable ReadSpeaker for actual conversations, obtain their **speechEngine SDK
Embedded evaluation for iOS arm64**, a **German voice package**, the **evaluation
license**, and the matching **integration documentation/sample app** through
[ReadSpeaker's trial contact](https://www.readspeaker.com/sectors/embedded/).
Request the best German voice available offline on an M1 iPad Pro and clarify
evaluation expiry and commercial distribution terms. These vendor files are not
included in this project; there is no placeholder synthesizer or demo API reuse.

### Commercial use and attribution

This integration restricts downloads to the German model and Alba conditioning files:

- [Pocket Core ML weights](https://huggingface.co/FluidInference/pocket-tts-coreml): CC BY 4.0.
- [Alba MacKenna, “Casual”](https://huggingface.co/kyutai/tts-voices#alba-mackenna): CC BY 4.0.
- [FluidAudio](https://github.com/FluidInference/FluidAudio): Apache 2.0.

CC BY 4.0 permits commercial use with attribution and its other license conditions.
Other catalog voices have different terms, including noncommercial licenses; they are
excluded. The app does not offer voice cloning. **„Lizenzen & Quellen“** includes source
links, credit, conversion notes, and full license texts. Preserve these notices when
redistributing the app. Licensing the model does not grant unrelated personality or
trademark rights.

SwiftPM pins FluidAudio to `5c51c5c93afff0d89594a2a93c3103e790ba648c`; model downloads
pin `91748676fe3c8b2eb3007b3125253bcd898202c3`. Review model and voice terms before
changing either pin or adding voices.

**Supertonic has different commercial conditions:** its model and supplied presets
use [OpenRAIL-M](https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE),
which permits commercial use subject to use restrictions. The
[Core ML conversion](https://huggingface.co/FluidInference/supertonic-3-coreml)
inherits that license. We pin it to `9f3606bf5c5ff9d6680cf6226614ac61358a24f3`.
The app labels Supertonic speech as AI-generated and bundles the complete license.
Before distributing to customers, include Section 5 / Attachment A restrictions as
**enforceable provisions in the application's user terms**, as required by Section 4(a);
a notices screen alone does not satisfy that obligation. Restrictions include medical
advice/results interpretation, impersonation without consent, and harmful exploitation
of age-related vulnerabilities. This prototype is not a medical-advice application.
These conditions apply to Supertonic, not to the other engines.

The shared Xcode scheme runs **Release**, both for optimized inference and because
FluidAudio's **Debug** build prints synthesized text to the console. Do not use Debug
with private conversations. The app's own timing logs contain no conversation text.

## First-version behavior

- Explicit tap-to-record / tap-to-finish; recording ends automatically at 60 seconds.
- Transcription happens **after** recording, using SpeechAnalyzer's native file
  input. The temporary device-local PCM recording is removed after transcription,
  cancellation, or error. Leftovers from a killed process are removed on next launch.
  A deletion failure is shown with a retry control and blocks further recordings.
- The app selects `SystemLanguageModel.default` explicitly. It makes no inference
  HTTP calls and has no cloud fallback. Speech asset downloads use Apple's
  `AssetInventory`; these are setup downloads, not remote recognition.
- Only completed exchanges enter memory: at most three, with a 3,000-character
  history budget. A context overflow retries once without history. Inputs are
  limited to 1,000 characters; an overlong transcript stays editable.
- The next model session is prepared and prewarmed while idle and retained when
  recording or sending begins. Recording also requests prewarming. Stop/end
  discards it. Standalone **Hallo / Guten Morgen / Guten Tag / Guten Abend** use
  a short local reply without language-model generation. A greeting followed by
  a question or other content still goes to the model.
  Speech starts after the full answer is generated; sentence streaming is deferred.
  Xcode's `TurnTiming` logs separate transcription, generation, speech startup, and
  total wait from **„Fertig“**/send to the synthesizer's playback-start callback.
  Supertonic also logs synthesis time, generated audio duration, voice ID, and
  whether the ANE or CPU/GPU path was used. ANE selection is a requested compute
  configuration, not proof that every operation executed on the Neural Engine.
  Acknowledgement timing is recorded separately and never resets the actual-answer
  timer. For Supertonic this records audio scheduling, not acoustically measured
  onset at the speaker. Feedback does not enter conversation history or the input
  recording: the microphone recording is stopped before it can play.
  These logs contain durations and the chosen system voice, not conversation text.
- **„Abbrechen“ / „Antwort stoppen“** cancels the current turn and keeps completed
  conversation memory. **„Gespräch beenden“** also clears text and memory.
- Standalone **„Stopp“**, **„Stop“**, **„Gespräch beenden“**, or **„Ich möchte jetzt
  aufhören“** ends the session after transcription, before calling the model.
  While the assistant is speaking, use the stop button; the microphone is off.
- Backgrounding, incoming audio interruptions, and headphone connection/removal
  stop active work. Listening never restarts automatically.
- **„Antworten vorlesen“** is the only persisted preference. Conversation content
  is not saved or logged by the app. With VoiceOver active, the interface announces
  replies instead of running a competing speech synthesizer.
- No music playback, live transcription, automatic pause detection, wake word,
  voice catalog, voice cloning, speech-speed slider, or saved profiles in this first version.

## Checks

From the repository root:

```sh
sh ipad-audio-agent/check.sh
```

This compiles a small Swift check for German end commands, rejecting results from
cancelled/ended turns, bounded conversation memory, and download progress,
timeout, and retry state. It also validates the
project and Info.plist. No model download or test framework is needed.
Voice-selection checks cover language filtering, quality, and regional preference.
Pocket download checks reject unreviewed voices, other languages, and path traversal.
Both downloaded engines share checks for partial caches, missing assets, and changed revisions.

Compile the app without signing or a connected iPad:

```sh
xcodebuild \
  -project ipad-audio-agent/SoundFlux.xcodeproj \
  -target SoundFlux \
  -configuration Release \
  -sdk iphoneos -arch arm64 \
  SYMROOT=/tmp/soundflux-ipad-products \
  OBJROOT=/tmp/soundflux-ipad-objects \
  CODE_SIGNING_ALLOWED=NO build
```

With a connected iPad, run
`sh Tests/check-preparation.sh DEVICE_ID DERIVED_DATA_PATH PACKAGES_PATH`.
This builds a temporary check app against the real `VoiceAgent`, checks selection,
saved settings, sequential startup, cancellation, retry, and a Qwen3.5 reply and
cached reload, then reinstalls and launches the production app. Missing models
download during the check. The check restores the device's saved selections.
The build directories can reuse existing Xcode caches.
Previously verified on the connected M1 iPad on 2026-09-24: Qwen3 0.6B/1.7B, Supertonic,
saved F3 selection, fresh-agent startup, no duplicate loading, cancellation, and retry passed.
The Qwen3.5 addition passes the focused checks and signed Release build. The updated
app is installed; its device inference check is pending because the iPad was locked.

Before calling the app offline-ready, run on the actual iPad:

1. Finish setup, disable Wi-Fi/cellular, disconnect the Mac, force-quit, and relaunch.
2. Complete ten German voice turns, including a name and a follow-up that refers to it.
3. Stop during capture, transcription, reasoning, and playback. Check that nothing
   resumes or appears from a stopped turn. End the session and check memory is empty.
4. Deny microphone permission; verify typed conversation. Test silence, an overlong
   message, app backgrounding, and headphones being removed.
5. Compare Apple/Pocket/Supertonic with **„Stimme testen“**, including all ten Supertonic voices,
   check that replies use the selected voice, test download cancellation/retry,
   then verify both downloaded engines after an offline relaunch and stop during streamed playback.
6. Check VoiceOver, large text, portrait/landscape, and a 20-minute session. Record
   cold/warm latency, heat, and battery behavior rather than inferring them from M4 specs.

## Files

- [`App/SoundFluxApp.swift`](App/SoundFluxApp.swift): German interface and app lifecycle.
- [`App/VoiceAgent.swift`](App/VoiceAgent.swift): local speech, asset setup, model, and audio ownership.
- [`App/Conversation.swift`](App/Conversation.swift): bounded memory, turn identifiers, and end commands.
- [`App/SpeechDownload.swift`](App/SpeechDownload.swift): download progress and timeout state.
- [`App/TurnTimeline.swift`](App/TurnTimeline.swift): bounded per-operation timing events and elapsed clock.
- [`App/SpeechVoice.swift`](App/SpeechVoice.swift): German voice preference policy.
- [`App/PocketVoice.swift`](App/PocketVoice.swift): pinned model setup and streamed playback.
- [`App/SupertonicVoice.swift`](App/SupertonicVoice.swift): pinned Supertonic setup and local playback.
- [`App/PocketAssets.swift`](App/PocketAssets.swift): commercially reviewed download allowlist.
- [`App/ThirdPartyNotices.txt`](App/ThirdPartyNotices.txt): bundled attribution and licenses.
- [`App/Instructions.de.txt`](App/Instructions.de.txt): bundled German model instructions.
- [`SYSTEM_PROMPT.de.md`](SYSTEM_PROMPT.de.md): conversational checks for the prompt.
- [`DESIGN.md`](DESIGN.md): broader design and physical-device acceptance targets.
