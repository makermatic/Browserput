import { siteKey, needsCapture, getRules, saveRules } from './shared.js';

// The offscreen document owns every captured stream; this worker decides
// which tabs to capture and where their audio should go.

let creatingOffscreen = null;

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Plays captured tab audio on the output device chosen for that site.',
    })
    .finally(() => (creatingOffscreen = null));
  await creatingOffscreen;
}

async function toOffscreen(message) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: 'offscreen', ...message });
}

async function activeSessions() {
  if (!(await hasOffscreen())) return {};
  return (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'list' })) ?? {};
}

// --- Badge -----------------------------------------------------------------

const BADGES = {
  idle: { text: '', color: '#000000', title: 'Browserput' },
  routed: { text: 'ON', color: '#1f9d55', title: 'Audio routed to: ' },
  fallback: { text: '!', color: '#d64545', title: 'Saved output not found, playing on the default device instead. Saved output: ' },
  pending: { text: '▶', color: '#e08a00', title: 'This site has a saved output. Click to start routing.' },
};

async function setBadge(tabId, result) {
  let kind = result.status;
  if (kind === 'routed' && result.fallback) kind = 'fallback';
  const badge = BADGES[kind] ?? BADGES.idle;
  let title = badge.title;
  if (kind === 'routed') title += result.sinkLabel;
  if (kind === 'fallback') title += result.wantedLabel;
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
    await chrome.action.setBadgeText({ tabId, text: badge.text });
    await chrome.action.setTitle({ tabId, title });
  } catch {
    // Tab closed while we were working.
  }
}

// --- Applying rules ----------------------------------------------------------

// Runs per-tab work one call at a time, so overlapping navigation events
// can't start two captures of the same tab.
const queues = new Map();
function serial(tabId, fn) {
  const next = (queues.get(tabId) ?? Promise.resolve()).then(fn, fn);
  queues.set(tabId, next.catch(() => {}));
  return next;
}

function applyToTab(tabId, url) {
  return serial(tabId, async () => {
    const host = siteKey(url);
    const rule = host ? (await getRules())[host] : null;
    const active = (await activeSessions())[tabId];
    let result;

    if (!needsCapture(rule)) {
      if (active) await toOffscreen({ type: 'stop', tabId });
      result = { status: 'idle' };
    } else if (active) {
      result = await toOffscreen({ type: 'update', tabId, rule });
    } else {
      let streamId = null;
      try {
        // Only succeeds once the extension has been invoked on this tab
        // (popup, keyboard shortcut), or when the browser was started with
        // --allowlisted-extension-id. See README "Automatic routing".
        streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
      } catch (e) {
        result = { status: 'pending', error: String(e?.message ?? e) };
      }
      if (streamId) result = await toOffscreen({ type: 'start', tabId, streamId, rule });
    }

    await setBadge(tabId, result);
    return { ...result, host, rule: rule ?? null };
  });
}

async function applyToAllTabs(filterHost) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((t) => t.url && (!filterHost || siteKey(t.url) === filterHost))
      .map((t) => applyToTab(t.id, t.url)),
  );
}

// --- Events ------------------------------------------------------------------

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') applyToTab(tabId, tab.url);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  queues.delete(tabId);
  if ((await activeSessions())[tabId]) await toOffscreen({ type: 'stop', tabId });
});

chrome.runtime.onStartup.addListener(() => applyToAllTabs());
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') chrome.runtime.openOptionsPage();
  await applyToAllTabs();
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'route-current-tab' && tab?.id) applyToTab(tab.id, tab.url);
});

// Rules edited anywhere (popup, options page, import) take effect immediately
// on every tab of the affected sites.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.rules) return;
  const before = changes.rules.oldValue ?? {};
  const after = changes.rules.newValue ?? {};
  const hosts = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const host of hosts) {
    if (JSON.stringify(before[host]) !== JSON.stringify(after[host])) applyToAllTabs(host);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'bg') return;
  handle(msg).then(sendResponse, (e) => sendResponse({ status: 'error', error: String(e?.message ?? e) }));
  return true;
});

async function handle(msg) {
  switch (msg.type) {
    // Opening the popup counts as invoking the extension on the tab, which is
    // what allows tab capture to start.
    case 'popupOpened':
      return applyToTab(msg.tabId, msg.url);

    case 'saveRule': {
      const rules = await getRules();
      if (msg.rule) rules[msg.host] = msg.rule;
      else delete rules[msg.host];
      await saveRules(rules);
      return applyToTab(msg.tabId, msg.url);
    }

    // Sent by the offscreen document when a stream ends or a device change
    // moved a stream to or from its saved output.
    case 'sessionChanged':
      await setBadge(msg.tabId, msg.result);
      return {};
  }
}
