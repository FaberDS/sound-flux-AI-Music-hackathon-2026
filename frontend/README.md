# Sound Flux Frontend

Ein Musikraum mit React, TypeScript, Vite und Tailwind CSS. Die Gestaltung übernimmt Braun, Gelb, Orange und die kräftige, schmale Überschrift aus der Präsentationsvorlage. Die Oberfläche ist auf Deutsch, passt sich an Handy und Tablet an und lädt Schriften lokal aus dem Build.

## Starten

Vom Repository-Root startet `./start.sh` das Frontend und installiert bei Bedarf die Abhängigkeiten. Weitere Team-Services können später im Skript ergänzt werden. `Ctrl+C` beendet die darüber gestarteten Prozesse. Siehe [gemeinsame Startanleitung](../README.md).

Für den separaten Frontend-Start:

Node.js ab 22.12 verwenden. Im Repository:

```sh
cd frontend
npm install
npm run dev
```

Öffne [localhost:5173](http://localhost:5173). Instrumente und Begleitmelodien funktionieren ohne Backend.

Für die Sprachbegleitung die bestehende API in einem zweiten Terminal starten:

```sh
cd local-speech/api
uv sync
uv run uvicorn app:app --host 127.0.0.1 --port 8000
```

Die Sprachmodelle, Ollama und FFmpeg müssen wie in [local-speech/README.md](../local-speech/README.md) eingerichtet sein. Das Frontend installiert oder startet keine Modelle.

## Bedienung

- Ruhige oder fröhliche Klänge wählen und die Musik starten. Die Begleitung besteht aus einer eigenen, im Browser erzeugten Melodie.
- Klavier, Gitarre, Glockenspiel oder Trommel antippen. Die Tasten 1 bis 4 spielen dieselben synthetischen Instrumente, wenn kein Eingabefeld oder Button fokussiert ist.
- „Mit Sound Flux sprechen“ öffnet das Mikrofon. „Aufnahme senden“ lädt die Aufnahme hoch und startet die Antwort. Aufnahmen enden nach spätestens 60 Sekunden.
- Alternativ eine Nachricht schreiben. Die Antwort erscheint während des Streamings. „Antworten vorlesen“ steuert die anschließende Sprachausgabe.
- Während Musik oder Sprachbegleitung aktiv sind, ist ein fester Stopp-Knopf sichtbar. Er stoppt Aufnahme und Ton sofort und unterbricht die laufende Serveranfrage.
- „Für Begleitpersonen“ erlaubt freiwillige Angaben zu Name und Musikvorlieben. Dort lässt sich die Frontend-Ansicht mit Gespräch und Angaben zurücksetzen. Die im Backend gespeicherten Daten bleiben erhalten.

Mikrofonzugriff braucht localhost oder HTTPS. Beim Öffnen über eine gewöhnliche HTTP-Adresse im WLAN ist häufig nur die Texteingabe verfügbar. Der Browser fragt erst nach Mikrofonzugriff, wenn die Person auf den Sprechen-Knopf tippt.

## API-Anbindung

Der Vite-Proxy leitet `/api` standardmäßig an `http://127.0.0.1:8000` weiter. So ist für die Entwicklung keine CORS-Änderung am Python-Backend nötig. Für eine andere Adresse `.env.example` nach `.env.local` kopieren, `API_TARGET` anpassen und Vite neu starten.

| Endpunkt                             | Verwendung                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                        | Erreichbarkeit prüfen, auch alle 30 Sekunden                                                                        |
| `POST /v1/transcriptions`            | Browseraufnahme als Multipart-Feld `audio` mit `turn_id`                                                            |
| `POST /v1/chat`                      | Nachricht, die letzten zwölf Gesprächseinträge und optionale Profilangaben; SSE-Ereignisse `token`, `done`, `error` |
| `POST /v1/speech`                    | Fertige Antwort als WAV anfordern und im Browser abspielen                                                          |
| `POST /v1/turns/{turn_id}/interrupt` | Laufende Verarbeitung beim Stoppen oder bei einer neuen Nachricht unterbrechen                                      |

Die drei Gesprächsschritte verwenden dieselbe `turn_id`. Für jede neue Nachricht entsteht eine neue ID. Das Frontend verwendet die Upload-Transkription, nicht den experimentellen Live-WebSocket. Eine erfolgreiche Health-Abfrage bestätigt nur, dass die API erreichbar ist. Sie prüft nicht, ob Ollama und die Sprachmodelle bereit sind. Fehler beim Erstellen der Stimme lassen die Textantwort sichtbar.

Das Frontend verwendet die Standardmodelle und Standardstimme der API. Es generiert Musik lokal über Web Audio; die Sprach-API liefert Text und Sprache, keine Musikdateien. Audioqualität und Sprachunterstützung hängen von den Backend-Modellen ab.

Die Frontend-Ansicht hält Profil und Gespräch im React-Arbeitsspeicher und verwendet dafür weder Local Storage noch Session Storage. Die API erhält Text, Profil und hochgeladene Aufnahmen zur Verarbeitung. Das Backend speichert Gespräche und daraus erkannte Profilangaben dauerhaft in `local-speech/api/sound_flux.db`, sofern `PROFILE_DB` keinen anderen Pfad vorgibt. „Sitzung beenden und Ansicht leeren“ sowie ein Neuladen entfernen nur die Daten im Frontend. Die gespeicherten Backend-Daten bleiben erhalten und können spätere Antworten beeinflussen.

## Build und Prüfung

```sh
npm run build
npm run lint
npx playwright install chromium
npm test
```

Die Browsertests prüfen Offline-Musik, Profil und Gesprächsverlauf, Mikrofonaufnahme mit einem simulierten Audiogerät, den gemeinsamen Turn-Identifier, API-Fehler, Abbrüche, SSE-Chunk-Grenzen und das mobile Layout. API-Antworten werden in den Tests simuliert. Ein erfolgreicher Test bestätigt nicht die Funktionsfähigkeit der lokal installierten ML-Modelle.

`npm run build` erzeugt `dist/`. Für ein Deployment muss der Webserver `/api/*` an die Python-API weiterleiten und dabei den Präfix `/api` entfernen. SSE-Buffering ausschalten und lange Modellantworten bei Proxy-Timeouts berücksichtigen. Alternativ lässt sich `VITE_API_BASE_URL` vor dem Build auf eine andere URL setzen; bei einer anderen Origin braucht das Backend passende CORS-Freigaben.

## Dateien

- `src/App.tsx`: Oberfläche, Einstellungen und optionale Angaben.
- `src/hooks/useCompanion.ts`: Aufnahme, Gespräch, Sprachausgabe und Abbrüche.
- `src/lib/api.ts`: HTTP-Anbindung und SSE-Parser.
- `src/lib/music.ts`: Instrumente und Melodien mit Web Audio.
- `src/index.css`: Tailwind, lokale Schriften, Farben und responsive Gestaltung.
- `src/components/sound-flux/`: Mitgelieferter Voice-Indikator aus `sound-flux-frontend.zip`. Die Komponente ersetzt die Schallplatte während der Sprachausgabe und beim erneuten Anhören. Sie verwendet den Zustand `speaking` mit der voreingestellten Bewegung, ohne Audiopegelmessung. Bei Stopp oder Wiedergabeende wird sie entfernt. Reduzierte Bewegung und Hintergrund-Tabs berücksichtigt die Komponente selbst.

Das Setup folgt der [Vite-Anleitung](https://vite.dev/guide/) und der [Tailwind-Integration für Vite](https://tailwindcss.com/docs/installation/using-vite).
