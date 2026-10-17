import { loadLanguage, downloadLanguage, setLanguage, applyStatic, texts, polityName, t, lang } from './i18n.js';
import { createMap, isBattle } from './map.js';
import { createTimeline, MIN_SPAN, MAX_SPAN } from './timeline.js';
import { clampYear, fmtYear, MAX_YEAR } from './time.js';
import { createPanel, showCard, hideCard, cardKey } from './panel.js';
import { createSearch } from './search.js';

const get = (p, fallback) => fetch(p).then(r => (r.ok ? r.json() : Promise.reject(new Error(p)))).catch(err => {
  if (fallback !== undefined) return fallback;
  throw err;
});

// The language goes first: every text on screen comes from its pack.
const [, snapshots, entities, events, cultures, cities, routes, eras, people, seas, wdRaw] = await Promise.all([
  loadLanguage(),
  get('data/snapshots.json'),
  get('data/entities.json'),
  get('data/content/events.json'),
  get('data/content/cultures.json'),
  get('data/content/cities.json'),
  get('data/content/routes.json'),
  get('data/content/eras.json'),
  get('data/content/people.json'),
  get('data/content/seas.json'),
  get('data/wd-events.json', []),
]);
applyStatic();

// The data files hold no text, only ids; texts are attached from the language pack.
const T = texts();
for (const e of events) Object.assign(e, T.events[e.id]);
for (const c of cultures) Object.assign(c, T.cultures[c.id]);
for (const r of routes) Object.assign(r, T.routes[r.id]);
for (const p of people) Object.assign(p, T.people[p.id]);
for (const c of cities) Object.assign(c, T.cities[c.id]);
for (const s of seas) s.n = T.seas[s.id];
for (const tr of eras.tracks) {
  tr.n = T.eras[tr.id].n;
  tr.b.forEach((b, i) => { b[2] = T.eras[tr.id].b[i]; });
}
for (const [name, ent] of Object.entries(entities)) ent.n = polityName(name);
// Wikidata rows: [year, lon, lat, kind, sitelinks, qid]
const wd = wdRaw.map(([y, lon, lat, k, l, id]) => ({ y, lon, lat, k, l, id, t: T.wd[id]?.[0] ?? id, w: T.wd[id]?.[1] }));

// ——— State: the URL is the source of truth on load ———
const LAYERS = [
  ['borders', '#d9b45a'],
  ['cultures', '#f0c674'],
  ['events', '#e8c46a'],
  ['battles', '#e0574f'],
  ['routes', '#ff7a5c'],
  ['cities', '#f4ecd8'],
  ['rivers', '#4b7298'],
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
// Events show exactly in the year on screen. Only while playing do they linger for
// about a second of playback, otherwise at 60 years a second they would never be seen.
const win = () => (app.playing ? Math.max(1, +speedSel.value * 0.8) : 0);

// ——— The map ———
const mapEl = document.getElementById('map');
const map = createMap({
  container: mapEl,
  canvas: document.getElementById('labels'),
  data: { snapshots, cultures, cities, routes, events, wd, seas },
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
// For poking around from the console.
window.atlas = { app, map: map.map };

function onGo(g) {
  app.stopPlay();
  if (g.y != null && Math.abs(g.y - app.year) > 0.5) app.setYear(g.y);
  map.flyTo(g.lon, g.lat);
}

// ——— Timeline, panel, search ———
const timeline = createTimeline(document.getElementById('timeline'), { eras, events, wd, snapshots, app });
const panel = createPanel(document.getElementById('side-list'), document.getElementById('side-toggle'), {
  data: { events, wd, cultures, cities, people },
  kinds: document.getElementById('kinds'),
  onKinds(ks) { map.setKinds(ks); dirty(); },
  onOpen: () => dirty(),
  onFocus(it) {
    if (it.type === 'event' || it.type === 'wd') { map.flyTo(it.item.lon, it.item.lat); showCard({ type: it.type, item: it.item, year: app.year }, { entities, onGo }); }
    else if (it.type === 'culture' || it.type === 'person') { map.flyTo(it.lon, it.lat); showCard({ type: it.type, item: it.item, year: app.year }, { entities, onGo }); }
    else map.flyTo(it.lon, it.lat);
  },
});
createSearch(document.getElementById('q'), document.getElementById('results'), { events, wd, entities, cultures, cities, routes, people }, r => {
  app.stopPlay();
  app.setYear(r.y);
  map.flyTo(r.lon, r.lat, r.area ? Math.max(2.2, Math.min(5, 7.2 - Math.log10(r.area))) : 4.5);
  showCard({ ...r.hit, year: r.y }, { entities, onGo });
});

map.setKinds(panel.kinds());

// First-visit hint; it goes away the first time time is turned.
const hint = document.getElementById('hint');
let hinted = false;
try { hinted = !!localStorage.getItem('hint'); } catch {}
const hideHint = () => { hint.hidden = true; try { localStorage.setItem('hint', '1'); } catch {} };
if (!hinted) {
  hint.querySelector('span').innerHTML = t(matchMedia('(pointer: coarse)').matches ? 'hint.touch' : 'hint.desktop');
  hint.hidden = false;
  document.getElementById('hint-ok').onclick = hideHint;
  document.getElementById('timeline').addEventListener('pointerdown', hideHint, { once: true });
  document.getElementById('timeline').addEventListener('wheel', hideHint, { once: true, passive: true });
}

// ——— Layer buttons ———
const layersEl = document.getElementById('layers');
const chip = (label, color, pressed) => {
  const b = document.createElement('button');
  b.innerHTML = '<i></i>';
  b.append(label);
  b.style.setProperty('--dot', color);
  if (pressed != null) b.setAttribute('aria-pressed', String(pressed));
  layersEl.append(b);
  return b;
};
for (const [k, color] of LAYERS) {
  const b = chip(t('layer.' + k), color, app.layers[k]);
  b.onclick = () => {
    app.layers[k] = !app.layers[k];
    b.setAttribute('aria-pressed', String(app.layers[k]));
    map.setLayer(k, app.layers[k]);
    try { localStorage.setItem('layers', JSON.stringify(app.layers)); } catch {}
  };
}
const globeBtn = chip(t('layer.globe'), '#7fb7e6', !app.flat);
globeBtn.onclick = () => {
  app.flat = !app.flat;
  globeBtn.setAttribute('aria-pressed', String(!app.flat));
  map.setProjection(app.flat ? 'mercator' : 'globe');
  writeHash();
};

// Language: English by default; other languages are downloaded once and kept in the browser.
for (const b of document.querySelectorAll('#lang-switch button')) {
  const code = b.dataset.lang;
  b.setAttribute('aria-pressed', String(code === lang));
  b.onclick = async () => {
    if (code === lang) return;
    if (code !== 'en') {
      const label = b.textContent;
      b.disabled = true;
      b.textContent = t('lang.downloading');
      if (!(await downloadLanguage(code))) {
        b.disabled = false;
        b.textContent = label;
        alert(t('lang.failed'));
        return;
      }
    }
    setLanguage(code);
    location.reload();
  };
}

// ——— Play ———
const playBtn = document.getElementById('play');
const speedSel = document.getElementById('speed');
for (const o of speedSel.options) o.textContent = t('speed.unit', { n: o.value });
let lastFrame = 0;
function togglePlay(on = !app.playing) {
  app.playing = on;
  if (on && app.year >= MAX_YEAR - 1) app.setYear(-3000, { instant: true });
  playBtn.textContent = on ? '❚❚' : '▶';
  playBtn.setAttribute('aria-label', t(on ? 'play.pause' : 'play.play'));
  lastFrame = performance.now();
  dirty();
}
playBtn.onclick = () => togglePlay();
document.addEventListener('keydown', e => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'Escape') hideCard();
  else if (e.key === '/') { e.preventDefault(); document.getElementById('q').focus(); }
  else if (e.code === 'Comma' || e.code === 'Period') stepEvent(e.code === 'Period' ? 1 : -1);
  // Arrows move time, unless the map has focus (there they pan the view).
  else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.target.closest('#map, #timeline')) {
    e.preventDefault();
    app.stopPlay();
    app.setYear(app.year + (e.key === 'ArrowLeft' ? -1 : 1) * app.span / (e.shiftKey ? 10 : 50), { instant: true });
  }
});

// , and . go to the previous or next year with an event on the map (layers and kinds as set).
function stepEvent(dir) {
  const ks = panel.kinds(), now = Math.round(app.tween?.to ?? app.year);
  let best = null;
  for (const list of [events, wd]) {
    for (const e of list) {
      if (!app.layers[isBattle(e.k) ? 'battles' : 'events'] || (ks && !ks.includes(e.k))) continue;
      if (dir > 0 ? e.y > now && (best === null || e.y < best) : e.y < now && (best === null || e.y > best)) best = e.y;
    }
  }
  if (best === null) return;
  app.stopPlay();
  app.setYear(best);
}

// ——— One frame: time moves on, everything is redrawn ———
const yearEl = document.getElementById('year'), eraEl = document.getElementById('era'), snapEl = document.getElementById('snap');
let raf = 0, lastHash = 0, lastPanel = 0, panelTimer = 0;
function dirty() { if (!raf) raf = requestAnimationFrame(frame); }
function frame(now) {
  raf = 0;
  if (app.tween) {
    const k0 = Math.min(1, (now - app.tween.t0) / app.tween.dur);
    const k = k0 < 0.5 ? 4 * k0 * k0 * k0 : 1 - (-2 * k0 + 2) ** 3 / 2;
    app.year = app.tween.from + (app.tween.to - app.tween.from) * k;
    if (k0 >= 1) app.tween = null;
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
  snapEl.innerHTML = snap == null ? '' : t('hud.snap', { year: fmtYear(snap) }) + (Math.round(app.year) !== snap ? t('hud.snapBack') : '');
  // The panel is rebuilt at most 5–6 times a second; whatever was skipped catches up shortly.
  if (now - lastPanel > 180) { lastPanel = now; panel.update(app.year, win(), map.labels, snap); }
  else if (!panelTimer) panelTimer = setTimeout(() => { panelTimer = 0; dirty(); }, 200);
  if (now - lastHash > 500) { lastHash = now; writeHash(); }
  if (app.tween || app.playing) dirty();
}
function writeHash() {
  const c = map.map.getCenter();
  const h = `y=${Math.round(app.year)}&s=${Math.round(app.span)}&c=${c.lng.toFixed(2)},${c.lat.toFixed(2)}&z=${map.map.getZoom().toFixed(2)}${app.flat ? '&p=flat' : ''}${cardKey ? '&o=' + encodeURIComponent(cardKey) : ''}`;
  if (location.hash.slice(1) !== h) history.replaceState(null, '', '#' + h);
}
map.map.on('moveend', writeHash);
document.getElementById('card').addEventListener('cardchange', writeHash);

// A link with o=type:id opens that card, e.g. #y=-490&o=event:marathon.
function cardFromKey(key) {
  const i = key?.indexOf(':') ?? -1;
  if (i < 0) return null;
  const type = key.slice(0, i), id = key.slice(i + 1);
  if (type === 'polity') {
    const ent = entities[id];
    return ent && { type, item: { n: ent.n, e: id, p: ent.at.some(a => a[4]) ? 1 : 0, s: '' } };
  }
  const list = { event: events, wd, city: cities, person: people, culture: cultures, route: routes }[type];
  const item = list?.find(x => x.id === id);
  return item && { type, item };
}
// A link pasted into an open tab: the year and the card follow it.
window.addEventListener('hashchange', () => {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.has('y')) app.setYear(num(h.get('y'), app.year));
  const linked = h.get('o') !== cardKey && cardFromKey(h.get('o'));
  if (linked) showCard({ ...linked, year: num(h.get('y'), app.year) }, { entities, onGo });
});

await map.whenReady;
const linked = cardFromKey(hash.get('o'));
if (linked) showCard({ ...linked, year: app.year }, { entities, onGo });
dirty();
document.fonts.load("600 16px 'Cormorant Garamond'").finally(() => dirty());
document.getElementById('loading').classList.add('done');
