# Backend-Mockup

Ein lokaler Ersatz für Sprach-API und Audio-Engine. Das bestehende React-Frontend
verwendet dieselben HTTP-, SSE- und WebSocket-Schnittstellen wie mit dem echten
Backend. Der Mock benötigt nur Node.js ab 22.12 und npm. Keine Python-Umgebung,
Modelle, Ollama, FFmpeg oder API-Schlüssel.

## Start

Im Repository-Root:

```sh
./start-dev.sh
```

- Frontend: <http://localhost:5173>
- Mock-Steuerung: <http://127.0.0.1:8001/?frontendPort=5173>
- Frontend-Debugansicht: <http://localhost:5173/debug>
- Song-Bibliothek: <http://localhost:5173/songs>

Das Skript installiert fehlende npm-Abhängigkeiten, startet beide Prozesse und
prüft die Verbindung vom Frontend zum Mock. Vite lädt Frontend-Änderungen sofort.
Der Mock läuft dabei weiter. `Ctrl+C` beendet beide gestarteten Prozessgruppen.

Ist ein Port belegt, beendet das Skript den Start, ohne fremde Prozesse zu
stoppen oder ein Frontend mit unbekannter Backend-Verbindung zu übernehmen:

```sh
FRONTEND_PORT=5174 MOCK_PORT=8002 ./start-dev.sh
```

Die Proxy-Ziele gelten nur für diesen Start. Bestehende `.env`-Dateien werden
nicht geändert. `./start.sh` startet weiterhin die echten Services.

## Abläufe testen

| Ablauf | Vorgehen |
| --- | --- |
| Vorhandene Daten | Im Mock „Beispieldaten laden“, Frontend neu laden. Alex, zwei Gespräche und drei Songs sind vorhanden. |
| Erstes Onboarding | „Alles leer / Onboarding“, Frontend neu laden, „Talk with Sound Flux“. Mikrofon erlauben, kurz sprechen, dann „Finish speaking“. Der Mock antwortet für die drei Schritte mit Alex, 1950 und Jazz. Danach startet die Musikaufnahme. |
| Eigene Gesprächstexte | Im Mock einen simulierten Satz eintragen und übernehmen, dann im Frontend sprechen. Das Transkript verwendet diesen Satz bis zur nächsten Änderung. Ein leeres Feld wählt wieder die automatische Antwort. |
| Live-Transkript steuern | Während das Frontend zuhört, im Mock „Live-Satz senden“. Ohne aktive Aufnahme wird der Satz als künftiges Transkript übernommen. |
| Musik erstellen | Mit einem vollständigen Profil „Talk with Sound Flux“ wählen. Nach den kurzen Testtönen eine Melodie summen und pausieren. Die Oberfläche zeigt die Generierung und spielt anschließend den gespeicherten Song ab. |
| Musik und Effekte | Unter „Your songs“ einen Song öffnen. Der erste Beispielsong hat einen Glockeneffekt zum Entfernen. Kamera erlauben und Mund öffnen, um weitere Effekte zu spielen und zu speichern. |
| Profil und Verlauf | Unter „For companions“ Werte ändern, speichern, neu laden, Verlauf löschen oder alle Profildaten löschen. Die Songs haben eine eigene Löschaktion. |
| Musikparameter | Unter `/debug` Beschreibung, Dauer, Stärke und weitere Werte ändern. Neu laden und gespeicherte Einstellungen prüfen. |
| Laden und Stoppen | Im Mock „Langsam“ wählen. Im Frontend eine Aufnahme oder Antwort starten und „Stop“ drücken. Unterbrochene Antworten erscheinen nicht im gespeicherten Verlauf. |
| Modellstart | Bei „Audio-Engine“ den Zustand „Setup erforderlich“ wählen und übernehmen. Die nächste Komposition durchläuft den Setup-Zustand. „Setup fehlgeschlagen“ zeigt den Fehlerfall. |
| Fehler und erneuter Versuch | Fehler wie `profile-save`, `chat-stream`, `speech`, `compose`, `effects` oder `delete` aktivieren. Aktion im Frontend ausführen, Fehler wieder ausschalten und erneut versuchen. `speech` lässt bereits gespeicherte Textantworten bestehen. |
| Nicht erreichbar | „API offline“ simuliert Fehler der Sprach- und Musikaufrufe. „Normal“ stellt die üblichen Wartezeiten wieder her und entfernt Fehler. Die Health-Anzeige im Frontend aktualisiert sich spätestens nach 30 Sekunden oder nach Neuladen. |
| Leere Aufnahme | „Stille simulieren“ liefert ein leeres Transkript. Die lokale Pausenerkennung und Mikrofonberechtigungen bleiben Browserfunktionen. |

Die Mock-Steuerung zeigt die letzten 100 Anfragen und aktive Live-Verbindungen.
Konfigurationsänderungen gelten ohne Neustart. Nach dem Ersetzen von Daten das
Frontend neu laden, damit es Profil, Verlauf und Songs erneut abruft.

## Was simuliert wird

- Chat liefert nachvollziehbare Beispielantworten mit zeitlich getrennten
  SSE-Ereignissen `token`, `onboarding`, `mode`, `done` und optional `error`.
- Live-Transkription nimmt echte PCM-Nachrichten vom Browser entgegen und liefert
  `partial` und `final`. Auch Multipart-Uploads werden angenommen. Der Inhalt
  einer Aufnahme wird nicht erkannt; das Transkript ist steuerbar.
- Sprachausgabe liefert kurze, hörbare Testtöne als gültige WAV-Datei. Damit lassen
  sich Abspielen, Wiederholen, Stoppen und automatisches Weiterhören prüfen.
  Die Testtöne sprechen den Antworttext nicht aus.
- Musik besteht aus lokal erzeugten Melodien. Dauer und Seed beeinflussen die
  WAV-Datei; gespeicherte Effekte werden hörbar eingemischt und lassen sich wieder
  entfernen. Die hochgeladene Melodie und Modellparameter wie Prompt oder Stärke
  beeinflussen den Klang nicht. Diese Werte lassen sich trotzdem speichern und
  über das Frontend testen.
- Die Musiksuche durchsucht zwei lokale Beispiele und ruft MusicBrainz nicht auf.
- Kamera, Gesichtserkennung, Instrumente, Mikrofonberechtigung und lokale
  Pausenerkennung bleiben die vorhandenen Frontend-Funktionen. Für manuelle
  Kamera- und Mikrofontests sind die entsprechenden Geräte nötig.

## Daten und Schnittstellen

Profil, Verlauf, Kompositionsdaten und Musikparameter liegen ausschließlich in
`backend-mockup/.data/state.json`. Audio wird bei Bedarf aus den gespeicherten
Seeds und Effekten erzeugt. Aufnahmen werden nicht gespeichert. Die echte
SQLite-Datenbank, Audio-Dateien und Modell-Caches werden nicht geöffnet.

Die Daten bleiben über einen Neustart erhalten. Wartezeiten, Fehler und
Transkript-Vorgaben gelten nur für den laufenden Mock und beginnen nach einem
Neustart wieder mit Standardwerten. Für eine getrennte Testsitzung:

```sh
MOCK_DATA_FILE=.data/another-session.json ./start-dev.sh
```

Relative Datenpfade beziehen sich auf `backend-mockup/`. Der Server bindet nur
an `127.0.0.1`. Er lässt sich auch einzeln mit `npm start` in diesem Ordner starten.

| Frontend-Aufruf | Mock-Endpunkt |
| --- | --- |
| `/api/health`, `/api/v1/*` | `/health`, `/v1/*` inklusive Live-WebSocket |
| `/engine/api/*` | `/api/*` der Audio-Engine |
| Steuerseite direkt auf Port 8001 | `/` |
| Zustand, Konfiguration, Anfrageliste | `GET /__mock` |
| Fehler, Antworttext, Transkript, Wartezeiten | `POST /__mock/config` mit Teilkonfiguration als JSON |
| Beispieldaten oder leerer Zustand | `POST /__mock/reset` mit `{"preset":"demo"}` oder `{"preset":"empty"}` |
| Aktuelle Live-Aufnahme abschließen | `POST /__mock/transcript` mit `{"text":"Alex"}` |

Unbekannte Routen liefern 404. Ein Reset unterbricht aktive Gespräche und
verhindert, dass laufende Musikgenerierungen gelöschte Testdaten wieder anlegen.

## Automatische Prüfung

```sh
cd backend-mockup
npm ci
npm test

cd ../frontend
npm ci
npx playwright install chromium
npm run test:mock
npm run build
npm run lint
```

Die API-Tests prüfen Speicherung über Neustarts, SSE-Onboarding, WebSocket,
Audio-Uploads, WAV-Ausgabe, Effekte, Löschungen, Setup, Fehler und Abbrüche.
Die Browsertests starten `start-dev.sh` auf den getrennten Ports 5179 und 8019
mit eigenen Daten in `.data/playwright-state.json`. Sie verwenden keine
abgefangenen API-Antworten. Ein simuliertes Browsermikrofon durchläuft das
Onboarding und die Aufnahme bis zur abspielbaren Komposition. Die Tests prüfen
außerdem Profilfehler, Löschen, Effektentfernung, Debug-Einstellungen und die
Mock-Steuerseite. Deine laufende Dev-Sitzung bleibt davon getrennt.
