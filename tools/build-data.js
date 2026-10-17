// Builds public/data from the raw datasets in .cache:
//   borders/<year>.json  — simplified borders + label points
//   entities.json        — every polity name: the years and places it appears
//   base/*.json          — land, ocean, rivers, lakes (Natural Earth)
// Inputs: .cache/hb (historical-basemaps), .cache/ne/<layer> (Natural Earth 1:50m, with
// admin0/ne_50m_admin_0_countries for the maps after 2010).
// Polity names stay in English (they are the keys); translations live in tools/i18n.
// Run with `npm run data`.
import fs from 'node:fs';
import path from 'node:path';
import ms from 'mapshaper';
import polylabel from 'polylabel';

const ROOT = path.resolve(import.meta.dirname, '..');
const HB = path.join(ROOT, '.cache/hb');
const NE = path.join(ROOT, '.cache/ne');
const OUT = path.join(ROOT, 'public/data');

fs.mkdirSync(path.join(OUT, 'borders'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'base'), { recursive: true });

// Muted colours that sit well on the relief. Picked by a hash of the name,
// so Rome has the same colour in every snapshot.
const PALETTE = [
  '#c0504d', '#d4884a', '#c9a640', '#8fa64a', '#4f9a6e', '#3f8f99', '#4a76b0',
  '#6b62b5', '#9a5aa8', '#b8577f', '#a0704f', '#7d8a5a', '#5c7d8f', '#b07a3a',
];
function hash(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}
const colorFor = key => PALETTE[hash(key) % PALETTE.length];

// Area in km² from the spherical excess — good enough to rank labels.
function ringArea(ring) {
  const R = 6371;
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    a += (x2 - x1) * Math.PI / 180 * (2 + Math.sin(y1 * Math.PI / 180) + Math.sin(y2 * Math.PI / 180));
  }
  return Math.abs(a * R * R / 2);
}
const polyArea = poly => Math.max(0, ringArea(poly[0]) - poly.slice(1).reduce((s, r) => s + ringArea(r), 0));

async function simplify(file, pct, extra = '') {
  const out = await ms.applyCommands(
    `-i in.json ${extra} -simplify ${pct} keep-shapes -o out.json precision=0.01 format=geojson`,
    { 'in.json': fs.readFileSync(file, 'utf8') });
  return JSON.parse(out['out.json']);
}

const r2 = n => Math.round(n * 100) / 100;

// Sutherland–Hodgman: the ring clipped to a rectangle.
function clipRing(ring, [x0, y0, x1, y1]) {
  const edges = [
    [p => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]],
    [p => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
    [p => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]],
    [p => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]],
  ];
  let out = ring.slice(0, -1);
  for (const [inside, cut] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[(i + src.length - 1) % src.length], b = src[i];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); }
      else if (inside(a)) out.push(cut(a, b));
    }
    if (!out.length) return null;
  }
  return [...out, out[0]];
}

// A huge polity (Russia, the Mongol Empire) gets labels in its other parts too,
// otherwise when zoomed into Europe its only label is somewhere in Siberia.
function extraLabels(poly, mainXY) {
  const xs = poly[0].map(p => p[0]), ys = poly[0].map(p => p[1]);
  const out = [];
  for (let x = Math.floor(Math.min(...xs) / 40) * 40; x < Math.max(...xs); x += 40) {
    for (let y = Math.floor(Math.min(...ys) / 25) * 25; y < Math.max(...ys); y += 25) {
      const ring = clipRing(poly[0], [x, y, x + 40, y + 25]);
      if (!ring || ring.length < 4) continue;
      const a = ringArea(ring);
      if (a < 900000) continue;
      const [lx, ly] = polylabel([ring], 0.1);
      if (Math.hypot(lx - mainXY[0], ly - mainXY[1]) < 15) continue;
      out.push([r2(lx), r2(ly), Math.round(a)]);
    }
  }
  return out;
}
const entities = {};
const index = JSON.parse(fs.readFileSync(path.join(HB, 'index.json'), 'utf8')).years;

// The source keeps a few names past the year they changed, misspells a few, and writes
// some the way a database index would ("Korea, Republic of"). One state, one name.
const RENAMES = {
  Zaire: [1997, 'Democratic Republic of the Congo'], Byelarus: [1991, 'Belarus'], Burma: [1989, 'Myanmar'],
  Trinidad: [1962, 'Trinidad and Tobago'],
  Zhoa: [-Infinity, 'Zhou'], Cimerians: [-Infinity, 'Cimmerians'], Irlanda: [-Infinity, 'Ireland'],
  'Korea, Republic of': [-Infinity, 'South Korea'], "Korea, Democratic People's Republic of": [-Infinity, 'North Korea'],
  'Tanzania, United Republic of': [-Infinity, 'Tanzania'], 'Gambia, The': [-Infinity, 'Gambia'],
  'Wallis and Futuna Islands': [-Infinity, 'Wallis and Futuna'], 'Turkish Cypriot-administered area': [-Infinity, 'Northern Cyprus'],
};
const renamed = (name, year) => (RENAMES[name] && year >= RENAMES[name][0] ? RENAMES[name][1] : name);

// ——— Natural Earth countries: the map after 2010, and the states the source misses ———
// The source has no map after 2010, and its 1994–2010 maps miss states: Switzerland is a
// hole, Kosovo is inside Serbia, East Timor inside Indonesia, the small island states are
// not there at all. Natural Earth (1:50m, v5.1.1) has every one of them.
const neMap = JSON.parse((await ms.applyCommands(
  `-i ${path.join(NE, 'admin0', 'ne_50m_admin_0_countries.shp')} -filter 'ADM0_A3 !== "ATA"' -filter-fields ADMIN,SOVEREIGNT,TYPE,ADM0_A3 -simplify 35% keep-shapes -o out.json precision=0.01 format=geojson`))['out.json']);
// Natural Earth draws Crimea as Russian, by who holds it. Here it is Ukraine, as the UN
// General Assembly recognises it (resolution 68/262).
{
  const russia = neMap.features.find(f => f.properties.ADM0_A3 === 'RUS');
  const ukraine = neMap.features.find(f => f.properties.ADM0_A3 === 'UKR');
  const inRing = ([x, y], ring) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const crimea = russia.geometry.coordinates.findIndex(poly => inRing([34.1, 45.0], poly[0]));
  if (crimea < 0) throw new Error('Crimea not found in the Natural Earth map of Russia');
  const [part] = russia.geometry.coordinates.splice(crimea, 1);
  const parts = ukraine.geometry.type === 'Polygon' ? [ukraine.geometry.coordinates] : ukraine.geometry.coordinates;
  ukraine.geometry = { type: 'MultiPolygon', coordinates: [...parts, part] };
  const out = await ms.applyCommands('-i in.json -dissolve ADM0_A3 copy-fields=ADMIN,SOVEREIGNT,TYPE -o out.json precision=0.01 format=geojson',
    { 'in.json': JSON.stringify(neMap) });
  neMap.features = JSON.parse(out['out.json']).features;
}
// Natural Earth names that differ from the ones used here for the same state.
const NE_NAMES = {
  'United States of America': 'United States', 'Republic of Serbia': 'Serbia', 'Republic of the Congo': 'Congo',
  'United Republic of Tanzania': 'Tanzania', 'The Bahamas': 'Bahamas', 'Hong Kong S.A.R.': 'Hong Kong',
  'Macao S.A.R': 'Macau', eSwatini: 'Eswatini', Aland: 'Åland',
  // A new short form of the same name stays under the one the state had in the source,
  // or Bulgarian would list "Чехия" twice.
  Czechia: 'Czech Republic', 'Cabo Verde': 'Cape Verde',
};
// Renamed states: the 2011 map uses the old names.
const NE_BEFORE = { Eswatini: [2018, 'Swaziland'], 'North Macedonia': [2019, 'Macedonia'] };
const neName = (admin, year) => {
  const n = NE_NAMES[admin] ?? admin;
  return NE_BEFORE[n] && year < NE_BEFORE[n][0] ? NE_BEFORE[n][1] : n;
};
// In the shape of the source's features: every border is a precise one.
const neFeature = (f, year) => {
  const { ADMIN, SOVEREIGNT, TYPE } = f.properties;
  const sub = SOVEREIGNT !== ADMIN && TYPE !== 'Indeterminate' ? neName(SOVEREIGNT, year) : '';
  return { type: 'Feature', properties: { NAME: neName(ADMIN, year), SUBJECTO: sub, BORDERPRECISION: 3 }, geometry: f.geometry };
};
// The states the source misses, from the year they exist (by Natural Earth's code).
const MISSING_FROM = {
  CHE: -Infinity, MCO: -Infinity, SMR: -Infinity, VAT: -Infinity, SGP: 1965, MDV: 1965, MUS: 1968, NRU: 1968,
  BHR: 1971, CPV: 1975, COM: 1975, STP: 1975, SYC: 1976, SLB: 1978, TUV: 1978, KIR: 1979, VUT: 1980,
  MHL: 1986, FSM: 1986, PLW: 1994, PSX: 1994, TLS: 2002, KOS: 2008,
};
// Cuts the missing states out of whatever the source drew there, then adds them.
async function withMissingStates(fc, year) {
  const have = new Set(fc.features.filter(f => f.geometry).map(f => renamed(f.properties.NAME?.trim(), year)));
  const add = neMap.features
    .filter(f => MISSING_FROM[f.properties.ADM0_A3] <= year && !have.has(neName(f.properties.ADMIN, year)))
    .map(f => neFeature(f, year));
  if (!add.length) return fc;
  // The source sometimes has the state as an empty shape (Switzerland): that goes.
  const added = new Set(add.map(f => f.properties.NAME));
  fc = { ...fc, features: fc.features.filter(f => !added.has(renamed(f.properties.NAME?.trim(), year))) };
  const out = await ms.applyCommands('-i hb.json name=hb -i add.json name=add -erase add target=hb -merge-layers target=hb,add force -o out.json precision=0.01 format=geojson',
    { 'hb.json': JSON.stringify(fc), 'add.json': JSON.stringify({ type: 'FeatureCollection', features: add }) });
  console.log(`  ${year}: added ${add.map(f => f.properties.NAME).join(', ')}`);
  return JSON.parse(out['out.json']);
}

const NE_YEARS = [2011, 2019];
const years = [...index.map(y => y.year), ...NE_YEARS];
for (const year of years) {
  const hb = index.find(y => y.year === year);
  let fc;
  if (!hb) fc = { type: 'FeatureCollection', features: neMap.features.map(f => neFeature(f, year)) };
  else {
    fc = await simplify(path.join(HB, hb.filename), '35%');
    if (year >= 1994) fc = await withMissingStates(fc, year);
  }
  const feats = [], labels = [];
  for (const f of fc.features) {
    const p = f.properties;
    const name = renamed(p.NAME?.trim(), year);
    if (!name || !f.geometry) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let best = null, bestA = -1, total = 0;
    for (const poly of polys) {
      const a = polyArea(poly);
      total += a;
      if (a > bestA) { bestA = a; best = poly; }
    }
    if (!best) continue;
    const sub = p.SUBJECTO && p.SUBJECTO !== p.NAME ? renamed(p.SUBJECTO.trim(), year) : null;
    const id = feats.length;
    feats.push({
      type: 'Feature', id,
      properties: { e: name, c: colorFor(sub || name), p: p.BORDERPRECISION >= 2 ? 1 : 0, s: sub || '' },
      geometry: f.geometry,
    });
    const [lx, ly] = polylabel(best, 0.05);
    // Names like "?" in the source data get no label.
    if (/\p{L}/u.test(name)) {
      const sharp = p.BORDERPRECISION >= 2 ? 1 : 0, color = colorFor(sub || name);
      labels.push([r2(lx), r2(ly), Math.round(total), name, sharp, color]);
      // A 7th field of 1 marks an extra label — the side panel skips it.
      if (bestA > 2500000) for (const [ex, ey, ea] of extraLabels(best, [lx, ly])) labels.push([ex, ey, ea, name, sharp, color, 1]);
    }
    const ent = entities[name] ??= { at: [] };
    // One point per snapshot: the largest part under this name in that year.
    const row = [year, r2(lx), r2(ly), Math.round(total), p.BORDERPRECISION >= 2 ? 1 : 0];
    const prev = ent.at.find(a => a[0] === year);
    if (!prev) ent.at.push(row);
    else if (total > prev[3]) Object.assign(prev, row);
  }
  labels.sort((a, b) => b[2] - a[2]);
  fs.writeFileSync(path.join(OUT, 'borders', `${year}.json`),
    JSON.stringify({ year, fc: { type: 'FeatureCollection', features: feats }, labels }));
  console.log(year, feats.length);
}

fs.writeFileSync(path.join(OUT, 'snapshots.json'), JSON.stringify(years));
fs.writeFileSync(path.join(OUT, 'entities.json'), JSON.stringify(entities));

// Base map: Natural Earth 1:50m.
const shp = n => path.join(NE, n, `${n}.shp`);
async function base(name, pct, fields) {
  const out = await ms.applyCommands(
    `-i ${shp(name)} -simplify ${pct} keep-shapes -filter-fields ${fields || 'scalerank'} -o out.json precision=0.01 format=geojson`);
  fs.writeFileSync(path.join(OUT, 'base', `${name.replace('ne_50m_', '')}.json`), out['out.json']);
}
await base('ne_50m_land', '60%');
await base('ne_50m_ocean', '60%');
// The ocean is one polygon for the whole world, and on the globe MapLibre triangulates it
// badly: at some zooms a band of ocean ran across South America. Cut into 30° cells, each
// piece is small enough to draw cleanly.
{
  const file = path.join(OUT, 'base', 'ocean.json');
  const src = fs.readFileSync(file, 'utf8');
  const features = [];
  for (let x = -180; x < 180; x += 30) {
    for (let y = -90; y < 90; y += 30) {
      const out = await ms.applyCommands(`-i in.json -clip bbox=${x},${y},${x + 30},${y + 30} -o out.json precision=0.01 format=geojson geojson-type=FeatureCollection`, { 'in.json': src });
      features.push(...JSON.parse(out['out.json']).features);
    }
  }
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }));
}
await base('ne_50m_lakes', '60%', 'name,scalerank');
await base('ne_50m_rivers_lake_centerlines', '60%', 'name,scalerank,featurecla');

console.log('done — run `npm run i18n` to rebuild the language packs');
