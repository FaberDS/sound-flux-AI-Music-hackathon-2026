import asyncio
import contextlib
import io
import json
import logging
import os
import random
import re
import sqlite3
import sys
import tempfile
import time
import uuid
import wave
from collections import defaultdict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal

import httpx
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from mlx_audio.stt.generate import generate_transcription
from mlx_audio.stt.utils import load_model as load_stt_model
from mlx_audio.tts.utils import load_model
from pydantic import BaseModel, Field


logger = logging.getLogger("uvicorn.error")


OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
MUSICBRAINZ_URL = "https://musicbrainz.org/ws/2/recording"
DEFAULT_STT_MODEL = os.getenv("STT_MODEL", "mlx-community/whisper-large-v3-turbo-asr-fp16")
DEFAULT_CHAT_MODEL = os.getenv("CHAT_MODEL", "qwen3.5:2b")
DEFAULT_TTS_MODEL = os.getenv("TTS_MODEL", "mlx-community/Kokoro-82M-8bit")
MAX_AUDIO_BYTES = 25 * 1024 * 1024
LIVE_WINDOW_SECONDS = 4
LIVE_TRANSCRIPTION_TIMEOUT_SECONDS = 45
DB_PATH = Path(os.getenv("PROFILE_DB", Path(__file__).with_name("sound_flux.db")))
ONBOARDING_QUESTIONS = (
    ("name", "Name", "Personal", "What should I call you?"),
    ("birth_year", "Birth year", "Personal", "What year were you born?"),
    ("mood", "Mood", "Session", "How are you feeling today?"),
    ("music_preferences", "Music preferences", "Music", "What music do you enjoy?"),
    ("played_instrument", "Played an instrument", "Musical ability", "Did you ever play an instrument?"),
    ("can_whistle", "Can whistle", "Musical ability", "Can you whistle?"),
    ("childhood_song", "Childhood song", "Music & memories", "Is there a song that reminds you of your childhood?"),
    ("strong_memory_song", "Strong memory song", "Music & memories", "Is there a song that brings back a particularly strong memory?"),
)
ONBOARDING_FLOW_KEYS = (
    "name", "birth_year", "music_preferences",
)
DEBUG_ONBOARDING_VALUES = {
    "name": "Alex",
    "birth_year": "1950",
    "mood": "calm",
    "played_instrument": "Piano",
    "can_whistle": "Yes",
    "childhood_song": "Moon River",
    "strong_memory_song": "Amazing Grace",
}

SYSTEM_INSTRUCTIONS = """You are Sound Flux, a warm musical companion.
The current year is 2026.
Use only known preferences and never infer medical facts. Answer the user's actual request first.
Profile questions are optional: never demand missing details; invite at most one when it fits naturally.
If interrupted, stop. Answer in one short sentence, at most 18 words."""
ONBOARDING_FOLLOW_UPS = {
    "name": (
        "Thank you, {name}. What year were you born?",
        "Lovely to meet you, {name}. Which year were you born?",
        "Thank you, {name}. May I ask what year you were born?",
    ),
    "birth_year": "What music do you enjoy?",
    "music_preferences": "Wonderful. Let's do some music.",
}
MEMORABLE_ITEM_QUESTION = {"key": "memorable_item", "label": "Memorable item", "category": "Memories", "question": "What would you like to remember: a person, a song, or a movie?"}


def synthesize_tts(model, text: str, voice: str) -> bytes:
    result = next(iter(model.generate(
        text=text, voice=voice, speed=1.0, lang_code="en", temperature=0.7,
        verbose=False, stream=False, streaming_interval=2.0, instruct=None,
        use_zero_spk_emb=False, max_tokens=1200,
    )))
    pcm = (np.clip(np.asarray(result.audio), -1, 1) * 32767).astype("<i2")
    with io.BytesIO() as output:
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(result.sample_rate)
            wav.writeframes(pcm.tobytes())
        return output.getvalue()


def transcribe_wav(model, wav: Path, output_base: Path) -> tuple[str, list[dict]]:
    result = generate_transcription(
        model=model,
        audio=str(wav),
        output_path=str(output_base),
        format="json",
        language="en",
    )
    return transcript_text({"text": result.text}), result.segments or []


@asynccontextmanager
async def lifespan(app: FastAPI):
    tts_model = await asyncio.to_thread(load_model, DEFAULT_TTS_MODEL)
    await asyncio.to_thread(synthesize_tts, tts_model, "Ready.", "af_heart")
    app.state.tts_model = tts_model
    app.state.stt_model = await asyncio.to_thread(load_stt_model, DEFAULT_STT_MODEL)
    yield


app = FastAPI(title="Sound Flux Voice API", version="0.1.0", lifespan=lifespan)
cancel_events: dict[str, asyncio.Event] = {}
active_processes: defaultdict[str, set[asyncio.subprocess.Process]] = defaultdict(set)
active_chat_tasks: dict[str, asyncio.Task] = {}
tts_lock = asyncio.Lock()
stt_lock = asyncio.Lock()
# ponytail: global request lock; per-user throttling if this becomes multi-user.
musicbrainz_lock = asyncio.Lock()
musicbrainz_last_request = 0.0


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4_000)


class ChatRequest(BaseModel):
    turn_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    message: str = Field(min_length=1, max_length=4_000)
    history: list[Message] = Field(default_factory=list, max_length=12)
    profile: list[str] = Field(default_factory=list, max_length=12)
    onboarding_key: str | None = Field(default=None, max_length=40)
    model: str = DEFAULT_CHAT_MODEL


class SpeechRequest(BaseModel):
    turn_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    text: str = Field(min_length=1, max_length=2_000)
    voice: str = "af_heart"


class ProfileUpdate(BaseModel):
    value: str = Field(min_length=1, max_length=500)


def database() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database() -> None:
    with database() as connection:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS profile_properties (
                key TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                value TEXT NOT NULL,
                is_profile_property INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS interactions (
                id INTEGER PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                role TEXT NOT NULL,
                content TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chat_history (
                id INTEGER PRIMARY KEY,
                turn_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                user TEXT NOT NULL,
                model TEXT NOT NULL,
                assistant TEXT NOT NULL,
                duration_ms INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS memorable_items (
                id INTEGER PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                kind TEXT NOT NULL,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS music_preferences (
                id INTEGER PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                value TEXT NOT NULL COLLATE NOCASE UNIQUE
            );
        """)
        connection.execute(
            """UPDATE profile_properties
               SET value = substr(value, 1, instr(value || ' ', ' ') - 1), updated_at = CURRENT_TIMESTAMP
               WHERE key = 'name' AND instr(trim(value), ' ') > 0"""
        )
        legacy_preferences = connection.execute(
            "SELECT value FROM profile_properties WHERE key IN ('music_preferences', 'favorite_genre')"
        ).fetchall()
        for row in legacy_preferences:
            for value in split_music_preferences(row["value"]):
                connection.execute("INSERT OR IGNORE INTO music_preferences (value) VALUES (?)", (value,))
        connection.execute("DELETE FROM profile_properties WHERE key IN ('music_preferences', 'favorite_genre')")


def save_profile_property(key: str, value: str) -> None:
    labels = {question_key: label for question_key, label, _, _ in ONBOARDING_QUESTIONS}
    if key not in labels:
        raise HTTPException(404, "Unknown profile property")
    value = value.strip().split(maxsplit=1)[0] if key == "name" else value.strip()
    with database() as connection:
        connection.execute(
            """INSERT INTO profile_properties (key, label, value, updated_at)
               VALUES (?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP""",
            (key, labels[key], value),
        )


def profile_properties() -> list[dict]:
    categories = {key: category for key, _, category, _ in ONBOARDING_QUESTIONS}
    with database() as connection:
        return [dict(row) | {"category": categories.get(row["key"], "Profile"), "is_profile_property": bool(row["is_profile_property"])} for row in connection.execute(
            "SELECT key, label, value, is_profile_property, updated_at FROM profile_properties ORDER BY label"
        )]


def record_interaction(role: str, content: str) -> None:
    with database() as connection:
        connection.execute("INSERT INTO interactions (role, content) VALUES (?, ?)", (role, content))


def record_chat(turn_id: str, user: str, model: str, assistant: str, duration_ms: int) -> None:
    with database() as connection:
        connection.execute(
            "INSERT INTO chat_history (turn_id, user, model, assistant, duration_ms) VALUES (?, ?, ?, ?, ?)",
            (turn_id, user, model, assistant, duration_ms),
        )


def chat_history() -> list[dict]:
    with database() as connection:
        return [dict(row) for row in connection.execute(
            "SELECT turn_id, created_at, user, model, assistant, duration_ms FROM chat_history ORDER BY id DESC"
        )]


def memorable_items() -> list[dict]:
    with database() as connection:
        return [dict(row) for row in connection.execute(
            "SELECT id, created_at, kind, value FROM memorable_items ORDER BY id DESC"
        )]


def split_music_preferences(text: str) -> list[str]:
    return [value.strip(" .") for value in re.split(r"\s*(?:,|/|\band\b|\bor\b)\s*", text, flags=re.I) if value.strip(" .")]


def music_preferences() -> list[dict]:
    with database() as connection:
        return [dict(row) for row in connection.execute("SELECT id, created_at, value FROM music_preferences ORDER BY value")]


def record_music_preferences(text: str) -> None:
    with database() as connection:
        for value in split_music_preferences(text):
            connection.execute("INSERT OR IGNORE INTO music_preferences (value) VALUES (?)", (value,))


def musicbrainz_results(payload: dict) -> list[dict]:
    results, seen = [], set()
    for recording in payload.get("recordings", []):
        title = recording.get("title", "").strip()
        artist = "".join(f"{credit.get('name', '')}{credit.get('joinphrase', '')}" for credit in recording.get("artist-credit", [])).strip()
        if not title or not artist or (title.casefold(), artist.casefold()) in seen:
            continue
        seen.add((title.casefold(), artist.casefold()))
        results.append({"title": title, "artist": artist})
        if len(results) == 3:
            break
    return results


async def search_musicbrainz(query: str) -> list[dict]:
    global musicbrainz_last_request
    async with musicbrainz_lock:
        wait = 1 - (time.monotonic() - musicbrainz_last_request)
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get(
                    MUSICBRAINZ_URL,
                    params={"query": query, "fmt": "json", "limit": 8},
                    headers={"User-Agent": "SoundFlux-local/0.1", "Accept": "application/json"},
                )
                response.raise_for_status()
                return musicbrainz_results(response.json())
        except httpx.HTTPError:
            return []
        finally:
            musicbrainz_last_request = time.monotonic()


def is_song_request(text: str) -> bool:
    return bool(re.search(r"\b(?:recommend|suggest|find|play|looking for|what song|which song)\b", text, re.I))


def is_play_music_request(text: str) -> bool:
    return bool(re.search(r"\b(?:let'?s|lets|can we|i want to)\s+(?:play|make|do)\b[^.!?]{0,40}\bmusic\b", text, re.I))


def next_onboarding_key(key: str | None) -> str | None:
    if key not in ONBOARDING_FLOW_KEYS:
        return None
    index = ONBOARDING_FLOW_KEYS.index(key)
    return ONBOARDING_FLOW_KEYS[index + 1] if index + 1 < len(ONBOARDING_FLOW_KEYS) else None


def music_search_query(text: str) -> str:
    genre = re.search(r"\b(jazz|rock|pop|blues|folk|country|metal|electronic|classical|hip[ -]?hop)\b", text, re.I)
    return genre.group() if genre else text


def record_memorable_item(text: str) -> None:
    kind_match = re.search(r"\b(person|song|movie|film)\b", text, re.I)
    kind = "movie" if kind_match and kind_match.group(1).lower() == "film" else (kind_match.group(1).lower() if kind_match else "other")
    value = re.sub(r"^\s*(?:a|the)?\s*(?:person|song|movie|film)\s*(?:called|named)?\s*", "", text, flags=re.I).strip() or text.strip()
    with database() as connection:
        connection.execute("INSERT INTO memorable_items (kind, value) VALUES (?, ?)", (kind, value))


def clear_persisted_data() -> None:
    with database() as connection:
        connection.executescript("DELETE FROM profile_properties; DELETE FROM interactions; DELETE FROM chat_history; DELETE FROM memorable_items; DELETE FROM music_preferences;")


def clear_chat_history() -> None:
    with database() as connection:
        connection.executescript("DELETE FROM interactions; DELETE FROM chat_history;")


def preseed_onboarding() -> dict:
    for key, value in DEBUG_ONBOARDING_VALUES.items():
        save_profile_property(key, value)
    record_music_preferences("Jazz, Classical")
    return profile_state()


def profile_state() -> dict:
    properties = profile_properties()
    values = {item["key"]: item["value"] for item in properties}
    preferences = music_preferences()
    question_by_key = {key: (label, category, question) for key, label, category, question in ONBOARDING_QUESTIONS}
    pending = next((
        {"key": key, "label": question_by_key[key][0], "category": question_by_key[key][1], "question": onboarding_question(key, question_by_key[key][2])}
        for key in ONBOARDING_FLOW_KEYS if (not preferences if key == "music_preferences" else key not in values)
    ), None)
    with database() as connection:
        latest = connection.execute("SELECT created_at FROM interactions ORDER BY id DESC LIMIT 1").fetchone()
        short_break = latest and connection.execute(
            "SELECT (julianday('now') - julianday(?)) * 86400 < 600", (latest["created_at"],)
        ).fetchone()[0]
    greeting = "Welcome today." if latest is None else (
        "Welcome back after a short break." if short_break else "Welcome back."
    )
    if values.get("name"):
        greeting = greeting.rstrip(".") + f", {values['name']}."
    questions = {key: {"key": key, "label": label, "category": category, "question": question} for key, label, category, question in ONBOARDING_QUESTIONS}
    questions["memorable_item"] = MEMORABLE_ITEM_QUESTION
    return {"greeting": greeting, "properties": properties, "music_preferences": preferences, "memorable_items": memorable_items(), "onboarding": pending, "questions": questions, "auto_start_onboarding": pending is not None}


def apply_profile_updates(text: str) -> None:
    lower = text.lower()
    if "born" in lower or "birth year" in lower:
        year = re.search(r"\b(?:18|19|20)\d{2}\b", text)
        if year:
            save_profile_property("birth_year", year.group())
    name = re.search(r"\b(?:my name is|call me)\s+([A-Za-z][A-Za-z'-]*(?:\s+(?!and\b|but\b|i['’]m\b)[A-Za-z][A-Za-z'-]*)?)", text, re.I)
    if name:
        save_profile_property("name", name.group(1).strip())
    mood = re.search(r"\b(?:i feel|i am feeling|i'm feeling|my mood is)\s+([^.!?]{1,80})", text, re.I)
    if mood:
        save_profile_property("mood", mood.group(1).strip())
    music = re.search(r"\bmy (?:favorite|favourite) (?:music|artist|song|instrument) is\s+([^.!?]{1,100})", text, re.I)
    music = music or re.search(
        r"\bi (?:like|love|prefer|enjoy)\s+(music|jazz|classical|rock|pop|blues|folk|country|metal|electronic|hip[ -]?hop)\b",
        text,
        re.I,
    )
    if music:
        record_music_preferences(music.group(1).strip())


def onboarding_question(key: str, fallback: str) -> str:
    if key == "name":
        return random.choice((
            "What should I call you?",
            "What name would you like me to use?",
            "How would you like me to address you?",
        ))
    return fallback


def apply_onboarding_answer(key: str | None, text: str) -> None:
    answer = text.strip()
    if is_skip_answer(answer):
        return
    if key == "name" and not re.search(r"\b(?:my name is|call me)\b", answer, re.I):
        name = re.match(r"[A-Za-z][A-Za-z'-]{0,40}", answer)
        if name and name.group().lower() not in {"hello", "hi", "hey"}:
            save_profile_property("name", name.group())
    if key == "birth_year":
        year = re.search(r"\b(?:18|19|20)\d{2}\b", answer)
        if year:
            save_profile_property("birth_year", year.group())
    if key == "music_preferences" and answer:
        record_music_preferences(answer)
    if key in {"played_instrument", "can_whistle", "childhood_song", "strong_memory_song"} and answer:
        save_profile_property(key, answer)
    if key == "memorable_item" and answer:
        record_memorable_item(answer)


def is_skip_answer(text: str) -> bool:
    return bool(re.search(r"\b(?:skip|done|not now|no thanks|don't know|no preference)\b", text, re.I))


initialize_database()


def event_for(turn_id: str) -> asyncio.Event:
    return cancel_events.setdefault(turn_id, asyncio.Event())


async def stop_turn(turn_id: str) -> bool:
    event = cancel_events.get(turn_id)
    if event is None:
        return False
    event.set()
    task = active_chat_tasks.get(turn_id)
    if task and task is not asyncio.current_task():
        task.cancel()
    for process in tuple(active_processes.get(turn_id, ())):
        if process.returncode is None:
            process.terminate()
    logger.info("[turn %s] interrupted=%s", turn_id, event is not None)
    return True


async def run_process(turn_id: str, *command: str) -> tuple[bytes, bytes]:
    event = event_for(turn_id)
    if event.is_set():
        raise HTTPException(409, "Turn interrupted")
    process = await asyncio.create_subprocess_exec(
        *command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    active_processes[turn_id].add(process)
    try:
        stdout, stderr = await process.communicate()
    except asyncio.CancelledError:
        process.terminate()
        await process.communicate()
        raise
    finally:
        active_processes[turn_id].discard(process)

    if event.is_set():
        raise HTTPException(409, "Turn interrupted")
    if process.returncode:
        detail = stderr.decode(errors="replace").strip()[-800:]
        raise HTTPException(500, detail or f"Command failed: {command[0]}")
    return stdout, stderr


def transcript_text(payload: dict) -> str:
    if isinstance(payload.get("text"), str):
        return payload["text"].strip()
    if isinstance(payload.get("transcription"), str):
        return payload["transcription"].strip()
    return " ".join(segment.get("text", "").strip() for segment in payload.get("segments", [])).strip()


def write_pcm_wav(path: Path, pcm: bytes, sample_rate: int) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(pcm)


async def transcribe_pcm(turn_id: str, directory: Path, pcm: bytes, sample_rate: int) -> str:
    source = directory / f"{uuid.uuid4().hex}.wav"
    wav = directory / f"{uuid.uuid4().hex}-16k.wav"
    output_base = directory / uuid.uuid4().hex
    write_pcm_wav(source, pcm, sample_rate)
    await run_process(
        turn_id, "ffmpeg", "-y", "-i", str(source), "-ar", "16000", "-ac", "1",
        "-c:a", "pcm_s16le", str(wav),
    )
    async with stt_lock:
        text, _ = await asyncio.to_thread(transcribe_wav, app.state.stt_model, wav, output_base)
        return text


@app.get("/health")
async def health():
    return {
        "stt_model": DEFAULT_STT_MODEL,
        "chat_model": DEFAULT_CHAT_MODEL,
        "tts_model": DEFAULT_TTS_MODEL,
        "profile_properties": len(profile_properties()),
    }


@app.get("/")
async def index():
    initial_state = json.dumps(profile_state()).replace("<", "\\u003c")
    html = Path(__file__).with_name("index.html").read_text().replace("__INITIAL_STATE__", initial_state)
    return HTMLResponse(html)


@app.get("/v1/profile")
async def get_profile():
    return profile_state()


@app.put("/v1/profile/{key}")
async def update_profile(key: str, update: ProfileUpdate):
    save_profile_property(key, update.value)
    record_interaction("user", f"{key}: {update.value.strip()}")
    return profile_state()


@app.post("/v1/debug/preseed-onboarding")
async def preseed_debug_onboarding():
    return preseed_onboarding()


@app.get("/v1/history")
async def get_history():
    return {"items": chat_history()}


@app.get("/v1/music/search")
async def search_music(query: Annotated[str, Query(min_length=1, max_length=120)]):
    return {"items": await search_musicbrainz(query)}


@app.delete("/v1/history")
async def clear_history():
    clear_chat_history()
    return {"items": []}


@app.delete("/v1/data")
async def clear_data():
    clear_persisted_data()
    return profile_state()


@app.websocket("/v1/live/{turn_id}")
async def live_transcription(websocket: WebSocket, turn_id: str):
    await websocket.accept()
    logger.info("[turn %s] live socket accepted", turn_id)
    sample_rate = 48_000
    audio = bytearray()
    changed = asyncio.Event()
    stopped = asyncio.Event()

    async def recognize():
        last_size = 0
        last_text = ""
        with tempfile.TemporaryDirectory() as directory:
            directory_path = Path(directory)

            async def transcribe_live(pcm: bytes, stage: str) -> str:
                started = time.perf_counter()
                logger.info("[turn %s] live %s transcription started bytes=%d", turn_id, stage, len(pcm))
                try:
                    text = await asyncio.wait_for(
                        transcribe_pcm(turn_id, directory_path, pcm, sample_rate),
                        timeout=LIVE_TRANSCRIPTION_TIMEOUT_SECONDS,
                    )
                except asyncio.TimeoutError as error:
                    logger.warning(
                        "[turn %s] live %s transcription timed out after %ss",
                        turn_id, stage, LIVE_TRANSCRIPTION_TIMEOUT_SECONDS,
                    )
                    raise HTTPException(504, "Speech recognition took too long. Please try again.") from error
                logger.info(
                    "[turn %s] live %s transcription completed chars=%d elapsed=%.2fs",
                    turn_id, stage, len(text), time.perf_counter() - started,
                )
                return text

            while not stopped.is_set():
                await changed.wait()
                changed.clear()
                await asyncio.sleep(0.75)
                if stopped.is_set():
                    break
                if len(audio) == last_size:
                    continue
                last_size = len(audio)
                window = bytes(audio[-sample_rate * 2 * LIVE_WINDOW_SECONDS:])
                if len(window) < sample_rate * 2:
                    continue
                text = await transcribe_live(window, "partial")
                last_text = text
                await websocket.send_json({"type": "partial", "text": text})
            if audio:
                # For a short utterance, return the latest live result instead of launching
                # Whisper again after Stop. This keeps the name-question handoff responsive.
                if last_text and len(audio) <= sample_rate * 2 * LIVE_WINDOW_SECONDS:
                    text = last_text
                    logger.info("[turn %s] live final reused partial chars=%d", turn_id, len(text))
                else:
                    text = await transcribe_live(bytes(audio), "final")
                logger.info("[turn %s] live final bytes=%d text=%r", turn_id, len(audio), text)
                await websocket.send_json({"type": "final", "text": text})

    async def recognize_with_errors():
        try:
            await recognize()
        except HTTPException as error:
            logger.warning("[turn %s] live transcription error: %s", turn_id, error.detail)
            await websocket.send_json({"type": "error", "detail": error.detail})
        except Exception as error:
            logger.exception("[turn %s] live transcription failed", turn_id)
            await websocket.send_json({"type": "error", "detail": str(error)})

    recognizer = asyncio.create_task(recognize_with_errors())
    normal_stop = False
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                logger.info("[turn %s] live socket disconnected", turn_id)
                stopped.set()
                break
            if message.get("bytes"):
                chunk = message["bytes"]
                if len(audio) + len(chunk) > MAX_AUDIO_BYTES:
                    await websocket.send_json({"type": "error", "detail": "Audio is limited to 25 MB"})
                    break
                audio.extend(chunk)
                changed.set()
                continue
            if message.get("text"):
                payload = json.loads(message["text"])
                if payload.get("type") == "start":
                    sample_rate = int(payload.get("sample_rate", sample_rate))
                    logger.info("[turn %s] live started sample_rate=%d", turn_id, sample_rate)
                    if not 8_000 <= sample_rate <= 96_000:
                        raise ValueError("Unsupported sample rate")
                if payload.get("type") == "stop":
                    normal_stop = True
                    logger.info("[turn %s] live stopped bytes=%d", turn_id, len(audio))
                    stopped.set()
                    changed.set()
                    break
    except (WebSocketDisconnect, RuntimeError, ValueError, json.JSONDecodeError):
        logger.warning("[turn %s] live socket disconnected or sent invalid data", turn_id)
        stopped.set()
    finally:
        stopped.set()
        changed.set()
        if not normal_stop:
            recognizer.cancel()
        with contextlib.suppress(asyncio.CancelledError, HTTPException, RuntimeError):
            await recognizer
        if normal_stop:
            # The final transcript immediately starts chat with this same turn ID.
            cancel_events.pop(turn_id, None)
            logger.info("[turn %s] live handoff complete", turn_id)
        else:
            await stop_turn(turn_id)


@app.post("/v1/transcriptions")
async def transcribe(
    audio: Annotated[UploadFile, File(...)],
    language: Annotated[str, Form()] = "auto",
    turn_id: Annotated[str, Form()] = "",
):
    suffix = Path(audio.filename or "audio.webm").suffix or ".webm"
    current_turn = turn_id or uuid.uuid4().hex
    with tempfile.TemporaryDirectory() as directory:
        directory_path = Path(directory)
        source = directory_path / f"input{suffix}"
        with source.open("wb") as output:
            while chunk := await audio.read(1_048_576):
                if output.tell() + len(chunk) > MAX_AUDIO_BYTES:
                    raise HTTPException(413, "Audio is limited to 25 MB")
                output.write(chunk)
        wav = directory_path / "normalized.wav"
        output_base = directory_path / "transcript"
        await run_process(
            current_turn, "ffmpeg", "-y", "-i", str(source), "-ar", "16000", "-ac", "1",
            "-c:a", "pcm_s16le", str(wav),
        )
        async with stt_lock:
            text, segments = await asyncio.to_thread(transcribe_wav, app.state.stt_model, wav, output_base)
    return {"turn_id": current_turn, "text": text, "segments": segments}


@app.post("/v1/chat")
async def chat(request: ChatRequest):
    event = event_for(request.turn_id)
    if event.is_set():
        raise HTTPException(409, "Turn interrupted")
    if is_play_music_request(request.message):
        answer = "Wonderful. Let's play some music."
        logger.info("[turn %s] entering play mode", request.turn_id)
        record_interaction("user", request.message)

        async def play_mode_stream():
            record_interaction("assistant", answer)
            record_chat(request.turn_id, request.message, "play_mode", answer, 0)
            yield f"event: mode\ndata: {json.dumps({'value': 'play'})}\n\n"
            yield f"event: token\ndata: {json.dumps({'turn_id': request.turn_id, 'text': answer})}\n\n"
            yield f"event: done\ndata: {json.dumps({'turn_id': request.turn_id})}\n\n"
            cancel_events.pop(request.turn_id, None)

        return StreamingResponse(play_mode_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
    apply_profile_updates(request.message)
    apply_onboarding_answer(request.onboarding_key, request.message)
    logger.info(
        "[turn %s] chat received onboarding=%r message=%r",
        request.turn_id,
        request.onboarding_key,
        request.message,
    )
    record_interaction("user", request.message)
    follow_up = None if request.onboarding_key == "memorable_item" and is_skip_answer(request.message) else ONBOARDING_FOLLOW_UPS.get(request.onboarding_key)
    if isinstance(follow_up, tuple):
        follow_up = random.choice(follow_up)
    if request.onboarding_key == "name" and follow_up:
        name = next((item["value"] for item in profile_properties() if item["key"] == "name"), "")
        follow_up = follow_up.format(name=name) if name else "Thank you. What year were you born?"
    if follow_up:
        logger.info("[turn %s] onboarding follow-up=%r", request.turn_id, follow_up)
        async def onboarding_stream():
            record_interaction("assistant", follow_up)
            record_chat(request.turn_id, request.message, "onboarding", follow_up, 0)
            next_key = next_onboarding_key(request.onboarding_key)
            yield f"event: onboarding\ndata: {json.dumps({'key': next_key})}\n\n"
            yield f"event: token\ndata: {json.dumps({'turn_id': request.turn_id, 'text': follow_up})}\n\n"
            yield f"event: done\ndata: {json.dumps({'turn_id': request.turn_id})}\n\n"
            cancel_events.pop(request.turn_id, None)
            logger.info("[turn %s] onboarding follow-up streamed", request.turn_id)

        return StreamingResponse(onboarding_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
    songs = await search_musicbrainz(music_search_query(request.message)) if is_song_request(request.message) else []
    saved_profile = [f"- {item['label']}: {item['value']}" for item in profile_properties()]
    if preferences := music_preferences():
        saved_profile.append(f"- Music preferences: {', '.join(item['value'] for item in preferences)}")
    missing = [label for key, label, _, _ in ONBOARDING_QUESTIONS if key not in {item["key"] for item in profile_properties()}]
    profile = "\n".join([*saved_profile, *[f"- {item}" for item in request.profile]]) or "No saved profile items."
    song_context = "\n".join(f'- "{song["title"]}" — {song["artist"]}' for song in songs)
    messages = [
        {"role": "system", "content": f"{SYSTEM_INSTRUCTIONS}\n\nProfile:\n{profile}\n\nOptional missing profile fields: {', '.join(missing) or 'none'}\n\nMusicBrainz matches:\n{song_context or 'None'}\nWhen matches are available, suggest up to three and name the credited artist for every song."},
        *[message.model_dump() for message in request.history],
        {"role": "user", "content": request.message},
    ]
    started_at = time.perf_counter()

    async def stream():
        active_chat_tasks[request.turn_id] = asyncio.current_task()
        answer = []
        logger.info("[turn %s] model request started model=%s", request.turn_id, request.model)
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(120, read=None)) as client:
                async with client.stream(
                    "POST", OLLAMA_URL,
                    json={
                        "model": request.model, "messages": messages, "stream": True,
                        "think": False, "keep_alive": "30m",
                        "options": {"num_predict": 48, "num_ctx": 2048},
                    },
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if event.is_set():
                            return
                        if not line:
                            continue
                        payload = json.loads(line)
                        token = payload.get("message", {}).get("content", "")
                        if token:
                            answer.append(token)
                            yield f"event: token\ndata: {json.dumps({'turn_id': request.turn_id, 'text': token})}\n\n"
                    if answer and not event.is_set():
                        assistant = "".join(answer)
                        record_interaction("assistant", assistant)
                        record_chat(request.turn_id, request.message, request.model, assistant, round((time.perf_counter() - started_at) * 1000))
                        logger.info("[turn %s] model response completed chars=%d", request.turn_id, len(assistant))
                    yield f"event: done\ndata: {json.dumps({'turn_id': request.turn_id})}\n\n"
        except asyncio.CancelledError:
            logger.info("[turn %s] model request cancelled", request.turn_id)
            return
        except httpx.HTTPError as error:
            logger.warning("[turn %s] model request failed: %s", request.turn_id, error)
            yield f"event: error\ndata: {json.dumps({'detail': str(error)})}\n\n"
        finally:
            active_chat_tasks.pop(request.turn_id, None)
            cancel_events.pop(request.turn_id, None)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/v1/speech")
async def speech(request: SpeechRequest):
    event = event_for(request.turn_id)
    if event.is_set():
        raise HTTPException(409, "Turn interrupted")
    logger.info("[turn %s] speech started chars=%d", request.turn_id, len(request.text))
    async with tts_lock:
        audio = await asyncio.to_thread(synthesize_tts, app.state.tts_model, request.text, request.voice)
    if event.is_set():
        raise HTTPException(409, "Turn interrupted")
    cancel_events.pop(request.turn_id, None)
    logger.info("[turn %s] speech completed bytes=%d", request.turn_id, len(audio))
    return Response(audio, media_type="audio/wav", headers={"X-Turn-ID": request.turn_id})


@app.post("/v1/turns/{turn_id}/interrupt")
async def interrupt(turn_id: str):
    return {"turn_id": turn_id, "interrupted": await stop_turn(turn_id)}
