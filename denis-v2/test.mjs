import assert from "node:assert/strict";
import { frequencyFromNote, nearestNote, rms } from "./music.js";

assert.equal(frequencyFromNote(69), 440);
assert.equal(nearestNote(440), 69);
assert.equal(nearestNote(20), null);
assert.equal(rms([1, -1, 1, -1]), 1);
console.log("music checks passed");
