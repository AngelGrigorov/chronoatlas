import { MIN_YEAR, MAX_YEAR, clampYear, fmtYear, fmtRange } from './time.js';
import { KINDS } from './map.js';
import { t } from './i18n.js';

export const MIN_SPAN = 12;
export const MAX_SPAN = 13000;

const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];

// A timeline with a fixed cursor in the middle: the world slides underneath it.
// app: { year, span, setYear(y, opts), setSpan(s), stopPlay() }
export function createTimeline(canvas, { eras, events, snapshots, app }) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, queued = false;
  let hoverX = null, momentum = null;

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    draw();
  }
  new ResizeObserver(resize).observe(canvas);

  const xOf = y => W / 2 + (y - app.year) * W / app.span;
  const yearAt = x => app.year + (x - W / 2) * app.span / W;

  function layout() {
    const tracks = H < 120 ? eras.tracks.slice(0, 4) : eras.tracks;
    const axisH = 28, evH = 10, top = 6;
    const trackH = Math.min(15, Math.floor((H - axisH - evH - top - 4) / tracks.length));
    return { tracks, axisH, evH, top, trackH, evY: top + tracks.length * trackH + 2 };
  }

  function draw() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; drawNow(); });
  }

  function drawNow() {
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const { tracks, axisH, top, trackH, evY } = layout();
    const y0 = yearAt(0), y1 = yearAt(W);

    // Outside the range — dark.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    if (xOf(MIN_YEAR) > 0) ctx.fillRect(0, 0, xOf(MIN_YEAR), H);
    if (xOf(MAX_YEAR) < W) ctx.fillRect(xOf(MAX_YEAR), 0, W - xOf(MAX_YEAR), H);

    // Eras, one track per region.
    tracks.forEach((tr, ti) => {
      const ty = top + ti * trackH;
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      ctx.fillRect(0, ty, W, trackH - 2);
      tr.b.forEach(([s, e, name], bi) => {
        if (e < y0 || s > y1) return;
        const xa = Math.max(-2, xOf(s)), xb = Math.min(W + 2, xOf(e));
        const on = app.year >= s && app.year < e;
        const hue = tr.h ?? 40;
        ctx.fillStyle = `hsla(${hue}, ${on ? 55 : 35}%, ${bi % 2 ? 46 : 38}%, ${on ? 0.75 : 0.42})`;
        ctx.fillRect(xa + 0.5, ty, Math.max(1, xb - xa - 1), trackH - 2);
        const avail = xb - xa - 8;
        if (avail > 18) {
          ctx.font = `${on ? 700 : 500} ${Math.min(11, trackH - 3.5)}px ${SANS}`;
          ctx.letterSpacing = '0px';
          ctx.fillStyle = on ? '#fff6e0' : 'rgba(236,228,210,0.78)';
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          let label = name;
          while (label.length > 1 && ctx.measureText(label).width > avail) label = label.slice(0, -2) + '…';
          if (label.length > 1) {
            // The label sticks to the left edge while the band is on screen.
            const lw = ctx.measureText(label).width;
            const lx = Math.min(Math.max(xa + 4, 4), xb - lw - 4);
            ctx.fillText(label, lx, ty + (trackH - 2) / 2 + 0.5);
          }
        }
      });
      ctx.font = `600 9px ${SANS}`;
      ctx.letterSpacing = '0.8px';
      ctx.fillStyle = 'rgba(165,157,140,0.9)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(tr.n.toUpperCase()).width;
      ctx.fillStyle = 'rgba(11,16,24,0.82)';
      ctx.fillRect(W - tw - 10, ty, tw + 10, trackH - 2);
      ctx.fillStyle = 'rgba(165,157,140,0.95)';
      ctx.fillText(tr.n.toUpperCase(), W - 5, ty + (trackH - 2) / 2 + 0.5);
    });

    // Events as ticks — the density of history.
    for (const e of events) {
      if (e.y < y0 || e.y > y1) continue;
      ctx.fillStyle = KINDS[e.k] || '#ccc';
      ctx.globalAlpha = e.i === 3 ? 0.95 : e.i === 2 ? 0.7 : 0.45;
      ctx.fillRect(Math.round(xOf(e.y)) - 1, evY + (3 - e.i) * 2, 2, 2 + e.i * 2);
    }
    ctx.globalAlpha = 1;

    // The axis.
    const ay = H - axisH;
    ctx.strokeStyle = 'rgba(236,226,205,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, ay + 0.5); ctx.lineTo(W, ay + 0.5); ctx.stroke();
    const pxPerYear = W / app.span;
    const step = STEPS.find(s => s * pxPerYear >= 84) || 5000;
    const minor = step / (String(step)[0] === '2' && step !== 2 ? 4 : 5);
    ctx.strokeStyle = 'rgba(236,226,205,0.18)';
    ctx.beginPath();
    for (let y = Math.ceil(y0 / minor) * minor; y <= y1; y += minor) {
      const x = Math.round(xOf(y)) + 0.5;
      ctx.moveTo(x, ay); ctx.lineTo(x, ay + 4);
    }
    ctx.stroke();
    ctx.font = `500 11.5px ${SANS}`;
    ctx.letterSpacing = '0px';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      if (y < MIN_YEAR || y > MAX_YEAR) continue;
      const x = Math.round(xOf(y)) + 0.5;
      ctx.strokeStyle = 'rgba(236,226,205,0.45)';
      ctx.beginPath(); ctx.moveTo(x, ay); ctx.lineTo(x, ay + 8); ctx.stroke();
      ctx.fillStyle = 'rgba(214,206,190,0.8)';
      ctx.fillText(y === 0 ? t('timeline.zero') : fmtYear(y, true), x, ay + 10);
    }

    // Border snapshots — gold diamonds on the axis.
    for (const s of snapshots) {
      if (s < y0 || s > y1) continue;
      const x = xOf(s);
      ctx.fillStyle = '#d9b45a';
      ctx.beginPath(); ctx.moveTo(x, ay - 4); ctx.lineTo(x + 3.5, ay); ctx.lineTo(x, ay + 4); ctx.lineTo(x - 3.5, ay); ctx.closePath(); ctx.fill();
    }

    // The cursor.
    const cx = Math.round(W / 2) + 0.5;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(217,180,90,0.95)'); grad.addColorStop(1, 'rgba(217,180,90,0.55)');
    ctx.strokeStyle = grad; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
    ctx.fillStyle = '#d9b45a';
    ctx.beginPath(); ctx.moveTo(cx - 6, 0); ctx.lineTo(cx + 6, 0); ctx.lineTo(cx, 7); ctx.closePath(); ctx.fill();

    if (hoverX != null && Math.abs(hoverX - W / 2) > 30) {
      const y = yearAt(hoverX);
      ctx.strokeStyle = 'rgba(236,226,205,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(hoverX) + 0.5, 0); ctx.lineTo(Math.round(hoverX) + 0.5, ay); ctx.stroke();
      ctx.font = `600 11px ${SANS}`;
      const label = fmtYear(y);
      const tw = ctx.measureText(label).width + 10;
      const tx = Math.min(W - tw - 2, Math.max(2, hoverX - tw / 2));
      ctx.fillStyle = 'rgba(11,16,24,0.92)';
      ctx.fillRect(tx, ay - 20, tw, 17);
      ctx.fillStyle = '#ece4d2'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(label, tx + 5, ay - 11);
    }
  }

  // ——— Moving and zooming ———
  function stopMomentum() { if (momentum) cancelAnimationFrame(momentum.raf); momentum = null; }

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    stopMomentum();
    app.stopPlay();
    if (e.ctrlKey || e.metaKey) {
      const anchor = yearAt(e.offsetX);
      const span = Math.min(MAX_SPAN, Math.max(MIN_SPAN, app.span * Math.exp(e.deltaY * 0.0022)));
      // The year under the mouse stays where it is.
      app.setSpan(span);
      app.setYear(anchor - (e.offsetX - W / 2) * span / W, { instant: true });
    } else {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const px = e.deltaMode === 1 ? d * 16 : d;
      app.setYear(app.year + px * 0.45 * app.span / W, { instant: true });
    }
  }, { passive: false });

  // Drag with one finger or the mouse, pinch with two fingers.
  const pointers = new Map();
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, e.clientX);
    stopMomentum();
    app.stopPlay();
    if (pointers.size === 1) drag = { x0: e.clientX, x: e.clientX, moved: false, samples: [[performance.now(), app.year]] };
    else if (pointers.size === 2) {
      const xs = [...pointers.values()];
      drag = { pinch: Math.abs(xs[0] - xs[1]) || 1, span0: app.span, moved: true };
    }
  });
  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    hoverX = e.clientX - r.left;
    if (!pointers.has(e.pointerId)) { draw(); return; }
    pointers.set(e.pointerId, e.clientX);
    if (drag?.pinch) {
      const xs = [...pointers.values()];
      const d = Math.abs(xs[0] - xs[1]) || 1;
      app.setSpan(Math.min(MAX_SPAN, Math.max(MIN_SPAN, drag.span0 * drag.pinch / d)));
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x;
    drag.x = e.clientX;
    if (Math.abs(e.clientX - drag.x0) > 4) drag.moved = true;
    if (drag.moved) {
      app.setYear(app.year - dx * app.span / W, { instant: true });
      drag.samples.push([performance.now(), app.year]);
      if (drag.samples.length > 6) drag.samples.shift();
    }
  });
  const end = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size) return;
    const d = drag;
    drag = null;
    if (!d) return;
    if (!d.moved && e.type === 'pointerup') {
      const r = canvas.getBoundingClientRect();
      app.setYear(yearAt(e.clientX - r.left));
      return;
    }
    // Inertia: the last moves give a velocity, which then dies down.
    const s = d.samples || [];
    if (s.length < 2) return;
    const [t0, y0] = s[0], [t1, y1] = s[s.length - 1];
    if (performance.now() - t1 > 80 || t1 - t0 < 10) return;
    let v = (y1 - y0) / (t1 - t0);
    let last = performance.now();
    const step = now => {
      const dt = now - last; last = now;
      app.setYear(app.year + v * dt, { instant: true });
      v *= Math.pow(0.93, dt / 16);
      if (Math.abs(v) * W / app.span > 0.02) momentum.raf = requestAnimationFrame(step);
      else momentum = null;
    };
    momentum = { raf: requestAnimationFrame(step) };
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { hoverX = null; draw(); });

  // Double-click an era to fit it into the timeline.
  canvas.addEventListener('dblclick', e => {
    const { tracks, top, trackH } = layout();
    const ti = Math.floor((e.offsetY - top) / trackH);
    const y = yearAt(e.offsetX);
    const band = tracks[ti]?.b.find(([s, en]) => y >= s && y < en);
    if (!band) return;
    app.setSpan(Math.min(MAX_SPAN, Math.max(MIN_SPAN, (band[1] - band[0]) * 1.25)));
    app.setYear((band[0] + band[1]) / 2);
  });

  // Tooltip: the full name of the era or event under the cursor.
  canvas.addEventListener('mousemove', e => {
    const { tracks, top, trackH, evY, evH } = layout();
    const ti = Math.floor((e.offsetY - top) / trackH);
    const y = yearAt(e.offsetX);
    const band = ti >= 0 && tracks[ti]?.b.find(([s, en]) => y >= s && y < en);
    let ev = null;
    if (e.offsetY >= evY - 2 && e.offsetY <= evY + evH + 2) {
      let best = 5;
      for (const x of events) {
        const d = Math.abs(xOf(x.y) - e.offsetX) - x.i;
        if (d < best) { best = d; ev = x; }
      }
    }
    canvas.title = ev ? t('timeline.event', { t: ev.t, year: fmtYear(ev.y) })
      : band ? t('timeline.band', { name: band[2], range: fmtRange(band[0], band[1]) })
      : t('timeline.help');
  });

  canvas.addEventListener('keydown', e => {
    const big = e.shiftKey ? 10 : 50;
    if (e.key === 'ArrowLeft') app.setYear(app.year - app.span / big, { instant: true });
    else if (e.key === 'ArrowRight') app.setYear(app.year + app.span / big, { instant: true });
    else if (e.key === '+' || e.key === '=') app.setSpan(Math.max(MIN_SPAN, app.span / 1.3));
    else if (e.key === '-') app.setSpan(Math.min(MAX_SPAN, app.span * 1.3));
    else return;
    e.preventDefault();
  });

  return { draw, clampYear };
}
