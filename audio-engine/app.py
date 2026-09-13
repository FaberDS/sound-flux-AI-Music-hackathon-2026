import io
import json
import math
import os
import re
import threading
import uuid
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
ASSETS = Path(__file__).resolve().parent / "assets"
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
    if saved_settings().get("use_default"):
        message = "Default audio ready. Generation is disabled."
        setup["message"] = message
        return {"ready": True, "message": message, "model": MODEL_ID, "setup": setup, "studio_url": str(request.base_url)}
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


def asset_names():
    return sorted(path.name for path in ASSETS.glob("*") if path.is_file() and not path.name.startswith("."))


def default_audio_path(options: Options):
    if options.default_file not in asset_names():
        raise ValueError("The selected default audio file is unavailable.")
    return ASSETS / options.default_file


def composition_path(identifier: str):
    if not re.fullmatch(r"[0-9]{8}T[0-9]{12}Z-[0-9]+", identifier):
        raise HTTPException(404, "Composition not found.")
    return COMPOSITIONS / f"{identifier}.wav"


def base_composition_path(identifier: str):
    return COMPOSITIONS / f"{identifier}.base.wav"


def effects_path(identifier: str):
    return COMPOSITIONS / f"{identifier}.effects.json"


def effects_audio_path(identifier: str):
    return COMPOSITIONS / f"{identifier}.effects.wav"


def delete_composition_files(identifier: str):
    for path in (
        composition_path(identifier),
        base_composition_path(identifier),
        effects_path(identifier),
        effects_audio_path(identifier),
    ):
        path.unlink(missing_ok=True)


def composition_effects(identifier: str):
    try:
        values = json.loads(effects_path(identifier).read_text())
    except (FileNotFoundError, json.JSONDecodeError, TypeError):
        return []
    if not isinstance(values, list):
        return []
    return [
        value | {"volume": float(value.get("volume", 1))} for value in values
        if isinstance(value, dict)
        and isinstance(value.get("id"), str)
        and isinstance(value.get("at"), (int, float))
        and not isinstance(value.get("at"), bool)
        and math.isfinite(value["at"])
        and value.get("effect") in {"piano", "guitar", "bells", "drum"}
        and isinstance(value.get("intensity"), (int, float))
        and not isinstance(value.get("intensity"), bool)
        and math.isfinite(value["intensity"])
        and 0.1 <= value["intensity"] <= 1
        and isinstance(value.get("volume", 1), (int, float))
        and not isinstance(value.get("volume", 1), bool)
        and math.isfinite(value.get("volume", 1))
        and 0 <= value.get("volume", 1) <= 1
        and value.get("pitch") in {"low", "high"}
    ]


def render_composition_effects(identifier: str, effects: list[dict]):
    path = composition_path(identifier)
    base = base_composition_path(identifier)
    if not base.is_file():
        os.link(path, base)
    samples, rate = sf.read(base, dtype="float32", always_2d=True)
    effect_samples = np.zeros_like(samples)
    for effect in effects:
        instrument = effect["effect"]
        sound_length = 0.4 if instrument == "drum" else 1.2
        length = round(sound_length * rate)
        time = np.arange(length, dtype=np.float32) / rate
        midi = (72 if effect["pitch"] == "high" else 60) + (12 if instrument == "bells" else 0)
        frequency = 440 * 2 ** ((midi - 69) / 12)
        phase = (
            2 * np.pi * (145 * time - 50 / 0.4 * time**2)
            if instrument == "drum"
            else 2 * np.pi * frequency * time
        )
        wave = (2 / np.pi) * np.arcsin(np.sin(phase)) if instrument == "guitar" else np.sin(phase)
        if instrument == "bells":
            wave += 0.18 * np.sin(phase * 2.76)
        strength = (0.12 + 0.2 * effect["intensity"]) * effect["volume"]
        envelope = np.minimum(time / 0.012, 1) * np.exp(-7 * time / sound_length) * strength
        start = round(effect["at"] * rate)
        effect_samples[(start + np.arange(length)) % len(samples)] += (wave * envelope)[:, None]
    temporary = path.with_suffix(".partial.wav")
    sf.write(temporary, np.clip(samples + effect_samples, -0.99, 0.99), rate, format="WAV", subtype="PCM_16")
    temporary.replace(path)
    effect_audio = effects_audio_path(identifier)
    effect_temporary = effect_audio.with_suffix(".partial.wav")
    sf.write(effect_temporary, np.clip(effect_samples, -0.99, 0.99), rate, format="WAV", subtype="PCM_16")
    effect_temporary.replace(effect_audio)
    metadata = effects_path(identifier)
    metadata.with_suffix(".partial.json").write_text(json.dumps(effects))
    metadata.with_suffix(".partial.json").replace(metadata)
    return len(samples) / rate


def save_composition(rate, samples, seed):
    COMPOSITIONS.mkdir(exist_ok=True)
    identifier = f"{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}-{seed}"
    path = composition_path(identifier)
    with path.open("xb") as output:
        sf.write(output, samples, rate, format="WAV", subtype="PCM_16")
    os.link(path, base_composition_path(identifier))
    return identifier


@app.get("/api/settings")
def get_settings():
    return asdict(Options(**saved_settings()))


@app.post("/api/settings")
async def save_settings(request: Request):
    try:
        options = Options(**await request.json())
        if options.use_default:
            default_audio_path(options)
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


@app.get("/api/assets")
def assets():
    return asset_names()


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
            "effects": composition_effects(path.stem),
        }
        for path in sorted(COMPOSITIONS.glob("*.wav"), key=lambda path: path.stat().st_mtime, reverse=True)
        if re.fullmatch(r"[0-9]{8}T[0-9]{12}Z-[0-9]+", path.stem)
    ]


@app.delete("/api/compositions", status_code=204)
def delete_compositions():
    with composition_lock:
        identifiers = [
            path.stem
            for path in COMPOSITIONS.glob("*.wav")
            if re.fullmatch(r"[0-9]{8}T[0-9]{12}Z-[0-9]+", path.stem)
        ]
        for identifier in identifiers:
            delete_composition_files(identifier)
    return Response(status_code=204)


@app.get("/api/compositions/{identifier}", name="composition")
def composition(identifier: str):
    path = composition_path(identifier)
    if not path.is_file():
        raise HTTPException(404, "Composition not found.")
    return FileResponse(path, media_type="audio/wav", filename=path.name)


@app.get("/api/compositions/{identifier}/base")
def base_composition(identifier: str):
    path = base_composition_path(identifier)
    if not path.is_file():
        raise HTTPException(404, "Composition not found.")
    return FileResponse(path, media_type="audio/wav", filename=path.name)


@app.get("/api/compositions/{identifier}/effects")
def composition_effect_audio(identifier: str):
    path = effects_audio_path(identifier)
    if not path.is_file():
        source = composition_path(identifier)
        if not source.is_file():
            raise HTTPException(404, "Composition not found.")
        with composition_lock:
            if not path.is_file():
                render_composition_effects(identifier, composition_effects(identifier))
    return FileResponse(path, media_type="audio/wav", filename=path.name)


@app.delete("/api/compositions/{identifier}", status_code=204)
def delete_composition(identifier: str):
    path = composition_path(identifier)
    with composition_lock:
        if not path.is_file():
            raise HTTPException(404, "Composition not found.")
        delete_composition_files(identifier)
    return Response(status_code=204)


@app.post("/api/compositions/{identifier}/effects")
async def add_composition_effect(identifier: str, request: Request):
    try:
        body = await request.json()
        at = body["at"]
        intensity = body["intensity"]
        volume = body.get("volume", 1)
        if (
            isinstance(at, bool)
            or not isinstance(at, (int, float))
            or not math.isfinite(at)
            or body["effect"] not in {"piano", "guitar", "bells", "drum"}
            or isinstance(intensity, bool)
            or not isinstance(intensity, (int, float))
            or not math.isfinite(intensity)
            or not 0.1 <= intensity <= 1
            or isinstance(volume, bool)
            or not isinstance(volume, (int, float))
            or not math.isfinite(volume)
            or not 0 <= volume <= 1
            or body["pitch"] not in {"low", "high"}
        ):
            raise ValueError
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(400, "Choose a valid effect, intensity, volume, pitch, and timestamp.") from exc
    path = composition_path(identifier)
    if not path.is_file():
        raise HTTPException(404, "Composition not found.")

    # ponytail: one local user; use per-composition locks if concurrent editing ever matters.
    with composition_lock:
        duration = sf.info(path).duration
        if not 0 <= at < duration:
            raise HTTPException(400, "Effect time must be inside the composition.")
        effects = [
            *composition_effects(identifier),
            {
                "id": uuid.uuid4().hex,
                "at": float(at),
                "effect": body["effect"],
                "intensity": float(intensity),
                "volume": float(volume),
                "pitch": body["pitch"],
            },
        ]
        effects.sort(key=lambda effect: effect["at"])
        duration = render_composition_effects(identifier, effects)
    return {"duration": duration, "effects": effects}


@app.delete("/api/compositions/{identifier}/effects/{effect_id}")
def delete_composition_effect(identifier: str, effect_id: str):
    path = composition_path(identifier)
    if not path.is_file():
        raise HTTPException(404, "Composition not found.")
    with composition_lock:
        effects = composition_effects(identifier)
        remaining = [effect for effect in effects if effect["id"] != effect_id]
        if len(remaining) == len(effects):
            raise HTTPException(404, "Effect not found.")
        duration = render_composition_effects(identifier, remaining)
    return {"duration": duration, "effects": remaining}


@app.post("/api/compose")
async def generate(audio: UploadFile = File(), settings: str = Form()):
    try:
        if len(settings) > 4096:
            raise ValueError("Generation settings are too long.")
        options = Options(**(saved_settings() | json.loads(settings)))
        if options.use_default:
            with sf.SoundFile(default_audio_path(options)) as handle:
                if handle.channels not in (1, 2):
                    raise ValueError("Default audio must be mono or stereo.")
                rate = handle.samplerate
                result = handle.read(dtype="float32", always_2d=True)
                if handle.channels == 1:
                    result = np.repeat(result, 2, axis=1)
            seed = 0 if options.seed < 0 else options.seed
        else:
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
    if not options.use_default:
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
