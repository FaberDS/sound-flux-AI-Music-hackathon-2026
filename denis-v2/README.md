# Memory Music — Draft 2

An accessible music-session prototype for people living with dementia or Alzheimer’s and the people supporting them.

It includes a care-partner profile, a familiar/new music choice, optional spoken prompt, microphone hum/clap interaction, tap instruments, and a gentle original accompaniment. Profile information remains in memory for the current browser session only.

## Run

```sh
cd denis-v2
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000). Do not open the HTML file directly: browsers only permit microphone access on `localhost` or HTTPS.

## Check

```sh
node test.mjs
```
