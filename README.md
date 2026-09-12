# Sound Flux

## Gemeinsam starten

Im Root des Repositories:

```sh
./start.sh
```

Das Skript startet das React-Frontend unter [localhost:5173](http://localhost:5173) und die Sprach-API unter [127.0.0.1:8000](http://127.0.0.1:8000). Läuft ein Dienst bereits, wird er weiterverwendet. Node.js ab 22.12, npm und [uv](https://docs.astral.sh/uv/) müssen installiert sein. Fehlende Frontend-Abhängigkeiten installiert es mit `npm ci`; `uv run` synchronisiert die API-Abhängigkeiten aus `uv.lock`. Mit `Ctrl+C` beendet es die gestarteten Services samt Kindprozessen.

Das Skript funktioniert auch bei Aufruf aus einem anderen Arbeitsverzeichnis. Falls Port 5173 belegt ist, bricht der Start ab. Alternativ lässt sich ein anderer Port wählen:

```sh
FRONTEND_PORT=5174 ./start.sh
```

## Eigene Services ergänzen

In `start.sh` ist der Abschnitt `Services` für weitere Teambeiträge vorbereitet:

```bash
start_service "Anzeigename" "ordner-relativ-zum-root" befehl argumente
```

Die Funktion wechselt in den angegebenen Ordner und startet den Befehl parallel zu den anderen Services. Der Befehl selbst soll im Vordergrund bleiben, also kein zusätzliches `&` oder Daemon-Modus. Die Ausgabe aller Services erscheint im selben Terminal. Endet ein Service, beendet das Skript auch die übrigen und übernimmt seinen Exit-Code.

Nötige Vorbereitungsschritte oberhalb des Service-Abschnitts ergänzen. Abhängigkeiten zwischen Services und deren Bereitschaft muss die jeweilige Integration berücksichtigen.

Das Frontend erwartet die Sprach-API standardmäßig unter `http://127.0.0.1:8000`; die Adresse kann in `frontend/.env.local` über `API_TARGET` angepasst werden. Instrumente und lokale Melodien funktionieren bereits ohne diese API.

Weitere Frontend-Details stehen in [frontend/README.md](frontend/README.md).
