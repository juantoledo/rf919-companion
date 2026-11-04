# Browser checks

Two scripts drive the web app in Chrome through its **Demo** (a simulated radio, no Bluetooth needed):

- `e2e.mjs`: tabs and links, View Transitions (the chip that grows into the dial), the Remote (and its slide away),
  gestures, band pickers, memories (store, check, Store here, clear, Start fresh), backup, switches, Find the Preset
  key, Near me, keyboard, Explore (home and detail with Back and ←, dial, band strip, Full schedule, pins, Share,
  Nearby, Discover, reminders, search by name, On air now, tune as you explore and its Undo, two panes on a wide
  screen), the Log (an entry from a short dwell, star, delete and Undo, ADIF export, "Logged once"), the signal meter,
  the idle mini player pill. Exits 1 on any failure or page error.
- `audit.mjs`: every visible control on every view (Explore both as its home and as a detail, the Log with a few entries), in the Remote and in the tools sheet; phones in portrait
  (360×780, 412×915) and landscape (780×360, 915×412, 932×430) with touch, 768×1024 and 1280×800 with a mouse,
  each in the light and the dark theme. Reports targets under 48 px on touch (24 px with a mouse), cut-off labels,
  unnamed controls and pages wider than the screen.

```sh
npm i --no-save playwright-core          # once; uses your installed Chrome, no browser download
npm run serve &                          # serves docs/ on http://localhost:8919
node tests/ui/e2e.mjs                    # screenshots go to a temp folder (or pass one as the first argument)
node tests/ui/audit.mjs
```

Set `CHROME` to Chrome's path if it isn't in `/Applications`, and `APP_URL` to test another address.
Some checks look up live data on radiomap.cl, so they need a network connection.
