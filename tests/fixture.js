"use strict";

const stage = document.getElementById("stage");
const summary = document.getElementById("summary");
const results = document.getElementById("results");
const pauseFor = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const emit = (element, type) => element.dispatchEvent(new Event(type, { bubbles: true }));
const panel = () => document.querySelector("video-seek-controls")?.shadowRoot;
const control = id => panel().getElementById(id);
const assert = (condition, message) => { if (!condition) throw Error(message); };

async function loadScript(filename) {
  const script = document.createElement("script");
  script.src = filename;
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
}

const initialized = (async () => {
  globalThis.__videoSeekStyle = await (await fetch("../overlay.css")).text();
  await loadScript("../content.js");
})();

function mockVideo(options = {}) {
  const video = document.createElement("video");
  const state = { time: 0, duration: 30, ranges: [[0, 30]], paused: true, ready: 4,
    source: "fixture:first", seeking: false, rate: 1, ended: false, error: null,
    rollback: false, rejectSeek: false, rejectPlay: false, writes: [], plays: 0, ...options };
  Object.defineProperties(video, {
    currentTime: { get: () => state.time, set: value => {
      if (state.rejectSeek) throw new DOMException("Simulated restriction", "InvalidStateError");
      state.writes.push(value);
      state.seeking = true;
      state.time = value;
      emit(video, "seeking");
      queueMicrotask(() => { state.seeking = false; emit(video, "seeked"); emit(video, "timeupdate"); });
      if (state.rollback) setTimeout(() => { state.time = 0; emit(video, "timeupdate"); }, 200);
    } },
    duration: { get: () => state.duration },
    paused: { get: () => state.paused },
    readyState: { get: () => state.ready },
    currentSrc: { get: () => state.source },
    seeking: { get: () => state.seeking },
    playbackRate: { get: () => state.rate },
    ended: { get: () => state.ended },
    error: { get: () => state.error },
    seekable: { get: () => ({ length: state.ranges.length,
      start: index => state.ranges[index][0], end: index => state.ranges[index][1] }) },
    play: { value: async () => {
      state.plays += 1;
      if (state.rejectPlay) throw new DOMException("Simulated restriction", "NotAllowedError");
      state.paused = false;
      emit(video, "playing");
    } },
    pause: { value: () => { state.paused = true; emit(video, "pause"); } }
  });
  return { video, state };
}

async function setup(options) {
  globalThis.__videoSeekControls.setEnabled(false);
  stage.replaceChildren();
  const fixture = mockVideo(options);
  stage.append(fixture.video);
  window.scrollTo(0, 0);
  globalThis.__videoSeekControls.setEnabled(true);
  await pauseFor(170);
  return fixture;
}

function previewAt(value) {
  control("slider").value = String(value);
  emit(control("slider"), "input");
}

function seekTo(value) {
  previewAt(value);
  emit(control("slider"), "change");
}

async function runTests() {
  await initialized;
  results.replaceChildren();
  const report = [];
  async function check(name, callback) {
    const row = document.createElement("li");
    try {
      await callback();
      row.className = "pass";
      row.textContent = `PASS: ${name}`;
      report.push({ name, passed: true });
    } catch (error) {
      row.className = "fail";
      row.textContent = `FAIL: ${name}: ${error.message}`;
      report.push({ name, passed: false, error: error.message });
    }
    results.append(row);
  }

  await check("Preview survives timeupdate; release commits once and preserves pause", async () => {
    const { video, state } = await setup();
    previewAt(12);
    state.time = 2;
    emit(video, "timeupdate");
    assert(control("slider").value === "12", "timeupdate overwrote preview");
    assert(state.writes.length === 0, "input committed too early");
    emit(control("slider"), "change");
    assert(state.writes.length === 1 && state.time === 12, "release did not commit once");
    assert(state.paused && state.plays === 0, "seeking started playback");
  });
  await check("Isolated panel coordinates remain inside the viewport", async () => {
    await setup();
    const rectangle = document.querySelector("video-seek-controls").getBoundingClientRect();
    assert(rectangle.width > 0 && rectangle.height > 0, "panel has no rendered area");
    assert(rectangle.left >= 0 && rectangle.top >= 0 && rectangle.right <= innerWidth && rectangle.bottom <= innerHeight,
      "shadow-root styles overrode the panel position");
  });
  await check("Header toggles collapse without a separate plus button; close stays independent", async () => {
    await setup();
    const toggle = control("header-toggle");
    assert(!panel().getElementById("collapse"), "separate collapse button remains");
    assert(toggle.tagName === "BUTTON", "header lacks native keyboard activation");
    toggle.click();
    assert(control("body").hidden && toggle.getAttribute("aria-expanded") === "false", "header did not collapse");
    toggle.click();
    assert(!control("body").hidden && toggle.getAttribute("aria-expanded") === "true", "header did not expand");
    control("close").click();
    assert(!document.querySelector("video-seek-controls"), "close did not disable overlay");
    globalThis.__videoSeekControls.setEnabled(true);
    assert(!control("body").hidden, "restore unexpectedly collapsed the panel");
  });
  await check("Disjoint range gap clamps to nearest boundary", async () => {
    const { state } = await setup({ ranges: [[0, 10], [20, 30]] });
    seekTo(16);
    assert(state.time === 20, "target fell in a gap");
  });
  await check("Empty ranges and missing metadata disable seeking", async () => {
    const { video, state } = await setup({ ranges: [], duration: NaN, ready: 0 });
    assert(control("slider").disabled, "unloaded video allowed seeking");
    assert(control("status").textContent.includes("metadata"), "missing metadata status");
    state.ready = 4;
    emit(video, "loadedmetadata");
    assert(control("status").textContent.includes("No seekable"), "missing empty-range status");
  });
  await check("Moving live window clamps the commit against fresh bounds", async () => {
    const { video, state } = await setup({ duration: Infinity, ranges: [[100, 160]], time: 120 });
    previewAt(105);
    state.ranges = [[120, 180]];
    emit(video, "progress");
    assert(control("slider").value === "105", "live update overwrote preview");
    emit(control("slider"), "change");
    assert(state.time === 120, "expired target was not clamped");
    assert(control("duration").textContent === "Window 2:00 - 3:00", "live bounds incorrect");
  });
  await check("Hidden videos ignored; ambiguous videos have a manual selector", async () => {
    await setup();
    const hidden = mockVideo({ paused: false });
    hidden.video.style.display = "none";
    stage.append(hidden.video);
    const alternate = mockVideo();
    stage.append(alternate.video);
    await pauseFor(200);
    assert(control("videos").options.length === 2, "hidden video entered selection");
    control("videos").value = control("videos").options[1].value;
    emit(control("videos"), "change");
    control("forward").click();
    assert(alternate.state.time === 5, "manual selection did not control chosen video");
  });
  await check("Replacement video cancels stale preview and detaches old controls", async () => {
    const old = await setup();
    previewAt(20);
    const replacement = mockVideo({ duration: 10, ranges: [[0, 10]], source: "fixture:ad" });
    old.video.replaceWith(replacement.video);
    await pauseFor(200);
    emit(control("slider"), "change");
    assert(replacement.state.writes.length === 0, "stale release sought new video");
    control("forward").click();
    assert(replacement.state.time === 5 && old.state.writes.length === 0, "replacement not controlled");
  });
  await check("Source change cancels the entire in-progress pointer gesture", async () => {
    const { video, state } = await setup();
    control("slider").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 3 }));
    previewAt(20);
    state.source = "fixture:second";
    emit(video, "emptied");
    emit(video, "loadedmetadata");
    previewAt(18);
    emit(control("slider"), "change");
    assert(state.writes.length === 0, "old gesture committed against a new source");
  });
  await check("Seek rollback is reported without repeated currentTime writes", async () => {
    const { state } = await setup({ rollback: true });
    seekTo(10);
    await pauseFor(2850);
    assert(/rollback/i.test(control("status").textContent), "rollback not reported");
    assert(state.writes.length === 1, "extension fought the rollback");
  });
  await check("Seek exception and play rejection are visible", async () => {
    await setup({ rejectSeek: true, rejectPlay: true });
    seekTo(10);
    assert(control("status").textContent.includes("Seek rejected"), "seek exception hidden");
    control("play").click();
    await pauseFor(10);
    assert(control("status").textContent.includes("Playback request rejected"), "play rejection hidden");
  });
  await check("Repeated toggles and duplicate script injection keep one overlay and one handler", async () => {
    const { state } = await setup();
    for (let index = 0; index < 5; index += 1) {
      globalThis.__videoSeekControls.setEnabled(false);
      assert(!document.querySelector("video-seek-controls"), "overlay survived disable");
      globalThis.__videoSeekControls.setEnabled(true);
    }
    await loadScript("../content.js");
    assert(document.querySelectorAll("video-seek-controls").length === 1, "expected exactly one visible-video overlay");
    control("forward").click();
    assert(state.writes.length === 1, "duplicate click listener");
    globalThis.__videoSeekControls.setEnabled(false);
    assert(state.paused && state.time === 5 && state.plays === 0, "disable changed playback");
  });
  await check("Open shadow roots are discovered; no video hides the panel", async () => {
    await setup();
    const container = document.createElement("div");
    const root = container.attachShadow({ mode: "open" });
    const fixture = mockVideo();
    fixture.video.style.cssText = "width:320px;height:180px";
    root.append(fixture.video);
    stage.replaceChildren(container);
    await pauseFor(200);
    control("forward").click();
    assert(fixture.state.time === 5, "shadow video not found");
    container.remove();
    await pauseFor(200);
    assert(document.querySelector("video-seek-controls").hidden, "stale panel visible");
  });
  await setup();
  const failed = report.filter(result => !result.passed).length;
  summary.textContent = `${report.length - failed}/${report.length} simulated-media tests passed. Real website acceptance is separate.`;
  globalThis.fixtureResults = report;
  return report;
}

function drawFrame(canvas, frame) {
  const context = canvas.getContext("2d");
  const style = getComputedStyle(document.documentElement);
  context.fillStyle = style.getPropertyValue("--cp-surface");
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = style.getPropertyValue("--cp-accent");
  context.fillRect((frame * 7) % (canvas.width - 80), 180, 80, 60);
  context.fillStyle = style.getPropertyValue("--cp-text");
  context.font = "28px Segoe UI";
  context.fillText(`LOCAL VIDEO / FRAME ${String(frame).padStart(3, "0")}`, 30, 70);
}

async function generateVideo() {
  await initialized;
  globalThis.__videoSeekControls.setEnabled(false);
  stage.replaceChildren();
  summary.textContent = "Recording generated local frames...";
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const stream = canvas.captureStream(20);
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
  const chunks = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise(resolve => { recorder.onstop = resolve; });
  recorder.start();
  for (let frame = 0; frame < 80; frame += 1) {
    drawFrame(canvas, frame);
    await pauseFor(50);
  }
  recorder.stop();
  await stopped;
  stream.getTracks().forEach(track => track.stop());
  const video = document.createElement("video");
  video.muted = true;
  video.controls = false;
  const url = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
  const metadata = new Promise(resolve => video.addEventListener("loadedmetadata", resolve, { once: true }));
  video.src = url;
  stage.append(video);
  await metadata;
  const endSeek = new Promise(resolve => video.addEventListener("seeked", resolve, { once: true }));
  video.currentTime = 1e6;
  await endSeek;
  const rewind = new Promise(resolve => video.addEventListener("seeked", resolve, { once: true }));
  video.currentTime = 0;
  await rewind;
  URL.revokeObjectURL(url);
  globalThis.__videoSeekControls.setEnabled(true);
  globalThis.generatedVideo = video;
  summary.textContent = "Generated local video ready. Native seek bar is disabled.";
  return { duration: video.duration, ranges: video.seekable.length };
}

document.getElementById("run").addEventListener("click", async event => {
  event.target.disabled = true;
  try { await runTests(); } finally { event.target.disabled = false; }
});
document.getElementById("real").addEventListener("click", async event => {
  event.target.disabled = true;
  try { await generateVideo(); } catch (error) { summary.textContent = error.message; }
  finally { event.target.disabled = false; }
});
document.getElementById("toggle").addEventListener("click", async () => {
  await initialized;
  globalThis.__videoSeekControls.setEnabled(!globalThis.__videoSeekControls.enabled);
});
document.getElementById("fullscreen").addEventListener("click", () => {
  stage.requestFullscreen().catch(error => { summary.textContent = error.message; });
});
globalThis.runFixtureTests = runTests;
globalThis.generateFixtureVideo = generateVideo;