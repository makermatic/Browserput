import { DEFAULT_DEVICE, listOutputs, getRules, saveRules } from './shared.js';

const $ = (id) => document.getElementById(id);
let outputs = [];

$('flag').textContent = `--allowlisted-extension-id=${chrome.runtime.id}`;
chrome.commands.getAll().then((commands) => {
  const cmd = commands.find((c) => c.name === 'route-current-tab');
  $('shortcut').textContent = cmd?.shortcut
    ? `Keyboard shortcut to start routing the current tab: ${cmd.shortcut} (change it at brave://extensions/shortcuts).`
    : 'Tip: set a keyboard shortcut for "Apply this site\'s saved audio routing" at brave://extensions/shortcuts.';
});

$('grant').onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch (e) {
    $('permState').textContent = `Permission wasn't granted (${e.name}). Allow microphone for this extension in the address bar and try again.`;
    $('permState').className = 'state warn';
    return;
  }
  await refresh();
};

navigator.mediaDevices.addEventListener('devicechange', refresh);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.rules) renderRules();
});

async function refresh() {
  const result = await listOutputs();
  outputs = result.outputs;
  $('permState').textContent = result.permitted
    ? `Access granted. ${outputs.length} output${outputs.length === 1 ? '' : 's'} found.`
    : 'Not granted yet.';
  $('permState').className = result.permitted ? 'state ok' : 'state warn';
  $('grant').hidden = result.permitted;
  renderOutputs(result.permitted);
  await renderRules();
}

function renderOutputs(permitted) {
  const list = $('outputs');
  list.replaceChildren();
  if (!permitted) {
    list.append(Object.assign(document.createElement('li'), { textContent: 'Grant device access first.' }));
    return;
  }
  for (const d of outputs) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = d.label;
    const btn = document.createElement('button');
    btn.textContent = 'Play test tone';
    btn.onclick = () => testTone(d.deviceId);
    li.append(name, btn);
    list.append(li);
  }
}

async function testTone(sinkId) {
  const ctx = new AudioContext();
  await ctx.setSinkId(sinkId);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 660;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.03);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.7);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.75);
  osc.onended = () => ctx.close();
}

async function renderRules() {
  const rules = await getRules();
  const body = $('rules').querySelector('tbody');
  body.replaceChildren();
  const hosts = Object.keys(rules).sort();
  $('noRules').hidden = hosts.length > 0;
  $('rules').hidden = hosts.length === 0;

  for (const host of hosts) {
    const rule = rules[host];
    const tr = document.createElement('tr');

    const site = document.createElement('td');
    site.textContent = host;

    const select = document.createElement('select');
    select.append(new Option('Default output', DEFAULT_DEVICE));
    for (const d of outputs) select.append(new Option(d.label, d.deviceId));
    let match = [...select.options].find((o) => o.value === rule.deviceId) ??
      [...select.options].find((o) => o.text === rule.deviceLabel);
    if (!match) {
      match = new Option(`${rule.deviceLabel || rule.deviceId} (not connected)`, rule.deviceId);
      select.append(match);
    }
    select.value = match.value;
    select.onchange = () => {
      const o = select.selectedOptions[0];
      update(host, {
        deviceId: o.value,
        deviceLabel: o.value === DEFAULT_DEVICE ? '' : o.text.replace(/ \(not connected\)$/, ''),
      });
    };
    const output = document.createElement('td');
    output.append(select);

    const vol = document.createElement('td');
    const range = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 100, value: rule.volume });
    const label = Object.assign(document.createElement('span'), { className: 'vol', textContent: `${rule.volume}%` });
    range.oninput = () => (label.textContent = `${range.value}%`);
    range.onchange = () => update(host, { volume: +range.value });
    vol.append(range, label);

    const del = document.createElement('td');
    const btn = Object.assign(document.createElement('button'), { textContent: 'Remove' });
    btn.onclick = async () => {
      const all = await getRules();
      delete all[host];
      await saveRules(all);
    };
    del.append(btn);

    tr.append(site, output, vol, del);
    body.append(tr);
  }
}

async function update(host, patch) {
  const rules = await getRules();
  rules[host] = { ...rules[host], ...patch };
  await saveRules(rules);
}

$('export').onclick = async () => {
  const data = { app: 'browserput', version: 1, exportedAt: new Date().toISOString(), rules: await getRules() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'browserput-sites.json' });
  a.click();
  URL.revokeObjectURL(url);
};

$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async () => {
  const file = $('importFile').files[0];
  $('importFile').value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const incoming = data?.rules;
    if (!incoming || typeof incoming !== 'object') throw new Error('no "rules" in file');
    const clean = {};
    for (const [host, r] of Object.entries(incoming)) {
      if (typeof r?.deviceId !== 'string') continue;
      const volume = Math.min(100, Math.max(0, Math.round(Number(r.volume ?? 100))));
      clean[host] = { deviceId: r.deviceId, deviceLabel: String(r.deviceLabel ?? ''), volume };
    }
    await saveRules({ ...(await getRules()), ...clean });
    $('importState').textContent = `Imported ${Object.keys(clean).length} site(s).`;
    $('importState').className = 'state ok';
  } catch (e) {
    $('importState').textContent = `Couldn't import that file: ${e.message}`;
    $('importState').className = 'state warn';
  }
};

refresh();
