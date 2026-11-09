// A broadcast as an iCalendar file (RFC 5545), so the phone's calendar can alert with the app closed. No DOM
import {MON, WD, apiWeekday, fmtKHz, minHHMM, span, utcDay} from "./radiomap.js";

const enc = new TextEncoder();

export const icsStamp = (t) => new Date(t).toISOString().replace(/[-:]|\.\d{3}/g, "");
const icsText = (s) => String(s).replace(/[\\;,]/g, "\\$&").replace(/\r\n|\r|\n/g, "\\n");

// Lines of at most 75 bytes, continued with a leading space, cut between characters (never inside one)
function fold(line) {
  const out = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > 75) { out.push(cur); cur = " "; bytes = 1; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

// Date and time of an airing, in UTC as the app shows broadcast times: "Tue 10 Nov 01:00 UTC"
export function airingText(at) {
  const d = new Date(at);
  return `${WD[apiWeekday(d)]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${minHHMM((at - utcDay(at)) / 60000)} UTC`;
}

// One airing (at: its start, ms) with an alert alarmMin before it. The end comes from span(), since endUTC can be
// "2400" or fall on the next day
export function broadcastIcs(e, {at, url = "", now = Date.now(), alarmMin = 5}) {
  const [s, end] = span(e), freq = fmtKHz(e.kHz);
  const lang = [e.langLabel || e.lang, e.targetLabel || e.target].filter(Boolean).join(" → ");
  const slug = String(e.station || "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const details = [lang, e.site && e.site.name && `Transmitter: ${e.site.name}`, `${minHHMM(s)}–${minHHMM(end)} UTC`, url].filter(Boolean);
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RF919 Companion//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.kHz}-${icsStamp(at)}-${slug}@rf919-companion`,
    `DTSTAMP:${icsStamp(now)}`,
    `DTSTART:${icsStamp(at)}`,
    `DTEND:${icsStamp(at + (end - s) * 60000)}`,
    `SUMMARY:${icsText(e.station ? `${e.station} · ${freq}` : freq)}`,
    `DESCRIPTION:${icsText(details.join("\n"))}`,
    ...(url ? [`URL:${url}`] : []),
    "TRANSP:TRANSPARENT",  // listening doesn't make anyone busy
    "BEGIN:VALARM", "ACTION:DISPLAY",
    `TRIGGER:-PT${alarmMin}M`,
    `DESCRIPTION:${icsText(`${e.station || "A broadcast"} starts in ${alarmMin} min on ${freq}`)}`,
    "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
