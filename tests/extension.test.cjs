const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

test("manifest uses temporary user-initiated access, no persistent host access", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "AdPuncture");
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  for (const filename of ["seek-logic.js", "content.js", "overlay.css", manifest.background.service_worker]) {
    assert.ok(fs.existsSync(path.join(root, filename)), `${filename} exists`);
  }
});

test("AdPuncture packages correctly sized PNG icons for Chrome", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.icons), ["16", "32", "48", "128"]);
  for (const [size, filename] of Object.entries(manifest.icons)) {
    const png = fs.readFileSync(path.join(root, filename));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), Number(size));
    assert.equal(png.readUInt32BE(20), Number(size));
  }
  assert.equal(manifest.action.default_icon[16], manifest.icons[16]);
  assert.equal(manifest.action.default_icon[32], manifest.icons[32]);
  assert.match(manifest.action.default_title, /AdPuncture/);
});

test("all runtime JavaScript parses without a build step", () => {
  for (const filename of ["content.js", "seek-logic.js", "background.js"]) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(root, filename), "utf8")), filename);
  }
});

function background(sendMessage, inject = async () => []) {
  const calls = [];
  let clicked, message;
  const chrome = {
    action: {
      onClicked: { addListener(listener) { clicked = listener; } },
      async setBadgeText(value) { calls.push(["badge", value]); },
      async setTitle(value) { calls.push(["title", value]); }
    },
    scripting: { executeScript: inject },
    tabs: { sendMessage },
    runtime: { getURL: filename => `chrome-extension://test/${filename}`, onMessage: { addListener(listener) { message = listener; } } }
  };
  const fetch = async () => ({ ok: true, text: async () => ":host {}" });
  vm.runInNewContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), { chrome, fetch });
  return { calls, click: tab => clicked(tab), message: (value, sender) => message(value, sender) };
}

test("toolbar toggles existing top-frame controls", async () => {
  const worker = background(async (id, message, options) => {
    assert.equal(id, 42);
    assert.equal(message.type, "VIDEO_SEEK_TOGGLE");
    assert.equal(options.frameId, 0);
    return { enabled: false };
  });
  await worker.click({ id: 42 });
  assert.equal(worker.calls[0][1].text, "");
});

test("first click injects local resources on any permitted website", async () => {
  const scripts = [];
  const worker = background(async () => { throw Error("No receiver"); }, async details => scripts.push(details));
  await worker.click({ id: 9 });
  assert.equal(scripts.length, 2);
  assert.equal(scripts[0].target.tabId, 9);
  assert.deepEqual(Array.from(scripts[1].files), ["seek-logic.js", "content.js"]);
  assert.equal(worker.calls[0][1].text, "ON");
});

test("restricted pages show an access and refresh hint", async () => {
  const worker = background(async () => { throw Error("No receiver"); }, async () => { throw Error("Cannot access"); });
  await worker.click({ id: 9 });
  assert.equal(worker.calls[0][1].text, "!");
  assert.match(worker.calls[1][1].title, /refresh/);
});

test("close-button state updates the toolbar badge", () => {
  const worker = background(async () => {});
  worker.message({ type: "VIDEO_SEEK_STATE", enabled: false }, { tab: { id: 8 } });
  assert.equal(worker.calls[0][1].text, "");
  assert.equal(worker.calls[0][1].tabId, 8);
});