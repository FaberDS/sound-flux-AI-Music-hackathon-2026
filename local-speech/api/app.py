import asyncio
import contextlib
import json
import os
import sys
import tempfile
import uuid
import wave
from collections import defaultdict
from pathlib import Path
from typing import Annotated, Literal

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field


OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
DEFAULT_STT_MODEL = os.getenv("STT_MODEL", "mlx-community/whisper-large-v3-turbo-asr-fp16")
DEFAULT_CHAT_MODEL = os.getenv("CHAT_MODEL", "qwen3.5:2b")
DEFAULT_TTS_MODEL = os.getenv("TTS_MODEL", "mlx-community/Kokoro-82M-8bit")
MAX_AUDIO_BYTES = 25 * 1024 * 1024
LIVE_WINDOW_SECONDS = 4

SYSTEM_INSTRUCTIONS = """You are Sound Flux, a calm musical companion.
Give short, concrete suggestions that invite musical expression. Respect a user's
stated preferences and accessibility needs, but do not infer diagnoses or medical
facts from movement. If the user says stop, pause, or interrupts, stop the current
activity and ask what they want next. Never invent memories; use only the supplied
profile and conversation. Keep spoken answers to two sentences unless asked for more."""

app = FastAPI(title="Sound Flux Voice API", version="0.1.0")
cancel_events: dict[str, asyncio.Event] = {}
active_processes: defaultdict[str, set[asyncio.subprocess.Process]] = defaultdict(set)
active_chat_tasks: dict[str, asyncio.Task] = {}


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
    }


@app.get("/")
async def index():
    return FileResponse(Path(__file__).with_name("index.html"))


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
    profile = "\n".join(f"- {item}" for item in request.profile) or "No saved profile items."
    messages = [
        {"role": "system", "content": f"{SYSTEM_INSTRUCTIONS}\n\nProfile:\n{profile}"},
        *[message.model_dump() for message in request.history],
        {"role": "user", "content": request.message},
    ]

    async def stream():
        active_chat_tasks[request.turn_id] = asyncio.current_task()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(120, read=None)) as client:
                async with client.stream(
                    "POST", OLLAMA_URL,
                    json={"model": request.model, "messages": messages, "stream": True, "think": False, "keep_alive": "30m"},
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
                            yield f"event: token\ndata: {json.dumps({'turn_id': request.turn_id, 'text': token})}\n\n"
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
    with tempfile.TemporaryDirectory() as directory:
        await run_process(
            request.turn_id, sys.executable, "-m", "mlx_audio.tts.generate",
            "--model", DEFAULT_TTS_MODEL, "--text", request.text, "--voice", request.voice,
            "--output_path", directory,
        )
        audio_files = sorted(Path(directory).glob("*.wav"))
        if not audio_files:
            raise HTTPException(500, "TTS produced no audio")
        audio = audio_files[0].read_bytes()
    cancel_events.pop(request.turn_id, None)
    return Response(audio, media_type="audio/wav", headers={"X-Turn-ID": request.turn_id})


@app.post("/v1/turns/{turn_id}/interrupt")
async def interrupt(turn_id: str):
    return {"turn_id": turn_id, "interrupted": await stop_turn(turn_id)}
