import io
import json
import math
import os
import re
import threading
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware

from engine import Options, compose
from prepare import MODEL_ID, prepare, require_ready, setup_status

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
setup_run = {"active": False, "error": None}
WEB = Path(__file__).resolve().parent / "web"
SETTINGS = Path(__file__).resolve().parent / "settings.json"
AUDIO = Path(__file__).resolve().parent / "audio"
COMPOSITIONS = Path(__file__).resolve().parent / "compositions"
MAX_UPLOAD = 25 * 1024 * 1024
composition_lock = threading.Lock()
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1"])


@app.middleware("http")
async def local_requests(request: Request, call_next):
    if request.method == "POST":
        origin = request.headers.get("origin")
        expected = f"{request.url.scheme}://{request.headers.get('host', '')}"
        if origin and origin != expected:
            return JSONResponse({"detail": "Cross-origin requests are not allowed."}, status_code=403)
        try:
            length = int(request.headers.get("content-length", "0"))
        except ValueError:
            length = 0
        if not 0 < length <= MAX_UPLOAD + 8192:
            return JSONResponse({"detail": "Upload a recording smaller than 25 MB."}, status_code=413)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; "
        "img-src 'self' data:; media-src 'self' blob:; worker-src 'self'; "
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    )
    return response


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")


@app.get("/api/status")
def status(request: Request):
    setup = setup_status()
    setup["busy"] = setup["busy"] or setup_run["active"]
    try:
        require_ready()
        ready, message = True, "Model ready. Everything runs on this Mac."
        setup["message"] = message
    except RuntimeError as exc:
        ready = False
        message = setup_run["error"] or (setup["message"] if setup["busy"] else str(exc))
    return {"ready": ready, "message": message, "model": MODEL_ID, "setup": setup, "studio_url": str(request.base_url)}


def run_setup():
    try:
        prepare()
    except Exception as exc:
        setup_run["error"] = f"Model setup failed: {exc}"
    finally:
        setup_run["active"] = False


@app.post("/api/setup", status_code=202)
async def start_setup(tasks: BackgroundTasks):
    if not setup_run["active"] and not setup_status()["busy"]:
        setup_run.update(active=True, error=None)
        tasks.add_task(run_setup)
    return {"message": "Model setup is running. The studio will show download progress."}


def saved_settings():
    try:
        return json.loads(SETTINGS.read_text())
    except FileNotFoundError:
        return {}


def composition_path(identifier: str):
    if not re.fullmatch(r"[0-9]{8}T[0-9]{12}Z-[0-9]+", identifier):
        raise HTTPException(404, "Composition not found.")
    return COMPOSITIONS / f"{identifier}.wav"


def beat_path(identifier: str):
    return COMPOSITIONS / f"{identifier}.beats.json"


def composition_beats(identifier: str):
    try:
        values = json.loads(beat_path(identifier).read_text())
        return [value for value in values if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0]
    except (FileNotFoundError, json.JSONDecodeError, TypeError):
        return []


def save_composition(rate, samples, seed):
    COMPOSITIONS.mkdir(exist_ok=True)
    identifier = f"{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}-{seed}"
    path = composition_path(identifier)
    with path.open("xb") as output:
        sf.write(output, samples, rate, format="WAV", subtype="PCM_16")
    return identifier


@app.get("/api/settings")
def get_settings():
    return asdict(Options(**saved_settings()))


@app.post("/api/settings")
async def save_settings(request: Request):
    try:
        options = Options(**await request.json())
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc
    temporary = SETTINGS.with_suffix(".partial")
    temporary.write_text(json.dumps(asdict(options), indent=2) + "\n")
    temporary.replace(SETTINGS)
    return asdict(options)


@app.get("/api/samples")
def samples():
    # ponytail: the browser decodes these (m4a, mp3, wav...), so the server only lists and serves them.
    return sorted(path.name for path in AUDIO.glob("*") if path.is_file() and not path.name.startswith("."))


@app.get("/api/compositions")
def compositions():
    if not COMPOSITIONS.exists():
        return []
    return [
        {
            "id": path.stem,
            "created_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
            "url": f"/api/compositions/{path.stem}",
            "duration": sf.info(path).duration,
            "beats": composition_beats(path.stem),
        }
        for path in sorted(COMPOSITIONS.glob("*.wav"), key=lambda path: path.stat().st_mtime, reverse=True)
        if re.fullmatch(r"[0-9]{8}T[0-9]{12}Z-[0-9]+", path.stem)
    ]


@app.get("/api/compositions/{identifier}", name="composition")
def composition(identifier: str):
    path = composition_path(identifier)
    if not path.is_file():
        raise HTTPException(404, "Composition not found.")
    return FileResponse(path, media_type="audio/wav", filename=path.name)


@app.post("/api/compositions/{identifier}/beats")
async def add_composition_beat(identifier: str, request: Request):
    try:
        body = await request.json()
        at = body["at"]
        if isinstance(at, bool) or not isinstance(at, (int, float)) or not math.isfinite(at):
            raise ValueError
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(400, "Beat time must be a finite number.") from exc
    path = composition_path(identifier)
    if not path.is_file():
        raise HTTPException(404, "Composition not found.")

    # ponytail: one local user; use per-composition locks if concurrent editing ever matters.
    with composition_lock:
        samples, rate = sf.read(path, dtype="float32", always_2d=True)
        duration = len(samples) / rate
        if not 0 <= at < duration:
            raise HTTPException(400, "Beat time must be inside the composition.")
        length = round(0.4 * rate)
        time = np.arange(length, dtype=np.float32) / rate
        phase = 2 * np.pi * (145 * time - 50 / 0.4 * time**2)
        envelope = np.minimum(time / 0.012, 1) * np.exp(-7 * time / 0.4) * 0.32
        start = round(at * rate)
        samples[(start + np.arange(length)) % len(samples)] += (np.sin(phase) * envelope)[:, None]
        samples = np.clip(samples, -0.99, 0.99)
        temporary = path.with_suffix(".partial.wav")
        sf.write(temporary, samples, rate, format="WAV", subtype="PCM_16")
        temporary.replace(path)
        beats = sorted([*composition_beats(identifier), float(at)])
        metadata = beat_path(identifier)
        metadata.with_suffix(".partial.json").write_text(json.dumps(beats))
        metadata.with_suffix(".partial.json").replace(metadata)
    return {"duration": duration, "beats": beats}


@app.post("/api/compose")
async def generate(audio: UploadFile = File(), settings: str = Form()):
    try:
        if len(settings) > 4096:
            raise ValueError("Generation settings are too long.")
        options = Options(**(saved_settings() | json.loads(settings)))
        payload = await audio.read(MAX_UPLOAD + 1)
        if len(payload) > MAX_UPLOAD:
            raise ValueError("Upload a recording smaller than 25 MB.")
        with sf.SoundFile(io.BytesIO(payload)) as handle:
            if not 1 <= handle.frames / handle.samplerate <= 30 or handle.channels not in (1, 2):
                raise ValueError("Upload 1 to 30 seconds of mono or stereo audio.")
            rate = handle.samplerate
            samples = handle.read(dtype="float32", always_2d=True)
    except (TypeError, ValueError, sf.LibsndfileError) as exc:
        raise HTTPException(400, str(exc)) from exc
    finally:
        await audio.close()
    try:
        rate, result, seed = await run_in_threadpool(compose, (rate, samples), options)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    identifier = save_composition(rate, result, seed)
    output = io.BytesIO()
    sf.write(output, result, rate, format="WAV", subtype="PCM_16")
    return Response(
        output.getvalue(), media_type="audio/wav",
        headers={
            "Content-Disposition": f'attachment; filename="{identifier}.wav"',
            "X-Generation-Seed": str(seed),
            "X-Composition-ID": identifier,
        },
    )


app.mount("/static", StaticFiles(directory=WEB), name="static")
app.mount("/samples", StaticFiles(directory=AUDIO, check_dir=False), name="samples")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=7860, access_log=False)
