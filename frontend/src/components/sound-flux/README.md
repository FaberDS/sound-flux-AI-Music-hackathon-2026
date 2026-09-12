# Sound Flux – Frontend-Komponente

Fast kreisrunder Voice-Indikator ohne Symbol in der Mitte. Die gewählte Verformung `0.625` liegt zwischen dem sanften Entwurf (`0.25`) und dem stark organischen Entwurf (`1`). Der Markenname bleibt unbewegt. Farben und Schriftzug entsprechen der letzten Marketingversion.

`demo.html` lässt sich direkt im Browser öffnen. Sie enthält alles lokal und braucht keinen Server. Die Dateien der Komponente werden über den eigenen Frontend-Bundler oder einen Webserver importiert.

## React

Den gesamten Ordner in das Projekt kopieren, beispielsweise nach `src/components/sound-flux`:

```jsx
import SoundFlux from './components/sound-flux/SoundFlux.jsx';

export default function VoiceAgent() {
  return (
    <SoundFlux
      state="idle"
      level={0}
      wobble={0.625}
      size={320}
    />
  );
}
```

`state` mit dem Gesprächsstatus verbinden, `level` mit einem normalisierten Audiopegel zwischen 0 und 1. Für das reine Symbol ohne Beschriftung `showBrand={false}` und `showStatus={false}` setzen. Der React-Wrapper benötigt React 18 oder neuer und einen JSX-fähigen Build. Er ist für die Einbindung in Client-Komponenten markiert und räumt seine Instanz beim Unmount auf.

## JavaScript, Vue, Svelte oder andere Frontends

Die unabhängige Kernkomponente benötigt keine zusätzlichen Pakete:

```js
import {createSoundFlux} from './sound-flux/sound-flux.js';

const indicator = createSoundFlux(document.querySelector('#voice-indicator'), {
  state: 'idle',
  wobble: 0.625,
  size: 320,
  showBrand: true,
  showStatus: true,
});

indicator.setState('listening');
indicator.setState('thinking');
indicator.setState('speaking');
indicator.setLevel(0.7);

// Nach Ende der Wiedergabe:
indicator.setLevel(0);
indicator.setState('idle');

// Beim Entfernen der Ansicht:
indicator.destroy();
```

In Vue und Svelte im jeweiligen Mount-Lifecycle initialisieren und beim Unmount `destroy()` aufrufen.

Alternativ den Ordner als lokales Paket installieren:

```sh
npm install ./sound-flux-frontend
```

Dann `createSoundFlux` aus `@sound-flux/voice-indicator` oder `SoundFlux` aus `@sound-flux/voice-indicator/react` importieren. Das Paket ist lokal vorbereitet und wurde nicht in einer Registry veröffentlicht.

## Steuerung

| Parameter / Methode | Bedeutung |
| --- | --- |
| `state` / `setState(...)` | `idle`, `listening`, `thinking`, `speaking` |
| `level` / `setLevel(...)` | Normalisierter Pegel 0–1. Wirkt beim Sprechen. Standard: 0. |
| `wobble` / `setWobble(...)` | 0–1. Gewählter Mittelwert: 0.625. |
| `paused` / `setPaused(...)` | Animation anhalten oder fortsetzen. |
| `size` | Breite in Pixeln; schrumpft passend zum Elterncontainer. |
| `showBrand`, `showStatus` | Markennamen und Status einzeln ausblenden. |
| `setTextVisibility({...})` | Beschriftung nach dem Mount ändern. |
| `labels` | Option der JS-Kernkomponente für eigene Statustexte. |
| `destroy()` | Animationsschleife, Listener und Element entfernen. |

Numerische Werte außerhalb von 0–1 werden begrenzt. Ungültige Zustände und nicht-endliche Werte werfen Fehler. Nach `destroy()` sind Änderungen nicht mehr zulässig; ein wiederholtes `destroy()` ist erlaubt.

## Beispiel: vorhandenen Audiopegel anbinden

Wenn der Agent bereits einen `AnalyserNode` für seine Audioausgabe besitzt:

```js
const samples = new Float32Array(analyser.fftSize);
let audioFrame;
function updateAudioLevel() {
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  indicator.setLevel(Math.min(1, rms * 4));
  audioFrame = requestAnimationFrame(updateAudioLevel);
}
indicator.setState('speaking');
updateAudioLevel();

// Beim Ende der Wiedergabe / Unmount:
cancelAnimationFrame(audioFrame);
indicator.setLevel(0);
indicator.setState('idle');
```

Den Verstärkungsfaktor an die tatsächliche Audioquelle anpassen. Die Komponente glättet Pegel und Zustandswechsel. Sie öffnet kein Mikrofon und stellt keine Serververbindung her. Nur die Demo simuliert einen Pegel.

## Gestaltung und Verhalten

- Mittelbraun `#693D2B`, Gelb `#FFDE5A`, Orange `#FE751F`.
- Farben mit CSS-Variablen `--sf-brown`, `--sf-yellow`, `--sf-orange` am Container anpassbar.
- Transparenter Hintergrund, für helle Oberflächen gestaltet.
- SVG-Pfade für scharfe Darstellung; keine GIF-Datei wird im Live-Betrieb geladen.
- Der Markenname ist als Vektorpfad enthalten und benötigt keine Schriftinstallation. Die bearbeitbare Statuszeile nutzt Georgia mit Serif-Fallback.
- Styles sind per Shadow DOM gekapselt. `prefers-reduced-motion` wird beachtet, ebenso Hintergrund-Tabs und die Pausensteuerung.
- Statuswechsel werden geglättet. Die Textzeile kündigt nur Statusänderungen an, keine einzelnen Animationsbilder.
- TypeScript-Deklarationen für Kernkomponente und React-Wrapper liegen bei.

Der Begleit-GIF zeigt den gewählten Mittelwert als Vorschau. Die eigentliche Frontend-Komponente ist unabhängig davon steuerbar.
