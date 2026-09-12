# Memory Music — Draft 2 specification

## Goal

Create a calm, familiar, low-pressure musical experience that helps a person living with dementia or Alzheimer’s express themselves and connect with a care partner in the moment.

## MVP flow

1. A care partner enters an optional, session-only profile.
2. The person chooses **familiar music** or **something new**.
3. They hum, sing, clap, or tap an instrument pad.
4. The app responds with an original, gentle accompaniment and simple musical answers.
5. Either person ends the session with one button.

## Design requirements

- Use plain, inviting language; never describe an action as incorrect.
- One clear choice per step; large controls; keyboard fallback.
- Do not store video, audio, or profile data by default.
- Do not reproduce or claim to identify a favourite copyrighted recording. Use a profile-informed original accompaniment instead.
- Microphone processing remains in the browser; it is used only for live level, clap, and rough pitch detection.

## MVP acceptance checks

- A care partner can reach the studio in under two minutes.
- The person can produce sound via a tap or space bar without microphone permission.
- With microphone permission, a clap creates a drum hit and a stable hum creates a flute response.
- The experience works over `localhost` and explains blocked microphone access clearly.

## Later additions

- Consent-based saved profiles and encrypted storage.
- Camera/sensor gestures shared with Draft 1.
- Licensed personal music integrations.
- A trained humming-to-melody system and human-reviewed care guidance.
