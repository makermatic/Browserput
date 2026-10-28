import { DEFAULT_DEVICE } from './shared.js';

// tabId -> { stream, ctx, gain, rule, sinkLabel, fallback }
//
// Capturing a tab takes its audio away from the normal output. Each session
// plays that audio back through its own AudioContext, pointed at the chosen
// device, so the audio comes out of exactly one place.
const sessions = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  handle(msg).then(sendResponse, (e) => sendResponse({ status: 'error', error: String(e?.message ?? e) }));
  return true;
});

async function handle(msg) {
  switch (msg.type) {
    case 'start':
      return start(msg.tabId, msg.streamId, msg.rule);
    case 'update':
      return update(msg.tabId, msg.rule);
    case 'stop':
      stop(msg.tabId);
      return { status: 'idle' };
    case 'list':
      return Object.fromEntries([...sessions].map(([tabId, s]) => [tabId, describe(s)]));
  }
}

function describe(s) {
  return {
    status: 'routed',
    sinkLabel: s.sinkLabel,
    fallback: s.fallback,
    wantedLabel: s.rule.deviceLabel ?? '',
    volume: s.rule.volume,
    contextState: s.ctx.state,
  };
}

// Device IDs are stable for the extension, but a device can come back with a
// new ID (different USB port, driver update), so fall back to its name.
async function resolveSink(rule) {
  if (rule.deviceId === DEFAULT_DEVICE) return { sinkId: '', label: 'Default output', fallback: false };
  const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
  const match =
    outputs.find((d) => d.deviceId === rule.deviceId) ??
    (rule.deviceLabel ? outputs.find((d) => d.label === rule.deviceLabel) : undefined);
  if (match) return { sinkId: match.deviceId, label: match.label, fallback: false };
  return { sinkId: '', label: 'Default output', fallback: true };
}

async function applyRule(s, rule) {
  s.rule = rule;
  s.gain.gain.setTargetAtTime(rule.volume / 100, s.ctx.currentTime, 0.015);
  const sink = await resolveSink(rule);
  if (s.ctx.sinkId !== sink.sinkId) await s.ctx.setSinkId(sink.sinkId);
  s.sinkLabel = sink.label;
  s.fallback = sink.fallback;
  if (s.ctx.state !== 'running') await s.ctx.resume();
}

async function start(tabId, streamId, rule) {
  stop(tabId);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  const gain = ctx.createGain();
  ctx.createMediaStreamSource(stream).connect(gain).connect(ctx.destination);

  const s = { stream, ctx, gain, rule, sinkLabel: '', fallback: false };
  sessions.set(tabId, s);

  // Fires when the tab closes or the capture is otherwise torn down.
  stream.getAudioTracks()[0].addEventListener('ended', () => {
    if (sessions.get(tabId) !== s) return;
    stop(tabId);
    notify(tabId, { status: 'idle' });
  });

  try {
    await applyRule(s, rule);
  } catch (e) {
    stop(tabId);
    throw e;
  }
  return describe(s);
}

async function update(tabId, rule) {
  const s = sessions.get(tabId);
  if (!s) return { status: 'idle' };
  await applyRule(s, rule);
  return describe(s);
}

function stop(tabId) {
  const s = sessions.get(tabId);
  if (!s) return;
  sessions.delete(tabId);
  s.stream.getTracks().forEach((t) => t.stop());
  s.ctx.close();
}

function notify(tabId, result) {
  chrome.runtime.sendMessage({ target: 'bg', type: 'sessionChanged', tabId, result }).catch(() => {});
}

// Mixer unplugged or plugged back in: move every stream to its saved device
// if present, or to the default device until it returns.
navigator.mediaDevices.addEventListener('devicechange', async () => {
  for (const [tabId, s] of sessions) {
    const before = s.fallback;
    try {
      await applyRule(s, s.rule);
    } catch {
      continue;
    }
    if (before !== s.fallback) notify(tabId, describe(s));
  }
});
