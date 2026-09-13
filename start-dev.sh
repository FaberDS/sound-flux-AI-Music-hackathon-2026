#!/usr/bin/env bash
# Frontend + lightweight mock only. Compatible with macOS Bash 3.2.
set -eo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_PORT="${FRONTEND_PORT:-}"
MOCK_PORT="${MOCK_PORT:-}"
service_pids=()
service_names=()
set -m

cleanup() {
  trap '' INT TERM
  if [ "${#service_pids[@]}" -gt 0 ]; then
    printf '\nSound Flux Dev wird beendet …\n'
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

for dependency in node npm curl; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    printf '%s fehlt. Benötigt werden Node.js ab 22.12, npm und curl.\n' "$dependency" >&2
    exit 1
  fi
done
if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)'; then
  printf 'Bitte Node.js ab Version 22.12 verwenden.\n' >&2
  exit 1
fi

# Prompts go to stderr so command substitution captures only the chosen port.
# Explicit environment values and starts without a terminal also work for tests.
select_port() {
  local name="$1" configured="$2" default_port="$3" other_port="${4:-}" bind_host="${5:-127.0.0.1}"
  local candidate="${configured:-$default_port}" entered prompt=0
  if [ -t 0 ] && [ -z "$configured" ]; then
    prompt=1
  fi
  while true; do
    if [ "$prompt" -eq 1 ]; then
      if ! read -r -p "$name-Port [$default_port]: " entered; then
        printf '\nPortauswahl abgebrochen.\n' >&2
        return 1
      fi
      candidate="${entered:-$default_port}"
    fi
    # Never reuse a frontend whose proxy may still point at the real services.
    if node --input-type=module - "$candidate" "$other_port" "$bind_host" <<'NODE'
import net from 'node:net'
const [port, otherPort, bindHost] = process.argv.slice(2)
if (!/^\d{1,5}$/.test(port) || +port < 1 || +port > 65535) {
  console.error('Bitte einen Port zwischen 1 und 65535 eingeben.')
  process.exit(1)
}
if (+port === +otherPort) {
  console.error('Frontend und Mock-Backend brauchen verschiedene Ports.')
  process.exit(1)
}
const server = net.createServer()
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(+port, bindHost, resolve) })
  await new Promise((resolve) => server.close(resolve))
  process.stdout.write(String(Number(port)))
} catch (error) {
  console.error(`Port ${port} ist nicht verfügbar: ${error.code}. Bitte einen anderen Port wählen.`)
  process.exit(1)
}
NODE
    then
      return 0
    fi
    if [ ! -t 0 ]; then
      printf 'Ports vorgeben, z. B.: FRONTEND_PORT=5174 MOCK_PORT=8002 ./start-dev.sh\n' >&2
      return 1
    fi
    prompt=1
  done
}

FRONTEND_PORT="$(select_port 'Frontend' "$FRONTEND_PORT" 5173 '' '0.0.0.0')"
MOCK_PORT="$(select_port 'Mock-Backend' "$MOCK_PORT" 8001 "$FRONTEND_PORT")"

if ! (cd -- "$PROJECT_ROOT/frontend" && npm ls --depth=0 >/dev/null 2>&1); then
  (cd -- "$PROJECT_ROOT/frontend" && npm ci)
fi
if ! (cd -- "$PROJECT_ROOT/backend-mockup" && npm ls --depth=0 >/dev/null 2>&1); then
  (cd -- "$PROJECT_ROOT/backend-mockup" && npm ci)
fi

start_service() {
  local name="$1" directory="$2"
  shift 2
  (
    trap '' TTOU
    cd -- "$PROJECT_ROOT/$directory"
    exec "$@"
  ) &
  service_pids+=("$!")
  service_names+=("$name")
}

start_service 'Mock-Backend' 'backend-mockup' env MOCK_PORT="$MOCK_PORT" node server.mjs
# Das Frontend ist so auch über Tailscale erreichbar; API-Aufrufe laufen über den Vite-Proxy.
start_service 'Frontend' 'frontend' env \
  API_TARGET="http://127.0.0.1:$MOCK_PORT" \
  AUDIO_ENGINE_TARGET="http://127.0.0.1:$MOCK_PORT" \
  VITE_API_BASE_URL=/api \
  npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" --strictPort

ready=0
for (( attempt = 0; attempt < 30; attempt++ )); do
  for (( index = 0; index < ${#service_pids[@]}; index++ )); do
    if ! kill -0 "${service_pids[$index]}" 2>/dev/null; then
      printf '%s konnte nicht starten.\n' "${service_names[$index]}" >&2
      exit 1
    fi
  done
  if curl --fail --silent --max-time 1 "http://127.0.0.1:$FRONTEND_PORT/api/health" | node -e 'let text=""; process.stdin.on("data",c=>text+=c).on("end",()=>{try{process.exit(JSON.parse(text).chat_model==="mock-chat"?0:1)}catch{process.exit(1)}})'; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  printf 'Frontend und Mock wurden nicht rechtzeitig bereit. Siehe Ausgabe oben.\n' >&2
  exit 1
fi

printf '\nFrontend:       http://localhost:%s\n' "$FRONTEND_PORT"
printf 'Mock-Steuerung: http://127.0.0.1:%s/?frontendPort=%s\n' "$MOCK_PORT" "$FRONTEND_PORT"
printf 'Frontend-Änderungen lädt Vite sofort. Mock-Daten bleiben gespeichert.\n'
printf 'Ctrl+C beendet beide gestarteten Services.\n'

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
