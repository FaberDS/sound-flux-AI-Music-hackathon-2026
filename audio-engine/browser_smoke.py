import io
import json
import os

import numpy as np
import soundfile as sf
from playwright.sync_api import expect, sync_playwright

real_model = os.environ.get("AUDIO_ENGINE_MODEL_TEST") == "1"
rate = 44100
samples = (0.1 * np.sin(2 * np.pi * 220 * np.arange(rate * 2) / rate)).astype(np.float32)
buffer = io.BytesIO()
sf.write(buffer, samples, rate, format="WAV", subtype="PCM_16")
wav = buffer.getvalue()

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
    context = browser.new_context(permissions=["microphone"], viewport={"width": 1440, "height": 1100})
    page = context.new_page()
    page.add_init_script("window.loopSources = []; const create = AudioContext.prototype.createBufferSource; AudioContext.prototype.createBufferSource = function() { const source = create.call(this); const stop = source.stop.bind(source); source.stop = (...args) => { source.wasStopped = true; return stop(...args); }; window.loopSources.push(source); return source; };")
    errors = []
    requests = {"compose": 0, "setup": 0, "fail": False}
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: requests.update(compose=requests["compose"] + 1) if request.url.endswith("/api/compose") else None)
    bodies = []
    page.on("request", lambda request: bodies.append(request.post_data_buffer) if request.url.endswith("/api/compose") else None)
    model_status = {"ready": False, "message": "Downloading model weights", "setup": {"busy": True, "downloaded_bytes": 50, "total_bytes": 100}, "studio_url": "http://127.0.0.1:7860/"}

    def generate(route):
        if requests["fail"]:
            route.fulfill(status=503, json={"detail": "Test generation failed"})
        else:
            route.fulfill(status=200, body=wav, content_type="audio/wav", headers={"X-Generation-Seed": "42"})

    def begin_setup(route):
        requests["setup"] += 1
        model_status["setup"]["busy"] = True
        route.fulfill(status=202, json={"message": "Starting setup"})

    # Playwright's open-source Chromium lacks AAC, so serve a WAV fixture instead of the real audio/ folder.
    page.route("**/api/samples", lambda route: route.fulfill(json=["test.wav"]))
    page.route("**/samples/test.wav", lambda route: route.fulfill(body=wav, content_type="audio/wav"))
    if not real_model:
        page.route("**/api/status", lambda route: route.fulfill(json=model_status))
        page.route("**/api/compose", generate)
        page.route("**/api/setup", begin_setup)
    page.goto("http://127.0.0.1:7860")
    expect(page.locator("button")).to_have_count(1)
    expect(page.locator("input, textarea, audio[controls]")).to_have_count(0)
    page.locator("#record").click()
    expect(page.locator("#record")).to_have_attribute("aria-pressed", "true")
    page.wait_for_timeout(1800)
    page.locator("#record").click()
    if not real_model:
        expect(page.locator("#studio")).to_have_attribute("data-phase", "waiting")
        assert requests["compose"] == 0
        model_status.update(ready=True, message="Model mocked for browser testing")
    expect(page.locator("#studio")).to_have_attribute("data-phase", "playing", timeout=180000)
    expect(page.locator("#record")).to_be_enabled()
    assert requests["compose"] == 1
    loop = page.evaluate("({loop: loopSources.at(-1).loop, duration: loopSources.at(-1).buffer.duration, state: loopSources.at(-1).context.state})")
    assert loop["loop"] and loop["state"] == "running", loop
    assert abs(loop["duration"] - (15 if real_model else 2)) < 0.02, loop
    page.wait_for_timeout(2300)
    expect(page.locator("#studio")).to_have_attribute("data-phase", "playing")
    assert requests["compose"] == 1, "Playback must loop without repeated inference requests"
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Mobile layout overflows"
    page.locator("#record").click()
    expect(page.locator("#studio")).to_have_attribute("data-phase", "recording")
    assert page.evaluate("loopSources[0].wasStopped"), "Re-recording must stop the old loop"

    if not real_model:
        requests["fail"] = True
        page.wait_for_timeout(1600)
        page.locator("#record").click()
        expect(page.locator("#studio")).to_have_attribute("data-phase", "error")
        expect(page.locator("#error")).to_contain_text("Test generation failed")
        expect(page.locator("#record")).to_be_enabled()
        requests["fail"] = False
        model_status.update(ready=False, message="Setup required", setup={"busy": False, "downloaded_bytes": 0, "total_bytes": 100})
        page.goto("http://localhost:7860")
        expect(page).to_have_url("http://127.0.0.1:7860/")
        expect(page.locator("button")).to_have_count(1)
        page.locator("#record").click()
        expect(page.locator("#studio")).to_have_attribute("data-phase", "recording")
        page.wait_for_timeout(1600)
        page.locator("#record").click()
        expect(page.locator("#studio")).to_have_attribute("data-phase", "waiting")
        assert requests["setup"] == 1
        model_status["ready"] = True
        expect(page.locator("#studio")).to_have_attribute("data-phase", "playing")

        page.goto("http://127.0.0.1:7860/?tune")
        expect(page.locator("#tune [name=prompt]")).not_to_have_value("")
        page.locator("#tune [name=strength]").evaluate("input => { input.value = '0.3'; input.dispatchEvent(new Event('input', { bubbles: true })); }")
        page.locator("#record").click()
        page.wait_for_timeout(1600)
        page.locator("#record").click()
        expect(page.locator("#studio")).to_have_attribute("data-phase", "playing")
        assert b'"strength":0.3' in bodies[-1], "Tune panel settings must reach the compose request"
        expect(page.locator("#tune-status")).to_contain_text("Seed 42")
        before = len(bodies)
        page.locator("#regenerate").click()
        expect(page.locator("#studio")).to_have_attribute("data-phase", "playing")
        assert len(bodies) == before + 1, "Regenerate must reuse the last hum without re-recording"
        page.locator("#tune [name=source]").select_option("test.wav")
        page.locator("#regenerate").click()
        expect(page.locator("#studio")).to_have_attribute("data-phase", "playing")
        assert len(bodies) == before + 2 and b'filename="sample.wav"' in bodies[-1], "Audio-folder input must reach the model"
    assert not errors, json.dumps(errors)
    print(f"One-button browser smoke passed ({'real MLX' if real_model else 'mocked model'}): record, automatic generation, automatic loop, re-record, mobile layout.")
    context.close()
    browser.close()
