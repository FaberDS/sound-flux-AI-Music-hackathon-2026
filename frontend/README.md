# Sound Flux Frontend

Ein Musikraum mit React, TypeScript, Vite und Tailwind CSS. Die Gestaltung übernimmt Braun, Gelb, Orange und die kräftige, schmale Überschrift aus der Präsentationsvorlage. Die Oberfläche ist auf Deutsch, passt sich an Handy und Tablet an und lädt Schriften lokal aus dem Build.

## Starten

Für Frontend-Arbeit ohne Sprach- und Musikmodelle im Repository-Root
`./start-dev.sh` ausführen. Im Terminal kannst du die Ports für Frontend und
`backend-mockup` eingeben; Enter übernimmt 5173 und 8001. Belegte Ports fragt
das Skript erneut ab und verbindet beide Dienste über die gewählten Ports.
Die [Mock-Steuerung](http://127.0.0.1:8001/?frontendPort=5173) unter dem Standardport
bietet Beispieldaten, leeres Onboarding, Transkripte, Wartezeiten und Fehlerfälle.
Frontend-Änderungen lädt Vite sofort; der Mock bleibt dabei aktiv.
Siehe [Mock-Anleitung und Testabläufe](../backend-mockup/README.md).
`npm run test:mock` prüft das Frontend gegen einen separat gestarteten Mock.

Für die echten Modelle startet `./start.sh` vom Repository-Root das Frontend, die Sprach-API und die Audio-Engine. Das Skript installiert bei Bedarf die Frontend-Abhängigkeiten. `Ctrl+C` beendet die darüber gestarteten Prozesse. Siehe [gemeinsame Startanleitung](../README.md).

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
- Optional „Nach Sprechpausen automatisch senden“ aktivieren. Nach erkannter Sprache und etwa 1,2 Sekunden Ruhe sendet das Frontend die Aufnahme. Nach der Antwort hört es wieder zu. Während der Verarbeitung und Sprachausgabe ist das Mikrofon aus. „Gespräch beenden“ stoppt diesen Ablauf. Ohne erkannte Stimme endet er nach 60 Sekunden, bei API-Fehlern ebenfalls. Kopfhörer helfen, Musik und Umgebungsgeräusche von der eigenen Stimme zu trennen.
- Alternativ eine Nachricht schreiben. Die Antwort erscheint während des Streamings. „Antworten vorlesen“ steuert die anschließende Sprachausgabe.
- Während Musik oder Sprachbegleitung aktiv sind, ist ein fester Stopp-Knopf sichtbar. Er stoppt Aufnahme und Ton sofort und unterbricht die laufende Serveranfrage.
- „Für Begleitpersonen“ lädt die gespeicherten Angaben zu Name, Geburtsjahr, Stimmung und Musikvorlieben. Änderungen werden direkt in der API gespeichert. Die Begrüßung und freiwillige Fragen zu fehlenden Angaben richten sich nach dem gespeicherten Profil.
- „Gesprächsverlauf“ zeigt frühere Gespräche auch nach einem Neuladen. Der Aktualisieren-Knopf lädt den neuesten Stand vom Backend.
- Im Bereich für Begleitpersonen lassen sich nach Bestätigung entweder nur der Verlauf oder alle gespeicherten Daten einschließlich Profil löschen. „Sitzung beenden“ leert nur die aktuelle Antwort und beendet Aufnahme und Ton; gespeicherte Angaben und Gespräche bleiben erhalten.

Mikrofonzugriff braucht localhost oder HTTPS. Beim Öffnen über eine gewöhnliche HTTP-Adresse im WLAN ist häufig nur die Texteingabe verfügbar. Der Browser fragt erst nach Mikrofonzugriff, wenn die Person auf den Sprechen-Knopf tippt.

## API-Anbindung

Der Vite-Proxy leitet `/api` standardmäßig an `http://127.0.0.1:8000` weiter. So ist für die Entwicklung keine CORS-Änderung am Python-Backend nötig. Für eine andere Adresse `.env.example` nach `.env.local` kopieren, `API_TARGET` anpassen und Vite neu starten.

| Endpunkt                             | Verwendung                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                        | Erreichbarkeit prüfen, auch alle 30 Sekunden                                                                                             |
| `GET /v1/profile`                    | Gespeicherte Angaben, Begrüßung und nächste freiwillige Profilfrage laden                                                                |
| `PUT /v1/profile/{key}`              | Eine Profilangabe speichern oder korrigieren                                                                                             |
| `GET /v1/history`                    | Gespeicherte Gesprächspaare laden, neueste zuerst                                                                                        |
| `DELETE /v1/history`                 | Gesprächsverlauf und Interaktionen löschen, Profil behalten                                                                              |
| `DELETE /v1/data`                    | Gesprächsverlauf, Interaktionen und Profil löschen                                                                                       |
| `POST /v1/transcriptions`            | Browseraufnahme als Multipart-Feld `audio` mit `turn_id`                                                                                 |
| `POST /v1/chat`                      | Nachricht und die letzten zwölf Gesprächseinträge; SSE-Ereignisse `token`, `done`, `error`. Das Backend ergänzt das gespeicherte Profil. |
| `POST /v1/speech`                    | Fertige Antwort als WAV anfordern und im Browser abspielen                                                                               |
| `POST /v1/turns/{turn_id}/interrupt` | Laufende Verarbeitung beim Stoppen oder bei einer neuen Nachricht unterbrechen                                                           |

Die drei Gesprächsschritte verwenden dieselbe `turn_id`. Für jede neue Nachricht entsteht eine neue ID. Die Pausenerkennung misst den Mikrofonpegel lokal im Browser. Anschließend sendet das Frontend die fertige Aufnahme an die Upload-Transkription. Der Live-WebSocket wird nicht benötigt. Eine erfolgreiche Health-Abfrage bestätigt nur, dass die API erreichbar ist. Sie prüft nicht, ob Ollama und die Sprachmodelle bereit sind. Fehler beim Erstellen der Stimme lassen die Textantwort sichtbar.

Das Frontend verwendet die Standardmodelle und Standardstimme der API. Es generiert Musik lokal über Web Audio; die Sprach-API liefert Text und Sprache, keine Musikdateien. Audioqualität und Sprachunterstützung hängen von den Backend-Modellen ab.

Die API erhält Text, Profiländerungen und hochgeladene Aufnahmen zur Verarbeitung. Das Backend speichert Gespräche und daraus erkannte Profilangaben dauerhaft in `local-speech/api/sound_flux.db`, sofern `PROFILE_DB` keinen anderen Pfad vorgibt. Das Frontend lädt diese Daten beim Öffnen und nach einer Antwort erneut. Es verwendet dafür weder Local Storage noch Session Storage. Für eine neue Chat-Anfrage ergänzt es die letzten sechs Gesprächspaare als zwölf chronologische Einträge. Bereits gespeicherte und gerade abgeschlossene Antworten werden anhand ihrer `turn_id` zusammengeführt, damit keine doppelten Einträge entstehen.

Die Löschaktionen warten auf die Unterbrechung eines laufenden Turns, bevor sie Daten löschen. Schlägt Speichern oder Löschen fehl, zeigt die Oberfläche den Fehler und erlaubt einen erneuten Versuch. Da die API Profilfelder einzeln speichert, können bei einem Teilfehler einzelne Änderungen bereits gespeichert sein.

## Build und Prüfung

```sh
npm run build
npm run lint
npx playwright install chromium
npm test
```

Die Browsertests prüfen Offline-Musik, Profiländerungen und Teilfehler, Verlauf nach Neuladen, beide Löschoptionen, Mikrofonaufnahme mit einem simulierten Audiogerät, automatische Sprechpausen und erneutes Zuhören nach der Antwort. Sie prüfen außerdem den gemeinsamen Turn-Identifier, API-Fehler, Abbrüche, SSE-Chunk-Grenzen und das mobile Layout. API-Antworten werden in den Tests simuliert. Ein erfolgreicher Test bestätigt nicht die Funktionsfähigkeit der lokal installierten ML-Modelle.

`npm run build` erzeugt `dist/`. Für ein Deployment muss der Webserver `/api/*` an die Python-API weiterleiten und dabei den Präfix `/api` entfernen. SSE-Buffering ausschalten und lange Modellantworten bei Proxy-Timeouts berücksichtigen. Alternativ lässt sich `VITE_API_BASE_URL` vor dem Build auf eine andere URL setzen; bei einer anderen Origin braucht das Backend passende CORS-Freigaben.

## Dateien

- `src/App.tsx`: Oberfläche, Einstellungen und optionale Angaben.
- `src/hooks/useCompanion.ts`: Aufnahme, Gespräch, Sprachausgabe und Abbrüche.
- `src/hooks/useSavedData.ts`: Profil und Verlauf laden, speichern und löschen.
- `src/lib/api.ts`: HTTP-Anbindung und SSE-Parser.
- `src/lib/savedData.ts`: Datenendpunkte, Profilfelder und Gesprächskontext.
- `src/lib/speechPause.ts`: Lokale Erkennung von Sprache und anschließenden Pausen.
- `src/components/ProfilePanel.tsx`: Profilformular und Löschbestätigungen.
- `src/components/SavedHistory.tsx`: Gespeicherte Gespräche mit Zeitangaben.
- `src/lib/music.ts`: Instrumente und Melodien mit Web Audio.
- `src/index.css`: Tailwind, lokale Schriften, Farben und responsive Gestaltung.
- `src/components/sound-flux/`: Mitgelieferter Voice-Indikator aus `sound-flux-frontend.zip`. Die Komponente zeigt Zuhören, Nachdenken und Sprechen an. Die Bewegung verwendet die Voreinstellung für den jeweiligen Zustand, ohne Audiopegelmessung. Im Ruhezustand erscheint wieder die Schallplatte. Reduzierte Bewegung und Hintergrund-Tabs berücksichtigt die Komponente selbst.

Das Setup folgt der [Vite-Anleitung](https://vite.dev/guide/) und der [Tailwind-Integration für Vite](https://tailwindcss.com/docs/installation/using-vite).
