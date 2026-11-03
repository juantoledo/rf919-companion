# RF919 Companion

Unofficial controller for the **Raddy RF919** shortwave radio over Bluetooth LE.
It replaces the vendor "Radio-C" app with:

- **A web app**: a single HTML page that tells you what's on the air. Look up any frequency, or
  connect the radio over Web Bluetooth and the page follows its dial. Its buttons are there too.
- **A protocol write-up** ([PROTOCOL.md](PROTOCOL.md)) covering frames, commands,
  status messages and band codes.

Not affiliated with or endorsed by Raddy. Use at your own risk.

## Phone (web app)

Open **https://juantoledo.github.io/rf919-companion/**
(served by GitHub Pages from [`docs/index.html`](docs/index.html)).

| Phone | Browser |
|---|---|
| Android | Chrome or Edge |
| iPhone / iPad | **Bluefy** (free, App Store). Safari has no Web Bluetooth |

1. Turn the radio on and make sure the vendor app isn't connected to it.
2. Tap **Connect radio** and pick `RF919-BLE` from the list of nearby Bluetooth devices.
3. Optional: use **Add to Home screen** so it opens like an app.

The app has four tabs at the bottom (a rail on the left on wide screens):

| Tab | What's there |
|---|---|
| **Radio** | The radio's frequency, band, preset and signal; ◀ ▶, Memo, Sub, volume, **Keys** (the Remote), **Store here**; and what's on the frequency the radio is tuned to |
| **Explore** | Look up any frequency, with or without the radio |
| **Memories** | Memory lists for the radio, one band at a time |
| **More** | Connection, settings, the radio's text lines, tools and the log |

On every tab but Radio, a **radio bar** above the tabs keeps the radio at hand: band, frequency,
◀ ▶ and Memo. Tap it (or swipe it up) for the **Remote**, with every key of the radio.

**Gestures** (each also has a button): swipe a frequency **left to step up, right to step down**,
and flick it further to seek; swipe the radio bar **up** to open the Remote; drag the Remote down
by its top edge to close it.

### What's on the air

The page asks [radiomap.cl](https://www.radiomap.cl/) what is on a frequency (its per-frequency
JSON API, `api/v1/freq/{kHz}.json`). It works with or without the radio:

- **Explore** looks up any frequency: `9580` (kHz), or `9.58`, `146.73`, `101.3` (MHz).
  The address becomes `…/#f=9580`, so a lookup can be bookmarked or shared.
  **Tune radio to…** sends the radio there.
- **Radio** shows the same for the frequency the radio is on, and follows the dial.
- **Shortwave**: the station on air (or the next one) with its flag, transmitter site, language
  and target, today's transmissions on a UTC bar, and the full EiBi schedule.
- **Stations**: Chilean broadcasters, amateur repeaters (output/input, CTCSS tone, shift, DMR,
  EchoLink) and ATC, each linked to the radiomap.cl map.
- **Nearby**: the closest frequencies with data and what's on them. Tap one to tune the radio
  there (or to look it up when no radio is connected).
- **Near me** filters by your location as well as sorting stations by distance. It hides stations
  farther than the radius you pick next to it (25–500 km, or any), and on shortwave it keeps the
  broadcasts aimed at your region (EiBi target: South America from Chile). Nearby only lists
  neighbours that pass. **Show all** lifts the filter for the frequency you're on. The target
  regions are rough boxes, and country targets are only known for the Americas.
  Your location is rounded to about 1 km and stays in the browser; the only thing sent to radiomap.cl is the frequency. Flags come from the
  flag-icons package on jsDelivr.

### The radio's controls

- ◀ ▶ step the frequency (**hold about 0.6 s** to seek); so does swiping the frequency.
- **The band chip** (`AIR ▾`, on the readout, the radio bar and the Remote) opens the phone's own
  picker with the radio's bands; pick one and the radio switches.
- **Sub**: the radio's sub-band key (MODE in the vendor app).
- **Scan** (Remote) sends the vendor app's SCAN key, `1A`, which doesn't scan on the RF919, and the radio
  doesn't report its own scans over Bluetooth either. It never sends a long press, because holding
  SCAN/ATS on the RF919 deletes every memory of the band. Holding **Play**, or the
  radio's SCAN-slot key in the Remote (labelled V-UHF on the RF919), still sends that long press, but
  only after a confirmation.
- **Memo**: a tap switches the radio's memory channel mode, a hold starts storing, as on the radio.
- **Keys** (or the radio bar, or `r` on a keyboard) opens the Remote: every key, the keypad and
  direct tune.
- **More › Tools › Log** has two diagnostic switches: **Every notification** logs each Bluetooth
  notification before decoding, and **Also listen on FFF1 and battery** (after Disconnect, then
  Connect) logs the radio's other two channels, which the vendor app never uses. Both only listen.
- **More › Tools › Key capture** shows what the radio reports when you press one of *its own*
  buttons: a guess at the button, what changed, and the raw messages. It's informational and sends
  nothing. The RF919 doesn't send key codes, only what changed (frequency, channel mode, a setting…).
- **Demo** (on the Radio tab, the radio bar or More) shows the radio side with recorded data, no
  radio needed. It also pretends to be a radio for what you send, so Memories can be tried without one.
- **More › Connection › Disconnect** forgets the radio, so the next **Connect** lets you pick a
  different one.

### Memories

The **Memories** tab loads a list of frequencies into the radio's memory channels. The radio
has no command for this, so the page presses the same keys you would (tune, hold MEMO, type the
channel, confirm), one channel at a time, about 2–3 s each. See [memory.md](memory.md).

- **Build the list** by typing lines (`1 SW 5025`, `FM 101.3 Radio Bio Bio`, `146.730`), with
  **+ Memory** under any frequency you look up, from the shortwave stations on air in the
  chosen meter bands (EiBi), or from the Chilean stations near you (radiomap.cl).
- **At most 200 channels per band**, which is the radio's limit. A line without a channel takes
  the next free one in its band, and the page refuses anything past 200.
- **Store** runs the list and stops at the first step the radio doesn't answer. **Resume**
  picks it up from there. **Check on radio** recalls every channel and compares it.
- **Store here** (under the radio's frequency) saves what the radio is tuned to on the channel after
  the last one in use in that band. The radio proposes that channel when MEMO is held, and the page
  just confirms it. If the page has looked the station up, its name is kept.
- **Backup** exports what the app knows is on the radio (what it stored, plus what Check on radio
  found) as a text file, one `channel band frequency name` line per channel, the same format as
  Edit as text. Share it or download it. To import, open the file and choose **Load to store** (the
  radio was wiped: the file becomes the list, then Store) or **Already on radio** (a new phone or
  browser: the app learns the channels, and nothing is sent).
- **One band at a time:** the Memories tab shows the band the radio is on, and follows it when you
  change band on the radio. The band tabs above the list (`● AIR · 11`) let you look at another
  band. **Store**, **Check on radio**, **Start fresh** and **Edit as text** act on the band shown;
  in Edit as text, lines without a band belong to it. Backup still exports every band.
- **Start fresh** wipes the band shown on the radio, the same as holding SCAN/ATS (all 200
  channels of the band), then clears the app's list and record for it. It recalls a channel
  afterwards to make sure it's empty before clearing anything in the app.
- The radio can't show names. When it recalls a channel, the page shows the stored name.
- **Test one memory** and **More › Tools › Developer** are for working out the parts of the store
  sequence that aren't confirmed yet.

Web Bluetooth only works on **https** pages or `localhost`, so opening the file
directly from the phone's storage won't connect.

## Computer

The same page works in desktop Chrome or Edge (Windows, macOS, ChromeOS; on Linux you may
need to enable `chrome://flags/#enable-experimental-web-platform-features`).
Keyboard shortcuts: `/` search (Explore), `r` Remote, ←/→ step, Shift+←/→ seek, +/− volume, `b` band,
`s` Scan, digits and `.` for the keypad, Enter = FREQ. With no radio connected, typing digits
starts a search.

On Linux, if a previous session didn't close cleanly, BlueZ may still hold the
connection and the radio stops advertising. Free it with `bluetoothctl disconnect <addr>`.

## Development

The web app is static files in [`docs/`](docs/): `index.html`, `css/` (design tokens and styles) and
`js/` as ES modules, with no build step. `js/protocol.js`, `js/radiomap.js` and `js/memories.js` hold
the logic and touch no DOM; `js/ui/` holds the views; `js/app.js` starts them.

```sh
npm test            # logic checks (protocol frames, memory lists, store/recall against the simulated radio…)
npm run serve       # http://localhost:8919
```

Browser checks (Chrome via playwright-core) are in [`tests/ui/`](tests/ui/README.md).

## Status

Tested against an RF919 with firmware 1.910: connecting, the handshake, the frequency,
mode, battery and band status messages, and the display text all work. Typing a
frequency on the radio's keypad (direct tune) is untested so far. See
[PROTOCOL.md](PROTOCOL.md) for what's confirmed and what's inferred.

`samples/` holds packets recorded from the radio, one `<seconds> <hex bytes>` line per packet.
`replay_demo.txt` (the source of the web app's Demo mode) also contains a few packets
rebuilt from decoded values; its header explains which.
