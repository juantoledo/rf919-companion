# Raddy RF919 / "Radio-C" BLE protocol

Reverse-engineered from `Radio-c.apk` v1.2.0 (package `com.myhomesmartlife.bluetooth`).
Most of this comes from static analysis of the decompiled app. Items marked **✓ live**
were confirmed against a real RF919 (firmware 1.910).

## Transport

| Item | Value |
|---|---|
| Write characteristic (phone → radio) | `0000ff13-0000-1000-8000-00805f9b34fb` (write w/ response) |
| Notify characteristic (radio → phone) | `0000ff14-0000-1000-8000-00805f9b34fb` |
| Scan filter | none: the app lists every named BLE device |
| On connect | discover services → write handshake `AB 01 FF AB` → enable notify on FF14 |
| Advertising | name `RF919-BLE`, random address, manufacturer data key `0x6c42` = `"uetrum"` ✓ live |

GATT table (✓ live):

| Service | Characteristic | Properties | Used by app |
|---|---|---|---|
| `180F` Battery | `2A19` | read, notify | no |
| `FF10` | `FFF1` | read, write, notify | no |
| `FF12` | `FF13` | write | yes, commands |
| `FF12` | `FF14` | notify (+CCCD) | yes, status |
| `FF12` | `FF15` | read, write-without-response | no |

**Session behaviour (✓ live):** right after the handshake the radio dumps its whole state
(about 40 packets in roughly 1 s, starting with `13 00`) and then repeats the dump
periodically. A client only needs to apply each message as it arrives.

**Linux note:** if a client process dies without disconnecting, BlueZ keeps the link up and
the radio stops advertising. `bluetoothctl disconnect <addr>` frees it.

The app only calls `setCharacteristicNotification()` and never writes the CCCD (0x2902),
so the radio probably sends notifications without being asked. A normal BLE stack
(Web Bluetooth, etc.) writes the CCCD anyway, and that should do no harm.

## Frame format (both directions)

```
AB  LEN  CMD  DATA[LEN-1]  SUM
```

- `LEN` = 1 + number of DATA bytes (it counts CMD but not SUM)
- `SUM` = (sum of every preceding byte, including `AB`) & 0xFF
- Multi-byte integers are **little-endian**
- The same CMD value can mean different things in each direction (for example `0D` and `11`)
- Every frame seen is at most 20 bytes, one default BLE notification; text is split into
  13–14 byte chunks to stay within that. Inferred from captures, not from the app

## Phone → radio

| CMD | DATA | Meaning |
|---|---|---|
| `FF` | – | Handshake (`AB 01 FF AB`) |
| `0C` | key | Virtual key press (see the key table) |
| `0D` | hh mm ss (year−1970) month day | Set clock |
| `0E` | en hh mm mode | Alarm. en=00/01; mode = app alarm state 0/1 |
| `0F` | minutes | Sleep timer (the app offers 0, 10, 20, … minutes) |
| `10` | band f0 f1 f2 f3 | Tune: band + 32-bit LE frequency (raw units, as received in `01`). Freq 0 = only switch band |
| `11` | level | Squelch level |
| `12` | 01 / 00 | Accept / reject (`accectSuccess` / `accectFaile`) |

### Key codes (`AB 02 0C <key> SUM`)

| key | name | key | name | key | name |
|---|---|---|---|---|---|
| 00 | BAND | 14 | POWER | 2A | SOS |
| 01–09 | digits 1–9 | 17 | SUB-BAND (MODE) | 2B | SOS long |
| 0A | digit 0 | 1A | PLAY / SCAN | 2C | MEMO long |
| 0B | BACK / delete | 1B | STEP | 2D | REC |
| 0C | POINT (.) | 1C | BLUETOOTH | 2E | STEP (new) / func 3 |
| 0D | FREQ (enter) | 1D | DEMODULATION / func 1 | 2F | func 4 |
| 0E | UP short | 1E | BANDWIDTH / func 2 | 30 | func 5 |
| 0F | UP long | 1F | MOBILE DISPLAY | 31 | ALARM |
| 10 | DOWN short | 20 | SQ | 32 | ALARM long |
| 11 | DOWN long | 21 | STEREO | 33 | PLAY long |
| 12 | VOL+ | 22 | DE (de-emphasis) | 34 | FUNC long |
| 13 | VOL− | 23 | PRESET | 35–3E | digits 1–9, 0 long |
| | | 24 | MEMO | 3F | MUSIC long |
| | | 25 | REC (old) | 40 | PLAY long (alt) |
| | | 26 | MUSIC | 41 | MODE long |
| | | 27 | CIRCLE (repeat) | 42 | EQ long |
| | | 28 | MUSIC repeat type | 43 / 44 | VOL− / VOL+ long |
| | | 29 | BAND long | 45 | POWER long |
| | | | | 46 / 47 / 48 / 49 | ENTER / POINT / DELETE / ? long |

## Radio → phone

| CMD | DATA | Meaning |
|---|---|---|
| `01` | band f0 f1 f2 f3 unit dp state | ✓ live. **Frequency status.** freq = u32 LE. unit 00=MHz 01=kHz. `dp` low nibble = lit decimal-point slot (0 = none), high nibble = 1-based display slot of the first digit. state 00=show, 01=hide, 02=blink. Band 06 (WB) with freq `0xFF000000` = weather ALERT |
| `0F` | result band f0 f1 f2 f3 unit dp | Frequency-entry echo. result 00=ok, 01=awaiting input, 02=input error |
| `02` | idx f0 f1 | Track selection (idx 00 = show n/total) |
| `03` | rssi snr | RSSI / SNR (older firmware) |
| `04` | demod … | Demodulation (DATA[0]) 0 WFM, 1 NFM, 2 MONO, 3 STEREO, 4 AM, 5 SSB, 6 LSB, 7 USB; bandwidth = u16 LE at DATA[6..7] |
| `05` | n | Sleep timer, minutes left (0 = off). ✓ live: counted down 77 → 75 |
| `06` | ? hh mm state | Alarm. state 00 off, 01 set, 02 ringing, 03 ? |
| `07` | mode | ✓ live. Device mode: 00/03 standby, 01 TF-card MP3, 02 radio, 04 BT audio, 06 PC/USB, 07 AUX |
| `08` | level charging | Battery 0–3, charging 01. ✓ live |
| `09` | vol | Volume |
| `0A` | eq | EQ: normal, pop, rock, jazz, classic, country |
| `0B` | ? | Online status (logged only) |
| `0C` | lo hi tlo thi | Track n (u16 LE) / total tracks (u16 LE) |
| `0D` | slo shi … | Track elapsed seconds = u16 LE DATA[0..1]; track number = u16 LE DATA[4..5] |
| `0E` | 01/00 | Playing / paused |
| `10` | state n | Preset: 00 hidden, 01/02 show n, 03 "- -" |
| `11` | mode | Repeat: all / one / folder / shuffle |
| `12` | seg n text… | Status-line text (GBK) |
| `13` | state | The app shows "please turn on the device" for `00`, but live the radio sends `13 00` as the first packet of every state dump while it's on and playing. Treat it as a dump marker / power state |
| `14` | ? u16 | (no UI) |
| `15` | lo hi | 16-bit mask of available bands (bit i = band list index i). ✓ live: `ff 01` = FM…LW |
| `16` | ver | Firmware version |
| `17` | b0 b1 b2 | Enable flags for MODE / STEP / SCAN buttons. Live: `01 01 01` |
| `18` | a b | Limits: a = max sleep minutes, b = max squelch level. Live: `5a 09` (90, 9) |
| `19` | seg n text… | Version text (GBK) |
| `1B` | x | (no UI) |
| `1C` | slot seg n text… | **Display field text (GBK).** See the slot table |
| `1D` | slot state | Display field 00/01 steady, 02 blink |
| `1E` | slot vis | Info row 1–5 visibility |
| `1F` | a b | Squelch popup control |
| `20` | lang | 00 Chinese, else English. Live: `01` |
| `21` | slot seg n text… | Button labels: 1 MODE, 2 STEP, 3 SCAN/PLAY, 4 SOS, 5 FUNC |
| `22` | btn state | Blink SOS (1) / FUNC (2); state 01 = blink. Live: `01 00`, `02 00` |
| `23` | seg n text… | Toast message (GBK) |
| `24` | – | Radio requests disconnect |

**Chunked text** (`12`, `19`, `1C`, `21`, `23`), ✓ live: `seg` 01 = first, 02 = middle, 04 = last,
03 = complete in one packet. `n` = byte count of text in this packet.

**`1C` slots:** 01 demod label, 02 demod value, 03 bandwidth label, 04 bandwidth value,
05 SNR label, 06 SNR value, 07 RSSI label, 08 RSSI value, 09–0C extra fields,
0D volume, 0E track number, 0F extra field, 10 REC status.

### Bands

`00` FM, `01` AM, `02` SW, `03` AIR, `04` CB, `05` UHF, `06` WB, `07` VHF, `08` LW,
`09` HAM, `10` RAIL, `11` MRN, `12` RACE, `13` POL, `14` FIRE, `15` OTHER.
After `09` the codes jump to `10` (BCD style), so `0A`–`0F` are unused.

### Frequency display

The display has slots `d0 . d1 . d2 . d3 . d4 . d5 . final`. With `dp = (hi<<4)|lo`,
the decimal digits of freq start at slot `hi` (1-based), and the dot after slot `lo−1`
is lit. That gives `lo − hi + 1` integer digits.

Live example: `AB 09 01 02 10 BB 11 00 00 12 00 ..` → SW, raw 1162000, MHz, dp `0x12`.
The first digit goes in slot 0, the dot lights after slot 1, giving `11.6200` with a small
trailing `0`.

### Relabelable buttons

The app's five function buttons take their captions from `21` (live: BW-DM, ANT-ATT,
V-UHF, MUTE, LOCK). Each always sends the same key:

| Slot | Short press | Long press |
|---|---|---|
| 1 MODE | `17` SUBBAND | none |
| 2 STEP | `1B` STEP | none |
| 3 SCAN | `1A` PLAY | `33` PLAY long |
| 4 SOS | `2A` SOS | `2B` SOS long |
| 5 FUNC | `1F` DISPLAY | `34` FUNC long |
