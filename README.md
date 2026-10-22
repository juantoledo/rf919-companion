# RF919 Companion

Unofficial controller for the **Raddy RF919** shortwave radio over Bluetooth LE.
It replaces the vendor "Radio-C" app with:

- **A web app**: a single HTML page using Web Bluetooth. Open it, tap
  Connect, and you get the radio's display plus all its buttons.
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

How to use it:
- **Tap** a button to press it; **hold it for about 0.6 s** for the long-press action (seek, band list, lock…).
- **Direct tune:** type a frequency, e.g. `9.5`, and the page enters it on the radio's own keypad.
- **Demo** shows the interface with recorded data, no radio needed.
- **Keep screen on** stops the phone from sleeping while you listen.
- **Disconnect** forgets the radio, so the next **Connect** lets you pick a different one.

### On this frequency

Once the radio settles on a frequency, the page asks [radiomap.cl](https://www.radiomap.cl/)
what is there (its per-frequency JSON API, `api/v1/freq/{kHz}.json`):

- **Shortwave**: the full EiBi schedule for that kHz, an ON AIR / OFF AIR pill, today's
  transmissions on a UTC bar, and the next broadcast when nothing is on.
- **Stations**: Chilean broadcasters, amateur repeaters (CTCSS tone, shift, DMR, EchoLink)
  and ATC, each linked to the radiomap.cl map.
- **Nearby with data**: tap a chip to tune the radio there.
- **Near me** sorts stations by distance. Your location is rounded to about 1 km and stays in
  the browser; the only thing sent to radiomap.cl is the frequency.

Web Bluetooth only works on **https** pages or `localhost`, so opening the file
directly from the phone's storage won't connect.

## Computer

The same page works in desktop Chrome or Edge (Windows, macOS, ChromeOS; on Linux you may
need to enable `chrome://flags/#enable-experimental-web-platform-features`).
Keyboard shortcuts: ←/→ step, Shift+←/→ seek, +/− volume, `b` band, `s` scan,
digits and `.` for the keypad, Enter = FREQ.

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
