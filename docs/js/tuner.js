// ---- Tuning the radio from the page: one tune at a time, the latest pick wins ----
// A tune types keys on the radio's keypad, each waiting for its echo (~2–3 s in all), so two can't overlap and one
// can't be cut short. A pick waits settleMs for the dial to settle (a swipe through ten frequencies tunes once);
// a pick made during a tune runs after it. onState({k, state, err}): "pending", "tuning", "done" or "failed"
export class Tuner {
  constructor(run, {settleMs = 600, onState = () => {}} = {}) {
    Object.assign(this, {run, settleMs, onState, want: null, busy: false, timer: 0, waiting: []});
  }
  // Resolves once no tune is under way
  idle() { return this.busy ? new Promise((r) => this.waiting.push(r)) : Promise.resolve(); }
  // now: no settling (a tap on Tune)
  request(k, {now = false} = {}) {
    this.want = k;
    clearTimeout(this.timer);
    this.onState({k, state: "pending"});
    this.timer = setTimeout(() => { this.timer = 0; this.next(); }, now ? 0 : this.settleMs);
  }
  // Drops the pick still waiting; a tune under way finishes
  cancel() {
    clearTimeout(this.timer);
    this.timer = 0;
    this.want = null;
  }
  async next() {
    if (this.busy || this.want === null) return;
    const k = this.want;
    this.want = null;
    this.busy = true;
    this.onState({k, state: "tuning"});
    try {
      const data = await this.run(k);
      this.onState({k, state: "done", data});
    } catch (err) {
      this.onState({k, state: "failed", err});
    } finally {
      this.busy = false;
      this.waiting.splice(0).forEach((r) => r());
    }
    // A pick that settled during the tune goes now; one still settling goes when it settles
    if (this.want !== null && !this.timer) this.next();
  }
}
