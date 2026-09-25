#!/usr/bin/env python3
"""Serve the evaluation lab with Promptfoo, emotion2vec, and Supertonic speech."""

from argparse import ArgumentParser
from datetime import date, datetime
from functools import partial
from http.client import HTTPConnection, HTTPException
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import os
import errno
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import subprocess
import tempfile
from threading import Lock, Thread
import time
from urllib.parse import parse_qs, unquote, urlparse
from uuid import UUID, uuid4
import wave

import numpy as np

ROOT = Path(__file__).resolve().parent
DATA_ROOT = ROOT / ".data"
os.environ.setdefault("HF_HOME", str(ROOT / ".cache" / "huggingface"))
MODEL_ID = "emotion2vec/emotion2vec_plus_base"
ASR_MODEL_ID = "openai/whisper-base"
ASR_SAMPLE_RATE = 16_000
LABELS = ("angry", "disgusted", "fearful", "happy", "neutral", "other", "sad", "surprised", "unknown")
model = None
model_error = None
loading = False
load_lock = Lock()
inference_lock = Lock()
TTS_VOICES = tuple(f"{prefix}{number}" for prefix in ("F", "M") for number in range(1, 6))
tts_model = None
tts_lock = Lock()
asr_model = None
asr_processor = None
asr_lock = Lock()
IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic", "image/heif": ".heif"}
MEMORY_KINDS = {"lebensereignis", "musikvorliebe", "lebensgeschichte", "kreative_idee", "alltag"}
MEMORY_SCOPES = {"persistent", "conversation", "irrelevant"}


def now_text():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def clean_text(value, label, maximum, required=False):
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ValueError(f"{label} muss Text sein.")
    value = value.strip()
    if required and not value:
        raise ValueError(f"{label} fehlt.")
    if len(value) > maximum:
        raise ValueError(f"{label} darf höchstens {maximum} Zeichen enthalten.")
    return value


def valid_id(value):
    try:
        return str(UUID(value)) == value
    except (ValueError, TypeError, AttributeError):
        return False


def registry_connection(data_root):
    data_root.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(data_root / "profiles.sqlite")
    connection.row_factory = sqlite3.Row
    connection.execute("""CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY, display_name TEXT NOT NULL, profile_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )""")
    return connection


def user_connection(data_root, user_id):
    if not valid_id(user_id):
        raise ValueError("Ungültige Personen-ID.")
    directory = data_root / "users" / user_id
    directory.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(directory / "memory.sqlite")
    connection.row_factory = sqlite3.Row
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY, kind TEXT NOT NULL, summary TEXT NOT NULL, scope TEXT NOT NULL,
            conversation_id TEXT NOT NULL DEFAULT '', event_date TEXT NOT NULL DEFAULT '',
            repeats_annually INTEGER NOT NULL DEFAULT 0, mention_policy TEXT NOT NULL DEFAULT 'passend',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS photos (
            id TEXT PRIMARY KEY, storage_name TEXT NOT NULL, content_type TEXT NOT NULL,
            original_name TEXT NOT NULL, caption TEXT NOT NULL, event_date TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
    """)
    return connection


def validated_profile(payload):
    if not isinstance(payload, dict):
        raise ValueError("Profildaten fehlen.")
    birth_year = payload.get("birthYear", "")
    if birth_year not in (None, ""):
        try:
            birth_year = int(birth_year)
        except (TypeError, ValueError) as error:
            raise ValueError("Das Geburtsjahr ist ungültig.") from error
        if not 1900 <= birth_year <= date.today().year:
            raise ValueError("Das Geburtsjahr muss zwischen 1900 und dem aktuellen Jahr liegen.")
    else:
        birth_year = ""
    return {
        "displayName": clean_text(payload.get("displayName"), "Anzeigename", 80, True),
        "preferredAddress": clean_text(payload.get("preferredAddress", "du"), "Anrede", 80),
        "birthYear": birth_year,
        "importantPeople": clean_text(payload.get("importantPeople"), "Wichtige Menschen", 1000),
        "musicPreferences": clean_text(payload.get("musicPreferences"), "Musikvorlieben", 1000),
        "meaningfulPlaces": clean_text(payload.get("meaningfulPlaces"), "Bedeutsame Orte", 1000),
        "conversationStyle": clean_text(payload.get("conversationStyle", "ruhig und zugewandt"), "Gesprächsstil", 200),
        "sensitiveTopics": clean_text(payload.get("sensitiveTopics"), "Sensible Themen", 1000),
        "proactiveMemories": payload.get("proactiveMemories") is True,
        "language": "de",
    }


def create_profile(data_root, payload):
    profile = validated_profile(payload)
    user_id, timestamp = str(uuid4()), now_text()
    with registry_connection(data_root) as connection:
        connection.execute("INSERT INTO profiles VALUES (?, ?, ?, ?, ?)",
                           (user_id, profile["displayName"], json.dumps(profile, ensure_ascii=False), timestamp, timestamp))
    with user_connection(data_root, user_id):
        pass
    return {"id": user_id, "profile": profile, "createdAt": timestamp, "updatedAt": timestamp}


def list_profiles(data_root):
    with registry_connection(data_root) as connection:
        rows = connection.execute("SELECT id, display_name, updated_at FROM profiles ORDER BY display_name COLLATE NOCASE").fetchall()
    return [{"id": row["id"], "displayName": row["display_name"], "updatedAt": row["updated_at"]} for row in rows]


def require_profile(data_root, user_id):
    if not valid_id(user_id):
        raise ValueError("Ungültige Personen-ID.")
    with registry_connection(data_root) as connection:
        if connection.execute("SELECT 1 FROM profiles WHERE id = ?", (user_id,)).fetchone() is None:
            raise LookupError("Person nicht gefunden.")


def read_profile(data_root, user_id):
    if not valid_id(user_id):
        raise ValueError("Ungültige Personen-ID.")
    with registry_connection(data_root) as connection:
        row = connection.execute("SELECT * FROM profiles WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        raise LookupError("Person nicht gefunden.")
    with user_connection(data_root, user_id) as connection:
        memories = [dict(item) for item in connection.execute("SELECT * FROM memories ORDER BY created_at DESC")]
        photos = [dict(item) for item in connection.execute("SELECT id, content_type, original_name, caption, event_date, created_at FROM photos ORDER BY created_at DESC")]
    return {"id": user_id, "profile": json.loads(row["profile_json"]), "createdAt": row["created_at"],
            "updatedAt": row["updated_at"], "memories": memories, "photos": photos}


def update_profile(data_root, user_id, payload):
    profile = validated_profile(payload)
    timestamp = now_text()
    with registry_connection(data_root) as connection:
        result = connection.execute("UPDATE profiles SET display_name = ?, profile_json = ?, updated_at = ? WHERE id = ?",
                                    (profile["displayName"], json.dumps(profile, ensure_ascii=False), timestamp, user_id))
        if not result.rowcount:
            raise LookupError("Person nicht gefunden.")
    return read_profile(data_root, user_id)


def parse_iso_date(value, label="Datum"):
    value = clean_text(value, label, 10)
    if value:
        try:
            date.fromisoformat(value)
        except ValueError as error:
            raise ValueError(f"{label} ist ungültig.") from error
    return value


def add_memory(data_root, user_id, payload):
    require_profile(data_root, user_id)
    if not isinstance(payload, dict):
        raise ValueError("Erinnerungsdaten fehlen.")
    scope = payload.get("scope")
    if scope not in MEMORY_SCOPES:
        raise ValueError("Ungültige Verwendung der Information.")
    if scope == "irrelevant":
        return {"stored": False}
    kind = payload.get("kind")
    if kind not in MEMORY_KINDS:
        raise ValueError("Ungültige Art der Erinnerung.")
    summary = clean_text(payload.get("summary"), "Erinnerung", 1000, True)
    conversation_id = clean_text(payload.get("conversationId"), "Gesprächs-ID", 80, scope == "conversation")
    event_date = parse_iso_date(payload.get("eventDate"))
    policy = payload.get("mentionPolicy", "passend")
    if policy not in {"passend", "nachfragen", "nur_auf_nachfrage"}:
        raise ValueError("Ungültige Regel für das Ansprechen.")
    item = {
        "id": str(uuid4()), "kind": kind, "summary": summary, "scope": scope,
        "conversation_id": conversation_id if scope == "conversation" else "",
        "event_date": event_date, "repeats_annually": 1 if payload.get("repeatsAnnually") is True and event_date else 0,
        "mention_policy": policy, "created_at": now_text(),
    }
    with user_connection(data_root, user_id) as connection:
        connection.execute("INSERT INTO memories VALUES (:id, :kind, :summary, :scope, :conversation_id, :event_date, :repeats_annually, :mention_policy, :created_at)", item)
    return {"stored": True, "memory": item}


def delete_memory(data_root, user_id, memory_id):
    require_profile(data_root, user_id)
    if not valid_id(memory_id):
        raise ValueError("Ungültige Erinnerungs-ID.")
    with user_connection(data_root, user_id) as connection:
        return bool(connection.execute("DELETE FROM memories WHERE id = ?", (memory_id,)).rowcount)


def add_photo(data_root, user_id, metadata, content_type, content):
    require_profile(data_root, user_id)
    if content_type not in IMAGE_TYPES or not content or len(content) > 10_000_000:
        raise ValueError("Bitte ein JPEG-, PNG-, WebP-, HEIC- oder HEIF-Bild bis 10 MB wählen.")
    item = {
        "id": str(uuid4()), "content_type": content_type,
        "original_name": clean_text(metadata.get("name"), "Dateiname", 200, True),
        "caption": clean_text(metadata.get("caption"), "Bildbeschreibung", 500, True),
        "event_date": parse_iso_date(metadata.get("date"), "Bilddatum"), "created_at": now_text(),
    }
    item["storage_name"] = item["id"] + IMAGE_TYPES[content_type]
    photos = data_root / "users" / user_id / "photos"
    photos.mkdir(parents=True, exist_ok=True)
    path = photos / item["storage_name"]
    path.write_bytes(content)
    try:
        with user_connection(data_root, user_id) as connection:
            connection.execute("INSERT INTO photos VALUES (:id, :storage_name, :content_type, :original_name, :caption, :event_date, :created_at)", item)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return {key: value for key, value in item.items() if key != "storage_name"}


def photo_record(data_root, user_id, photo_id):
    require_profile(data_root, user_id)
    if not valid_id(photo_id):
        raise ValueError("Ungültige Bild-ID.")
    with user_connection(data_root, user_id) as connection:
        item = connection.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
    if item is None:
        raise LookupError("Bild nicht gefunden.")
    return dict(item)


def delete_photo(data_root, user_id, photo_id):
    item = photo_record(data_root, user_id, photo_id)
    with user_connection(data_root, user_id) as connection:
        connection.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
    (data_root / "users" / user_id / "photos" / item["storage_name"]).unlink(missing_ok=True)


def anniversary_distance(event_date, current):
    source = date.fromisoformat(event_date)
    try:
        candidate = source.replace(year=current.year)
    except ValueError:  # 29 February in a non-leap year
        candidate = date(current.year, 2, 28)
    distances = [(candidate - current).days]
    for year in (current.year - 1, current.year + 1):
        try:
            other = source.replace(year=year)
        except ValueError:
            other = date(year, 2, 28)
        distances.append((other - current).days)
    return min(distances, key=abs)


def build_memory_context(data_root, user_id, payload):
    if not isinstance(payload, dict):
        raise ValueError("Kontextdaten fehlen.")
    current = date.fromisoformat(parse_iso_date(payload.get("currentDate"), "Aktuelles Datum") or date.today().isoformat())
    topic = clean_text(payload.get("topic"), "Gesprächsthema", 500)
    conversation_id = clean_text(payload.get("conversationId"), "Gesprächs-ID", 80)
    person = read_profile(data_root, user_id)
    memories, photos = person["memories"], person["photos"]
    annual = []
    annual_dates = set()
    for item in memories:
        if item.get("repeats_annually") and item.get("event_date"):
            distance = anniversary_distance(item["event_date"], current)
            if abs(distance) <= 7:
                annual.append({**item, "daysAway": distance, "type": "memory"})
                annual_dates.add(item["event_date"][5:])
    for item in photos:
        if item.get("event_date", "")[5:] in annual_dates:
            distance = anniversary_distance(item["event_date"], current)
            annual.append({**item, "daysAway": distance, "type": "photo"})
    words = set(re.findall(r"[a-zäöüß]{4,}", topic.lower()))
    relevant = []
    for item in memories:
        if item["scope"] == "conversation" and item["conversation_id"] == conversation_id:
            relevant.append({**item, "reason": "aktuelles Gespräch"})
        elif item["scope"] == "persistent" and words:
            haystack = f"{item['kind']} {item['summary']}".lower()
            if any(word in haystack for word in words):
                relevant.append({**item, "reason": "passendes Thema"})
    unique = {item["id"]: item for item in [*annual, *relevant] if item.get("summary")}
    selected_photos = {item["id"]: item for item in annual if item.get("type") == "photo"}
    if words:
        for item in photos:
            if any(word in item["caption"].lower() for word in words):
                selected_photos[item["id"]] = {**item, "type": "photo", "reason": "passendes Thema"}
    profile = person["profile"]
    lines = [f"Person: {profile['displayName']}", f"Bevorzugte Anrede: {profile['preferredAddress'] or 'nicht angegeben'}"]
    if profile.get("birthYear"):
        lines.append(f"Geburtsjahr: {profile['birthYear']} (genaues Alter ohne Geburtstag nicht behaupten)")
    for key, label in (("importantPeople", "Wichtige Menschen"), ("musicPreferences", "Musikvorlieben"),
                       ("meaningfulPlaces", "Bedeutsame Orte"), ("conversationStyle", "Gesprächsstil"),
                       ("sensitiveTopics", "Nicht ungefragt ansprechen")):
        if profile.get(key):
            lines.append(f"{label}: {profile[key]}")
    if annual:
        lines.append("Zeitnah relevante Jahrestage:")
        for item in annual:
            text = item.get("summary") or item.get("caption")
            policy = item.get("mention_policy", "passend")
            if not profile["proactiveMemories"] or policy == "nur_auf_nachfrage":
                instruction = "nicht von selbst ansprechen"
            elif policy == "nachfragen":
                instruction = "vor dem Ansprechen kurz um Erlaubnis fragen"
            else:
                instruction = "darf behutsam und passend angesprochen werden"
            lines.append(f"- {text} ({item['event_date']}, Abstand {item['daysAway']:+d} Tage; {instruction})")
    if unique:
        lines.append("Relevante bestätigte Erinnerungen:")
        lines.extend(f"- {item['summary']}" for item in list(unique.values())[:8])
    if selected_photos:
        lines.append("Relevante Bilder (nur bestätigte Beschreibung; Bildinhalt nicht dazuerfinden):")
        for item in list(selected_photos.values())[:4]:
            image_date = f" ({item['event_date']})" if item.get("event_date") else ""
            lines.append(f"- {item['caption']}{image_date}")
    lines.append("Fehlende Details nicht erfinden. Sensible Themen und Bildinhalte nicht ungefragt behaupten.")
    return {"currentDate": current.isoformat(), "anniversaries": annual, "memories": list(unique.values())[:8],
            "photos": [{**item, "url": f"/api/memory/users/{user_id}/photos/{item['id']}"}
                       for item in list(selected_photos.values())[:4]],
            "context": "\n".join(lines)}


class PromptfooViewer:
    def __init__(self, port):
        self.port = port
        self.process = None
        self.error = None

    def start(self):
        node = shutil.which("node")
        cli = ROOT / "node_modules/promptfoo/dist/src/entrypoint.js"
        if not node or not cli.is_file():
            self.error = "Node.js 22.22+ und npm ci in llm-evaluation benötigt. Danach den Laborserver neu starten."
            return
        try:
            self.process = subprocess.Popen(
                [node, str(cli), "view", "--port", str(self.port), "--no"],
                cwd=ROOT, stdin=subprocess.DEVNULL, start_new_session=True,
                env={**os.environ, "PROMPTFOO_CONFIG_DIR": str(ROOT / ".promptfoo"),
                     "PROMPTFOO_DISABLE_TELEMETRY": "1", "PROMPTFOO_DISABLE_UPDATE": "1",
                     "OLLAMA_BASE_URL": "http://127.0.0.1:11434", "REQUEST_TIMEOUT_MS": "120000"},
            )
        except OSError as error:
            self.error = f"Promptfoo konnte nicht gestartet werden: {error}"

    def status(self):
        ready = False
        error = self.error
        if self.process is not None:
            if self.process.poll() is not None:
                error = (f"Promptfoo wurde beendet (Code {self.process.returncode}). Terminal prüfen; "
                         f"falls Port {self.port} belegt ist, den Laborserver mit --promptfoo-port auf einem freien Port neu starten.")
            else:
                connection = HTTPConnection("127.0.0.1", self.port, timeout=1)
                try:
                    connection.request("GET", "/health")
                    response = connection.getresponse()
                    health = json.loads(response.read())
                    ready = (response.status == 200 and isinstance(health, dict)
                             and health.get("status") == "OK" and bool(health.get("version")))
                except (OSError, HTTPException, ValueError):
                    pass  # The child is still starting; the browser retries while this tab is open.
                finally:
                    connection.close()
        return {"port": self.port, "ready": ready, "error": error}

    def close(self):
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=6)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()


def validate_tts(payload):
    if not isinstance(payload, dict) or payload.get("voice") not in TTS_VOICES:
        raise ValueError("Bitte eine Stimme von F1–F5 oder M1–M5 wählen.")
    text = payload.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > 1000:
        raise ValueError("Bitte einen Text mit 1–1.000 Zeichen eingeben.")
    return payload["voice"], text.strip()


def synthesize_tts(active_model, voice, text):
    samples, _ = active_model.synthesize(
        text, voice_style=active_model.get_voice_style(voice), lang="de", total_steps=8, speed=1.0,
    )
    samples = np.asarray(samples).reshape(-1)
    if not samples.size or not np.isfinite(samples).all():
        raise RuntimeError("Supertonic hat keine gültige Stimmprobe geliefert.")
    audio = BytesIO()
    with wave.open(audio, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(active_model.sample_rate)
        output.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return audio.getvalue()


def load_model():
    global model, model_error, loading
    with load_lock:
        if model is not None or loading:
            return
        loading = True
    try:
        from funasr import AutoModel

        model = AutoModel(model=MODEL_ID, hub="hf", device="cpu", disable_update=True)
    except Exception as error:  # surfaced through the local status endpoint
        model_error = str(error)
    finally:
        loading = False


def classify(samples, sample_rate, active_model):
    started = time.perf_counter()
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with tempfile.NamedTemporaryFile(suffix=".wav") as recording:
        with wave.open(recording.name, "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(sample_rate)
            output.writeframes(pcm.tobytes())
        result = active_model.generate(recording.name, granularity="utterance", extract_embedding=False)
    scores = result[0].get("scores", []) if result else []
    if len(scores) != len(LABELS):
        raise RuntimeError("emotion2vec returned an unexpected score vector")
    values = np.asarray(scores, dtype=float)
    total = values.sum()
    if not np.isfinite(values).all() or total <= 0:
        raise RuntimeError("emotion2vec returned invalid scores")
    values /= total
    return {
        "model": MODEL_ID,
        "scores": dict(zip(LABELS, values.tolist())),
        "inference_ms": round((time.perf_counter() - started) * 1000),
    }


def transcribe(samples, sample_rate, processor, active_model):
    # ponytail: a simple silence gate prevents Whisper hallucinations; use a VAD if noisy rooms defeat it.
    if np.sqrt(np.mean(np.square(samples, dtype=np.float64))) < 0.001:
        return ""
    if sample_rate != ASR_SAMPLE_RATE:
        source = np.arange(len(samples), dtype=np.float64)
        target = np.arange(round(len(samples) * ASR_SAMPLE_RATE / sample_rate), dtype=np.float64) * sample_rate / ASR_SAMPLE_RATE
        samples = np.interp(target, source, samples).astype(np.float32)
    parts = []
    # Whisper accepts at most 30 seconds per pass; recordings are capped at 60 seconds by the UI and endpoint.
    for start in range(0, len(samples), ASR_SAMPLE_RATE * 30):
        inputs = processor(samples[start:start + ASR_SAMPLE_RATE * 30], sampling_rate=ASR_SAMPLE_RATE, return_tensors="pt")
        import torch
        with torch.inference_mode():
            tokens = active_model.generate(**inputs, language="de", task="transcribe")
        text = processor.batch_decode(tokens, skip_special_tokens=True, clean_up_tokenization_spaces=False)[0].strip()
        if text:
            parts.append(text)
    return " ".join(parts)


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        if not any(header.lower().startswith(b"cache-control:") for header in self._headers_buffer):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    @property
    def data_root(self):
        return getattr(self.server, "data_root", DATA_ROOT)

    def read_json(self, maximum=20_000):
        length = int(self.headers.get("Content-Length", "0"))
        if self.headers.get_content_type() != "application/json" or not 0 < length <= maximum:
            raise ValueError(f"Eine JSON-Anfrage bis {maximum:,} Bytes senden.")
        return json.loads(self.rfile.read(length))

    def memory_error(self, error):
        if isinstance(error, LookupError):
            self.send_json(404, {"error": str(error)})
        elif isinstance(error, (ValueError, UnicodeDecodeError, json.JSONDecodeError)):
            self.send_json(400, {"error": str(error)})
        else:
            self.send_json(500, {"error": f"Lokaler Speicherfehler: {error}"})

    def memory_route(self, method):
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")
        if parts[:3] != ["api", "memory", "users"]:
            return False
        try:
            if method == "GET" and len(parts) == 3:
                self.send_json(200, {"users": list_profiles(self.data_root)})
            elif method == "POST" and len(parts) == 3:
                self.send_json(201, create_profile(self.data_root, self.read_json()))
            elif method == "GET" and len(parts) == 4:
                self.send_json(200, read_profile(self.data_root, parts[3]))
            elif method == "PUT" and len(parts) == 4:
                self.send_json(200, update_profile(self.data_root, parts[3], self.read_json()))
            elif method == "POST" and len(parts) == 5 and parts[4] == "memories":
                self.send_json(201, add_memory(self.data_root, parts[3], self.read_json()))
            elif method == "POST" and len(parts) == 5 and parts[4] == "context":
                self.send_json(200, build_memory_context(self.data_root, parts[3], self.read_json()))
            elif method == "POST" and len(parts) == 5 and parts[4] == "photos":
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 10_000_000:
                    raise ValueError("Bitte ein Bild bis 10 MB wählen.")
                query = {key: values[0] for key, values in parse_qs(parsed.query, keep_blank_values=True).items()}
                self.send_json(201, add_photo(self.data_root, parts[3], query, self.headers.get_content_type(), self.rfile.read(length)))
            elif method == "GET" and len(parts) == 6 and parts[4] == "photos":
                item = photo_record(self.data_root, parts[3], parts[5])
                content = (self.data_root / "users" / parts[3] / "photos" / item["storage_name"]).read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", item["content_type"])
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Cache-Control", "private, max-age=3600")
                self.end_headers()
                self.wfile.write(content)
            elif method == "DELETE" and len(parts) == 6 and parts[4] == "memories":
                if not delete_memory(self.data_root, parts[3], parts[5]):
                    raise LookupError("Erinnerung nicht gefunden.")
                self.send_json(200, {"deleted": True})
            elif method == "DELETE" and len(parts) == 6 and parts[4] == "photos":
                delete_photo(self.data_root, parts[3], parts[5])
                self.send_json(200, {"deleted": True})
            else:
                self.send_error(404)
        except Exception as error:
            self.memory_error(error)
        return True

    def do_GET(self):
        path = urlparse(self.path).path
        if self.memory_route("GET"):
            return
        if unquote(path).startswith("/.data"):
            self.send_error(404)
            return
        if path == "/api/promptfoo/status":
            self.send_json(200, self.server.promptfoo.status())
            return
        if path == "/api/tone/status":
            self.send_json(200, {
                "model": MODEL_ID,
                "ready": model is not None,
                "loading": loading,
                "error": model_error,
            })
            return
        super().do_GET()

    def do_POST(self):
        if self.memory_route("POST"):
            return
        parsed = urlparse(self.path)
        if parsed.path == "/api/tts":
            self.do_tts()
            return
        if parsed.path == "/api/transcribe":
            self.do_transcribe(parsed)
            return
        if parsed.path != "/api/tone":
            self.send_error(404)
            return
        if model is None:
            self.send_json(503, {"error": model_error or "emotion2vec is still loading"})
            return
        try:
            sample_rate = int(parse_qs(parsed.query).get("sample_rate", [""])[0])
            length = int(self.headers.get("Content-Length", "0"))
            if not 8_000 <= sample_rate <= 96_000 or not 0 < length <= 4_000_000 or length % 4:
                raise ValueError("Send mono float32 PCM at 8–96 kHz, up to 4 MB.")
            samples = np.frombuffer(self.rfile.read(length), dtype="<f4")
            if not sample_rate // 2 <= len(samples) <= sample_rate * 10:
                raise ValueError("Send between 0.5 and 10 seconds of audio.")
            with inference_lock:
                response = classify(samples, sample_rate, model)
            self.send_json(200, response)
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except Exception as error:
            self.send_json(500, {"error": str(error)})

    def do_transcribe(self, parsed):
        global asr_model, asr_processor
        try:
            sample_rate = int(parse_qs(parsed.query).get("sample_rate", [""])[0])
            length = int(self.headers.get("Content-Length", "0"))
            if not 8_000 <= sample_rate <= 96_000 or not 0 < length <= 24_000_000 or length % 4:
                raise ValueError("Mono-float32-PCM mit 8–96 kHz und höchstens 24 MB senden.")
            samples = np.frombuffer(self.rfile.read(length), dtype="<f4")
            if not sample_rate // 4 <= len(samples) <= sample_rate * 60:
                raise ValueError("Bitte zwischen 0,25 und 60 Sekunden Audio senden.")
            # ponytail: one local transcription at a time; add a queue only for shared production use.
            with asr_lock:
                if asr_model is None:
                    from transformers import AutoProcessor, WhisperForConditionalGeneration

                    asr_processor = AutoProcessor.from_pretrained(ASR_MODEL_ID)
                    asr_model = WhisperForConditionalGeneration.from_pretrained(ASR_MODEL_ID).eval()
                text = transcribe(samples, sample_rate, asr_processor, asr_model)
            self.send_json(200, {"model": ASR_MODEL_ID, "language": "de", "text": text})
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except Exception as error:
            self.send_json(500, {"error": f"Lokale Transkription fehlgeschlagen: {error}"})

    def do_PUT(self):
        if not self.memory_route("PUT"):
            self.send_error(404)

    def do_DELETE(self):
        if not self.memory_route("DELETE"):
            self.send_error(404)

    def do_tts(self):
        global tts_model
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if self.headers.get_content_type() != "application/json" or not 0 < length <= 8000:
                raise ValueError("Eine JSON-Anfrage mit höchstens 8.000 Bytes senden.")
            voice, text = validate_tts(json.loads(self.rfile.read(length)))
        except (ValueError, UnicodeDecodeError) as error:
            self.send_json(400, {"error": str(error)})
            return
        # ponytail: one synthesis at a time for this local lab; queue jobs if shared use is needed.
        if not tts_lock.acquire(blocking=False):
            self.send_json(503, {"error": "Supertonic lädt oder erzeugt noch eine Stimmprobe. Bitte kurz warten und erneut versuchen."})
            return
        try:
            if tts_model is None:
                from supertonic import TTS

                tts_model = TTS(model="supertonic-3", model_dir=ROOT / ".cache" / "supertonic3", auto_download=True)
            audio = synthesize_tts(tts_model, voice, text)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(audio)
        except (BrokenPipeError, ConnectionResetError):
            pass  # The browser stopped or left the voices tab.
        except Exception as error:
            self.send_json(500, {"error": f"Supertonic konnte nicht vorlesen: {error}"})
        finally:
            tts_lock.release()

    def log_message(self, message, *args):
        print(f"{self.address_string()} - {message % args}")


def main():
    parser = ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8088)
    parser.add_argument("--promptfoo-port", type=int, default=15500)
    parser.add_argument("--data-dir", type=Path, default=DATA_ROOT)
    parser.add_argument("--skip-tone-model", action="store_true", help="Do not load emotion2vec (useful for memory-demo tests).")
    args = parser.parse_args()
    if not 1 <= args.promptfoo_port <= 65535 or args.promptfoo_port == args.port:
        parser.error("--promptfoo-port must be 1–65535 and different from --port")
    try:
        server = ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=ROOT))
    except OSError as error:
        if error.errno == errno.EADDRINUSE:
            parser.error(f"Port {args.port} wird bereits verwendet. Den alten Laborserver beenden oder mit --port einen anderen Port wählen.")
        raise
    server.promptfoo = PromptfooViewer(args.promptfoo_port)
    server.data_root = args.data_dir.resolve()

    def stop_server(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop_server)
    try:
        server.promptfoo.start()
        if not args.skip_tone_model:
            print(f"Loading {MODEL_ID} in the background; the first run downloads about 1.12 GB…")
            Thread(target=load_model, daemon=True).start()
        print(f"Tonumo evaluation: http://{args.host}:{args.port}")
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        server.promptfoo.close()


if __name__ == "__main__":
    main()
