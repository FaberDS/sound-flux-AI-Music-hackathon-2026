# Sound Flux — AI Music Interface (Voice)

## 1. Product summary

Sound Flux is an accessible, camera-controlled music instrument. A person describes the music they want to make, then uses comfortable physical movements to perform part of a track while the system supplies a compatible accompaniment.

The first version supports a rock setup: head movements trigger drums and control intensity while an AI-selected flute phrase plays in time. A connected AlphaTheta Chordcat may provide chords and tempo over MIDI.

## 2. Problem and goal

Most music tools require the user to adapt to fixed controls. Sound Flux adapts the controls, sounds, and musical role to the user’s preferences and available movement.

**MVP goal:** a new user can describe a desired setup, calibrate head movement, and perform a recognisably musical 30-second rock loop without touching a conventional instrument.

## 3. MVP users and scenarios

### Primary user

A person who wants to make music but prefers or needs hands-free interaction. They may have limited mobility, no instrumental training, or both.

### Core scenario

1. The user says: “I want energetic rock. I can use my head. Let head nods make drums and let the AI play flute.”
2. The system proposes a preset: 128 BPM, E minor, kick on nod, snare on left tilt, crash on right tilt, and a flute accompaniment.
3. The user adjusts sensitivity if necessary, presses **Play**, and completes a short calibration.
4. The user performs; sound responds quickly and remains in time with the beat.
5. The user stops the session or starts again.

## 4. Scope

### Included

- Voice or text onboarding that produces a structured music preset.
- Optional personal profile: artists, genres, musical experience, preferred interaction, movement limitations, mood, and intensity.
- Webcam permission, face/head tracking, and calibration.
- Three head gestures: nod, tilt left, tilt right.
- Browser drum samples, tempo clock, one musical key, and a looping flute accompaniment.
- A Play screen with status, calibration, sensitivity, and stop controls.
- Optional USB MIDI input/output for Chordcat.

### Explicitly not in the MVP

- Continuous live generation of raw audio by an LLM or music model.
- Full-body gesture recognition.
- Saving, sharing, exporting, or account management.
- Bluetooth sensor setup.
- Automatic medical/accessibility assessment.

## 5. Experience and screens

### A. Welcome and profile

The user can skip the profile and begin immediately. Profile questions are conversational and optional.

| Field | Example | Purpose |
|---|---|---|
| Favourite artists | Foo Fighters, Jethro Tull | Suggest style and instrumentation |
| Preferred styles/mood | rock, intense | Select tempo, rhythm, and sound palette |
| Musical experience | no instruments | Choose simple, forgiving mappings |
| Comfortable movement | head movement only | Restrict the gesture set |
| Interaction preference | hands-free | Prefer camera/sensor controls |

### B. Setup conversation

The assistant turns a request into a reviewable card, rather than applying hidden decisions.

```text
Rock Motion Kit
128 BPM · E minor

Head nod       Kick
Head tilt left Snare
Head tilt right Crash
Movement speed Drum intensity
AI role         Flute accompaniment

[Edit] [Calibrate & Play]
```

If the request is ambiguous, use safe defaults: 110 BPM, C minor, moderate sensitivity, drums plus flute loop.

### C. Calibration

1. Ask the user to sit or stand comfortably and hold their natural neutral pose for three seconds.
2. Ask for one comfortable nod and one comfortable tilt to each side.
3. Set thresholds relative to that user’s range.
4. Show a large success state and start Play only when a face is detected reliably.

### D. Play screen

```text
Rock Motion Kit                              Camera: connected
128 BPM · E minor                            [Calibrate] [Stop]

                 Live camera preview
                 Head landmark overlay

Nod: Kick          Left tilt: Snare          Right tilt: Crash
Intensity: ██████░░░░     Flute: AI loop playing
```

The camera preview is helpful feedback, not a required performance target. Each trigger receives a visible flash and a short audio response.

## 6. Functional requirements

### FR1 — Preset generation

The application must transform onboarding answers into a `MusicPreset` and present it for approval before starting playback.

```ts
type MusicPreset = {
  name: string;
  style: string;
  mood: string;
  bpm: number;
  key: string;
  gestureMap: {
    nod: "kick" | "none";
    tiltLeft: "snare" | "none";
    tiltRight: "crash" | "none";
  };
  accompaniment: { instrument: "flute"; patternId: string };
  sensitivity: "low" | "medium" | "high";
};
```

The AI must return this schema, not direct audio-control instructions. The app validates BPM (60–180), supported gestures, instrument, and sound names before use.

### FR2 — Movement recognition

The application must process webcam landmarks locally and expose normalized values for pitch/tilt, yaw/turn, and movement speed.

- Nod: pitch crosses a calibrated downward threshold, then returns near neutral.
- Left/right tilt: roll crosses the calibrated threshold.
- Movement speed: a smoothed rate of head-angle change, mapped to MIDI velocity 40–127.
- Cooldown: the same gesture cannot retrigger for 150 ms.
- Tracking loss: stop accepting new triggers and show “Face not detected”; resume only after stable tracking.

### FR3 — Music engine

- Start audio only after an explicit user click, satisfying browser autoplay rules.
- Quantize drum hits to the nearest sixteenth note by default; offer an optional “direct” mode later.
- Keep the flute loop locked to the tempo and key.
- Play a short kick/snare/crash sample immediately at the scheduled beat.
- Never let a failing accompaniment prevent user-triggered drums from playing.

### FR4 — Chordcat MIDI (optional)

When a compatible MIDI device is selected, the app must:

- display its device name and connection state;
- receive MIDI notes or MIDI clock when enabled;
- send generated accompaniment notes and transport/clock only after the user enables output;
- select one clock source: internal app clock or Chordcat/external MIDI clock, never both.

Chordcat integration is a MIDI feature, not a dependency: the camera-and-audio prototype must work with no hardware connected.

### FR5 — Accessibility and control

- All setup controls are keyboard accessible and have text labels.
- The user can adjust sensitivity without leaving Play.
- The user can disable any gesture and select a no-camera fallback later.
- No profile or camera image is stored by default.

## 7. Technical design

```text
UI (web app)
 ├─ Onboarding + profile
 ├─ Preset validator
 ├─ Camera tracker
 │   └─ Gesture detector + calibration
 ├─ Audio clock + sample player + flute sequencer
 └─ Web MIDI adapter (optional)
```

### Recommended MVP stack

| Concern | Choice | Why |
|---|---|---|
| UI | React + TypeScript | Quick iteration and a single browser app |
| Head landmarks | MediaPipe Face Landmarker | Runs locally in-browser and needs no custom model |
| Audio | Tone.js / Web Audio | Low-latency scheduling and sample playback |
| MIDI | Web MIDI API | Direct USB MIDI access in supporting browsers |
| AI setup | JSON-schema constrained model response | AI helps configure, not time-critical sound playback |

For a demo, use pre-authored MIDI flute patterns tagged by key, tempo range, and style. “AI-generated” means the assistant selects or adapts an appropriate pattern. A full generative accompaniment model is a later replacement behind the same `patternId` interface.

## 8. Data and privacy

- Keep the profile and preset in browser storage only for the MVP.
- Process camera landmarks in-browser; do not upload video frames.
- Send only the text onboarding request to the AI service, with a clear consent message.
- Treat disability and movement information as sensitive: it is optional, editable, and deletable.

## 9. Success criteria

| Area | Acceptance criterion |
|---|---|
| Onboarding | A user can reach an approved preset in under two minutes. |
| Calibration | The system adapts thresholds and detects all three gestures in a test run. |
| Responsiveness | A detected gesture schedules an audible hit within one beat; target under 100 ms in direct mode. |
| Musicality | Flute accompaniment remains on tempo and in key for a 30-second session. |
| Resilience | Losing camera tracking never crashes audio or produces uncontrolled repeated hits. |
| Hardware | The app works without MIDI hardware and shows clear MIDI connection status when present. |

## 10. Delivery plan

### Milestone 1 — Playable camera demo

One hard-coded Rock Motion Kit, webcam calibration, three gestures, and browser drum samples.

### Milestone 2 — Assisted setup

Text/voice onboarding, a reviewed preset card, profile fields, and AI-selected flute patterns.

### Milestone 3 — Hardware and polish

Web MIDI device picker, Chordcat note/clock support, MIDI output toggle, and accessibility pass.

## 11. Demo script

1. Say: “Energetic rock, head movements for drums, AI flute.”
2. Approve the generated Rock Motion Kit.
3. Complete calibration.
4. Start Play and demonstrate nod → kick, left tilt → snare, right tilt → crash.
5. Increase head movement speed to make the drums more intense.
6. Plug in Chordcat, show the detected MIDI device, and sync or play a chord.

## 12. Open decisions

- Is Chordcat the specific AlphaTheta device, and will it be available during the demo?
- Does “voice” mean spoken onboarding only, or should voice commands also operate Play?
- Which browser and computer will be the demo target? Web MIDI support varies by browser.
- What consent language and data-retention rules are required for profile information?
