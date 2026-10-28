// Helpers shared by the service worker, popup and options page.

export const DEFAULT_DEVICE = 'default';

// Rules are keyed by hostname, with a leading "www." dropped so
// www.youtube.com and youtube.com share one rule.
export function siteKey(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// A tab only needs capturing when its audio must go somewhere other than the
// default device or play at a volume other than 100%. Everything else is left
// untouched, so tabs without a rule behave exactly as if the extension wasn't installed.
export function needsCapture(rule) {
  return !!rule && (rule.deviceId !== DEFAULT_DEVICE || rule.volume !== 100);
}

export async function getRules() {
  const { rules = {} } = await chrome.storage.local.get('rules');
  return rules;
}

export async function saveRules(rules) {
  await chrome.storage.local.set({ rules });
}

export async function listOutputs() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter((d) => d.kind === 'audiooutput');
  // Without the one-time device permission Chromium hides labels and IDs.
  const permitted = outputs.some((d) => d.label);
  return {
    permitted,
    outputs: outputs.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications'),
  };
}
