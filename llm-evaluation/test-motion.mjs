import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

execFileSync(process.execPath, ['--check', fileURLToPath(new URL('./motion-capture.mjs', import.meta.url))]);
const base = process.env.LAB_URL || 'http://127.0.0.1:8088';
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  // Keep regression checks separate from the running lab's audio models and saved data.
  await page.route('**/api/**', route => route.fulfill({ json: { ready: false, models: [], users: [], properties: [] } }));
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    window.motionAudioContexts = [];
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) { super(...args); window.motionAudioContexts.push(this); }
      createBiquadFilter() { const node = super.createBiquadFilter(); (this.testFilters ||= []).push(node); return node; }
      createGain() { const node = super.createGain(); (this.testGains ||= []).push(node); return node; }
    };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.cameraRequests = 0;
    navigator.mediaDevices.getUserMedia = options => { window.cameraRequests++; return original(options); };
  });
  return page;
}
async function waitStatus(page, text) {
  await page.waitForFunction(text => document.querySelector('#motion-status').textContent.includes(text)
    || !document.querySelector('#motion-error').hidden, text, { timeout: 45_000 });
  assert.ok((await page.locator('#motion-status').textContent()).includes(text), await page.locator('#motion-error').textContent());
}
const clickCamera = page => page.locator('#motion-toggle').click();
const hasDrawing = (page, id) => page.locator(id).evaluate(canvas =>
  canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0));

try {
  const page = await openPage();
  await page.route('**/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const aliases = ['FaceLandmarker', 'PoseLandmarker', 'HandLandmarker', 'FilesetResolver']
      .map(name => `const ${name} = ${source.match(new RegExp(`(\\w+) as ${name}\\b`))[1]};`).join('\n');
    await route.fulfill({ response, body: `${source}\n${aliases}
      const points = (count, visibility) => Array.from({ length: count }, (_, i) => ({
        x: .3 + (i % 20) * .02, y: .2 + Math.floor(i / 20) * .02, z: 0, visibility,
      }));
      window.motionTest = { lost: false, fail: false, created: 0, closed: 0, jaw: .7, handX: 0, handY: 0 };
      FilesetResolver.forVisionTasks = async () => ({});
      for (const [Tracker, result] of [
        [FaceLandmarker, { faceLandmarks: [points(478, 0)], faceBlendshapes: [{ categories: [{ categoryName: 'jawOpen', score: .7 }] }] }],
        [PoseLandmarker, { landmarks: [points(33, 1)] }],
        [HandLandmarker, { landmarks: [points(21, 0), points(21, 0)], handedness: [[{ categoryName: 'Left' }], [{ categoryName: 'Right' }]] }],
      ]) {
        Tracker.createFromOptions = async () => {
          await new Promise(resolve => setTimeout(resolve, 350));
          window.motionTest.created++;
          return {
            detectForVideo() {
              if (window.motionTest.fail) throw new Error('Inference failed');
              if (result.faceBlendshapes) result.faceBlendshapes[0].categories[0].score = window.motionTest.jaw;
              if (result.handedness && !window.motionTest.lost) {
                const hand = points(21, 0);
                hand[0] = { x: .5, y: .6 }; hand[5] = { x: .45, y: .5 }; hand[17] = { x: .55, y: .5 };
                return { ...result, landmarks: [hand, hand.map(p => ({ ...p, x: p.x + window.motionTest.handX, y: p.y + window.motionTest.handY }))] };
              }
              return window.motionTest.lost ? { landmarks: [], faceLandmarks: [], faceBlendshapes: [], handedness: [] } : result;
            }, close() { window.motionTest.closed++; },
          };
        };
      }
    ` });
  });
  await page.goto(`${base}/#motion`);
  await page.locator('#motion-panel').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => window.cameraRequests), 0);
  assert.equal(await page.evaluate(() => window.motionAudioContexts.length), 0, 'Sound starts only on request.');
  await page.locator('.motion-mapping-options summary').click();
  assert.equal(await page.locator('#motion-mappings select').count(), 21);
  assert.equal(await page.locator('.motion-readout').count(), 21);
  for (const width of [1440, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(width => document.documentElement.scrollWidth <= width, width), `Page fits ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await clickCamera(page);
  await waitStatus(page, 'Tracking live');
  assert.equal(await page.locator('#motion-total').textContent(), '553');
  assert.ok(await hasDrawing(page, '#motion-face'), 'Face points with zero visibility still draw');
  assert.ok(await hasDrawing(page, '#motion-Left'), 'Finger details draw');
  assert.equal(await page.locator('[data-motion-expression="jawOpen"]').evaluate(meter => meter.value), 0.7);
  await page.locator('#motion-sound').click();
  await page.waitForFunction(() => window.motionAudioContexts[0]?.state === 'running');
  await page.waitForFunction(() => window.motionAudioContexts[0].testFilters[0].frequency.value < 3500, null, { timeout: 5000 }).catch(async () => {
    throw new Error(JSON.stringify(await page.evaluate(() => ({
      audioTime: window.motionAudioContexts[0].currentTime,
      frequency: window.motionAudioContexts[0].testFilters[0].frequency.value,
      motion: document.querySelector('#motion-status').textContent,
      sound: document.querySelector('#motion-sound-status').textContent,
      meter: document.querySelector('[data-motion-input="mouth"] meter').value,
      videoTime: document.querySelector('#motion-video').currentTime,
    }))));
  });
  await page.locator('#motion-map-mouth').selectOption('kick');
  await page.evaluate(() => { window.motionTest.jaw = 0; });
  await page.waitForFunction(() => document.querySelector('[data-motion-input="mouth"] meter').value === 0);
  await page.evaluate(() => { window.motionTest.jaw = 0.9; });
  await page.waitForFunction(() => document.querySelector('#motion-sound-status').textContent === 'Mouth opening → Kick');
  assert.match(await page.locator('[data-motion-value="mouth"]').textContent(), /90%.*Kick · Triggered!/s);
  assert.equal(await page.locator('[data-motion-input="mouth"]').getAttribute('class'), 'motion-mapping is-active');
  await page.locator('#motion-map-mouth').selectOption('off');
  assert.equal(await page.locator('[data-motion-input="mouth"]').getAttribute('class'), 'motion-mapping');
  await page.locator('#motion-map-RightIndex').selectOption('echo');
  assert.match(await page.locator('[data-motion-value="RightIndex"]').textContent(), /Echo/);
  await page.locator('#motion-map-RightLift').selectOption('volume');
  await page.waitForFunction(() => Math.abs(window.motionAudioContexts[0].testGains[2].gain.value - .03) < .005);
  await page.evaluate(() => { window.motionTest.handY = -.3; });
  await page.waitForFunction(() => document.querySelector('[data-motion-value="RightLift"] output').textContent === '100%');
  await page.waitForFunction(() => window.motionAudioContexts[0].testGains[2].gain.value > .11);
  assert.match(await page.locator('[data-motion-value="RightLift"]').textContent(), /Volume swell · Applying/);
  await page.locator('#motion-map-RightMoveLeft').selectOption('next');
  await page.evaluate(() => { window.motionTest.handY = 0; });
  await page.waitForFunction(() => document.querySelector('[data-motion-input="RightMoveLeft"] .motion-input-state').textContent === 'Ready');
  await page.evaluate(() => { window.motionTest.handX = .25; });
  await page.waitForFunction(() => document.querySelector('#motion-sound-status').textContent === 'Right Move left → Next phrase 2');
  assert.match(await page.locator('[data-motion-value="RightMoveLeft"]').textContent(), /Next phrase · Triggered!/);
  await page.locator('#motion-center').click();
  assert.equal(await page.locator('[data-motion-value="RightMoveLeft"] output').textContent(), '0%');
  await page.locator('.motion-mapping-options summary').click();
  await page.locator('.motion-details').screenshot({ path: '/tmp/motion-values-desktop.png' });
  for (const checkbox of await page.locator('[data-motion-layer]').all()) await checkbox.uncheck();
  assert.equal(await hasDrawing(page, '#motion-skeleton'), false);
  await page.locator('[data-motion-layer="hands"]').check();
  assert.ok(await hasDrawing(page, '#motion-skeleton'));
  await page.evaluate(() => { window.motionTest.lost = true; });
  await waitStatus(page, 'Looking for a person');
  assert.equal(await hasDrawing(page, '#motion-skeleton'), false);
  await page.evaluate(() => { window.motionTest.lost = false; window.motionTracks = document.querySelector('#motion-video').srcObject.getTracks(); });
  await waitStatus(page, 'Tracking live');
  await page.getByRole('tab', { name: 'Überblick', exact: true }).click();
  assert.equal(await page.locator('#motion-panel').isVisible(), false);
  assert.ok(await page.evaluate(() => window.motionTracks.every(track => track.readyState === 'ended')));
  assert.equal(await hasDrawing(page, '#motion-skeleton'), false);
  await page.waitForFunction(() => window.motionAudioContexts.every(context => context.state === 'closed'));
  assert.equal(await page.locator('#motion-sound').getAttribute('aria-pressed'), 'false');
  await page.getByRole('tab', { name: 'Motion capture', exact: true }).click();
  await waitStatus(page, 'Camera is off');
  await clickCamera(page);
  await waitStatus(page, 'Loading');
  await page.getByRole('tab', { name: 'Überblick', exact: true }).click();
  await page.getByRole('tab', { name: 'Motion capture', exact: true }).click();
  await clickCamera(page);
  await waitStatus(page, 'Tracking live');
  await page.locator('#motion-sound').click();
  await page.waitForFunction(() => window.motionAudioContexts.at(-1)?.state === 'running');
  await page.evaluate(() => { window.motionTest.fail = true; });
  await page.locator('#motion-error').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#motion-error').textContent(), 'Inference failed');
  assert.equal(await page.evaluate(() => window.motionTest.closed), await page.evaluate(() => window.motionTest.created));
  await page.waitForFunction(() => window.motionAudioContexts.every(context => context.state === 'closed'));
  console.log('OK: layout, landmarks, mappings, actual Web Audio effects, tab cleanup, interrupted loading and restart.');
  await page.close();

  const denied = await openPage();
  await denied.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await denied.goto(`${base}/#motion`);
  await clickCamera(denied);
  await denied.locator('#motion-error').waitFor({ state: 'visible' });
  assert.match(await denied.locator('#motion-error').textContent(), /Camera permission was blocked/);
  assert.equal(await denied.locator('#motion-toggle').textContent(), 'Start camera');
  await denied.close();
  console.log('OK: permission denial is recoverable.');

  const real = await openPage();
  const modelRequests = [];
  real.on('request', request => { if (/\.task|\.wasm|vision_bundle/.test(request.url())) modelRequests.push(request.url()); });
  await real.goto(`${base}/#motion`);
  await clickCamera(real);
  await waitStatus(real, 'Looking for a person');
  await real.waitForFunction(() => Number(document.querySelector('#motion-fps').textContent) > 0);
  assert.equal(await real.locator('#motion-error').isVisible(), false);
  assert.equal(modelRequests.filter(url => url.endsWith('.task')).length, 3);
  assert.ok(modelRequests.every(url => url.startsWith(base)), 'Models and runtime come from the lab');
  await real.getByRole('tab', { name: 'Überblick', exact: true }).click();
  assert.equal(await real.locator('#motion-video').evaluate(video => video.srcObject), null);
  console.log('OK: real bundled models run on simulated webcam video, with no frontend server.');
} finally {
  await browser.close();
}
