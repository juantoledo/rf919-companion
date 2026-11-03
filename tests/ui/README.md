# Browser checks

Two scripts drive the web app in Chrome through its **Demo** (a simulated radio, no Bluetooth needed):

- `e2e.mjs`: tabs and links, the Remote, gestures, band pickers, memories (store, check, Store here, clear,
  Start fresh), backup, switches, Find the Preset key, Near me, keyboard. Exits 1 on any failure or page error.
- `audit.mjs`: every visible control on every view and in the Remote, at 360/412 px (touch) and 768/1280 px
  (mouse). Reports targets under 44 px (24 px with a mouse), cut-off labels and unnamed controls.

```sh
npm i --no-save playwright-core          # once; uses your installed Chrome, no browser download
npm run serve &                          # serves docs/ on http://localhost:8919
node tests/ui/e2e.mjs                    # screenshots go to a temp folder (or pass one as the first argument)
node tests/ui/audit.mjs
```

Set `CHROME` to Chrome's path if it isn't in `/Applications`, and `APP_URL` to test another address.
Some checks look up live data on radiomap.cl, so they need a network connection.
