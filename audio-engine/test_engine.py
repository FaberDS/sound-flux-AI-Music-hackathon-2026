import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import soundfile as sf

from engine import GenerationError, Options, build_command, compose, prepare_audio
from prepare import COMPONENTS, MODEL_ID, MODEL_REVISION, dequantize_weights, require_ready


def hum(rate=48000, seconds=2):
    t = np.arange(round(rate * seconds)) / rate
    return rate, (0.15 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def echo_reference(command, gain=1):
    audio, rate = sf.read(command[command.index("--init-audio") + 1])
    sf.write(command[command.index("--out") + 1], gain * audio, rate, subtype="PCM_16")
    return subprocess.CompletedProcess(command, 0, "", "")


class AudioTests(unittest.TestCase):
    def test_resamples_mono_to_exact_stereo_duration(self):
        audio = prepare_audio(hum(), 5, repeat=True)
        self.assertEqual(audio.shape, (220500, 2))
        self.assertEqual(audio.dtype, np.float32)
        np.testing.assert_array_equal(audio[:, 0], audio[:, 1])
        self.assertLessEqual(np.max(np.abs(audio)), 0.9)
        spectrum = np.abs(np.fft.rfft(audio[1000:45100, 0]))
        self.assertAlmostEqual(np.argmax(spectrum), 220, delta=1)

    def test_repeat_keeps_reference_beyond_original_hum(self):
        audio = prepare_audio(hum(), 5, repeat=True)
        self.assertGreater(np.std(audio[3 * 44100:4 * 44100]), 0.01)

    def test_no_repeat_pads_with_silence(self):
        audio = prepare_audio(hum(), 5, repeat=False)
        np.testing.assert_array_equal(audio[2 * 44100:], 0)

    def test_pcm16_stereo_input_is_supported(self):
        rate, mono = hum()
        pcm = np.stack([mono, mono], axis=1)
        pcm = (pcm * 32767).astype(np.int16)
        audio = prepare_audio((rate, pcm), 5, repeat=True)
        self.assertTrue(np.isfinite(audio).all())
        self.assertLessEqual(np.max(np.abs(audio)), 0.9)

    def test_rejects_missing_silent_invalid_and_long_audio(self):
        cases = [
            None, (44100, np.zeros(44100)), (44100, np.full(44100, np.nan)),
            (44100, np.full(44100, np.inf)), (0, np.ones(44100)),
            (44100, np.ones((44100, 3))), (44100, np.ones((2, 2, 2))),
            hum(seconds=0.1), hum(seconds=31),
        ]
        for audio in cases:
            with self.subTest(audio=None if audio is None else np.shape(audio[1])):
                with self.assertRaises(ValueError):
                    prepare_audio(audio, 5, repeat=True)


class OptionsTests(unittest.TestCase):
    def test_invalid_options_fail_before_loading_models(self):
        cases = [
            {"prompt": " "}, {"prompt": "x" * 2001}, {"seconds": 0},
            {"seconds": 61}, {"seconds": float("nan")}, {"strength": 0},
            {"strength": 1}, {"strength": float("nan")}, {"steps": 0},
            {"steps": 2.5}, {"seed": -2}, {"seed": 2**31}, {"cfg": 0},
            {"negative_prompt": None}, {"negative_prompt": "x" * 2001},
            {"input_mix": -0.1}, {"input_mix": 1.5},
        ]
        for change in cases:
            with self.subTest(change=change), self.assertRaises(ValueError):
                Options(**({"prompt": "Gentle piano"} | change))

    def test_command_uses_medium_same_l_and_audio_conditioning(self):
        options = Options(prompt="Piano; $(echo untouched)", seconds=5, strength=0.55)
        command = build_command(Path("/runtime"), Path("/hum.wav"), Path("/out.wav"), options, 42)
        self.assertEqual(command[command.index("--dit") + 1], "medium")
        self.assertEqual(command[command.index("--decoder") + 1], "same-l")
        self.assertEqual(command[command.index("--init-audio") + 1], "/hum.wav")
        self.assertEqual(command[command.index("--init-noise-level") + 1], "0.55")
        self.assertIn(options.prompt, command)
        self.assertIn("--free-models", command)
        self.assertNotIn("--negative-prompt", command)
        negative = build_command(Path("/runtime"), Path("/hum.wav"), Path("/out.wav"), Options(prompt="Piano", negative_prompt=" drums, vocals "), 42)
        self.assertEqual(negative[negative.index("--negative-prompt") + 1], "drums, vocals")


class PreparationTests(unittest.TestCase):
    def test_correct_bundle_and_required_components(self):
        self.assertEqual(MODEL_ID, "aufklarer/Stable-Audio-3-DiT-Medium-MLX-8bit")
        self.assertEqual(len(MODEL_REVISION), 40)
        self.assertEqual(set(COMPONENTS), {"dit_medium", "same_l_encoder", "same_l_decoder", "t5gemma"})

    def test_missing_setup_fails_without_download(self):
        with tempfile.TemporaryDirectory() as folder, patch("prepare.RUNTIME", Path(folder)):
            with self.assertRaisesRegex(RuntimeError, "prepare.py"):
                require_ready()

    def test_download_progress_does_not_double_count_retried_files(self):
        import json
        from prepare import setup_status
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            repository = root / f"models--{MODEL_ID.replace('/', '--')}"
            manifest = repository / "snapshots" / MODEL_REVISION / "dit_medium" / "manifest.json"
            manifest.parent.mkdir(parents=True)
            manifest.write_text(json.dumps({"sha256": "abcd", "size_bytes": 100}))
            blobs = repository / "blobs"
            blobs.mkdir()
            (blobs / "abcd.old.incomplete").write_bytes(b"x" * 20)
            (blobs / "abcd.new.incomplete").write_bytes(b"x" * 60)
            with patch("huggingface_hub.constants.HF_HUB_CACHE", folder), patch("prepare.CACHE", root), patch("prepare.COMPONENTS", {"dit_medium": "dit.npz"}):
                status = setup_status()
            self.assertEqual(status["downloaded_bytes"], 60)
            self.assertEqual(status["total_bytes"], 100)

    def test_dequantization_preserves_metadata_and_codec_precision(self):
        class FakeMLX:
            float16 = np.float16

            @staticmethod
            def dequantize(weight, scales, biases, *, group_size, bits):
                self.assertEqual((group_size, bits), (64, 8))
                return weight.astype(np.float32) * scales + biases

        weights = {
            "layer.weight": np.array([1, 2], dtype=np.uint32),
            "layer.scales": np.array([0.5], dtype=np.float16),
            "layer.biases": np.array([1.0], dtype=np.float16),
            "codec.weight": np.array([0.123456789], dtype=np.float32),
            "META": np.array([123, 125], dtype=np.uint8),
            "TOKENIZER_MODEL": np.array([4, 5], dtype=np.uint8),
        }
        result = dequantize_weights(weights, FakeMLX)
        np.testing.assert_array_equal(result["layer.weight"], [1.5, 2])
        self.assertEqual(result["layer.weight"].dtype, np.float16)
        self.assertEqual(result["codec.weight"].dtype, np.float32)
        self.assertIs(result["META"], weights["META"])
        self.assertIs(result["TOKENIZER_MODEL"], weights["TOKENIZER_MODEL"])
        self.assertNotIn("layer.scales", result)
        self.assertNotIn("layer.biases", result)


class GenerationTests(unittest.TestCase):
    @patch("engine.require_ready", return_value=Path("/runtime"))
    @patch("engine.subprocess.run")
    def test_generation_receives_reference_and_cleans_temporary_files(self, run, ready):
        paths = []

        def generate(command, **kwargs):
            self.assertTrue(kwargs["check"])
            self.assertEqual(kwargs["env"]["HF_HUB_OFFLINE"], "1")
            self.assertNotIn("shell", kwargs)
            source = Path(command[command.index("--init-audio") + 1])
            output = Path(command[command.index("--out") + 1])
            paths.extend([source, output])
            audio, rate = sf.read(source)
            self.assertEqual((rate, audio.shape), (44100, (220500, 2)))
            sf.write(output, audio, rate, subtype="PCM_16")
            return subprocess.CompletedProcess(command, 0, "", "")

        run.side_effect = generate
        rate, audio, seed = compose(hum(), Options(prompt="Warm acoustic piano", seconds=5, seed=42))
        self.assertEqual((rate, audio.shape, seed), (44100, (220500, 2), 42))
        self.assertTrue(all(not path.exists() for path in paths))

    @patch("engine.require_ready", return_value=Path("/runtime"))
    @patch("engine.subprocess.run")
    def test_input_mix_adds_the_aligned_reference_without_clipping(self, run, ready):
        run.side_effect = lambda command, **kwargs: echo_reference(command, gain=4)
        _, result, _ = compose(hum(), Options(prompt="Piano", seconds=5, seed=42, input_mix=1))
        mixed = 5 * prepare_audio(hum(), 5)
        self.assertGreater(np.max(np.abs(mixed)), 0.99)
        np.testing.assert_allclose(result, mixed * 0.99 / np.max(np.abs(mixed)), atol=1e-3)

    @patch("engine.require_ready", return_value=Path("/runtime"))
    @patch("engine.subprocess.run")
    def test_match_input_uses_recording_length_within_model_limits(self, run, ready):
        run.side_effect = lambda command, **kwargs: echo_reference(command)
        for seconds, samples in ((7.5, 330750), (2, 220500)):
            with self.subTest(seconds=seconds):
                _, result, _ = compose(hum(seconds=seconds), Options(prompt="Piano", seconds=60, seed=42, match_input=True))
                self.assertEqual(result.shape, (samples, 2))

    @patch("engine.require_ready", return_value=Path("/runtime"))
    @patch("engine.subprocess.run", side_effect=subprocess.CalledProcessError(1, "sa3", stderr="Model failure"))
    def test_runtime_error_is_actionable(self, run, ready):
        with self.assertRaisesRegex(GenerationError, "Model failure"):
            compose(hum(), Options(prompt="Piano", seconds=5))

    @patch("engine.require_ready", return_value=Path("/runtime"))
    @patch("engine.subprocess.run", side_effect=subprocess.TimeoutExpired("sa3", 900))
    def test_runtime_timeout_is_actionable(self, run, ready):
        with self.assertRaisesRegex(GenerationError, "timed out"):
            compose(hum(), Options(prompt="Piano", seconds=5))


class InterfaceTests(unittest.TestCase):
    def setUp(self):
        import io
        from fastapi.testclient import TestClient
        from app import app, setup_run
        setup_run.update(active=False, error=None)
        setup_patch = patch("app.setup_status", return_value={"busy": False, "downloaded_bytes": 0, "total_bytes": 100, "message": "Setup required"})
        self.setup = setup_patch.start()
        self.addCleanup(setup_patch.stop)
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        settings_patch = patch("app.SETTINGS", Path(folder.name) / "settings.json")
        settings_patch.start()
        self.addCleanup(settings_patch.stop)
        compositions_patch = patch("app.COMPOSITIONS", Path(folder.name) / "compositions")
        compositions_patch.start()
        self.addCleanup(compositions_patch.stop)
        self.client = TestClient(app, base_url="http://127.0.0.1")
        buffer = io.BytesIO()
        rate, samples = hum()
        sf.write(buffer, samples, rate, format="WAV", subtype="PCM_16")
        self.upload = {"audio": ("hum.wav", buffer.getvalue(), "audio/wav")}
        self.settings = {"settings": '{"prompt":"Piano","seconds":5,"seed":42}'}

    def tearDown(self):
        self.client.close()

    def test_custom_interface_and_static_assets(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Small hum.", response.text)
        self.assertEqual(response.text.count("<button"), 1)
        self.assertNotIn("<input", response.text)
        self.assertNotIn("<audio", response.text)
        self.assertNotIn('id="generate"', response.text)
        self.assertIn("/static/app.js", response.text)
        self.assertNotIn("gradio", response.text.lower())
        self.assertIn("frame-ancestors 'none'", response.headers["content-security-policy"])
        for name in ("app.js", "style.css", "audio-utils.js", "recorder-worklet.js"):
            self.assertEqual(self.client.get(f"/static/{name}").status_code, 200)
        self.assertEqual(self.client.get("/static/../engine.py").status_code, 404)

    @patch("app.require_ready", side_effect=RuntimeError("Run prepare.py"))
    def test_status_reports_missing_setup_without_downloading(self, ready):
        response = self.client.get("/api/status")
        self.assertFalse(response.json()["ready"])
        self.assertIn("prepare.py", response.json()["message"])

    def test_status_exposes_canonical_studio_origin(self):
        response = self.client.get("/api/status")
        self.assertEqual(response.json()["studio_url"], "http://127.0.0.1/")
        self.assertIn("setup", response.json())

    @patch("app.prepare")
    def test_setup_can_be_started_from_the_web_app(self, prepare_model):
        response = self.client.post("/api/setup", json={})
        self.assertEqual(response.status_code, 202)
        prepare_model.assert_called_once()

    @patch("app.prepare")
    def test_setup_does_not_duplicate_a_running_download(self, prepare_model):
        self.setup.return_value["busy"] = True
        response = self.client.post("/api/setup", json={})
        self.assertEqual(response.status_code, 202)
        prepare_model.assert_not_called()

    @patch("app.require_ready", side_effect=RuntimeError("Setup required"))
    def test_status_explains_why_generation_is_disabled(self, ready):
        self.setup.return_value.update(busy=True, downloaded_bytes=25, total_bytes=100, message="Downloading model weights")
        response = self.client.get("/api/status").json()
        self.assertFalse(response["ready"])
        self.assertEqual(response["setup"]["downloaded_bytes"], 25)
        self.assertIn("Downloading", response["message"])

    @patch("app.compose")
    def test_upload_returns_downloadable_wav(self, generate):
        import io
        samples = prepare_audio(hum(), 5)
        generate.return_value = (44100, samples, 42)
        response = self.client.post("/api/compose", files=self.upload, data=self.settings)
        self.assertEqual(response.status_code, 200, response.text[:200])
        self.assertEqual(response.headers["content-type"], "audio/wav")
        self.assertEqual(response.headers["x-generation-seed"], "42")
        identifier = response.headers["x-composition-id"]
        self.assertEqual(response.headers["cache-control"], "no-store")
        result, rate = sf.read(io.BytesIO(response.content))
        self.assertEqual((rate, result.shape), (44100, (220500, 2)))
        audio, options = generate.call_args.args
        self.assertEqual(audio[0], 48000)
        self.assertEqual(options.seed, 42)
        library = self.client.get("/api/compositions").json()
        self.assertEqual([item["id"] for item in library], [identifier])
        self.assertEqual(self.client.get(library[0]["url"]).content, response.content)

    @patch("app.compose")
    def test_invalid_settings_and_audio_never_reach_model(self, generate):
        for settings in ('{"strength":1}', 'null', '[]', '{bad json'):
            response = self.client.post("/api/compose", files=self.upload, data={"settings": settings})
            self.assertEqual(response.status_code, 400)
        response = self.client.post("/api/compose", files={"audio": ("bad.wav", b"not audio")}, data=self.settings)
        self.assertEqual(response.status_code, 400)
        generate.assert_not_called()

    @patch("app.compose")
    def test_saved_settings_become_defaults_and_requests_override_them(self, generate):
        generate.return_value = (44100, prepare_audio(hum(), 5), 42)
        self.assertEqual(self.client.get("/api/settings").json()["strength"], 0.55)
        saved = self.client.post("/api/settings", json={"prompt": "Dark synth", "strength": 0.4, "seconds": 5})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(self.client.get("/api/settings").json()["prompt"], "Dark synth")
        self.client.post("/api/compose", files=self.upload, data={"settings": '{"cfg": 4}'})
        options = generate.call_args.args[1]
        self.assertEqual((options.prompt, options.strength, options.cfg), ("Dark synth", 0.4, 4))
        for bad in ({"strength": 1}, [], {"unknown": 1}):
            self.assertEqual(self.client.post("/api/settings", json=bad).status_code, 400)
        self.assertEqual(self.client.get("/api/settings").json()["prompt"], "Dark synth")

    def test_sample_folder_is_listed_without_hidden_files_or_traversal(self):
        with tempfile.TemporaryDirectory() as folder:
            for name in ("b.m4a", "a.wav", ".DS_Store"):
                (Path(folder) / name).write_bytes(b"x")
            (Path(folder) / "nested").mkdir()
            with patch("app.AUDIO", Path(folder)):
                self.assertEqual(self.client.get("/api/samples").json(), ["a.wav", "b.m4a"])
        self.assertEqual(self.client.get("/samples/../app.py").status_code, 404)

    @patch("app.compose", side_effect=RuntimeError("Model setup is incomplete. Run prepare.py"))
    def test_generation_error_reaches_user(self, generate):
        response = self.client.post("/api/compose", files=self.upload, data=self.settings)
        self.assertEqual(response.status_code, 503)
        self.assertIn("prepare.py", response.json()["detail"])

    def test_cross_origin_and_untrusted_hosts_are_rejected(self):
        response = self.client.post("/api/compose", files=self.upload, data=self.settings, headers={"origin": "https://example.com"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.get("/api/status", headers={"host": "example.com"}).status_code, 400)

    def test_oversized_requests_are_rejected_before_parsing(self):
        response = self.client.post("/api/compose", content=b"body", headers={"content-length": str(26 * 1024 * 1024)})
        self.assertEqual(response.status_code, 413)


@unittest.skipUnless(os.environ.get("AUDIO_ENGINE_MODEL_TEST") == "1", "Set AUDIO_ENGINE_MODEL_TEST=1 after model setup")
class ModelIntegrationTests(unittest.TestCase):
    def test_real_audio_to_audio_depends_on_reference(self):
        options = Options(prompt="A gentle instrumental piano melody with acoustic guitar", seconds=5, steps=4, seed=42)
        rate, first, seed = compose(hum(), options)
        time = np.arange(96000) / 48000
        other_hum = (48000, (0.15 * np.sin(2 * np.pi * 330 * time)).astype(np.float32))
        _, second, _ = compose(other_hum, options)
        self.assertEqual((rate, first.shape, seed), (44100, (220500, 2), 42))
        self.assertGreater(float(np.std(first)), 0.001)
        self.assertGreater(float(np.mean(np.abs(first - second))), 0.001)


if __name__ == "__main__":
    unittest.main()
