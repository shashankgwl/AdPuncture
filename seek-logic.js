(function (root) {
  "use strict";

  function normalizeRanges(timeRanges) {
    const ranges = [];
    try {
      for (let index = 0; index < timeRanges.length; index += 1) {
        const start = timeRanges.start(index);
        const end = timeRanges.end(index);
        if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start) {
          ranges.push({ start, end });
        }
      }
    } catch {
      return [];
    }
    ranges.sort((first, second) => first.start - second.start);
    return ranges.reduce((merged, range) => {
      const previous = merged[merged.length - 1];
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
      else merged.push({ ...range });
      return merged;
    }, []);
  }

  function clampTarget(target, ranges) {
    if (!Number.isFinite(target) || !ranges.length) return null;
    let closest = ranges[0].start;
    for (const range of ranges) {
      if (target >= range.start && target <= range.end) return target;
      for (const boundary of [range.start, range.end]) {
        if (Math.abs(target - boundary) < Math.abs(target - closest)) closest = boundary;
      }
    }
    return closest;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
    const whole = Math.floor(seconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const remainder = String(whole % 60).padStart(2, "0");
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
  }

  function describeTimeline(duration, ranges) {
    if (Number.isFinite(duration) && duration > 0) return { live: false, label: formatTime(duration) };
    if (ranges.length) {
      return { live: true, label: `${formatTime(ranges[0].start)} - ${formatTime(ranges.at(-1).end)}` };
    }
    return { live: duration === Infinity, label: "--:--" };
  }

  function scoreVideo(candidate) {
    if (!candidate.visible || candidate.width < 80 || candidate.height < 45) return -Infinity;
    const area = candidate.width * candidate.height;
    return Math.min(60, area / 12000) + (candidate.loaded ? 45 : 0) +
      (candidate.playing ? 25 : 0) + (candidate.ended ? -35 : 0);
  }

  function chooseVideo(candidates, selected, pinned) {
    const ranked = candidates.map(candidate => ({ ...candidate, score: scoreVideo(candidate) }))
      .filter(candidate => Number.isFinite(candidate.score)).sort((first, second) => second.score - first.score);
    const current = ranked.find(candidate => candidate.video === selected);
    const best = ranked[0];
    if (!best) return { video: null, ranked };
    const retain = current && (pinned || current.score + 18 >= best.score);
    return { video: retain ? selected : best.video, ranked };
  }

  function seekMatches(actual, target, elapsedPlayback, tolerance = 1.25) {
    return Number.isFinite(actual) && Number.isFinite(target) &&
      actual >= target - tolerance && actual <= target + Math.max(0, elapsedPlayback) + tolerance;
  }

  const api = { normalizeRanges, clampTarget, formatTime, describeTimeline, scoreVideo, chooseVideo, seekMatches };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else if (!root.VideoSeekLogic) Object.defineProperty(root, "VideoSeekLogic", { value: Object.freeze(api) });
})(globalThis);