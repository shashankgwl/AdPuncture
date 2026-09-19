const { test } = require("node:test");
const assert = require("node:assert/strict");
const logic = require("../seek-logic.js");

function ranges(entries) {
  return logic.normalizeRanges({ length: entries.length, start: index => entries[index][0], end: index => entries[index][1] });
}

test("finite range clamps both ends and retains valid positions", () => {
  const window = ranges([[0, 10]]);
  assert.equal(logic.clampTarget(4, window), 4);
  assert.equal(logic.clampTarget(-5, window), 0);
  assert.equal(logic.clampTarget(20, window), 10);
});

test("disjoint ranges never target gaps, with earlier boundary winning ties", () => {
  const window = ranges([[0, 10], [20, 30], [40, 50]]);
  assert.equal(logic.clampTarget(14, window), 10);
  assert.equal(logic.clampTarget(15, window), 10);
  assert.equal(logic.clampTarget(16, window), 20);
  assert.equal(logic.clampTarget(38, window), 40);
});

test("normalization sorts, merges overlaps, rejects invalid ranges", () => {
  assert.deepEqual(ranges([[20, 30], [0, 12], [8, 15], [NaN, 10], [-1, 2], [30, Infinity], [4, 4]]),
    [{ start: 0, end: 15 }, { start: 20, end: 30 }]);
  assert.deepEqual(logic.normalizeRanges({ length: 1, start() { throw Error("source changed"); } }), []);
});

test("empty ranges and nonfinite targets cannot seek", () => {
  assert.equal(logic.clampTarget(2, []), null);
  for (const invalid of [NaN, Infinity, -Infinity]) assert.equal(logic.clampTarget(invalid, ranges([[0, 10]])), null);
});

test("unknown and infinite durations use available windows", () => {
  assert.equal(logic.describeTimeline(NaN, []).label, "--:--");
  assert.equal(logic.describeTimeline(0, []).label, "--:--");
  assert.deepEqual(logic.describeTimeline(Infinity, ranges([[100, 160]])), { live: true, label: "1:40 - 2:40" });
  assert.equal(logic.describeTimeline(120, ranges([[0, 20]])).label, "2:00");
});

test("expired positions clamp against the latest live window", () => {
  assert.equal(logic.clampTarget(105, ranges([[100, 160]])), 105);
  assert.equal(logic.clampTarget(105, ranges([[120, 180]])), 120);
});

test("time formatting handles hours and invalid times", () => {
  assert.equal(logic.formatTime(3661.9), "1:01:01");
  for (const invalid of [-1, NaN, Infinity]) assert.equal(logic.formatTime(invalid), "--:--");
});

test("video choice ignores hidden videos, supports paused playback and sticky choice", () => {
  const paused = { video: "content", visible: true, width: 1280, height: 720, loaded: true, playing: false };
  const hidden = { ...paused, video: "hidden", visible: false, playing: true };
  const preview = { ...paused, video: "preview", width: 160, height: 90, playing: true };
  assert.equal(logic.chooseVideo([hidden, preview, paused], null, false).video, "content");
  assert.equal(logic.chooseVideo([paused, { ...paused, video: "equal" }], "equal", false).video, "equal");
  assert.equal(logic.chooseVideo([{ ...paused, video: "ad", playing: true }, paused], "content", false).video, "ad");
  assert.equal(logic.chooseVideo([hidden], "hidden", true).video, null);
  assert.equal(logic.chooseVideo([paused, { ...paused, video: "ad", playing: true }], "content", true).video, "content");
});

test("seek observation accounts for playback progression but detects rollback", () => {
  assert.equal(logic.seekMatches(4, 4, 0), true);
  assert.equal(logic.seekMatches(7, 4, 3), true);
  assert.equal(logic.seekMatches(0.5, 4, 0.5), false);
  assert.equal(logic.seekMatches(NaN, 4, 0), false);
});