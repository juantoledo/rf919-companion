// ---- Station names → frequencies, for Explore's search ----
// No DOM. radiomap.cl's index lists frequencies only, so the names are learnt from the frequency files the page reads
// (lookups, Nearby, Discover, the list builders) and, once asked, from all of them. seen: the kHz read so far
import {ituFlag} from "./radiomap.js";

// Lower case, no accents, words of letters and digits: "Radio Bío-Bío" → "radio bio bio"
export const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export class NameIndex {
  constructor() { this.byKey = new Map(); this.seen = new Set(); }
  get size() { return this.byKey.size; }
  // One frequency file (null: radiomap.cl has nothing there)
  add(k, data) {
    this.seen.add(k);
    if (!data) return;
    for (const e of data.shortwave || []) this.put(e.station, k, ituFlag(e.itu) || "");
    for (const s of data.stations || []) this.put(s.nombre || s.signal, k, s.category === "global" ? "" : "cl");
  }
  put(name, k, flag) {
    const key = norm(name);
    if (!key) return;
    let n = this.byKey.get(key);
    if (!n) this.byKey.set(key, n = {name: String(name).trim(), flag, ks: new Set()});
    if (!n.flag && flag) n.flag = flag;
    n.ks.add(k);
  }
  // Every word typed must start a word of the name (in any order) or, failing that, appear inside it. Ranked: whole
  // words first, then starts of words, then names that merely contain it; shorter names before longer ones
  search(q, max = 8) {
    const words = norm(q).split(" ").filter(Boolean);
    if (!words.length) return [];
    const hits = [];
    for (const [key, n] of this.byKey) {
      const parts = key.split(" ");
      let score = 0;
      for (const w of words) {
        const s = parts.includes(w) ? 3 : parts.some((p) => p.startsWith(w)) ? 2 : key.includes(w) ? 1 : 0;
        if (!s) { score = 0; break; }
        score += s;
      }
      if (score) hits.push({score, key, n});
    }
    return hits.sort((a, b) => b.score - a.score || a.key.length - b.key.length || b.n.ks.size - a.n.ks.size)
      .slice(0, max).map(({n}) => ({name: n.name, flag: n.flag, ks: [...n.ks].sort((a, b) => a - b)}));
  }
  toJSON() { return {seen: [...this.seen], names: [...this.byKey.values()].map((n) => [n.name, n.flag, [...n.ks]])}; }
  static fromJSON(o) {
    const ix = new NameIndex();
    if (!o) return ix;
    for (const k of o.seen || []) ix.seen.add(k);
    for (const [name, flag, ks] of o.names || []) for (const k of ks) ix.put(name, k, flag);
    return ix;
  }
}
