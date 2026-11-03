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
2. Tap **Connect** and pick `RF919-BLE` from the list of nearby Bluetooth devices.
3. Optional: use **Add to Home screen** so it opens like an app.

### What's on the air

The page asks [radiomap.cl](https://www.radiomap.cl/) what is on a frequency (its per-frequency
JSON API, `api/v1/freq/{kHz}.json`). It works with or without the radio:

- **Look up** any frequency in the search field: `9580` (kHz), or `9.58`, `146.73`, `101.3` (MHz).
  The address becomes `…/#f=9580`, so a lookup can be bookmarked or shared.
- **Connected**, the page follows the radio. A search pins the page to that frequency;
  **Back to radio** follows the dial again, and **Tune radio to…** sends the radio there.
- **Shortwave**: the station on air (or the next one) with its flag, transmitter site, language
  and target, today's transmissions on a UTC bar, and the full EiBi schedule.
- **Stations**: Chilean broadcasters, amateur repeaters (output/input, CTCSS tone, shift, DMR,
  EchoLink) and ATC, each linked to the radiomap.cl map.
- **Nearby**: the closest frequencies with data and what's on them. Tap one to tune the radio
  there (or to look it up when no radio is connected).
- **Near me** sorts stations by distance. Your location is rounded to about 1 km and stays in
  the browser; the only thing sent to radiomap.cl is the frequency. Flags come from the
  flag-icons package on jsDelivr.

### The radio's controls

- The bar at the bottom steps ◀ ▶ (**hold about 0.6 s** to seek) and sets the volume.
- **Remote** (or ☰ at the top) opens every other key: the keypad, direct tune, the radio's
  text lines, and settings (Demo, Keep screen on, Disconnect, the connection log).
- **Demo** shows the radio side with recorded data, no radio needed. It also pretends to be a
  radio for what you send, so Memories can be tried without one.
- **Disconnect** forgets the radio, so the next **Connect** lets you pick a different one.

### Memories

**Remote › Memories** loads a list of frequencies into the radio's memory channels. The radio
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
- **By band:** when the list has several bands, tick the ones to store or check. All are ticked
  until you pick; adding a new band to the list ticks them all again.
- **Start fresh** wipes the ticked bands on the radio, the same as holding SCAN/ATS (all 200
  channels of the band), then clears the app's list and record for them. It recalls a channel
  afterwards to make sure it's empty before clearing anything in the app.
- The radio can't show names. When it recalls a channel, the page shows the stored name.
- **Test one memory** and **Settings › Developer** are for working out the parts of the store
  sequence that aren't confirmed yet.

Web Bluetooth only works on **https** pages or `localhost`, so opening the file
directly from the phone's storage won't connect.

## Computer

The same page works in desktop Chrome or Edge (Windows, macOS, ChromeOS; on Linux you may
need to enable `chrome://flags/#enable-experimental-web-platform-features`).
Keyboard shortcuts: `/` search, `r` Remote, ←/→ step, Shift+←/→ seek, +/− volume, `b` band,
`s` scan, digits and `.` for the keypad, Enter = FREQ. With no radio connected, typing digits
starts a search.

On Linux, if a previous session didn't close cleanly, BlueZ may still hold the
connection and the radio stops advertising. Free it with `bluetoothctl disconnect <addr>`.

## Status

Tested against an RF919 with firmware 1.910: connecting, the handshake, the frequency,
mode, battery and band status messages, and the display text all work. Typing a
frequency on the radio's keypad (direct tune) is untested so far. See
[PROTOCOL.md](PROTOCOL.md) for what's confirmed and what's inferred.

`samples/` holds packets recorded from the radio, one `<seconds> <hex bytes>` line per packet.
`replay_demo.txt` (the source of the web app's Demo mode) also contains a few packets
rebuilt from decoded values; its header explains which.
