"use strict";

async function updateAction(tabId, enabled) {
  await Promise.allSettled([
    chrome.action.setBadgeText({ tabId, text: enabled ? "ON" : "" }),
    chrome.action.setTitle({ tabId, title: enabled ? "Hide AdPuncture" : "Show AdPuncture on this page" })
  ]);
}

chrome.action.onClicked.addListener(async tab => {
  if (!Number.isInteger(tab.id)) return;
  try {
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: "VIDEO_SEEK_TOGGLE" }, { frameId: 0 });
    } catch {
      const stylesheet = await fetch(chrome.runtime.getURL("overlay.css"));
      if (!stylesheet.ok) throw new Error("Stylesheet unavailable");
      const css = await stylesheet.text();
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: text => { globalThis.__videoSeekStyle = text; },
        args: [css]
      });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["seek-logic.js", "content.js"] });
      response = { enabled: true };
    }
    if (typeof response?.enabled !== "boolean") throw new Error("Content script unavailable");
    await updateAction(tab.id, response.enabled);
  } catch {
    await Promise.allSettled([
      chrome.action.setBadgeText({ tabId: tab.id, text: "!" }),
      chrome.action.setTitle({ tabId: tab.id,
        title: "Cannot access this page. Open a normal website and click again. After an extension update, refresh the page. Chrome policies may block access." })
    ]);
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "VIDEO_SEEK_STATE" || !Number.isInteger(sender.tab?.id)) return;
  updateAction(sender.tab.id, message.enabled);
});