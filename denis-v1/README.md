# Sound Flux — AI Music Interface

A dependency-free browser MVP for an accessible, camera-controlled music instrument.

## Run

Serve the folder from `localhost` (camera access requires a secure context):

```sh
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000), describe a music kit, allow camera access, calibrate, and play. Do not open `index.html` directly or use a file preview: browsers block camera access there.

The app loads MediaPipe Face Landmarker from a CDN only when camera tracking starts. Calibration captures a neutral pose and then the user’s own comfortable nod/left/right range; a gesture must return towards neutral before it can retrigger. Web MIDI is optional and can connect to the first available MIDI output, including Chordcat.

## Check

```sh
node test.mjs
```

See [PRODUCT_SPEC.md](PRODUCT_SPEC.md) for the product specification.
