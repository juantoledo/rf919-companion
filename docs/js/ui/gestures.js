// Swipe gestures. Each one only speeds up something a button also does (◀ ▶, the radio bar, ✕), so none is required.
// Pointer events cover touch, pen and mouse; the elements set touch-action in CSS so the browser leaves the
// gesture to us (pan-y: vertical scrolling still works on the frequency readout).

const STEP_PX = 40;     // a swipe this long steps the frequency
const SEEK_PX = 120;    // this long seeks to the next station
const CLOSE_PX = 80;    // a sheet dragged down this far closes
const haptic = (ms = 10) => { if (navigator.vibrate) navigator.vibrate(ms); };

// Swallow the click that follows a recognised swipe, so a swipe on a button doesn't also press it
function eatNextClick(el) {
  const eat = (e) => { e.stopPropagation(); e.preventDefault(); };
  el.addEventListener("click", eat, {capture: true, once: true});
  setTimeout(() => el.removeEventListener("click", eat, {capture: true}), 400);
}

// Horizontal swipe on a frequency: left = up, right = down (like turning a dial: the scale moves with the finger).
// onStep(direction: 1 | -1, seek: boolean). only: a selector inside el where the swipe has to start (el re-renders)
export function swipeTune(el, onStep, {only = null} = {}) {
  let x0 = 0, y0 = 0, id = null;
  el.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || e.target.closest("select") || (only && !e.target.closest(only))) return;
    id = e.pointerId; x0 = e.clientX; y0 = e.clientY;
    // The swipe ends here even if the finger leaves the element. With only, el holds buttons of its own: capture
    // once the finger moves, so a tap still clicks the button under it
    if (!only) el.setPointerCapture(id);
  });
  if (only) el.addEventListener("pointermove", (e) => {
    if (e.pointerId === id && !el.hasPointerCapture(id) && Math.abs(e.clientX - x0) > 8) el.setPointerCapture(id);
  });
  el.addEventListener("pointerup", (e) => {
    if (e.pointerId !== id) return;
    id = null;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (Math.abs(dx) < STEP_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const dir = dx < 0 ? 1 : -1;
    eatNextClick(el);
    haptic(Math.abs(dx) >= SEEK_PX ? 30 : 10);
    const nudge = el.querySelector(".freq, .rb-freq, .d-freq") || el;
    nudge.classList.add(dir > 0 ? "nudge-l" : "nudge-r");
    setTimeout(() => nudge.classList.remove("nudge-l", "nudge-r"), 160);
    onStep(dir, Math.abs(dx) >= SEEK_PX);
  });
  el.addEventListener("pointercancel", () => { id = null; });
}

// Upward swipe (the radio bar opens the Remote)
export function swipeUp(el, onUp) {
  let y0 = 0, x0 = 0, id = null;
  el.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    id = e.pointerId; x0 = e.clientX; y0 = e.clientY;
    el.setPointerCapture(id);
  });
  el.addEventListener("pointerup", (e) => {
    if (e.pointerId !== id) return;
    id = null;
    const dy = e.clientY - y0, dx = e.clientX - x0;
    if (dy > -STEP_PX || Math.abs(dy) < Math.abs(dx) * 1.5) return;
    eatNextClick(el);
    haptic();
    onUp();
  });
  el.addEventListener("pointercancel", () => { id = null; });
}

// Where sheets come in from the side instead of the bottom: wide screens, and phones held sideways (as in app.css)
export const SIDE_SHEETS = "(min-width: 900px), (orientation: landscape) and (max-height: 540px)";
const FLING = 0.8;      // px/ms: a flick this fast moves one detent in its direction
const LARGE = .92, MEDIUM = .46;  // of the screen's height, as --detent-large and --detent-medium in tokens.css

// A bottom sheet's top drags it between its detents (data-detent="medium" | "large"); dragged down past medium
// it closes. It follows the finger, then settles on the nearest detent, or the next one after a flick.
export function sheetDrag(sheet, handles, {onClose, onDetent = () => {}}) {
  let id = null, y0 = 0, h0 = 0, lastY = 0, lastT = 0, v = 0;
  const start = (e) => {
    if (e.button > 0 || e.target.closest("button, select, input, label")) return;
    if (matchMedia(SIDE_SHEETS).matches) return;  // a side sheet: nothing to drag
    id = e.pointerId; y0 = lastY = e.clientY; lastT = e.timeStamp; v = 0;
    h0 = sheet.getBoundingClientRect().height;
    e.currentTarget.setPointerCapture(id);
    sheet.classList.add("dragging");
  };
  const move = (e) => {
    if (e.pointerId !== id) return;
    if (e.timeStamp > lastT) v = (e.clientY - lastY) / (e.timeStamp - lastT);
    lastY = e.clientY; lastT = e.timeStamp;
    const h = h0 - (e.clientY - y0), max = innerHeight * LARGE;
    sheet.style.height = `${h > max ? max + (h - max) * .2 : Math.max(0, h)}px`;  // a little give past the top
  };
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    const h = sheet.getBoundingClientRect().height, medium = innerHeight * MEDIUM, large = innerHeight * LARGE;
    sheet.classList.remove("dragging");
    sheet.style.height = "";
    let to = Math.abs(h - medium) < Math.abs(h - large) ? "medium" : "large";
    if (v > FLING) to = h > medium ? "medium" : "close";
    else if (v < -FLING) to = "large";
    else if (h < medium - CLOSE_PX) to = "close";
    if (to === "close") {
      haptic();
      sheet.style.transform = "translateY(100%)";
      setTimeout(() => { onClose(); sheet.style.transform = ""; }, 200);
      return;
    }
    if (to !== sheet.dataset.detent) haptic(6);
    sheet.dataset.detent = to;
    onDetent(to);
  };
  for (const h of handles) {
    h.addEventListener("pointerdown", start);
    h.addEventListener("pointermove", move);
    h.addEventListener("pointerup", end);
    h.addEventListener("pointercancel", end);
  }
}

// List rows that uncover an action when swiped left (touch and pen; with a mouse, Edit and the row's minus do it). Let go past
// half the row and the action runs; past half the action's width the row stays open on it. Rows are delegated, so
// re-rendering the list keeps this working. Each row: .mr-fg (what moves) and .mr-act (the button behind).
const REVEAL = 88;
export function swipeRows(list) {
  let row = null, fg = null, id = null, x0 = 0, y0 = 0, dx = 0, base = 0, horiz = null;
  const shut = (r) => { r.classList.remove("open"); r.querySelector(".mr-fg").style.transform = ""; };
  list.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || e.button > 0 || e.target.closest("button")) return;
    const f = e.target.closest(".mr-fg");
    if (!f) return;
    row = f.parentElement; fg = f; id = e.pointerId; x0 = e.clientX; y0 = e.clientY; dx = 0; horiz = null;
    base = row.classList.contains("open") ? -REVEAL : 0;
    for (const o of list.querySelectorAll(".open")) if (o !== row) shut(o);
  });
  list.addEventListener("pointermove", (e) => {
    if (e.pointerId !== id) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (horiz === null) {
      if (Math.hypot(mx, my) < 8) return;
      horiz = Math.abs(mx) > Math.abs(my);
      if (!horiz) { id = null; return; }  // a scroll: leave it to the page
      fg.setPointerCapture(id);
      row.classList.add("swiping");
    }
    dx = Math.min(0, base + mx);
    fg.style.transform = `translateX(${dx}px)`;
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    if (!horiz) return;
    row.classList.remove("swiping");
    eatNextClick(fg);
    if (-dx > row.offsetWidth * .55) { haptic(20); row.querySelector(".mr-act").click(); return; }
    if (-dx > REVEAL / 2) { row.classList.add("open"); fg.style.transform = `translateX(${-REVEAL}px)`; }
    else shut(row);
  };
  list.addEventListener("pointerup", end);
  list.addEventListener("pointercancel", end);
  // A tap anywhere else closes an open row
  document.addEventListener("pointerdown", (e) => { for (const o of list.querySelectorAll(".open")) if (!o.contains(e.target)) shut(o); });
}

// A snackbar swiped sideways goes away (one with an action takes taps; a plain one lets them through and times out)
export function swipeAway(el, onAway) {
  let id = null, x0 = 0, dx = 0;
  el.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || e.target.closest("button")) return;
    id = e.pointerId; x0 = e.clientX; dx = 0;
    el.setPointerCapture(id);
    el.style.transition = "none";
  });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== id) return;
    dx = e.clientX - x0;
    el.style.transform = `translateX(${dx}px)`;
    el.style.opacity = String(1 - Math.min(1, Math.abs(dx) / 200));
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    el.style.transition = el.style.transform = el.style.opacity = "";
    if (Math.abs(dx) > CLOSE_PX) onAway();
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}
