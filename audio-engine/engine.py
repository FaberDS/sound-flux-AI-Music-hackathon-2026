import argparse
import math
import os
import secrets
import subprocess
import sys
import tempfile
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

from prepare import exclusive_lock, require_ready

SAMPLE_RATE = 44100
DEFAULT_PROMPT = "Gentle instrumental composition with warm piano, soft acoustic guitar and a light rhythm."


class GenerationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Options:
    prompt: str = DEFAULT_PROMPT
    seconds: float = 15
    strength: float = 0.55
    steps: int = 8
    cfg: float = 2.5
    seed: int = -1
    repeat: bool = True
    negative_prompt: str = ""
    input_mix: float = 0.0
    match_input: bool = False

    def __post_init__(self):
        if not isinstance(self.prompt, str) or not 1 <= len(self.prompt.strip()) <= 2000:
            raise ValueError("Describe the composition using 1 to 2000 characters.")
        if not isinstance(self.negative_prompt, str) or len(self.negative_prompt) > 2000:
            raise ValueError("The negative prompt must be text of at most 2000 characters.")
        for name, low, high in (("seconds", 5, 60), ("strength", 0.1, 0.95), ("cfg", 1, 10), ("input_mix", 0, 1)):
            value = getattr(self, name)
            if not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
                raise ValueError(f"{name} must be between {low} and {high}.")
        for name, low, high in (("steps", 1, 32), ("seed", -1, 2**31 - 1)):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
                raise ValueError(f"{name} must be an integer between {low} and {high}.")
        for name in ("repeat", "match_input"):
            if not isinstance(getattr(self, name), bool):
                raise ValueError(f"{name} must be true or false.")


def prepare_audio(audio, seconds, repeat=True):
    if audio is None:
        raise ValueError("Record or upload 1 to 30 seconds of humming first.")
    rate, samples = audio
    samples = np.asarray(samples)
    if not isinstance(rate, (int, np.integer)) or not 8000 <= rate <= 192000:
        raise ValueError("The input sample rate must be between 8000 and 192000 Hz.")
    if samples.ndim not in (1, 2) or (samples.ndim == 2 and samples.shape[1] not in (1, 2)):
        raise ValueError("Audio must have one or two channels.")
    if not rate <= len(samples) <= 30 * rate:
        raise ValueError("Record or upload 1 to 30 seconds of humming.")
    if np.issubdtype(samples.dtype, np.signedinteger):
        samples = samples.astype(np.float32) / (float(np.iinfo(samples.dtype).max) + 1)
    elif np.issubdtype(samples.dtype, np.floating):
        samples = samples.astype(np.float32)
    else:
        raise ValueError("Audio must contain floating-point or signed PCM samples.")
    if not np.isfinite(samples).all():
        raise ValueError("The recording contains invalid samples. Record it again.")
    if samples.ndim == 1:
        samples = samples[:, None]
    samples = samples - samples.mean(axis=0, keepdims=True)
    rms = float(np.sqrt(np.mean(samples.astype(np.float64) ** 2)))
    if rms < 0.001:
        raise ValueError("The recording is silent or too quiet. Move closer to the microphone and try again.")
    divisor = math.gcd(int(rate), SAMPLE_RATE)
    samples = resample_poly(samples, SAMPLE_RATE // divisor, int(rate) // divisor, axis=0)
    samples *= min(0.15 / rms, 0.9 / float(np.max(np.abs(samples))), 10)
    fade = min(round(0.01 * SAMPLE_RATE), len(samples) // 2)
    ramp = np.linspace(0, 1, fade, dtype=np.float32)[:, None]
    samples[:fade] *= ramp
    samples[-fade:] *= ramp[::-1]
    target = round(seconds * SAMPLE_RATE)
    if len(samples) < target:
        if repeat:
            samples = np.tile(samples, (math.ceil(target / len(samples)), 1))
        else:
            samples = np.pad(samples, ((0, target - len(samples)), (0, 0)))
    samples = samples[:target]
    samples[-fade:] *= ramp[::-1]
    if samples.shape[1] == 1:
        samples = np.repeat(samples, 2, axis=1)
    return samples.astype(np.float32)


def build_command(runtime, source, output, options, seed):
    negative = options.negative_prompt.strip()
    return [
        sys.executable, str(runtime / "scripts" / "sa3_mlx.py"),
        "--dit", "medium", "--decoder", "same-l", "--dit-dtype", "fp16",
        "--prompt", options.prompt.strip(), *(["--negative-prompt", negative] if negative else []),
        "--init-audio", str(source),
        "--init-noise-level", str(options.strength), "--seconds", str(options.seconds),
        "--steps", str(options.steps), "--cfg", str(options.cfg), "--seed", str(seed),
        "--free-models", "--out", str(output),
    ]


def compose(audio, options, progress=lambda value, description: None):
    if options.match_input and audio is not None and audio[0]:
        # Clamped to the 5-60 s model range; the runtime trims to round(seconds * 44100), matching prepare_audio.
        options = replace(options, seconds=min(60, max(5, len(audio[1]) / audio[0])))
    reference = prepare_audio(audio, options.seconds, options.repeat)
    runtime = require_ready()
    seed = secrets.randbelow(2**31) if options.seed == -1 else options.seed
    with exclusive_lock("generation"), tempfile.TemporaryDirectory(prefix="hum-composition-") as folder:
        source, output = Path(folder) / "hum.wav", Path(folder) / "composition.wav"
        sf.write(source, reference, SAMPLE_RATE, subtype="PCM_16")
        progress(0.1, "Encoding your hum and generating the composition on this Mac")
        try:
            subprocess.run(
                build_command(runtime, source, output, options, seed),
                cwd=runtime, check=True, capture_output=True, text=True, timeout=900,
                env=os.environ | {"HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1"},
            )
        except subprocess.TimeoutExpired as exc:
            raise GenerationError("Generation timed out. Try a shorter duration or fewer steps.") from exc
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or "No diagnostic output was returned.").strip()[-2000:]
            raise GenerationError(f"Stable Audio generation failed: {detail}") from exc
        progress(0.95, "Preparing your WAV audio")
        if not output.is_file():
            raise GenerationError("The runtime did not produce an audio file.")
        result, rate = sf.read(output, dtype="float32", always_2d=True)
        if rate != SAMPLE_RATE or result.shape != (round(options.seconds * SAMPLE_RATE), 2):
            raise GenerationError("The runtime returned an unexpected audio length or format.")
        if not np.isfinite(result).all() or np.max(np.abs(result)) < 1e-5:
            raise GenerationError("The runtime returned invalid or silent audio. Try a different seed or strength.")
        if options.input_mix:
            # The exact array the model was conditioned on, so the input stays sample-aligned with the output.
            result = result + options.input_mix * reference
            result *= 0.99 / max(0.99, float(np.max(np.abs(result))))
    progress(1, "Composition ready")
    return rate, result, seed


def main():
    parser = argparse.ArgumentParser(description="Turn a hummed melody into a Stable Audio 3 Medium composition.")
    parser.add_argument("input", type=Path, help="A 1 to 30 second WAV, FLAC, or other libsndfile-supported recording")
    parser.add_argument("--out", type=Path, required=True, help="A new WAV output path")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument("--negative-prompt", default="", help="What to steer away from; needs --cfg above 1")
    parser.add_argument("--seconds", type=float, default=15)
    parser.add_argument("--strength", type=float, default=0.55)
    parser.add_argument("--steps", type=int, default=8)
    parser.add_argument("--cfg", type=float, default=2.5)
    parser.add_argument("--seed", type=int, default=-1)
    parser.add_argument("--no-repeat", action="store_true")
    parser.add_argument("--input-mix", type=float, default=0.0, help="0 to 1: mix the aligned input into the output")
    parser.add_argument("--match-input", action="store_true", help="Generate exactly as long as the input (5 s minimum)")
    args = parser.parse_args()
    try:
        if args.out.suffix.lower() != ".wav" or not args.out.parent.is_dir():
            raise ValueError("Choose a .wav output path in an existing directory.")
        if args.out.exists():
            raise ValueError("The output already exists. Choose a new path to avoid overwriting it.")
        options = Options(args.prompt, args.seconds, args.strength, args.steps, args.cfg, args.seed, not args.no_repeat, args.negative_prompt, args.input_mix, args.match_input)
        with sf.SoundFile(args.input) as handle:
            if not 1 <= handle.frames / handle.samplerate <= 30 or handle.channels not in (1, 2):
                raise ValueError("Input must be 1 to 30 seconds of mono or stereo audio.")
            samples = handle.read(dtype="float32", always_2d=True)
            rate = handle.samplerate
        rate, audio, seed = compose((rate, samples), options, lambda value, text: print(text, flush=True))
        with args.out.open("xb") as handle:
            sf.write(handle, audio, rate, format="WAV", subtype="PCM_16")
        print(f"Saved {args.out.resolve()} (seed {seed})")
    except (OSError, RuntimeError, ValueError) as exc:
        parser.exit(1, f"Error: {exc}\n")


if __name__ == "__main__":
    main()
