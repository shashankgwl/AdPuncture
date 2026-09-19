(function () {
  "use strict";
  if (globalThis.__videoSeekControls) return;
  const logic = globalThis.VideoSeekLogic;
  if (!logic || !globalThis.__videoSeekStyle) return;
  const runtime = globalThis.chrome?.runtime;
  const mediaEvents = ["loadedmetadata", "loadstart", "emptied", "playing", "pause", "ended", "error", "durationchange"];
  const selectedEvents = ["timeupdate", "progress", "seeking", "seeked", "ratechange", "waiting"];
  const videos = new Map();
  const roots = new Map();
  let enabled = false;
  let host, shadow, ui, lifetime, selectedLifetime, resizeObserver;
  let selected = null;
  let pinned = false;
  let source = null;
  let preview = false;
  let gestureActive = false;
  let gestureCancelled = false;
  let observation = null;
  let observationTimer = null;
  let scanTimer = null;
  let fallbackTimer = null;
  let previewTimer = null;
  let position = null;
  let dragging = null;
  let collapsed = false;
  let status = "";
  let candidates = [];
  let selectorSignature = "";
  let nextVideoId = 0;
  let playRequest = 0;

  function announce(message) {
    status = message;
    if (ui && ui.status.textContent !== message) ui.status.textContent = message;
  }

  function notifyState() {
    try { runtime?.sendMessage({ type: "VIDEO_SEEK_STATE", enabled }).catch(() => {}); } catch {}
  }

  function isOwnNode(node) {
    return node === host || (shadow && node.getRootNode() === shadow);
  }

  function sourceIdentity(video) {
    return { url: video.currentSrc || video.getAttribute("src") || "", object: video.srcObject };
  }

  function cancelObservation() {
    clearInterval(observationTimer);
    observationTimer = null;
    observation = null;
  }

  function resetSource() {
    if (preview || gestureActive) gestureCancelled = true;
    preview = false;
    cancelObservation();
    playRequest += 1;
    source = selected ? sourceIdentity(selected) : null;
    announce("");
  }

  function checkSource() {
    if (!selected) return;
    const current = sourceIdentity(selected);
    if (!source || source.url !== current.url || source.object !== current.object) resetSource();
  }

  function onMedia(video, event) {
    if (video === selected) {
      if (["emptied", "loadstart", "loadedmetadata"].includes(event.type)) resetSource();
      else checkSource();
      if (observation) {
        if (event.type === "seeking") observation.sawSeeking = true;
        if (event.type === "seeked") observation.sawSeeked = true;
        inspectSeek();
      }
      render();
    }
    if (mediaEvents.includes(event.type)) scheduleSelection();
  }

  function registerVideo(video) {
    if (videos.has(video)) return;
    const controller = new AbortController();
    videos.set(video, { controller, id: ++nextVideoId });
    for (const event of mediaEvents) video.addEventListener(event, eventObject => onMedia(video, eventObject), { signal: controller.signal });
  }

  function discover(node) {
    if (isOwnNode(node)) return;
    if (node instanceof HTMLVideoElement) registerVideo(node);
    if (node.shadowRoot) observeRoot(node.shadowRoot);
    if (!node.querySelectorAll) return;
    for (const element of node.querySelectorAll("*")) {
      if (element === host) continue;
      if (element instanceof HTMLVideoElement) registerVideo(element);
      if (element.shadowRoot) observeRoot(element.shadowRoot);
    }
  }

  function observeRoot(root) {
    if (roots.has(root)) return;
    const observer = new MutationObserver(records => {
      let relevant = false;
      for (const record of records) {
        if (isOwnNode(record.target)) continue;
        relevant = true;
        for (const node of record.addedNodes) discover(node);
      }
      if (relevant) scheduleSelection();
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["src", "style", "class", "hidden", "width", "height"] });
    roots.set(root, observer);
    discover(root);
  }

  function scheduleSelection() {
    if (!enabled || scanTimer !== null) return;
    scanTimer = setTimeout(() => { scanTimer = null; refreshSelection(); }, 120);
  }

  function measure(video) {
    const rectangle = video.getBoundingClientRect();
    let visible = video.isConnected && rectangle.bottom > 0 && rectangle.right > 0 &&
      rectangle.top < innerHeight && rectangle.left < innerWidth;
    if (visible && typeof video.checkVisibility === "function") {
      visible = video.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }
    let ancestor = video;
    while (visible && ancestor instanceof Element) {
      const style = getComputedStyle(ancestor);
      if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0 || ancestor.hidden) visible = false;
      ancestor = ancestor.parentElement || ancestor.getRootNode().host;
    }
    return { video, visible, width: rectangle.width, height: rectangle.height,
      loaded: video.readyState >= 1, playing: !video.paused && !video.ended, ended: video.ended };
  }

  function refreshSelection() {
    if (!enabled) return;
    for (const [video, entry] of videos) {
      if (!video.isConnected) { entry.controller.abort(); videos.delete(video); }
    }
    for (const [root, observer] of roots) {
      if (root.host && !root.host.isConnected) { observer.disconnect(); roots.delete(root); }
    }
    const choice = logic.chooseVideo([...videos.keys()].map(measure), selected, pinned);
    candidates = choice.ranked;
    if (choice.video !== selected) selectVideo(choice.video, false);
    checkSource();
    mount();
    updateSelector();
    render();
  }

  function selectVideo(video, manual) {
    selectedLifetime?.abort();
    selectedLifetime = new AbortController();
    selected = video;
    pinned = manual;
    resetSource();
    if (video) for (const event of selectedEvents) {
      video.addEventListener(event, eventObject => onMedia(video, eventObject), { signal: selectedLifetime.signal });
    }
  }

  function fullscreenElement() {
    let element = document.fullscreenElement;
    while (element?.shadowRoot?.fullscreenElement) element = element.shadowRoot.fullscreenElement;
    return element;
  }

  function mount() {
    const fullscreen = fullscreenElement();
    const blocked = fullscreen instanceof HTMLMediaElement || fullscreen instanceof HTMLIFrameElement;
    if (!selected || blocked) { host.hidden = true; return; }
    const parent = fullscreen || document.documentElement;
    if (host.parentNode !== parent) parent.append(host);
    host.hidden = false;
    constrainPosition();
  }

  function updateSelector() {
    ui.videoLabel.hidden = candidates.length < 2;
    const signature = candidates.map(candidate => `${videos.get(candidate.video)?.id}:${Math.round(candidate.width)}:${Math.round(candidate.height)}`).join("|");
    if (signature !== selectorSignature) {
      selectorSignature = signature;
      ui.videos.replaceChildren();
      for (const candidate of candidates) {
        const id = videos.get(candidate.video).id;
        const option = document.createElement("option");
        option.value = String(id);
        option.textContent = `Video ${id} (${Math.round(candidate.width)} x ${Math.round(candidate.height)})`;
        ui.videos.append(option);
      }
    }
    ui.videos.value = String(videos.get(selected)?.id || "");
  }

  function render() {
    if (!ui || !selected) return;
    const ranges = logic.normalizeRanges(selected.seekable);
    const available = ranges.length > 0 && !selected.error && selected.readyState >= 1;
    ui.slider.disabled = !available;
    ui.back.disabled = !available;
    ui.forward.disabled = !available;
    ui.play.disabled = selected.readyState < 1 || Boolean(selected.error);
    ui.play.textContent = selected.paused ? "\u25b6" : "\u23f8";
    ui.play.setAttribute("aria-label", selected.paused ? "Play" : "Pause");
    ui.play.title = selected.paused ? "Play" : "Pause";
    const timeline = logic.describeTimeline(selected.duration, ranges);
    ui.duration.textContent = timeline.live ? `Window ${timeline.label}` : `/ ${timeline.label}`;
    if (!available) {
      preview = false;
      ui.slider.min = "0";
      ui.slider.max = "1";
      ui.slider.value = "0";
      const reason = selected.error ? "Media error. Seeking unavailable." : selected.readyState < 1 ?
        "Waiting for video metadata." : "No seekable range. This video cannot currently be sought.";
      if (ui.status.textContent !== reason) ui.status.textContent = reason;
    } else {
      if (!preview) {
        ui.slider.min = String(ranges[0].start);
        ui.slider.max = String(ranges.at(-1).end);
        ui.slider.value = String(logic.clampTarget(selected.currentTime, ranges) ?? ranges[0].start);
      }
      if (ui.status.textContent !== status) ui.status.textContent = status;
    }
    const shown = preview ? Number(ui.slider.value) : selected.currentTime;
    ui.current.textContent = `${preview ? "Preview " : ""}${logic.formatTime(shown)}`;
    ui.slider.setAttribute("aria-valuetext", `${logic.formatTime(shown)}; ${timeline.live ? "seekable window " : "duration "}${timeline.label}`);
  }

  function inspectSeek() {
    if (!observation || !selected) return;
    const request = observation;
    const now = performance.now();
    if (!request.wasPaused) request.elapsedPlayback += (now - request.lastTime) / 1000 * Math.abs(request.rate);
    request.lastTime = now;
    request.wasPaused = selected.paused;
    request.rate = selected.playbackRate;
    const matches = logic.seekMatches(selected.currentTime, request.target, request.elapsedPlayback);
    if (matches) request.matched = true;
    if (now - request.started < 2600) return;
    const ranges = logic.normalizeRanges(selected.seekable);
    const expired = ranges.length && request.target < ranges[0].start;
    let message;
    if (expired) message = "Seek observation inconclusive: the live window moved.";
    else if (selected.seeking) message = "Seek still pending; the player has not confirmed the position.";
    else if (!matches) message = request.matched ?
      "Likely seek rollback: the player moved away from the requested position." :
      "Likely seek rejection: the requested position was not observed.";
    else message = `Position observed near ${logic.formatTime(request.target)}. Later player restrictions may still apply.`;
    cancelObservation();
    announce(message);
  }

  function requestSeek(target) {
    preview = false;
    if (!selected) return;
    const previousSource = source;
    checkSource();
    if (previousSource !== source) { render(); return; }
    cancelObservation();
    const ranges = logic.normalizeRanges(selected.seekable);
    const valid = logic.clampTarget(target, ranges);
    if (valid === null || selected.readyState < 1 || selected.error) {
      announce("Seeking unavailable: no valid seekable position.");
      render();
      return;
    }
    const now = performance.now();
    observation = { target: valid, started: now, lastTime: now, elapsedPlayback: 0,
      wasPaused: selected.paused, rate: selected.playbackRate, matched: false, sawSeeking: false, sawSeeked: false };
    announce(`Requested ${logic.formatTime(valid)}. Checking player response...`);
    try {
      selected.currentTime = valid;
      if (observation) observationTimer = setInterval(() => { checkSource(); inspectSeek(); render(); }, 150);
    } catch (error) {
      cancelObservation();
      announce(`Seek rejected (${error.name || "media error"}).`);
    }
    render();
  }

  function constrainPosition() {
    if (!host || host.hidden) return;
    const width = host.getBoundingClientRect().width;
    const height = host.getBoundingClientRect().height;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const availableWidth = viewport?.width || innerWidth;
    const availableHeight = viewport?.height || innerHeight;
    const desired = position || { x: left + availableWidth - width - 20, y: top + 72 };
    const x = Math.max(left, Math.min(desired.x, left + availableWidth - width));
    const y = Math.max(top, Math.min(desired.y, top + availableHeight - height));
    if (position) position = { x, y };
    host.style.setProperty("--seek-left", `${x}px`);
    host.style.setProperty("--seek-top", `${y}px`);
  }

  function createPanel() {
    host = document.createElement("video-seek-controls");
    host.hidden = true;
    shadow = host.attachShadow({ mode: "open" });
    const stylesheet = document.createElement("style");
    stylesheet.textContent = globalThis.__videoSeekStyle;
    shadow.append(stylesheet);
    const panel = document.createElement("section");
    panel.setAttribute("aria-label", "AdPuncture seek controls");
    panel.innerHTML = `
      <header>
        <button id="header-toggle" type="button" title="Collapse" aria-label="AdPuncture" aria-expanded="true" aria-controls="body">
          <span class="grip" aria-hidden="true">&#10239;</span>
          <span>AdPuncture</span>
        </button>
        <button id="close" type="button" title="Hide AdPuncture" aria-label="Hide AdPuncture">&#215;</button>
      </header>
      <div id="body">
        <label id="video-label" hidden>Active video <select id="videos" aria-label="Active video"></select></label>
        <div class="times"><output id="current">--:--</output><span id="duration">--:--</span></div>
        <input id="slider" type="range" min="0" max="1" step="any" value="0" aria-label="Playback position" disabled>
        <div class="transport">
          <button id="back" type="button" title="Back 5 seconds" aria-label="Back 5 seconds">&#8630; 5</button>
          <button id="play" type="button" title="Play" aria-label="Play">&#9654;</button>
          <button id="forward" type="button" title="Forward 5 seconds" aria-label="Forward 5 seconds">5 &#8631;</button>
        </div>
      </div>
      <p id="status" role="status" aria-live="polite" aria-atomic="true"></p>`;
    shadow.append(panel);
    ui = Object.fromEntries(["slider", "current", "duration", "back", "forward", "play", "close", "body", "status", "videos"]
      .map(id => [id, shadow.getElementById(id)]));
    ui.videoLabel = shadow.getElementById("video-label");
    const options = { signal: lifetime.signal };
    const header = shadow.querySelector("header");
    const headerToggle = shadow.getElementById("header-toggle");
    let suppressHeaderClick = false;
    for (const event of ["keydown", "keyup", "keypress", "click", "pointerdown", "pointerup"]) {
      panel.addEventListener(event, eventObject => eventObject.stopPropagation(), options);
    }
    ui.close.addEventListener("click", () => setEnabled(false), options);
    header.addEventListener("click", event => {
      if (event.target.closest("#close")) return;
      if (suppressHeaderClick && event.detail !== 0) return;
      collapsed = !collapsed;
      ui.body.hidden = collapsed;
      headerToggle.setAttribute("aria-expanded", String(!collapsed));
      headerToggle.title = collapsed ? "Expand" : "Collapse";
      constrainPosition();
    }, options);
    ui.back.addEventListener("click", () => requestSeek(selected.currentTime - 5), options);
    ui.forward.addEventListener("click", () => requestSeek(selected.currentTime + 5), options);
    ui.play.addEventListener("click", async () => {
      const video = selected;
      const request = ++playRequest;
      try {
        if (video.paused) await video.play();
        else video.pause();
      } catch (error) {
        if (enabled && video === selected && request === playRequest) announce(`Playback request rejected (${error.name || "media error"}).`);
      }
      if (enabled && request === playRequest) render();
    }, options);
    ui.videos.addEventListener("change", () => {
      const video = [...videos].find(([, entry]) => String(entry.id) === ui.videos.value)?.[0];
      if (video) { selectVideo(video, true); refreshSelection(); }
    }, options);
    ui.slider.addEventListener("pointerdown", () => {
      gestureActive = true;
      gestureCancelled = false;
      preview = true;
    }, options);
    ui.slider.addEventListener("input", () => {
      if (!gestureCancelled) preview = true;
      render();
    }, options);
    ui.slider.addEventListener("change", () => {
      if (preview && !gestureCancelled) requestSeek(Number(ui.slider.value));
    }, options);
    const cancelPreview = () => {
      preview = gestureActive = false;
      gestureCancelled = true;
      render();
    };
    ui.slider.addEventListener("pointercancel", cancelPreview, options);
    ui.slider.addEventListener("blur", cancelPreview, options);
    ui.slider.addEventListener("keydown", event => {
      if (event.key === "Escape") cancelPreview();
      else if (!gestureActive) gestureCancelled = false;
    }, options);
    window.addEventListener("pointerup", () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        gestureActive = false;
        if (enabled && preview) cancelPreview();
      }, 0);
    }, { ...options, capture: true });
    header.addEventListener("pointerdown", event => {
      if (event.button !== 0 || !event.isPrimary || event.target.closest("#close")) return;
      suppressHeaderClick = false;
      const rectangle = host.getBoundingClientRect();
      dragging = { id: event.pointerId, x: event.clientX - rectangle.left, y: event.clientY - rectangle.top,
        startX: event.clientX, startY: event.clientY, moved: false };
      headerToggle.focus({ preventScroll: true });
      header.setPointerCapture(event.pointerId);
      event.preventDefault();
    }, options);
    header.addEventListener("pointermove", event => {
      if (!dragging || dragging.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY) > 5) dragging.moved = true;
      if (!dragging.moved) return;
      suppressHeaderClick = true;
      position = { x: event.clientX - dragging.x, y: event.clientY - dragging.y };
      constrainPosition();
    }, options);
    header.addEventListener("pointerup", event => {
      if (!dragging || dragging.id !== event.pointerId) return;
      suppressHeaderClick = dragging.moved;
      dragging = null;
    }, options);
    const cancelHeaderDrag = () => {
      if (dragging) suppressHeaderClick = true;
      dragging = null;
    };
    header.addEventListener("pointercancel", cancelHeaderDrag, options);
    header.addEventListener("lostpointercapture", cancelHeaderDrag, options);
    resizeObserver = new ResizeObserver(constrainPosition);
    resizeObserver.observe(host);
  }

  function setEnabled(value) {
    if (enabled === value) return;
    enabled = value;
    if (value) {
      lifetime = new AbortController();
      createPanel();
      observeRoot(document);
      const options = { signal: lifetime.signal };
      document.addEventListener("fullscreenchange", refreshSelection, options);
      document.addEventListener("visibilitychange", refreshSelection, options);
      window.addEventListener("resize", refreshSelection, options);
      window.addEventListener("scroll", scheduleSelection, { ...options, capture: true, passive: true });
      window.addEventListener("popstate", scheduleSelection, options);
      window.addEventListener("hashchange", scheduleSelection, options);
      window.addEventListener("pagehide", () => { cancelObservation(); preview = false; }, options);
      window.addEventListener("pageshow", refreshSelection, options);
      window.visualViewport?.addEventListener("resize", constrainPosition, options);
      window.visualViewport?.addEventListener("scroll", constrainPosition, options);
      fallbackTimer = setInterval(() => { discover(document); refreshSelection(); }, 3000);
      refreshSelection();
    } else {
      lifetime?.abort();
      selectedLifetime?.abort();
      resizeObserver?.disconnect();
      for (const entry of videos.values()) entry.controller.abort();
      for (const observer of roots.values()) observer.disconnect();
      videos.clear();
      roots.clear();
      clearTimeout(scanTimer);
      clearTimeout(previewTimer);
      clearInterval(fallbackTimer);
      cancelObservation();
      scanTimer = fallbackTimer = previewTimer = null;
      playRequest += 1;
      host?.remove();
      host = shadow = ui = selected = source = dragging = null;
      selectorSignature = "";
      preview = gestureActive = gestureCancelled = pinned = collapsed = false;
      candidates = [];
    }
    notifyState();
  }

  Object.defineProperty(globalThis, "__videoSeekControls", { value: Object.freeze({
    setEnabled,
    get enabled() { return enabled; }
  }) });
  runtime?.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== "VIDEO_SEEK_TOGGLE") return;
    setEnabled(!enabled);
    respond({ enabled });
  });
  setEnabled(true);
})();