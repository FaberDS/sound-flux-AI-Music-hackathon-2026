#!/usr/bin/env bash
# Gemeinsamer Einstiegspunkt. Jeder Service bekommt seinen eigenen Prozessbaum.
# Kompatibel mit dem vorinstallierten Bash 3.2 auf macOS.
set -eo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
service_pids=()
service_names=()

# Job-Control gibt jedem Hintergrund-Service eine eigene Prozessgruppe.
# Dadurch beendet Ctrl+C auch Kindprozesse wie den von npm gestarteten Vite-Server.
set -m

cleanup() {
  trap '' INT TERM
  if [ "${#service_pids[@]}" -gt 0 ]; then
    printf '\nSound Flux wird beendet …\n'
    for service_pid in "${service_pids[@]}"; do
      kill -TERM -- "-$service_pid" 2>/dev/null || true
    done
    for service_pid in "${service_pids[@]}"; do
      wait "$service_pid" 2>/dev/null || true
    done
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Verwendung: start_service "Anzeigename" "Ordner relativ zum Root" Befehl Argumente …
# Der Befehl muss im Vordergrund laufen; diese Funktion startet ihn parallel.
start_service() {
  local service_name="$1"
  local service_directory="$2"
  shift 2

  if [ ! -d "$PROJECT_ROOT/$service_directory" ]; then
    printf 'Ordner für %s fehlt: %s\n' "$service_name" "$service_directory" >&2
    exit 1
  fi

  printf '\n[%s] Starte in %s\n' "$service_name" "$service_directory"
  (
    # Background services still write normal status logs to this terminal.
    # Keep macOS job control from suspending them with SIGTTOU.
    trap '' TTOU
    cd -- "$PROJECT_ROOT/$service_directory"
    exec "$@"
  ) &
  service_pids+=("$!")
  service_names+=("$service_name")
}

# --- Vorbereitung: Frontend ---
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf 'Für das Frontend werden Node.js ab 22.12 und npm benötigt.\n' >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  printf 'Für die Sprach-API wird uv benötigt.\n' >&2
  exit 1
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)'; then
  printf 'Bitte Node.js ab Version 22.12 verwenden. Installiert: %s\n' "$(node --version)" >&2
  exit 1
fi

if [[ ! "$FRONTEND_PORT" =~ ^[0-9]{1,5}$ ]] ||
  (( 10#$FRONTEND_PORT < 1 || 10#$FRONTEND_PORT > 65535 )); then
  printf 'FRONTEND_PORT muss eine Zahl zwischen 1 und 65535 sein.\n' >&2
  exit 1
fi

if [ ! -x "$PROJECT_ROOT/frontend/node_modules/.bin/vite" ]; then
  printf '[Frontend] Installiere Abhängigkeiten aus package-lock.json …\n'
  (cd -- "$PROJECT_ROOT/frontend" && npm ci)
fi

# --- Services: Hier ergänzt das Team seine eigenen Startbefehle ---
if curl --fail --silent --max-time 1 "http://127.0.0.1:$FRONTEND_PORT" >/dev/null; then
  printf '\n[Frontend] Nutze das bereits laufende Frontend auf Port %s\n' "$FRONTEND_PORT"
else
  start_service "Frontend" "frontend" npm run dev -- --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort
fi
if curl --fail --silent --max-time 1 http://127.0.0.1:8000/health >/dev/null; then
  printf '\n[Sprach-API] Nutze die bereits laufende API auf Port 8000\n'
else
  start_service "Sprach-API" "local-speech/api" uv run uvicorn app:app --host 127.0.0.1 --port 8000
fi

# Weitere Services hier ergänzen, zum Beispiel:
# start_service "Mein Service" "mein-ordner" mein-befehl --mein-argument
# Vorbereitungen wie die Installation von Abhängigkeiten oberhalb dieses Blocks einfügen.

printf '\nFrontend-Adresse: http://localhost:%s\n' "$FRONTEND_PORT"
printf 'Sprach-API: http://127.0.0.1:8000\n'
printf 'Die Vite-Ausgabe bestätigt, sobald der Server bereit ist. Ctrl+C beendet alle gestarteten Services.\n'

# Bash 3.2 hat kein wait -n. Sobald ein Service endet, räumt EXIT auch die übrigen auf.
while true; do
  for (( index = 0; index < ${#service_pids[@]}; index++ )); do
    if ! kill -0 "${service_pids[$index]}" 2>/dev/null; then
      service_exit=0
      wait "${service_pids[$index]}" || service_exit=$?
      printf '\n[%s] Beendet mit Exit-Code %s.\n' "${service_names[$index]}" "$service_exit" >&2
      exit "$service_exit"
    fi
  done
  sleep 1
done
