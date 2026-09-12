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


if __name__ == "__main__":
    unittest.main()
