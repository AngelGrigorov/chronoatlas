import { createMap } from './map.js';
import { createTimeline, MIN_SPAN, MAX_SPAN } from './timeline.js';
import { clampYear, fmtYear, MAX_YEAR } from './time.js';
import { createPanel, showCard, hideCard } from './panel.js';
import { createSearch } from './search.js';

const get = (p, fallback) => fetch(p).then(r => (r.ok ? r.json() : Promise.reject(new Error(p)))).catch(err => {
  if (fallback !== undefined) return fallback;
  throw err;
});

const [snapshots, entities, events, cultures, cities, routes, eras, wdRaw] = await Promise.all([
  get('data/snapshots.json'),
  get('data/entities.json'),
  get('data/content/events.json'),
  get('data/content/cultures.json'),
  get('data/content/cities.json'),
  get('data/content/routes.json'),
  get('data/content/eras.json'),
  get('data/wd-events.json', []),
]);
// Wikidata е в компактни редове: [y, lon, lat, вид, езици, заглавие, en, bg уики, en уики, id]
const wd = wdRaw.map(([y, lon, lat, k, l, t, en, wb, we, id]) => ({ y, lon, lat, k, l, t, en, wb, we, id }));
events.sort((a, b) => a.y - b.y);

// ——— Състояние: адресът е източникът при отваряне ———
const LAYERS = [
  ['borders', 'Граници', '#d9b45a'],
  ['cultures', 'Култури', '#f0c674'],
  ['events', 'Събития', '#e8c46a'],
  ['battles', 'Битки', '#e0574f'],
  ['routes', 'Пътища и походи', '#ff7a5c'],
  ['cities', 'Градове', '#f4ecd8'],
  ['rivers', 'Реки', '#4b7298'],
];
const hash = new URLSearchParams(location.hash.slice(1));
const num = (v, d) => (v != null && v !== '' && Number.isFinite(+v) ? +v : d);
const [hx, hy] = (hash.get('c') || '').split(',').map(Number);
let saved = {};
try { saved = JSON.parse(localStorage.getItem('layers') || '{}'); } catch {}

const app = {
  year: clampYear(num(hash.get('y'), -500)),
  span: Math.min(MAX_SPAN, Math.max(MIN_SPAN, num(hash.get('s'), 2400))),
  playing: false,
  layers: Object.fromEntries(LAYERS.map(([k]) => [k, saved[k] ?? true])),
  flat: hash.get('p') === 'flat',
  tween: null,
  setYear(y, { instant = false } = {}) {
    y = clampYear(y);
    if (instant) { this.tween = null; this.year = y; }
    else this.tween = { from: this.year, to: y, t0: performance.now(), dur: Math.min(1400, 450 + Math.abs(y - this.year) / this.span * 900) };
    dirty();
  },
  setSpan(s) { this.span = Math.min(MAX_SPAN, Math.max(MIN_SPAN, s)); dirty(); },
  stopPlay() { if (this.playing) togglePlay(false); },
};
const win = () => Math.min(400, Math.max(6, app.span * 0.06));

// ——— Картата ———
const mapEl = document.getElementById('map');
const map = createMap({
  container: mapEl,
  canvas: document.getElementById('labels'),
  data: { snapshots, cultures, cities, routes, events, wd },
  initial: {
    year: app.year, layers: app.layers, flat: app.flat,
    center: Number.isFinite(hx) && Number.isFinite(hy) ? [hx, hy] : [28, 34],
    zoom: num(hash.get('z'), window.innerWidth < 760 ? 1.6 : 2.4),
  },
  onPick(hit) {
    if (!hit) return hideCard();
    showCard({ ...hit, year: app.year }, { entities, onGo });
  },
  onSnapshot() { panel.refresh(); dirty(); },
});
function onGo(g) {
  app.stopPlay();
  if (g.y != null && Math.abs(g.y - app.year) > 0.5) app.setYear(g.y);
  map.flyTo(g.lon, g.lat);
}

// ——— Таймлайнът, панелът, търсенето ———
const timeline = createTimeline(document.getElementById('timeline'), { eras, events, snapshots, app });
const panel = createPanel(document.getElementById('side-body'), document.getElementById('side-toggle'), {
  data: { events, cultures, cities },
  onFocus(it) {
    if (it.type === 'event') { map.flyTo(it.item.lon, it.item.lat); showCard({ type: 'event', item: it.item, year: app.year }, { entities, onGo }); }
    else if (it.type === 'culture') { map.flyTo(it.lon, it.lat); showCard({ type: 'culture', item: it.item, year: app.year }, { entities, onGo }); }
    else map.flyTo(it.lon, it.lat);
  },
});
createSearch(document.getElementById('q'), document.getElementById('results'), { events, wd, entities, cultures, cities, routes }, r => {
  app.stopPlay();
  app.setYear(r.y);
  map.flyTo(r.lon, r.lat, r.area ? Math.max(2.2, Math.min(5, 7.2 - Math.log10(r.area))) : 4.5);
  showCard({ ...r.hit, year: r.y }, { entities, onGo });
});

// ——— Слоевете ———
const layersEl = document.getElementById('layers');
for (const [k, label, color] of LAYERS) {
  const b = document.createElement('button');
  b.innerHTML = `<i></i>${label}`;
  b.style.setProperty('--dot', color);
  b.setAttribute('aria-pressed', String(app.layers[k]));
  b.onclick = () => {
    app.layers[k] = !app.layers[k];
    b.setAttribute('aria-pressed', String(app.layers[k]));
    map.setLayer(k, app.layers[k]);
    try { localStorage.setItem('layers', JSON.stringify(app.layers)); } catch {}
  };
  layersEl.append(b);
}
const globeBtn = document.createElement('button');
globeBtn.innerHTML = '<i></i>Глобус';
globeBtn.style.setProperty('--dot', '#7fb7e6');
globeBtn.setAttribute('aria-pressed', String(!app.flat));
globeBtn.onclick = () => {
  app.flat = !app.flat;
  globeBtn.setAttribute('aria-pressed', String(!app.flat));
  map.setProjection(app.flat ? 'mercator' : 'globe');
  writeHash();
};
layersEl.append(globeBtn);

// ——— ▶ ———
const playBtn = document.getElementById('play');
const speedSel = document.getElementById('speed');
let lastFrame = 0;
function togglePlay(on = !app.playing) {
  app.playing = on;
  if (on && app.year >= MAX_YEAR - 1) app.setYear(-3000, { instant: true });
  playBtn.textContent = on ? '❚❚' : '▶';
  playBtn.setAttribute('aria-label', on ? 'Пауза' : 'Пусни');
  lastFrame = performance.now();
  dirty();
}
playBtn.onclick = () => togglePlay();
document.addEventListener('keydown', e => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'Escape') hideCard();
  else if (e.key === '/') { e.preventDefault(); document.getElementById('q').focus(); }
});

// ——— Един кадър: годината тече, всичко се пренарежда ———
const yearEl = document.getElementById('year'), eraEl = document.getElementById('era'), snapEl = document.getElementById('snap');
let raf = 0, lastHash = 0, lastPanel = 0;
function dirty() { if (!raf) raf = requestAnimationFrame(frame); }
function frame(now) {
  raf = 0;
  if (app.tween) {
    const t = Math.min(1, (now - app.tween.t0) / app.tween.dur);
    const k = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    app.year = app.tween.from + (app.tween.to - app.tween.from) * k;
    if (t >= 1) app.tween = null;
  }
  if (app.playing) {
    app.year = clampYear(app.year + (+speedSel.value) * (now - lastFrame) / 1000);
    if (app.year >= MAX_YEAR) togglePlay(false);
  }
  lastFrame = now;

  map.setYear(app.year, win());
  timeline.draw();
  yearEl.textContent = fmtYear(app.year);
  const band = eras.tracks[0].b.find(([s, e]) => app.year >= s && app.year < e);
  eraEl.textContent = band ? band[2] : '';
  const snap = map.snapshot;
  snapEl.innerHTML = snap == null ? '' : `Граници към <b>${fmtYear(snap)}</b>${Math.abs(snap - app.year) >= 1 ? ' · най-близката карта назад' : ''}`;
  if (now - lastPanel > 180) { lastPanel = now; panel.update(app.year, win(), map.labels, snap); }
  if (now - lastHash > 500) { lastHash = now; writeHash(); }
  if (app.tween || app.playing) dirty();
}
function writeHash() {
  const c = map.map.getCenter();
  const h = `y=${Math.round(app.year)}&s=${Math.round(app.span)}&c=${c.lng.toFixed(2)},${c.lat.toFixed(2)}&z=${map.map.getZoom().toFixed(2)}${app.flat ? '&p=flat' : ''}`;
  if (location.hash.slice(1) !== h) history.replaceState(null, '', '#' + h);
}
map.map.on('moveend', writeHash);
window.addEventListener('hashchange', () => {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.has('y')) app.setYear(num(h.get('y'), app.year));
});

await map.whenReady;
dirty();
document.fonts.load("600 16px 'Cormorant Garamond'").finally(() => dirty());
document.getElementById('loading').classList.add('done');
