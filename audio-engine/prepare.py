import fcntl
import gc
import hashlib
import json
import platform
from contextlib import contextmanager
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache"
MODEL_ID = "aufklarer/Stable-Audio-3-DiT-Medium-MLX-8bit"
MODEL_REVISION = "751de64c000314c0cb29b0fc1ce25e412b49ceca"
RUNTIME_REVISION = "ffaf2826503b3f64ce5378d8510919b0b33615a4"
RUNTIME = CACHE / RUNTIME_REVISION / "optimized" / "mlx"
SOURCE_BASE = f"https://raw.githubusercontent.com/Stability-AI/stable-audio-3/{RUNTIME_REVISION}"
SOURCE_FILES = (
    "models/__init__.py", "models/defs/__init__.py",
    "models/defs/dit_mlx_medium.py", "models/defs/same_l_encoder.py",
    "models/defs/same_l_decoder.py", "models/defs/t5gemma_mlx.py",
    "models/defs/sa3_pipeline.py", "scripts/sa3_mlx.py", "scripts/weights.py",
)
COMPONENTS = {
    "dit_medium": "dit_medium_f16.npz",
    "same_l_encoder": "same_l_encoder_f32.npz",
    "same_l_decoder": "same_l_decoder_f32.npz",
    "t5gemma": "t5gemma_f16.npz",
}
IDENTITY = {"model": MODEL_ID, "model_revision": MODEL_REVISION, "runtime_revision": RUNTIME_REVISION}


def check_platform():
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise RuntimeError("This engine requires macOS on Apple Silicon and Python 3.11 or newer.")


@contextmanager
def exclusive_lock(name):
    CACHE.mkdir(parents=True, exist_ok=True)
    with (CACHE / f"{name}.lock").open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError(f"Another {name} operation is running. Wait for it to finish.") from exc
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def require_ready():
    check_platform()
    marker = RUNTIME / "bundle.json"
    required = [RUNTIME / path for path in SOURCE_FILES]
    required += [RUNTIME / "models" / "mlx" / name for name in COMPONENTS.values()]
    try:
        valid = json.loads(marker.read_text()) == IDENTITY
    except (OSError, ValueError):
        valid = False
    if not valid or not all(path.is_file() for path in required):
        raise RuntimeError("Model setup is incomplete. From audio-engine run: uv run python prepare.py")
    return RUNTIME


def setup_status():
    from huggingface_hub.constants import HF_HUB_CACHE

    busy = False
    lock = CACHE / "setup.lock"
    if lock.exists():
        with lock.open("r") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(handle, fcntl.LOCK_UN)
            except BlockingIOError:
                busy = True
    repository = Path(HF_HUB_CACHE) / f"models--{MODEL_ID.replace('/', '--')}"
    downloaded, total = 0, 0
    for component in COMPONENTS:
        manifest_path = repository / "snapshots" / MODEL_REVISION / component / "manifest.json"
        if not manifest_path.is_file():
            continue
        manifest = json.loads(manifest_path.read_text())
        size = manifest["size_bytes"]
        total += size
        candidates = (repository / "blobs").glob(f"{manifest['sha256']}*")
        sizes = []
        for candidate in candidates:
            try:
                sizes.append(candidate.stat().st_size)
            except FileNotFoundError:
                pass
        downloaded += min(size, max(sizes, default=0))
    converted = sum((RUNTIME / "models" / "mlx" / filename).is_file() for filename in COMPONENTS.values())
    if busy and total and downloaded >= total:
        message = f"Preparing model components ({converted}/{len(COMPONENTS)}). Generation unlocks when setup finishes."
    elif busy:
        message = f"Downloading model weights: {downloaded / 1e9:.2f} / {(total or 5531781681) / 1e9:.2f} GB. Generation unlocks when setup finishes."
    else:
        message = "Model setup is incomplete. Download and prepare the model before generating."
    return {"busy": busy, "downloaded_bytes": downloaded, "total_bytes": total or 5531781681, "converted": converted, "message": message}


def dequantize_weights(weights, mx):
    bases = {key.removesuffix(".scales") for key in weights if key.endswith(".scales")}
    result = {}
    for base in bases:
        if not all(f"{base}.{suffix}" in weights for suffix in ("weight", "scales", "biases")):
            raise ValueError(f"Incomplete quantized weight triplet: {base}")
    for key, value in weights.items():
        base, _, suffix = key.rpartition(".")
        if base in bases:
            if suffix in ("scales", "biases"):
                continue
            if suffix == "weight":
                value = mx.dequantize(
                    value, weights[f"{base}.scales"], weights[f"{base}.biases"],
                    group_size=64, bits=8,
                ).astype(mx.float16)
        result[key] = value
    return result


def prepare():
    check_platform()
    with exclusive_lock("setup"):
        try:
            require_ready()
            print("Stable Audio 3 Medium MLX is already prepared.")
            return
        except RuntimeError:
            pass
        import mlx.core as mx
        import numpy as np
        from huggingface_hub import snapshot_download

        if not mx.metal.is_available():
            raise RuntimeError("MLX cannot access Metal. Run on an Apple Silicon Mac with Metal enabled.")
        print(f"Downloading pinned runtime {RUNTIME_REVISION}.", flush=True)
        downloads = [(f"optimized/mlx/{name}", RUNTIME / name) for name in SOURCE_FILES]
        downloads.append(("LICENSE", CACHE / RUNTIME_REVISION / "LICENSE"))
        for source, target in downloads:
            if target.is_file():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with urlopen(f"{SOURCE_BASE}/{source}", timeout=60) as response:
                content = response.read()
            temporary = target.with_suffix(target.suffix + ".partial")
            temporary.write_bytes(content)
            temporary.replace(target)
        print(f"Downloading {MODEL_ID} (~5.53 GB); conversion needs ~7 GB more disk space.", flush=True)
        print("Weights: Stability AI Community License; T5Gemma also uses Gemma Terms of Use.", flush=True)
        bundle = Path(snapshot_download(
            MODEL_ID, revision=MODEL_REVISION,
            allow_patterns=[f"{component}/*" for component in COMPONENTS] + ["README.md"],
        ))
        destination = RUNTIME / "models" / "mlx"
        destination.mkdir(parents=True, exist_ok=True)
        for component, filename in COMPONENTS.items():
            target = destination / filename
            if target.is_file():
                continue
            source = bundle / component / "model.safetensors"
            manifest = json.loads((source.parent / "manifest.json").read_text())
            print(f"Checking and converting {component}.", flush=True)
            with source.open("rb") as handle:
                checksum = hashlib.file_digest(handle, "sha256").hexdigest()
            if checksum != manifest["sha256"]:
                raise RuntimeError(f"Checksum mismatch for {component}. The cached download is corrupt.")
            weights = dequantize_weights(dict(mx.load(str(source))), mx)
            if component == "t5gemma" and not {"META", "TOKENIZER_MODEL"}.issubset(weights):
                raise RuntimeError("The bundle is missing the T5Gemma configuration or tokenizer.")
            temporary = target.with_suffix(".partial")
            with temporary.open("wb") as handle:
                np.savez(handle, **{key: np.asarray(value) for key, value in weights.items()})
            temporary.replace(target)
            del weights
            gc.collect()
            mx.clear_cache()
        marker = RUNTIME / "bundle.json"
        marker.write_text(json.dumps(IDENTITY, indent=2) + "\n")
        require_ready()
        print("Ready. Start the local interface: uv run python app.py", flush=True)


if __name__ == "__main__":
    prepare()
