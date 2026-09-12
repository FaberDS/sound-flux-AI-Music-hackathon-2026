import asyncio
import json
import unittest

import app
from fastapi.testclient import TestClient


class FakeProcess:
    returncode = None
    terminated = False

    def terminate(self):
        self.terminated = True


class InterruptTest(unittest.TestCase):
    def test_interrupt_terminates_active_tts(self):
        turn_id = "test-turn"
        process = FakeProcess()
        app.event_for(turn_id)
        app.active_processes[turn_id].add(process)
        result = asyncio.run(app.interrupt(turn_id))
        self.assertTrue(result["interrupted"])
        self.assertTrue(process.terminated)
        self.assertTrue(app.cancel_events[turn_id].is_set())
        app.active_processes.pop(turn_id, None)
        app.cancel_events.pop(turn_id, None)

    def test_pcm_wav_is_valid(self):
        import tempfile
        import wave
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audio.wav"
            app.write_pcm_wav(path, b"\0\0" * 160, 16_000)
            with wave.open(str(path)) as audio:
                self.assertEqual(audio.getframerate(), 16_000)
                self.assertEqual(audio.getnframes(), 160)

    def test_normal_live_stop_leaves_turn_available_for_chat(self):
        turn_id = "normal-live-stop"
        with TestClient(app.app) as client:
            with client.websocket_connect(f"/v1/live/{turn_id}") as websocket:
                websocket.send_text(json.dumps({"type": "start", "sample_rate": 48_000}))
                websocket.send_text(json.dumps({"type": "stop"}))
        self.assertNotIn(turn_id, app.cancel_events)

    def test_profile_onboarding_and_correction(self):
        import tempfile
        from pathlib import Path

        original_path = app.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            try:
                app.DB_PATH = Path(directory) / "profile.db"
                app.initialize_database()
                self.assertEqual(app.profile_state()["onboarding"]["key"], "name")
                self.assertEqual(app.profile_state()["onboarding"]["category"], "Personal")
                app.save_profile_property("name", "Ada")
                app.apply_profile_updates("I was actually born in 1922.")
                app.record_interaction("user", "Hello")
                state = app.profile_state()
                self.assertEqual(state["onboarding"]["key"], "mood")
                self.assertEqual({item["key"]: item["value"] for item in state["properties"]}["birth_year"], "1922")
                self.assertEqual(state["greeting"], "Welcome back after a short break, Ada.")
            finally:
                app.DB_PATH = original_path

    def test_partial_profile_updates_do_not_block_a_turn(self):
        import tempfile
        from pathlib import Path

        original_path = app.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            try:
                app.DB_PATH = Path(directory) / "profile.db"
                app.initialize_database()
                app.apply_profile_updates("I'm feeling calm. I love jazz.")
                app.apply_profile_updates("Call me Ada and I'm feeling great.")
                values = {item["key"]: item["value"] for item in app.profile_state()["properties"]}
                self.assertEqual(values["name"], "Ada")
                self.assertEqual(values["mood"], "great")
                self.assertEqual(values["music_preferences"].lower(), "jazz")
                self.assertEqual(app.profile_state()["onboarding"]["key"], "birth_year")
                app.save_profile_property("name", "Ada Lovelace")
                self.assertEqual({item["key"]: item["value"] for item in app.profile_state()["properties"]}["name"], "Ada")
            finally:
                app.DB_PATH = original_path

    def test_history_and_clear_data(self):
        import tempfile
        from pathlib import Path

        original_path = app.DB_PATH
        with tempfile.TemporaryDirectory() as directory:
            try:
                app.DB_PATH = Path(directory) / "profile.db"
                app.initialize_database()
                app.save_profile_property("name", "Ada")
                app.record_chat("turn-1", "Hello", "qwen3.5:2b", "Hi Ada.", 125)
                self.assertEqual(app.chat_history()[0]["duration_ms"], 125)
                self.assertEqual(app.chat_history()[0]["model"], "qwen3.5:2b")
                app.clear_chat_history()
                self.assertEqual(app.chat_history(), [])
                self.assertEqual(app.profile_properties()[0]["value"], "Ada")
                app.clear_persisted_data()
                self.assertEqual(app.profile_properties(), [])
                self.assertEqual(app.chat_history(), [])
            finally:
                app.DB_PATH = original_path

    def test_index_embeds_profile_state(self):
        response = asyncio.run(app.index())
        self.assertNotIn(b"__INITIAL_STATE__", response.body)
        self.assertIn(b'initial-state', response.body)


if __name__ == "__main__":
    unittest.main()
