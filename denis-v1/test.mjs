import assert from "node:assert/strict";
import { detectGesture, poseFromLandmarks } from "./motion.js";

const points = [];
points[33] = { x: .4, y: .4 };
points[263] = { x: .6, y: .4 };
points[1] = { x: .5, y: .55 };
const pose = poseFromLandmarks(points);
assert.equal(Math.round(pose.tilt), 0);
assert.equal(detectGesture({ nod: .9, tilt: 0 }, { nod: .7, tilt: 0 }, { nod: .1, tilt: 15 }, null), "kick");
assert.equal(detectGesture({ nod: .7, tilt: -20 }, { nod: .7, tilt: 0 }, { nod: .1, tilt: 15 }, null), "snare");
assert.equal(detectGesture({ nod: .7, tilt: 20 }, { nod: .7, tilt: 0 }, { nod: .1, tilt: 15 }, null), "crash");
console.log("motion checks passed");
