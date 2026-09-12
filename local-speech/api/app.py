import asyncio
import contextlib
import io
import json
import os
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
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from mlx_audio.tts.utils import load_model
from pydantic import BaseModel, Field


OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
DEFAULT_STT_MODEL = os.getenv("STT_MODEL", "mlx-community/whisper-large-v3-turbo-asr-fp16")
DEFAULT_CHAT_MODEL = os.getenv("CHAT_MODEL", "qwen3.5:2b")
DEFAULT_TTS_MODEL = os.getenv("TTS_MODEL", "mlx-community/Kokoro-82M-8bit")
MAX_AUDIO_BYTES = 25 * 1024 * 1024
LIVE_WINDOW_SECONDS = 4
DB_PATH = Path(os.getenv("PROFILE_DB", Path(__file__).with_name("sound_flux.db")))
ONBOARDING_QUESTIONS = (
    ("name", "Name", "Personal", "What should I call you?"),
    ("birth_year", "Birth year", "Personal", "What year were you born?"),
    ("mood", "Mood", "Session", "How are you feeling today?"),
    ("music_preferences", "Music preferences", "Music", "What music, artists, or instruments do you enjoy?"),
)

SYSTEM_INSTRUCTIONS = """You are Sound Flux, a warm musical companion.
Use only known preferences and never infer medical facts. Answer the user's actual request first.
Profile questions are optional: never demand missing details; invite at most one when it fits naturally.
If interrupted, stop. Answer in one short sentence, at most 18 words."""


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


@asynccontextmanager
async def lifespan(app: FastAPI):
    model = await asyncio.to_thread(load_model, DEFAULT_TTS_MODEL)
    await asyncio.to_thread(synthesize_tts, model, "Ready.", "af_heart")
    app.state.tts_model = model
    yield


app = FastAPI(title="Sound Flux Voice API", version="0.1.0", lifespan=lifespan)
cancel_events: dict[str, asyncio.Event] = {}
active_processes: defaultdict[str, set[asyncio.subprocess.Process]] = defaultdict(set)
active_chat_tasks: dict[str, asyncio.Task] = {}
tts_lock = asyncio.Lock()


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4_000)


class ChatRequest(BaseModel):
    turn_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    message: str = Field(min_length=1, max_length=4_000)
    history: list[Message] = Field(default_factory=list, max_length=12)
    profile: list[str] = Field(default_factory=list, max_length=12)
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
        """)
        connection.execute(
            """UPDATE profile_properties
               SET value = substr(value, 1, instr(value || ' ', ' ') - 1), updated_at = CURRENT_TIMESTAMP
               WHERE key = 'name' AND instr(trim(value), ' ') > 0"""
        )


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
        return [dict(row) | {"category": categories[row["key"]], "is_profile_property": bool(row["is_profile_property"])} for row in connection.execute(
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


def clear_persisted_data() -> None:
    with database() as connection:
        connection.executescript("DELETE FROM profile_properties; DELETE FROM interactions; DELETE FROM chat_history;")


def clear_chat_history() -> None:
    with database() as connection:
        connection.executescript("DELETE FROM interactions; DELETE FROM chat_history;")


def profile_state() -> dict:
    properties = profile_properties()
    values = {item["key"]: item["value"] for item in properties}
    pending = next((
        {"key": key, "label": label, "category": category, "question": question}
        for key, label, category, question in ONBOARDING_QUESTIONS if key not in values
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
    return {"greeting": greeting, "properties": properties, "onboarding": pending}


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
        save_profile_property("music_preferences", music.group(1).strip())


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
    await run_process(
        turn_id, sys.executable, "-m", "mlx_audio.stt.generate", "--model", DEFAULT_STT_MODEL,
        "--audio", str(wav), "--format", "json", "--output-path", str(output_base),
    )
    return transcript_text(json.loads(output_base.with_suffix(".json").read_text()))


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


@app.get("/v1/history")
async def get_history():
    return {"items": chat_history()}


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
    sample_rate = 48_000
    audio = bytearray()
    changed = asyncio.Event()
    stopped = asyncio.Event()

    async def recognize():
        last_size = 0
        with tempfile.TemporaryDirectory() as directory:
            directory_path = Path(directory)
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
                text = await transcribe_pcm(turn_id, directory_path, window, sample_rate)
                await websocket.send_json({"type": "partial", "text": text})
            if audio:
                text = await transcribe_pcm(turn_id, directory_path, bytes(audio), sample_rate)
                await websocket.send_json({"type": "final", "text": text})

    async def recognize_with_errors():
        try:
            await recognize()
        except HTTPException as error:
            await websocket.send_json({"type": "error", "detail": error.detail})
        except Exception as error:
            await websocket.send_json({"type": "error", "detail": str(error)})

    recognizer = asyncio.create_task(recognize_with_errors())
    normal_stop = False
    try:
        while True:
            message = await websocket.receive()
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
                    if not 8_000 <= sample_rate <= 96_000:
                        raise ValueError("Unsupported sample rate")
                if payload.get("type") == "stop":
                    normal_stop = True
                    stopped.set()
                    changed.set()
                    break
    except (WebSocketDisconnect, ValueError, json.JSONDecodeError):
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
        wav = directory_path / "input.wav"
        output_base = directory_path / "transcript"
        await run_process(
            current_turn, "ffmpeg", "-y", "-i", str(source), "-ar", "16000", "-ac", "1",
            "-c:a", "pcm_s16le", str(wav),
        )
        await run_process(
            current_turn, sys.executable, "-m", "mlx_audio.stt.generate", "--model", DEFAULT_STT_MODEL,
            "--audio", str(wav), "--format", "json", "--output-path", str(output_base),
        )
        payload = json.loads(output_base.with_suffix(".json").read_text())
    return {"turn_id": current_turn, "text": transcript_text(payload), "segments": payload.get("segments", [])}


@app.post("/v1/chat")
async def chat(request: ChatRequest):
    event = event_for(request.turn_id)
    if event.is_set():
        raise HTTPException(409, "Turn interrupted")
    apply_profile_updates(request.message)
    record_interaction("user", request.message)
    saved_profile = [f"- {item['label']}: {item['value']}" for item in profile_properties()]
    missing = [label for key, label, _, _ in ONBOARDING_QUESTIONS if key not in {item["key"] for item in profile_properties()}]
    profile = "\n".join([*saved_profile, *[f"- {item}" for item in request.profile]]) or "No saved profile items."
    messages = [
        {"role": "system", "content": f"{SYSTEM_INSTRUCTIONS}\n\nProfile:\n{profile}\n\nOptional missing profile fields: {', '.join(missing) or 'none'}"},
        *[message.model_dump() for message in request.history],
        {"role": "user", "content": request.message},
    ]
    started_at = time.perf_counter()

    async def stream():
        active_chat_tasks[request.turn_id] = asyncio.current_task()
        answer = []
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
                    yield f"event: done\ndata: {json.dumps({'turn_id': request.turn_id})}\n\n"
        except asyncio.CancelledError:
            return
        except httpx.HTTPError as error:
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
    async with tts_lock:
        audio = await asyncio.to_thread(synthesize_tts, app.state.tts_model, request.text, request.voice)
    if event.is_set():
        raise HTTPException(409, "Turn interrupted")
    cancel_events.pop(request.turn_id, None)
    return Response(audio, media_type="audio/wav", headers={"X-Turn-ID": request.turn_id})


@app.post("/v1/turns/{turn_id}/interrupt")
async def interrupt(turn_id: str):
    return {"turn_id": turn_id, "interrupted": await stop_turn(turn_id)}
