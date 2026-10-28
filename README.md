# Browserput

Send each website's audio to its own output device, and have Brave (or any Chromium browser) remember it.

Built for a mixer setup: music on one fader, everything else on another. Pick an output for a site once and it stays that way.

## Install (Brave, Chrome, Edge)

1. Download this repo (green **Code** button → **Download ZIP**) and unzip it somewhere permanent.
2. Go to `brave://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder (the one containing `manifest.json`).
4. The settings page opens. Click **Allow access to audio devices** and accept the prompt.
   Chromium only shows device names after this one-time permission.
5. Pin the extension (puzzle icon → pin) so you can see its badge.

To update: replace the folder contents and click the reload ↻ icon on the extension card. Your saved
sites are kept because the extension ID is fixed by the `key` in `manifest.json`.

## Use

- On a site, open the popup and pick an output. Adjust the volume if you like. It's saved right away (✓).
- Sites without a saved output aren't touched at all and play on the default output as usual.
- Badge meanings:
  - **ON** (green): this tab is being routed.
  - **▶** (orange): this site has a saved output but the tab hasn't been started yet. Click the icon or press **Alt+Shift+A**.
  - **!** (red): the saved device isn't connected. The tab plays on the default output and switches back
    automatically when the device returns.
- Settings page: test tone per output (to find which mixer channel is which), edit or remove saved
  sites, export or import a backup.

### Automatic routing (no click)

Chromium only lets an extension capture a tab after you've interacted with the extension on that tab.
That's why each routed tab needs one click (or the shortcut) per browser session. To remove the click, launch Brave
with:

```
--allowlisted-extension-id=nkdalbdkkidbglmmihmdjcmbpliddhpg
```

- **Windows:** right-click the Brave shortcut → Properties → append the flag to the end of **Target**, after the closing quote.
  Fully quit Brave (including the tray icon) before relaunching.
- **macOS:** `open -a "Brave Browser" --args --allowlisted-extension-id=nkdalbdkkidbglmmihmdjcmbpliddhpg`
- **Linux:** add the flag to the `Exec=` line of the Brave `.desktop` file.

With the flag, saved sites route on their own as soon as they load.

## How it works (and why it's reliable)

Most "audio output per tab" extensions inject a script into the page and call `setSinkId()` on its
`<audio>`/`<video>` elements. That breaks in many ways:

- Device IDs are different for every website, and the site needs microphone permission to see them.
- Audio played through the Web Audio API, from iframes, or from elements created before the script runs gets missed.
- Players that rebuild their elements (YouTube, Spotify, Twitch) drop the setting.

Browserput uses Chromium's **tab capture** instead:

1. `chrome.tabCapture` grabs *all* audio the tab produces, whatever the source, and takes it off the
   normal output.
2. A hidden offscreen document plays that stream through an `AudioContext` with
   `setSinkId(<your device>)` and a gain node for the volume slider.
3. Rules are saved by hostname with the device's ID **and** name. If the ID changes (different USB port,
   driver update) it matches by name instead. Plugging or unplugging devices is handled live.
4. The capture follows the tab across navigation. If the tab moves to a site without a rule, capture
   stops and the tab goes back to normal.

### Known trade-offs

- Brave shows its "tab is being shared" indicator on routed tabs. That's tab capture and can't be hidden.
- Routing adds a few tens of milliseconds of audio delay. That's fine for music and tutorials, and lip-sync drift is
  barely noticeable.
- Browser pages (`brave://…`, the Web Store) can't be captured.
- Saved sites live in the browser profile (`chrome.storage.local`). Extensions can't choose a file on disk,
  so use Export/Import for backups.

## Project layout

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest, permissions, fixed extension key |
| `background.js` | Service worker: decides which tabs to capture, badges, rule changes |
| `offscreen.js` | Audio engine: captured streams → gain → chosen output device |
| `popup.*` | Toolbar popup (site, volume, output) |
| `options.*` | Settings: device access, test tones, saved sites, backup |
| `shared.js` | Helpers used by all of the above |

No build step: plain JavaScript modules, loaded unpacked.

## Roadmap

- [ ] "Mixer view" in the popup listing every routed tab with its own slider
- [ ] Match rules by wildcard (`*.youtube.com`) or path
- [ ] Optional per-site mute and solo
- [ ] Chrome Web Store / packaged release
