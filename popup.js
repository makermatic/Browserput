import { DEFAULT_DEVICE, siteKey, listOutputs, getRules } from './shared.js';

const $ = (id) => document.getElementById(id);

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const host = siteKey(tab?.url ?? '');

$('settings').onclick = () => chrome.runtime.openOptionsPage();
$('grant').onclick = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html#setup') });
};

$('host').textContent = host ?? 'This page';
if (tab?.favIconUrl) $('favicon').src = tab.favIconUrl;
else $('favicon').hidden = true;

if (!host) {
  $('unsupported').hidden = false;
} else {
  await init();
}

async function init() {
  const { permitted, outputs } = await listOutputs();
  const rule = (await getRules())[host];

  if (!permitted) {
    $('needsPermission').hidden = false;
    return;
  }

  const select = $('output');
  select.append(new Option('Default output (no routing)', DEFAULT_DEVICE));
  for (const d of outputs) select.append(new Option(d.label, d.deviceId));

  if (rule) {
    // Saved device may have a new ID; match by name, or keep it listed as missing.
    let option = [...select.options].find((o) => o.value === rule.deviceId) ??
      [...select.options].find((o) => o.text === rule.deviceLabel);
    if (!option) {
      option = new Option(`${rule.deviceLabel} (not connected)`, rule.deviceId);
      select.append(option);
    }
    select.value = option.value;
    setVolume(rule.volume);
  }
  $('controls').hidden = false;
  showSaved(rule);

  // Opening the popup is what lets the extension capture this tab.
  render(await chrome.runtime.sendMessage({ target: 'bg', type: 'popupOpened', tabId: tab.id, url: tab.url }));

  select.onchange = save;
  $('volume').oninput = () => {
    setVolume(+$('volume').value);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 60);
  };
  $('forget').onclick = async () => {
    render(await chrome.runtime.sendMessage({ target: 'bg', type: 'saveRule', tabId: tab.id, url: tab.url, host, rule: null }));
    select.value = DEFAULT_DEVICE;
    setVolume(100);
    showSaved(null);
  };
}

let saveTimer;

async function save() {
  const select = $('output');
  const option = select.selectedOptions[0];
  const rule = {
    deviceId: option.value,
    deviceLabel: option.value === DEFAULT_DEVICE ? '' : option.text.replace(/ \(not connected\)$/, ''),
    volume: +$('volume').value,
  };
  showSaved(rule);
  render(await chrome.runtime.sendMessage({ target: 'bg', type: 'saveRule', tabId: tab.id, url: tab.url, host, rule }));
}

function setVolume(v) {
  $('volume').value = v;
  $('volumeValue').textContent = `${v}%`;
}

function showSaved(rule) {
  $('saved').hidden = !rule;
  $('forget').hidden = !rule;
}

// Only speak up when something needs attention; the dropdown already shows
// where the audio is going.
function render(result) {
  const status = $('status');
  let message = '';
  if (result?.status === 'routed' && result.fallback) {
    message = `${result.wantedLabel} isn't connected. Playing on the default output until it's back.`;
  } else if (result?.status === 'pending') {
    message = `Couldn't capture this tab: ${result.error}`;
  } else if (result?.status === 'error') {
    message = `Something went wrong: ${result.error ?? 'unknown error'}`;
  }
  status.textContent = message;
  status.hidden = !message;
}
