import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { encodeWav, formatTime, joinSamples, mixToMono } from "./web/audio-utils.js";

test("WAV encoding preserves the actual sample rate and clamps PCM", () => {
  const wav = encodeWav(new Float32Array([-2, -0.5, 0, 0.5, 2, NaN]), 48000);
  const view = new DataView(wav);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(wav.slice(8, 12)), "WAVE");
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(40, true), 12);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true)), [-32768, -16384, 0, 16384, 32767, 0]);
});

test("recordings concatenate in order and stop at the 30-second sample budget", () => {
  const result = joinSamples([new Float32Array([1, 2]), new Float32Array([3, 4, 5])], 4);
  assert.deepEqual([...result], [1, 2, 3, 4]);
  assert.equal(joinSamples([], 30).length, 0);
});

test("stereo uploads include the right channel in the mono guide", () => {
  const mono = mixToMono([new Float32Array([0, 0]), new Float32Array([0.4, 0.8])]);
  assert.ok(Math.abs(mono[0] - 0.2) < 1e-6);
  assert.ok(Math.abs(mono[1] - 0.4) < 1e-6);
});

test("recording timer stays inside the supported interval", () => {
  assert.equal(formatTime(-1), "00:00");
  assert.equal(formatTime(8.8), "00:08");
  assert.equal(formatTime(35), "00:30");
});

test("AudioWorklet flushes partial frames and stops processing", () => {
  let Recorder;
  const messages = [];
  const context = vm.createContext({
    Float32Array,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (message) => messages.push(message) }; } },
    registerProcessor: (name, implementation) => { assert.equal(name, "hum-recorder"); Recorder = implementation; },
  });
  vm.runInContext(readFileSync(new URL("./web/recorder-worklet.js", import.meta.url), "utf8"), context);
  const recorder = new Recorder();
  assert.equal(recorder.process([[new Float32Array([0.1, 0.2, 0.3])]]), true);
  recorder.port.onmessage({ data: "stop" });
  assert.equal(messages[0].type, "samples");
  assert.equal(messages[0].samples.length, 3);
  assert.equal(messages[1].type, "stopped");
  assert.equal(recorder.process([]), false);
});
