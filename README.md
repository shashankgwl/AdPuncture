---
title: AdPuncture
description: Locally loadable Chrome extension for independent, manual HTML5 video seeking on user-selected websites.
---

## Purpose

![AdPuncture: a surprised AD balloon meets a pin](icons/icon-128.png)

AdPuncture adds its own draggable playback-position slider to the
current website, including when an advertisement disables the site's seek bar.
It works with HTML5 video elements and requests position changes through
`HTMLMediaElement.currentTime`. It does not enable or modify the site's controls.
The scope includes Hotstar and other video websites, not only Hotstar.

This is manual seeking within the active video, **not universal ad skipping**.
The browser must expose a usable `video.seekable` range, and the player may
reject or reverse a change. Seeking within one advertisement may leave later
advertisements in the same break untouched. Short duration is not used to
classify a video as an advertisement.

A user-reported earlier Hotstar session accepted a change from approximately
0 to 4 seconds in one 10-second ad, then returned to main content. That is a
feasibility observation for that session, not a guarantee or a test completed
by this project.

## Install in Chrome

No build, package installation, or server is needed for the extension.

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** in the upper-right corner.
3. Choose **Load unpacked**.
4. Select this project folder, the folder containing [manifest.json](manifest.json).
5. Open Chrome's Extensions menu and pin **AdPuncture**.
6. Open the website containing the video and click the extension's toolbar icon.

The toolbar click grants temporary access to that tab and injects the local
scripts. There is no automatic injection across all your websites. Already-open
tabs can normally be activated immediately after installation. If activation
fails, refresh the tab, including any existing Hotstar tabs, and click again.
After a full page navigation or refresh, click the toolbar icon again.
Same-document SPA navigation remains supported while the extension is enabled.

Chrome internal pages, the Chrome Web Store, and other protected browser
surfaces cannot be scripted. File URLs and incognito require their respective
Chrome extension settings; normal HTTP/HTTPS video pages are the intended use.

## Use the controls

* Drag the playback slider to preview a position, then release to request it.
  Keyboard arrow, Home, and End keys use the native range input behavior.
  Escape cancels a preview. The player remains paused or playing as it was;
  seeking never calls `play()`.
* Use Back 5 seconds, Forward 5 seconds, and Play/Pause as needed.
  Play rejection and seek exceptions appear in the status area.
* Drag the panel header to move the panel. Its default position is near the
  upper-right, away from typical bottom-edge player controls.
* Click the header to collapse or expand, or focus its title and press Enter
  or Space. Hold and move the header to drag; dragging does not toggle it.
  Movement of up to five pixels counts as a click. The close button disables
  the overlay and its media observers. The toolbar icon restores it.
* The toolbar also toggles the overlay off/on. `ON` means discovery is enabled,
  even if no visible video is currently found. `!` means activation failed;
  hover over the toolbar icon for the access/refresh hint.
* When multiple usable videos are visible, choose an entry in Active video.
  Entries use local video numbers and dimensions, not video titles or URLs.
  A manual choice stays selected while it remains visible and connected.
  Toggle off/on to return to automatic selection.
* Live or unknown-duration media shows the available seek window. Requests
  outside that window or inside gaps clamp to the nearest valid boundary;
  equal-distance gaps choose the earlier boundary. The window is re-read
  at commit time, so a live preview may resolve to a newer valid position.

The extension makes one position assignment per requested seek. It observes
`seeking`, `seeked`, and time updates for approximately 2.6 seconds, allowing
for elapsed playback time and a 1.25-second tolerance. It reports an observed
position, likely rejection/rollback, or an inconclusive pending seek. It does
not repeatedly force a position. Small changes within that tolerance, player
stalls, and rollbacks after the observation period cannot be diagnosed reliably.

## Fullscreen and lifecycle

The panel moves inside the fullscreen player container when possible, then
returns on exit. If the video element itself (or an iframe) is fullscreen,
the custom overlay is hidden because these surfaces cannot render arbitrary
child controls. Exit fullscreen to use it; playback is not interrupted.
Picture-in-picture and native browser/OS media surfaces are not supported.
Unusual transformed or clipped fullscreen containers may also affect positioning.

Video discovery runs initially, observes added elements and relevant attributes,
and coalesces updates over 120 ms. A three-second fallback discovers late
attached open shadow roots and CSS-driven changes. There is no per-frame DOM
scan. Loaded, visible, larger playback videos are preferred over previews;
paused videos remain eligible. Similar-scoring selections are retained.

Ad/content video replacement and media load/source events cancel pending
previews and observations. Source identity uses the current media source and
`srcObject`, held only in memory. A site that changes logical content inside the
same MediaSource without exposing load events or identity changes cannot always
be recognized immediately. The browser's current seekable ranges still govern
every position request.

Disabling removes the UI, media listeners, observers, discovery/seek timers,
and pending previews. A lightweight extension-message listener remains to
support the toolbar. Disabling does not pause, resume, or seek the video.

## Update or uninstall

After changing these files:

1. Open `chrome://extensions` and find AdPuncture.
2. Click its **Reload** button.
3. Refresh the video tab to remove scripts from the previous extension version.
4. Click the toolbar icon again.

To uninstall, choose **Remove** on the extension card at `chrome://extensions`
and confirm. Refresh previously activated tabs to remove any existing panel.

## Real-site acceptance checklist

Run this in your own logged-in browser on Hotstar and each other target site.
Local tests do not establish whether a real site's ad player accepts seeking.

1. Start playback and wait for an actual advertisement whose native seek bar
   is unavailable. Click the extension toolbar icon. Do not classify ads from
   duration alone; use the site's own visible context.
2. Check that AdPuncture selects the playing advertisement. If multiple
   videos are listed, verify the chosen entry with a small seek request.
3. Record the original position, available seek window, requested position,
   and paused/playing state for your own comparison.
4. Drag to a modest later position inside the same ad. Confirm that preview
   changes do not seek until release and that the actual picture/playhead
   moves to the requested position if the player accepts it.
5. Wait at least three seconds. Compare actual playback progression and the
   panel status. If it rolls back or rejects the change, record that result;
   do not count it as success or repeatedly force seeks.
6. Let the remaining ad break proceed and verify eventual return to main
   content. Check later ads independently; one seek does not complete a break.
7. Repeat while paused and confirm seeking does not start playback. Test
   keyboard slider changes, the five-second buttons, and Play/Pause.
8. Check ad/content element replacement, same-element source changes, and
   SPA navigation. No usable video should leave no visible panel.
9. Test player-container fullscreen, video-element fullscreen, dragging,
   resizing, collapse, close, and toolbar restoration.
10. Toggle off/on repeatedly. Confirm one panel only and normal site playback
    when disabled. Repeat on a second website to check cross-site behavior.

## Troubleshooting

| Symptom | Explanation or next step |
| --- | --- |
| No panel | Click the toolbar icon on the video tab. Start/load a video and keep it visible. Wait up to three seconds. Try the selector when available. |
| Toolbar shows `!` | Hover for the hint. Use a normal webpage, refresh after installation/update, and click again. Protected Chrome pages disallow injection. |
| Seeking disabled | Metadata is missing, a media error occurred, or `seekable` is empty. A finite duration alone does not prove seeking is possible. |
| Video returns to its old position | The site may enforce its own playback policy. The extension reports likely rollback and does not fight it. |
| Wrong video | Choose the other visible video in Active video. Tiny/offscreen/hidden previews are excluded, but visibility heuristics cannot identify every player's intended video. |
| Embedded video missing | This version injects into the top document only. Iframe videos, including same-origin embeds, are not traversed. Cross-origin frames and closed shadow roots are unsupported; no boundary is bypassed. Open the video provider's actual page when available. |
| No panel in fullscreen | Native video-element fullscreen, iframe fullscreen, or picture-in-picture cannot host these controls. Exit that mode or use the site's container/theater view. |
| Page handles keyboard shortcuts first | The panel stops bubbling events, but site capture-phase handlers can still run first. Use pointer controls if those handlers interfere. Global event APIs are not patched. |
| Load unpacked unavailable | Your organization may prohibit developer mode or unpacked extensions. Check `chrome://policy` and contact your administrator; do not bypass managed policies. |

## Permissions and privacy

Only two permissions are requested:

* `activeTab` grants temporary access to the tab on which you explicitly click
  the extension. It avoids persistent host permission for Hotstar or any other
  website. Cross-origin navigation revokes this temporary grant.
* `scripting` injects the bundled scripts and CSS into that authorized tab.
  Code runs in Chrome's isolated extension world, not the site's main world.

There are no `host_permissions`, static content scripts, remote scripts,
web-accessible resources, `tabs`, `storage`, `debugger`, `webRequest`, cookies,
native messaging, analytics, or telemetry permissions. `chrome.tabs.sendMessage`
does not require the `tabs` permission. The service worker reads only the
extension's bundled stylesheet, not network/video resources.

Panel position and selection are kept only in memory for the current page.
Nothing is persisted or transmitted: no browsing history, titles, URLs,
account information, or playback activity. The extension does not intercept
requests, obtain stream URLs, change streaming manifests, bypass DRM, alter
subscriptions, spoof ad-completion events, or monkey-patch browser/player APIs.
Review each service's applicable terms before using independent seek controls.

## Tests and files

Node.js 18 or newer is needed only for development checks. No dependencies or
build step are required.

```shell
npm test
npm run fixture
```

Open the local URL printed by the fixture server, normally
<http://127.0.0.1:4173/tests/fixture.html>. An occupied port selects another
available port. The server binds only to loopback and serves an explicit file
allowlist. Stop it with Ctrl+C when finished.

Run simulated media tests for lifecycle, preview/commit, live-window clamping,
rollback, error handling, open shadow roots, positioning, and repeated toggles.
Choose Generate local video to record original canvas frames into an in-memory
WebM, then try the overlay against the real browser media API with native controls
disabled. The fixture never downloads third-party video. Its simulated media
properties exist only on fixture-created video elements; production code does
not override media properties. Do not also activate the installed extension on
this fixture: the page already loads its own test copy of the overlay.

| File | Purpose |
| --- | --- |
| [manifest.json](manifest.json) | Directly loadable Manifest V3 configuration |
| [background.js](background.js) | Toolbar activation, scoped injection, badges and failure hints |
| [content.js](content.js) | Discovery, media lifecycle, shadow-root UI, seeking and observation |
| [seek-logic.js](seek-logic.js) | Pure range, formatting, selection and observation helpers |
| [overlay.css](overlay.css) | Isolated light/dark panel styling |
| [icons/adpuncture.svg](icons/adpuncture.svg) | Original editable balloon-and-pin logo |
| [icons/icon-16.png](icons/icon-16.png), [icons/icon-32.png](icons/icon-32.png), [icons/icon-48.png](icons/icon-48.png), [icons/icon-128.png](icons/icon-128.png) | Packaged Chrome toolbar and extension icons |
| [package.json](package.json) | Dependency-free test and fixture commands |
| [tests/logic.test.cjs](tests/logic.test.cjs) | Pure logic unit tests |
| [tests/extension.test.cjs](tests/extension.test.cjs) | Manifest and toolbar/injection contract tests |
| [tests/fixture.html](tests/fixture.html) | Browser test surface |
| [tests/fixture.js](tests/fixture.js) | Simulated media tests and generated real video |
| [tests/serve.cjs](tests/serve.cjs) | Loopback-only fixture server |

The local fixture and mocked toolbar tests are not proof of acceptance by any
real site's player. Logged-in ad playback, service-specific restrictions,
managed-browser behavior, and each site's fullscreen integration require the
manual checklist above.