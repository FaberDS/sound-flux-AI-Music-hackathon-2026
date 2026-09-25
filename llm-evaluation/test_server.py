import unittest
import wave
from functools import partial
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from threading import Thread
from unittest.mock import patch

import numpy as np

from server import (Handler, LABELS, ROOT, TTS_VOICES, PromptfooViewer, add_memory, add_photo,
                    build_memory_context, create_profile, delete_memory, delete_photo, list_profiles,
                    read_profile, classify, transcribe, tts_lock, update_profile)


class FakeModel:
    def generate(self, path, **options):
        with wave.open(path, "rb") as recording:
            assert recording.getnchannels() == 1
            assert recording.getframerate() == 16_000
            assert recording.getnframes() == 16_000
        assert options == {"granularity": "utterance", "extract_embedding": False}
        return [{"scores": list(range(1, 10))}]


class ServerTest(unittest.TestCase):
    def test_personal_memory_isolated_persisted_and_retrieved(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            first = create_profile(root, {
                "displayName": "Maria", "preferredAddress": "Frau Berger", "birthYear": 1942,
                "importantPeople": "Tochter Anna", "musicPreferences": "Walzer", "proactiveMemories": True,
            })
            second = create_profile(root, {"displayName": "Josef"})
            self.assertEqual([item["displayName"] for item in list_profiles(root)], ["Josef", "Maria"])
            wedding = add_memory(root, first["id"], {
                "kind": "lebensereignis", "summary": "Die Hochzeit mit Karl war am 26. September 1964.",
                "scope": "persistent", "eventDate": "1964-09-26", "repeatsAnnually": True,
                "mentionPolicy": "passend", "conversationId": "talk-1",
            })
            add_memory(root, first["id"], {
                "kind": "kreative_idee", "summary": "Heute ein Lied über den Sommerabend schreiben.",
                "scope": "conversation", "conversationId": "talk-1",
            })
            self.assertFalse(add_memory(root, first["id"], {
                "kind": "alltag", "summary": "Milch kaufen", "scope": "irrelevant",
            })["stored"])
            photo = add_photo(root, first["id"], {
                "name": "hochzeit.png", "caption": "Maria und Karl bei ihrer Hochzeit", "date": "1964-09-26",
            }, "image/png", b"png")
            context = build_memory_context(root, first["id"], {
                "currentDate": "2026-09-24", "topic": "Hochzeit und Musik", "conversationId": "talk-1",
            })
            self.assertEqual(len(context["anniversaries"]), 2)
            self.assertIn("Hochzeit mit Karl", context["context"])
            self.assertIn("Maria und Karl bei ihrer Hochzeit", context["context"])
            self.assertIn("darf behutsam und passend angesprochen werden", context["context"])
            self.assertIn("Sommerabend", context["context"])
            later = build_memory_context(root, first["id"], {
                "currentDate": "2026-10-10", "topic": "Musik", "conversationId": "talk-2",
            })
            self.assertNotIn("Sommerabend", later["context"])
            self.assertNotIn("Milch kaufen", later["context"])
            self.assertEqual(read_profile(root, second["id"])["memories"], [])
            updated = update_profile(root, first["id"], {**first["profile"], "musicPreferences": "Walzer und Operette"})
            self.assertEqual(updated["profile"]["musicPreferences"], "Walzer und Operette")
            self.assertTrue(delete_memory(root, first["id"], wedding["memory"]["id"]))
            delete_photo(root, first["id"], photo["id"])
            self.assertEqual(read_profile(root, first["id"])["photos"], [])

    def test_promptfoo_start_health_errors_and_cleanup(self):
        class HealthHandler(BaseHTTPRequestHandler):
            payload = {"status": "OK", "version": "0.123.1"}

            def do_GET(self):
                assert self.path == "/health"
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(self.payload).encode())

            def log_message(self, *_):
                pass

        health = ThreadingHTTPServer(("127.0.0.1", 0), HealthHandler)
        thread = Thread(target=health.serve_forever, daemon=True)
        thread.start()
        viewer = PromptfooViewer(health.server_port)
        try:
            with patch("server.shutil.which", return_value="/test/node"), patch("server.Path.is_file", return_value=True), \
                    patch("server.subprocess.Popen") as spawn:
                process = spawn.return_value
                process.poll.return_value = None
                viewer.start()
                command = spawn.call_args.args[0]
                self.assertEqual(command, ["/test/node", str(ROOT / "node_modules/promptfoo/dist/src/entrypoint.js"),
                                           "view", "--port", str(health.server_port), "--no"])
                options = spawn.call_args.kwargs
                self.assertEqual(options["cwd"], ROOT)
                self.assertTrue(options["start_new_session"])
                self.assertEqual(options["env"]["PROMPTFOO_CONFIG_DIR"], str(ROOT / ".promptfoo"))
                self.assertEqual(options["env"]["PROMPTFOO_DISABLE_TELEMETRY"], "1")
                self.assertEqual(options["env"]["PROMPTFOO_DISABLE_UPDATE"], "1")
                self.assertTrue(viewer.status()["ready"])
                HealthHandler.payload = []
                self.assertFalse(viewer.status()["ready"])
                with patch("server.HTTPConnection.request", side_effect=ConnectionRefusedError):
                    self.assertEqual(viewer.status(), {"port": health.server_port, "ready": False, "error": None})
                process.poll.return_value = process.returncode = 1
                self.assertIn("Code 1", viewer.status()["error"])
                viewer.close()
                process.terminate.assert_not_called()
                process.poll.return_value = None
                process.wait.side_effect = [subprocess.TimeoutExpired(command, 6), None]
                viewer.close()
                process.terminate.assert_called_once()
                process.kill.assert_called_once()
            missing = PromptfooViewer(15500)
            with patch("server.shutil.which", return_value=None):
                missing.start()
            self.assertFalse(missing.status()["ready"])
            self.assertIn("npm ci", missing.status()["error"])
            missing.close()
        finally:
            health.shutdown()
            health.server_close()
            thread.join()

    def test_classify_encodes_wav_and_normalizes_scores(self):
        result = classify(np.zeros(16_000, dtype=np.float32), 16_000, FakeModel())
        self.assertEqual(tuple(result["scores"]), LABELS)
        self.assertAlmostEqual(sum(result["scores"].values()), 1)
        self.assertGreaterEqual(result["inference_ms"], 0)

    def test_transcribe_resamples_chunks_and_forces_german(self):
        class Processor:
            def __init__(self):
                self.lengths = []
                self.decoded = 0

            def __call__(self, samples, sampling_rate, return_tensors):
                self.lengths.append(len(samples))
                self.assertions = (sampling_rate, return_tensors)
                return {"input_features": samples[:1]}

            def batch_decode(self, _tokens, skip_special_tokens, clean_up_tokenization_spaces):
                self.decoded += 1
                self.decode_options = (skip_special_tokens, clean_up_tokenization_spaces)
                return [f"Abschnitt {self.decoded}."]

        class SpeechModel:
            def __init__(self):
                self.calls = []

            def generate(self, **options):
                self.calls.append(options)
                return [[1]]

        processor, speech_model = Processor(), SpeechModel()
        text = transcribe(np.full(31 * 8_000, 0.1, dtype=np.float32), 8_000, processor, speech_model)
        self.assertEqual(text, "Abschnitt 1. Abschnitt 2.")
        self.assertEqual(processor.lengths, [30 * 16_000, 16_000])
        self.assertEqual(processor.assertions, (16_000, "pt"))
        self.assertEqual(processor.decode_options, (True, False))
        self.assertTrue(all(call["language"] == "de" and call["task"] == "transcribe" for call in speech_model.calls))
        self.assertEqual(transcribe(np.zeros(8_000, dtype=np.float32), 8_000, processor, speech_model), "")

    def test_supertonic_endpoint_voices_german_wav_validation_and_busy(self):
        class SpeechModel:
            sample_rate = 44_100

            def get_voice_style(self, voice):
                return voice

            def synthesize(self, text, **options):
                self.last_request = (text, options)
                return np.array([[0, 0.5, -0.5, 2, -2]], dtype=np.float32), 0.1

        model = SpeechModel()
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory="."))
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def request(payload):
            connection = HTTPConnection(*server.server_address, timeout=5)
            try:
                connection.request("POST", "/api/tts", json.dumps(payload), {"Content-Type": "application/json"})
                response = connection.getresponse()
                return response.status, response.getheader("Content-Type"), response.read()
            finally:
                connection.close()

        try:
            with patch("server.tts_model", model):
                for voice in TTS_VOICES:
                    status, content_type, data = request({"voice": voice, "text": " Grüße aus Österreich! "})
                    self.assertEqual((status, content_type), (200, "audio/wav"))
                    self.assertEqual(model.last_request, ("Grüße aus Österreich!", {
                        "voice_style": voice, "lang": "de", "total_steps": 8, "speed": 1.0,
                    }))
                    with wave.open(BytesIO(data), "rb") as audio:
                        self.assertEqual((audio.getframerate(), audio.getnchannels(), audio.getsampwidth()), (44_100, 1, 2))
                        self.assertEqual(list(np.frombuffer(audio.readframes(5), dtype="<i2")), [0, 16383, -16383, 32767, -32767])
                for payload in [[], {}, {"voice": "../../F1", "text": "Hallo"},
                                *({"voice": "F1", "text": text} for text in ("", " ", None, "x" * 1001))]:
                    self.assertEqual(request(payload)[0], 400)
                with tts_lock:
                    self.assertEqual(request({"voice": "F1", "text": "Hallo"})[0], 503)
                with patch.object(model, "synthesize", side_effect=RuntimeError("Synthesis failed")):
                    self.assertEqual(request({"voice": "F1", "text": "Hallo"})[0], 500)
                self.assertEqual(request({"voice": "F1", "text": "Hallo"})[0], 200)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
