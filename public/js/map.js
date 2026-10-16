import * as maplibregl from '../vendor/maplibre/maplibre-gl.mjs';
import { fmtYear, fmtRange, wrapLine } from './time.js';
import { t, polityName } from './i18n.js';

const abs = p => new URL(p, location.href).href;
const EMPTY = { type: 'FeatureCollection', features: [] };
const FADE_MS = 450;

// Event kind → colour. Names come from the language pack (kind.<key>).
export const KINDS = {
  battle: '#e0574f', siege: '#e0574f', war: '#e0574f',
  found: '#e8c46a', politics: '#e8c46a', fall: '#a99a86', treaty: '#7fb7e6',
  discovery: '#5fd0c0', invention: '#b49cf0', culture: '#f0a6c8', religion: '#f5e6a8',
  disaster: '#f08a3c', eruption: '#f08a3c', quake: '#f08a3c', person: '#d8d0c0',
};
export const kindLabel = k => t('kind.' + k);
// Groups for the event filter (names: group.<key>).
export const KIND_GROUPS = {
  war: ['battle', 'siege', 'war'],
  power: ['politics', 'found', 'fall', 'treaty'],
  culture: ['culture', 'invention', 'person'],
  religion: ['religion'],
  discovery: ['discovery'],
  nature: ['disaster', 'eruption', 'quake'],
};
const kindColor = ['match', ['get', 'k'], ...Object.entries(KINDS).flat(), '#d8d0c0'];
export const isBattle = k => k === 'battle' || k === 'siege';

const Y = ['global-state', 'year'];
const WIN = ['global-state', 'win'];
const age = ['-', Y, ['get', 'y']];
// An event lights up in its year and fades over the "window", which depends on the timeline zoom.
const eventOpacity = ['case', ['<', age, 0], 0, ['>', age, WIN], 0, ['-', 1, ['*', 0.72, ['/', age, WIN]]]];
const rippleT = ['/', age, ['*', WIN, 0.35]];
const rippleOpacity = ['case', ['<', age, 0], 0, ['>', rippleT, 1], 0, ['*', 0.85, ['-', 1, rippleT]]];
// Fade in after s and out before e, over f years.
const spanOpacity = ['max', 0, ['min', 1, ['/', ['-', Y, ['get', 's']], ['get', 'f']], ['/', ['-', ['get', 'e'], Y], ['get', 'f']]]];

// The same formula in JS — for the panel, labels and clicks.
export function eventAlpha(y, year, win) {
  const a = year - y;
  return a < 0 || a > win ? 0 : 1 - 0.72 * a / win;
}
export const spanAlpha = (s, e, f, year) => Math.max(0, Math.min(1, (year - s) / f, (e - year) / f));

// A radius in km → pixels at zoom 0 (512 px for the world), doubling per zoom level.
const kmRadius = ['interpolate', ['exponential', 2], ['zoom'], 0, ['get', 'r0'], 20, ['*', ['get', 'r0'], 2 ** 20]];
const r0 = (km, lat) => km * 512 / (40075 * Math.cos(lat * Math.PI / 180));

// Opacity of the border layers. Switching snapshots fades them with a transition,
// which is why these are constants rather than expressions.
const BORDER_LAYERS = [
  ['fuzzy-fill', 'fill', 'fill-opacity', 0.3],
  ['sharp-fill', 'fill', 'fill-opacity', 0.46],
  ['fuzzy-edge', 'line', 'line-opacity', 0.45],
  ['sharp-edge', 'line', 'line-opacity', 0.7],
  ['sharp-line', 'line', 'line-opacity', 0.75],
];

function swordsImage() {
  const s = 48, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const blade = (rot) => {
    g.save();
    g.translate(s / 2, s / 2);
    g.rotate(rot);
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(15,10,8,0.9)'; g.lineWidth = 9;
    g.beginPath(); g.moveTo(0, -18); g.lineTo(0, 17); g.stroke();
    g.beginPath(); g.moveTo(-8, 10); g.lineTo(8, 10); g.stroke();
    g.strokeStyle = '#f0ddb0'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(0, -17); g.lineTo(0, 9); g.stroke();
    g.strokeStyle = '#e0574f'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(-7, 10); g.lineTo(7, 10); g.moveTo(0, 10); g.lineTo(0, 17); g.stroke();
    g.restore();
  };
  blade(Math.PI / 4); blade(-Math.PI / 4);
  return g.getImageData(0, 0, s, s);
}

export function createMap({ container, canvas, data, initial, onPick, onSnapshot }) {
  const { snapshots, cultures, cities, routes, events, wd, seas } = data;
  const state = { year: initial.year, win: 100, layers: { ...initial.layers }, kinds: initial.kinds || null };
  const kindOk = k => !state.kinds || state.kinds.includes(k);

  const ev = (list, extra) => ({
    type: 'FeatureCollection',
    features: list.map((e, idx) => ({ type: 'Feature', id: idx, geometry: { type: 'Point', coordinates: [e.lon, e.lat] }, properties: { y: e.y, k: e.k, i: e.i || 1, ...extra?.(e) } })),
  });
  const curatedNonBattle = events.filter(e => !isBattle(e.k));
  const curatedBattle = events.filter(e => isBattle(e.k));
  const wdBattle = wd.filter(e => isBattle(e.k));
  const wdOther = wd.filter(e => !isBattle(e.k));
  const wdMz = e => ({ mz: e.l >= 60 ? 2 : e.l >= 30 ? 3 : e.l >= 15 ? 4 : 5 });

  const routeFeatures = [];
  const line = coords => ({ type: 'MultiLineString', coordinates: wrapLine(coords) });
  routes.forEach((r, rid) => {
    if (r.k === 'trade') {
      routeFeatures.push({ type: 'Feature', id: routeFeatures.length, geometry: line(r.p), properties: { rid, k: 'trade', s: r.s, e: r.e, f: Math.max(40, (r.e - r.s) * 0.08) } });
      return;
    }
    // Campaigns are cut into short segments with their own year, so they draw themselves over time.
    const end = r.p[r.p.length - 1][2];
    for (let i = 0; i < r.p.length - 1; i++) {
      const [x0, y0, t0] = r.p[i], [x1, y1, t1] = r.p[i + 1];
      const N = 6;
      for (let j = 0; j < N; j++) {
        const a = j / N, b = (j + 1) / N;
        routeFeatures.push({
          type: 'Feature', id: routeFeatures.length,
          geometry: line([[x0 + (x1 - x0) * a, y0 + (y1 - y0) * a], [x0 + (x1 - x0) * b, y0 + (y1 - y0) * b]]),
          properties: { rid, k: r.k, t0: t0 + (t1 - t0) * a, end },
        });
      }
    }
  });
  const ROUTE_COLORS = { trade: '#e8c46a', campaign: '#ff7a5c', voyage: '#7fd3ff', migration: '#c3e88d' };

  const style = {
    version: 8,
    projection: { type: initial.flat ? 'mercator' : 'globe' },
    state: { year: { default: state.year }, win: { default: state.win } },
    sky: {
      'sky-color': '#0b1220', 'horizon-color': '#29405e', 'fog-color': '#0b1220',
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
    },
    transition: { duration: FADE_MS, delay: 0 },
    sources: {
      relief: { type: 'raster', tiles: [abs('tiles/relief/') + '{z}/{x}/{y}.webp'], tileSize: 256, maxzoom: 5, attribution: 'Relief: Natural Earth' },
      ocean: { type: 'geojson', data: abs('data/base/ocean.json') },
      land: { type: 'geojson', data: abs('data/base/land.json') },
      lakes: { type: 'geojson', data: abs('data/base/lakes.json') },
      rivers: { type: 'geojson', data: abs('data/base/rivers_lake_centerlines.json') },
      bA: { type: 'geojson', data: EMPTY, attribution: 'Borders: <a href="https://github.com/aourednik/historical-basemaps">historical-basemaps</a> (GPL-3.0)' },
      bB: { type: 'geojson', data: EMPTY },
      cultures: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: cultures.map((c, idx) => ({ type: 'Feature', id: idx, geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: { s: c.s, e: c.e, f: Math.max(40, (c.e - c.s) * 0.15), r0: r0(c.r, c.lat), c: c.c || '#f0c674' } })) },
      },
      routes: { type: 'geojson', data: { type: 'FeatureCollection', features: routeFeatures } },
      cities: { type: 'geojson', data: { type: 'FeatureCollection', features: cities.map((c, idx) => ({ type: 'Feature', id: idx, geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: { s: c.s, e: c.e ?? 9999, r: c.r } })) } },
      ev: { type: 'geojson', data: ev(curatedNonBattle) },
      bt: { type: 'geojson', data: ev(curatedBattle) },
      wdb: { type: 'geojson', data: ev(wdBattle, wdMz), attribution: 'Events: Wikidata' },
      wdo: { type: 'geojson', data: ev(wdOther, wdMz) },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#142132' } },
      { id: 'relief', type: 'raster', source: 'relief', paint: { 'raster-saturation': -0.45, 'raster-brightness-max': 0.74, 'raster-contrast': 0.04, 'raster-fade-duration': 0 } },
      { id: 'ocean', type: 'fill', source: 'ocean', paint: { 'fill-color': '#142132' } },
      { id: 'lakes', type: 'fill', source: 'lakes', paint: { 'fill-color': '#1b2c42' } },
      { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': '#0c1522', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 6, 1.4], 'line-opacity': 0.9 } },
      {
        id: 'rivers', type: 'line', source: 'rivers', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#4b7298', 'line-opacity': 0.75, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, ['case', ['<=', ['get', 'scalerank'], 3], 0.8, 0.3], 6, ['case', ['<=', ['get', 'scalerank'], 3], 2.2, 1.1]] },
      },
      ...['bA', 'bB'].flatMap(src => [
        { id: `${src}-fuzzy-fill`, type: 'fill', source: src, filter: ['==', ['get', 'p'], 0], paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0 } },
        { id: `${src}-sharp-fill`, type: 'fill', source: src, filter: ['==', ['get', 'p'], 1], paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0 } },
        { id: `${src}-hover`, type: 'fill', source: src, paint: { 'fill-color': '#fff6dc', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.16, 0] } },
        { id: `${src}-fuzzy-edge`, type: 'line', source: src, filter: ['==', ['get', 'p'], 0], layout: { 'line-join': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-opacity': 0, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 4, 6, 16], 'line-blur': ['interpolate', ['linear'], ['zoom'], 1, 4, 6, 14] } },
        { id: `${src}-sharp-edge`, type: 'line', source: src, filter: ['==', ['get', 'p'], 1], layout: { 'line-join': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-opacity': 0, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 2, 6, 7], 'line-blur': ['interpolate', ['linear'], ['zoom'], 1, 1.5, 6, 5], 'line-offset': ['interpolate', ['linear'], ['zoom'], 1, 0.8, 6, 3] } },
        { id: `${src}-sharp-line`, type: 'line', source: src, filter: ['==', ['get', 'p'], 1], layout: { 'line-join': 'round' }, paint: { 'line-color': '#1c140c', 'line-opacity': 0, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 6, 1.5] } },
      ]),
      { id: 'cultures', type: 'circle', source: 'cultures', paint: { 'circle-radius': kmRadius, 'circle-color': ['get', 'c'], 'circle-blur': 0.85, 'circle-opacity': ['*', 0.42, spanOpacity], 'circle-pitch-alignment': 'map' } },
      {
        id: 'routes-trade', type: 'line', source: 'routes', filter: ['==', ['get', 'k'], 'trade'], layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ROUTE_COLORS.trade, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.4, 6, 3], 'line-dasharray': [2, 2], 'line-opacity': ['*', 0.8, spanOpacity] },
      },
      {
        id: 'routes-move', type: 'line', source: 'routes', filter: ['!=', ['get', 'k'], 'trade'], layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'k'], 'campaign', ROUTE_COLORS.campaign, 'voyage', ROUTE_COLORS.voyage, ROUTE_COLORS.migration],
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.8, 6, 3.5],
          'line-opacity': ['case', ['<', Y, ['get', 't0']], 0, ['>', Y, ['+', ['get', 'end'], WIN]], 0, ['>', Y, ['get', 'end']], ['-', 0.9, ['*', 0.9, ['/', ['-', Y, ['get', 'end']], WIN]]], 0.9],
        },
      },
      ...[[1, 0], [2, 2.6], [3, 4]].map(([rank, mz]) => ({
        id: `cities-${rank}`, type: 'circle', source: 'cities', minzoom: mz, filter: ['==', ['get', 'r'], rank],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 4 - rank * 0.7, 6, 6 - rank],
          'circle-color': '#f4ecd8', 'circle-stroke-color': '#16110c', 'circle-stroke-width': 1.2,
          'circle-opacity': ['case', ['all', ['>=', Y, ['get', 's']], ['<=', Y, ['get', 'e']]], 1, 0],
          'circle-stroke-opacity': ['case', ['all', ['>=', Y, ['get', 's']], ['<=', Y, ['get', 'e']]], 1, 0],
        },
      })),
      ...[2, 3, 4, 5].map(mz => ({
        id: `wdo-${mz}`, type: 'circle', source: 'wdo', minzoom: mz, filter: ['==', ['get', 'mz'], mz],
        paint: { 'circle-radius': 3.5, 'circle-color': kindColor, 'circle-opacity': ['*', 0.85, eventOpacity], 'circle-stroke-color': '#0b0f16', 'circle-stroke-width': 1, 'circle-stroke-opacity': eventOpacity },
      })),
      ...[2, 3, 4, 5].map(mz => ({
        id: `wdb-${mz}`, type: 'symbol', source: 'wdb', minzoom: mz, filter: ['==', ['get', 'mz'], mz],
        layout: { 'icon-image': 'swords', 'icon-size': 0.42, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
        paint: { 'icon-opacity': ['*', 0.85, eventOpacity] },
      })),
      { id: 'ev-ripple', type: 'circle', source: 'ev', paint: { 'circle-radius': ['+', 4, ['*', 30, ['min', 1, ['max', 0, rippleT]]]], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': kindColor, 'circle-stroke-width': 2, 'circle-stroke-opacity': rippleOpacity, 'circle-pitch-alignment': 'map' } },
      { id: 'ev', type: 'circle', source: 'ev', paint: { 'circle-radius': ['match', ['get', 'i'], 3, 7, 2, 5.5, 4.2], 'circle-color': kindColor, 'circle-opacity': eventOpacity, 'circle-stroke-color': '#0b0f16', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': eventOpacity } },
      { id: 'bt-ripple', type: 'circle', source: 'bt', paint: { 'circle-radius': ['+', 6, ['*', 30, ['min', 1, ['max', 0, rippleT]]]], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#e0574f', 'circle-stroke-width': 2, 'circle-stroke-opacity': rippleOpacity } },
      {
        id: 'bt', type: 'symbol', source: 'bt',
        layout: { 'icon-image': 'swords', 'icon-size': ['match', ['get', 'i'], 3, 0.72, 2, 0.6, 0.5], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
        paint: { 'icon-opacity': eventOpacity },
      },
    ],
  };

  const map = new maplibregl.Map({
    container, style,
    center: initial.center, zoom: initial.zoom,
    minZoom: 0.8, maxZoom: 9, maxPitch: 0, dragRotate: false,
    attributionControl: { compact: true },
    fadeDuration: 0,
  });
  map.touchZoomRotate.disableRotation();
  map.setMissingStyleImageResolver(id => {
    if (id === 'swords' && !map.hasImage(id)) map.addImage(id, swordsImage(), { pixelRatio: 2 });
  });

  // ——— Layer groups (the buttons at the top) ———
  const GROUPS = {
    borders: id => /^b[AB]-/.test(id),
    cultures: id => id === 'cultures',
    events: id => id === 'ev' || id === 'ev-ripple' || id.startsWith('wdo-'),
    battles: id => id === 'bt' || id === 'bt-ripple' || id.startsWith('wdb-'),
    routes: id => id.startsWith('routes-'),
    cities: id => id.startsWith('cities-'),
    rivers: id => id === 'rivers' || id === 'lakes',
  };
  // The kind filter: an expression on the MapLibre layers, kindOk() for the labels.
  function applyKinds() {
    const f = state.kinds ? ['in', ['get', 'k'], ['literal', state.kinds]] : null;
    for (const id of ['ev', 'ev-ripple', 'bt', 'bt-ripple']) map.setFilter(id, f);
    for (const mz of [2, 3, 4, 5]) {
      const base = ['==', ['get', 'mz'], mz];
      for (const id of [`wdo-${mz}`, `wdb-${mz}`]) map.setFilter(id, f ? ['all', base, f] : base);
    }
    draw();
  }

  function applyLayerVisibility() {
    for (const l of map.getStyle().layers) {
      for (const [g, test] of Object.entries(GROUPS)) {
        if (test(l.id)) map.setLayoutProperty(l.id, 'visibility', state.layers[g] ? 'visible' : 'none');
      }
    }
    draw();
  }

  // ——— Borders: two copies; one is filled while the other is shown ———
  const cache = new Map();
  const load = y => {
    if (!cache.has(y)) {
      cache.set(y, fetch(abs(`data/borders/${y}.json`)).then(r => r.json()).then(snap => {
        // Polity names are English keys in the data; show them in the current language.
        for (const f of snap.fc.features) {
          f.properties.n = polityName(f.properties.e);
          if (f.properties.s) f.properties.s = polityName(f.properties.s);
        }
        for (const l of snap.labels) l[3] = polityName(l[3]);
        return snap;
      }).catch(err => { cache.delete(y); throw err; }));
    }
    return cache.get(y);
  };
  let active = 'bA', shown = null, wanted = null, busy = false, labels = [];
  const snapFor = year => {
    let s = snapshots[0];
    for (const y of snapshots) if (y <= year) s = y;
    return s;
  };
  function setBufferOpacity(src, on) {
    for (const [suffix, , prop, val] of BORDER_LAYERS) map.setPaintProperty(`${src}-${suffix}`, prop, on ? val : 0);
  }
  async function swap() {
    if (busy || wanted === shown) return;
    busy = true;
    const target = wanted;
    try {
      const snap = await load(target);
      const next = active === 'bA' ? 'bB' : 'bA';
      const source = map.getSource(next);
      await new Promise(resolve => {
        const done = () => { map.off('sourcedata', onData); clearTimeout(t); resolve(); };
        const onData = e => { if (e.sourceId === next && e.isSourceLoaded) done(); };
        const t = setTimeout(done, 2500);
        map.on('sourcedata', onData);
        source.setData(snap.fc);
      });
      clearHover();
      setBufferOpacity(next, true);
      setBufferOpacity(active, false);
      active = next;
      shown = target;
      labels = snap.labels;
      onSnapshot?.(target, snap);
      draw();
      const i = snapshots.indexOf(target);
      [snapshots[i - 1], snapshots[i + 1]].forEach(y => y != null && load(y).catch(() => {}));
    } catch (err) {
      console.error('Snapshot failed to load', target, err);
    } finally {
      busy = false;
      if (wanted !== shown) swap();
    }
  }

  // ——— Hover and clicks ———
  let hovered = null;
  function clearHover() {
    if (hovered) map.setFeatureState(hovered, { hover: false });
    hovered = null;
  }
  const clickable = () => [
    ...(state.layers.battles ? ['bt', 'wdb-2', 'wdb-3', 'wdb-4', 'wdb-5'] : []),
    ...(state.layers.events ? ['ev', 'wdo-2', 'wdo-3', 'wdo-4', 'wdo-5'] : []),
    ...(state.layers.cities ? ['cities-1', 'cities-2', 'cities-3'] : []),
    ...(state.layers.routes ? ['routes-move', 'routes-trade'] : []),
    ...(state.layers.cultures ? ['cultures'] : []),
    ...(state.layers.borders ? [`${active}-sharp-fill`, `${active}-fuzzy-fill`] : []),
  ].filter(id => map.getLayer(id));

  // Which of the features under the cursor is actually visible in this year.
  function visibleHit(f) {
    const p = f.properties, y = state.year;
    switch (f.source) {
      case 'ev': case 'bt': return kindOk(p.k) && eventAlpha(p.y, y, state.win) > 0.05 && { type: 'event', item: (f.source === 'ev' ? curatedNonBattle : curatedBattle)[f.id] };
      case 'wdb': case 'wdo': return kindOk(p.k) && eventAlpha(p.y, y, state.win) > 0.05 && { type: 'wd', item: (f.source === 'wdb' ? wdBattle : wdOther)[f.id] };
      case 'cities': return y >= p.s && y <= p.e && { type: 'city', item: cities[f.id] };
      case 'routes': {
        const r = routes[p.rid];
        const on = p.k === 'trade' ? spanAlpha(p.s, p.e, p.f, y) > 0.1 : y >= p.t0 && y <= p.end + state.win;
        return on && { type: 'route', item: r };
      }
      case 'cultures': return spanAlpha(p.s, p.e, p.f, y) > 0.15 && { type: 'culture', item: cultures[f.id] };
      default: return f.source === active && { type: 'polity', item: p, feature: f };
    }
  }
  function hitAt(point) {
    const box = [[point.x - 6, point.y - 6], [point.x + 6, point.y + 6]];
    for (const f of map.queryRenderedFeatures(box, { layers: clickable() })) {
      const hit = visibleHit(f);
      if (hit) return hit;
    }
    return null;
  }
  // Hover tooltip — Wikidata battles have no label on the map.
  const tip = document.getElementById('tip');
  const tipText = hit => {
    const it = hit.item;
    switch (hit.type) {
      case 'event': case 'wd': return [it.t, fmtYear(it.y)];
      case 'city': return [cityName(it, state.year), ''];
      case 'route': return [it.n, it.k === 'trade' ? fmtRange(it.s, it.e) : ''];
      case 'culture': return [it.n, fmtRange(it.s, it.e)];
      default: return [it.n, it.s ? t('tip.under', { s: it.s }) : ''];
    }
  };
  map.on('mousemove', e => {
    const hit = hitAt(e.point);
    map.getCanvas().style.cursor = hit ? 'pointer' : '';
    if (hit) {
      const [t, sub] = tipText(hit);
      tip.innerHTML = '';
      tip.append(Object.assign(document.createElement('b'), { textContent: t }));
      if (sub) tip.append(Object.assign(document.createElement('span'), { textContent: sub }));
      const r = container.getBoundingClientRect();
      tip.style.left = r.left + e.point.x + 'px';
      tip.style.top = r.top + e.point.y + 'px';
    }
    tip.hidden = !hit;
    const f = hit?.type === 'polity' ? { source: active, id: hit.feature.id } : null;
    if (f?.id !== hovered?.id || f?.source !== hovered?.source) {
      clearHover();
      if (f) { map.setFeatureState(f, { hover: true }); hovered = f; }
    }
  });
  map.on('mouseout', () => { clearHover(); tip.hidden = true; });
  map.on('click', e => {
    const hit = hitAt(e.point);
    if (hit) onPick?.(hit, e.lngLat);
    else onPick?.(null);
  });

  // ——— Labels on a separate canvas: our own font, spacing and collisions ———
  const ctx = canvas.getContext('2d');
  const widthCache = new Map();
  let W = 0, H = 0, dpr = 1;
  function resize() {
    const r = container.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    canvas.style.left = r.left + 'px'; canvas.style.top = r.top + 'px';
  }
  resize();
  map.on('resize', () => { resize(); draw(); });

  const SERIF = "'Cormorant Garamond', Georgia, serif";
  function measure(text, font, spacing) {
    const key = font + '|' + spacing + '|' + text;
    let w = widthCache.get(key);
    if (w == null) {
      ctx.font = font;
      ctx.letterSpacing = spacing + 'px';
      w = ctx.measureText(text).width;
      widthCache.set(key, w);
    }
    return w;
  }
  function splitName(name) {
    if (name.length < 15 || !name.includes(' ')) return [name];
    const mid = name.length / 2;
    let best = -1;
    for (let i = 0; i < name.length; i++) if (name[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    return [name.slice(0, best), name.slice(best + 1)];
  }

  let pending = false;
  function draw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; drawNow(); });
  }
  map.on('render', drawNow);

  function drawNow() {
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const z = map.getZoom(), year = state.year, win = state.win;
    const c = map.getCenter();
    const globe = map.getProjection()?.type === 'globe';
    const cx = Math.cos(c.lat * Math.PI / 180) * Math.cos(c.lng * Math.PI / 180), cy = Math.cos(c.lat * Math.PI / 180) * Math.sin(c.lng * Math.PI / 180), cz = Math.sin(c.lat * Math.PI / 180);
    const facing = (lon, lat) => {
      if (!globe) return true;
      const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
      return Math.cos(la) * Math.cos(lo) * cx + Math.cos(la) * Math.sin(lo) * cy + Math.sin(la) * cz > 0.2;
    };
    // Two layers of labels, as in a printed atlas: events, campaigns and cities ("hard")
    // never overlap each other; states and cultures ("soft") only avoid each other and
    // are drawn underneath, so they don't swallow the cities when zoomed in.
    const hard = [], soft = [], later = [];
    const freeIn = (placed, x0, y0, x1, y1) => {
      // Fully on screen or not at all — a half-cut label is worse than none.
      if (x0 < 2 || y0 < 2 || x1 > W - 2 || y1 > H - 2) return false;
      // ponytail: O(n²) over placed labels; with hundreds on screen it is under a millisecond.
      for (const r of placed) if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return false;
      placed.push([x0, y0, x1, y1]);
      return true;
    };
    const free = (...box) => freeIn(hard, ...box);
    // Space taken by the interface over the map is taken for labels too.
    const cr = container.getBoundingClientRect();
    for (const sel of ['#hud', '#tools', '#side:not(.closed) #side-body', '#side-toggle', '#card:not([hidden])', '#hint:not([hidden])']) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const box = [r.left - cr.left, r.top - cr.top, r.right - cr.left, r.bottom - cr.top];
      hard.push(box);
      soft.push(box);
    }
    const text = (str, x, y, font, fill, spacing = 0, align = 'left', halo = 'rgba(8,10,16,0.82)') => {
      ctx.font = font;
      ctx.letterSpacing = spacing + 'px';
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = halo;
      ctx.strokeText(str, x, y);
      ctx.fillStyle = fill;
      ctx.fillText(str, x, y);
    };

    // 1. Fresh events — they are "what is happening now".
    if (state.layers.events || state.layers.battles) {
      const minI = z < 2.6 ? 3 : z < 4 ? 2 : 1;
      const fresh = events
        .filter(e => (isBattle(e.k) ? state.layers.battles : state.layers.events) && e.i >= minI && kindOk(e.k))
        .map(e => [e, year - e.y])
        .filter(([, a]) => a >= 0 && a <= win * 0.55)
        .sort((a, b) => b[0].i - a[0].i || a[1] - b[1])
        .slice(0, 10);
      for (const [e, a] of fresh) {
        if (!facing(e.lon, e.lat)) continue;
        const p = map.project([e.lon, e.lat]);
        const font = `italic 600 ${e.i === 3 ? 16 : 14.5}px ${SERIF}`;
        const w = measure(e.t, font, 0);
        // Right of the dot, unless it would hit the edge — then to the left.
        const left = p.x + 11 + w > W - 4;
        const x0 = left ? p.x - 11 - w : p.x + 11, y = p.y;
        if (x0 < 4 || !free(x0 - 2, y - 9, x0 + w + 2, y + 9)) continue;
        const alpha = Math.min(1, 1.6 * (1 - a / (win * 0.55)));
        later.push(() => { ctx.globalAlpha = alpha; text(e.t, x0, y, font, '#fff3d6'); ctx.globalAlpha = 1; });
      }
    }

    // 2. Campaigns: a glowing head and the campaign's name.
    if (state.layers.routes) {
      routes.forEach(r => {
        if (r.k === 'trade') return;
        const pts = r.p, t0 = pts[0][2], t1 = pts[pts.length - 1][2];
        if (year < t0 || year > t1) return;
        let i = 0;
        while (i < pts.length - 2 && pts[i + 1][2] <= year) i++;
        const [x0, y0, a0] = pts[i], [x1, y1, a1] = pts[i + 1];
        const f = a1 > a0 ? Math.min(1, Math.max(0, (year - a0) / (a1 - a0))) : 1;
        const lon = x0 + (x1 - x0) * f, lat = y0 + (y1 - y0) * f;
        if (!facing(lon, lat)) return;
        const p = map.project([lon, lat]);
        const color = ROUTE_COLORS[r.k];
        const font = `600 13px ${SERIF}`;
        const w = measure(r.n, font, 0.3);
        const named = free(p.x + 10, p.y - 18, p.x + 14 + w, p.y - 4);
        later.push(() => {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
          g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
          if (named) text(r.n, p.x + 12, p.y - 11, font, color, 0.3);
        });
      });
    }

    // 3. Cities, with their name for the year.
    if (state.layers.cities) {
      const maxRank = z < 2.6 ? 1 : z < 4 ? 2 : 3;
      for (const c of cities) {
        if (c.r > maxRank || year < c.s || year > (c.e ?? 9999) || !facing(c.lon, c.lat)) continue;
        const name = cityName(c, year);
        const p = map.project([c.lon, c.lat]);
        const font = `${c.r === 1 ? 700 : 600} ${c.r === 1 ? 14.5 : 13}px ${SERIF}`;
        const w = measure(name, font, 0);
        const x = p.x + 7 + w > W - 4 ? p.x - 7 - w : p.x + 7;
        if (free(x, p.y - 8, x + w, p.y + 8)) later.push(() => text(name, x, p.y, font, '#f4ecd8'));
      }
    }

    // 3½. Seas with their name for the year — bluish italics, like an old atlas.
    if (state.layers.rivers) {
      const maxRank = z < 2 ? 1 : z < 3.2 ? 2 : 3;
      for (const s of seas) {
        if (s.r > maxRank || (s.r === 1 && z > 4.5) || !facing(s.lon, s.lat)) continue;
        const name = cityName(s, year);
        const size = s.r === 1 ? 17 : s.r === 2 ? 14.5 : 12.5;
        const spacing = s.r === 1 ? 5 : s.r === 2 ? 2.2 : 1.2;
        const font = `italic 500 ${size}px ${SERIF}`;
        const p = map.project([s.lon, s.lat]);
        const w = measure(name, font, spacing);
        if (!freeIn(soft, p.x - w / 2, p.y - size / 2, p.x + w / 2, p.y + size / 2)) continue;
        text(name, p.x, p.y, font, 'rgba(150,186,222,0.82)', spacing, 'center', 'rgba(10,20,34,0.7)');
      }
    }

    // 4. Cultures without borders.
    if (state.layers.cultures) {
      for (const c of cultures) {
        const a = spanAlpha(c.s, c.e, Math.max(40, (c.e - c.s) * 0.15), year);
        if (a < 0.25 || !facing(c.lon, c.lat)) continue;
        const p = map.project([c.lon, c.lat]);
        const font = `italic 600 ${z < 3 ? 15 : 17}px ${SERIF}`;
        const w = measure(c.n, font, 0.5);
        if (!freeIn(soft, p.x - w / 2, p.y - 10, p.x + w / 2, p.y + 10)) continue;
        ctx.globalAlpha = a;
        text(c.n, p.x, p.y, font, '#f6d89a', 0.5, 'center');
        ctx.globalAlpha = 1;
      }
    }

    // 5. States and peoples from the snapshot, by area.
    if (state.layers.borders) {
      const kmPerPx0 = 40075 / 512;
      // The same name is not repeated closer than half a screen.
      const seen = new Map();
      const near = Math.max(W, H) * 0.5;
      for (const [lon, lat, area, name, sharp] of labels) {
        if (!facing(lon, lat)) continue;
        const kmPerPx = kmPerPx0 * Math.cos(lat * Math.PI / 180) / 2 ** z;
        const ext = Math.sqrt(area) / kmPerPx;
        if (ext < 34) continue;
        const lines = splitName(sharp ? name.toUpperCase() : name);
        const longest = Math.max(...lines.map(l => l.length));
        let size = Math.min(sharp ? 22 : 19, ext / (longest * (sharp ? 0.85 : 0.62)));
        if (size < 10.5) {
          if (ext < 70) continue;
          size = 10.5;
        }
        const font = sharp ? `700 ${size.toFixed(1)}px ${SERIF}` : `italic 600 ${size.toFixed(1)}px ${SERIF}`;
        const spacing = sharp ? size * 0.14 : 0.3;
        const p = map.project([lon, lat]);
        const lh = size * 1.05;
        const w = Math.max(...lines.map(l => measure(l, font, spacing)));
        const h = lh * lines.length;
        if (seen.get(name)?.some(q => Math.hypot(q.x - p.x, q.y - p.y) < near)) continue;
        if (!freeIn(soft, p.x - w / 2 - 2, p.y - h / 2, p.x + w / 2 + 2, p.y + h / 2)) continue;
        seen.set(name, [...(seen.get(name) || []), p]);
        lines.forEach((l, k) => text(l, p.x, p.y + (k - (lines.length - 1) / 2) * lh, font, sharp ? 'rgba(250,240,220,0.95)' : 'rgba(236,226,206,0.82)', spacing, 'center', 'rgba(8,10,16,0.7)'));
      }
    }

    // The hard labels on top.
    for (const f of later) f();
  }

  // ——— Public interface ———
  let ready = false;
  map.on('load', () => {
    ready = true;
    // The compact attribution opens itself on load; on a phone it covers the map.
    container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    applyLayerVisibility();
    if (state.kinds) applyKinds();
    api.setYear(state.year, state.win);
  });

  const api = {
    map,
    get snapshot() { return shown; },
    get labels() { return labels; },
    setYear(year, win) {
      state.year = year;
      state.win = win;
      if (!ready) return;
      map.setGlobalStateProperty('year', year);
      map.setGlobalStateProperty('win', win);
      wanted = snapFor(year);
      swap();
      draw();
    },
    setKinds(kinds) {
      state.kinds = kinds;
      if (ready) applyKinds();
    },
    setLayer(name, on) {
      state.layers[name] = on;
      if (ready) applyLayerVisibility();
    },
    setProjection(type) { map.setProjection({ type }); },
    flyTo(lon, lat, zoom) {
      map.flyTo({ center: [lon, lat], zoom: zoom ?? Math.max(map.getZoom(), 3.6), speed: 1.4, essential: true });
    },
    whenReady: new Promise(r => map.once('load', r)),
  };
  return api;
}

export function cityName(c, year) {
  let n = c.n[0][1];
  for (const [from, name] of c.n) if (year >= from) n = name;
  return n;
}
