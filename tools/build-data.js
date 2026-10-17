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
// Neighbours whose hashes happen to give the same colour get one by hand.
const COLORS = { 'East Germany': '#d4884a' };
const colorFor = key => COLORS[key] ?? PALETTE[hash(key) % PALETTE.length];

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

// ——— Natural Earth countries: the maps from 1970 on ———
// The source has no map between 1960 and 1994 or after 2010, and its later maps miss states
// (Switzerland is a hole; Kosovo, East Timor, Palestine and the small island states are not there). Natural Earth (1:50m, v5.1.1)
// has every state of today; the maps of 1970–2010 are made from it by undoing what
// changed since (NE_RULES), so all maps from 1994 on share the same precise borders.
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
// Renamed states: earlier maps use the old names, [until, name] from the oldest.
const NE_BEFORE = {
  Eswatini: [[2018, 'Swaziland']], 'North Macedonia': [[2019, 'Macedonia']],
  'Democratic Republic of the Congo': [[1972, 'Democratic Republic of the Congo'], [1997, 'Zaire']],
  Myanmar: [[1989, 'Burma']], 'Sri Lanka': [[1972, 'Ceylon']], Benin: [[1975, 'Dahomey']], 'Burkina Faso': [[1984, 'Upper Volta']],
};
const neName = (admin, year) => {
  const n = NE_NAMES[admin] ?? admin;
  return NE_BEFORE[n]?.find(([until]) => year < until)?.[1] ?? n;
};
// What was one state before (by Natural Earth's codes). The first rule that holds wins.
const NE_RULES = [
  { codes: ['BGD'], until: 1972, into: 'PAK' },                      // East Pakistan until 1971
  { codes: ['ARE'], until: 1972, name: 'Trucial States', sub: 'United Kingdom' }, // the UAE from December 1971
  { codes: ['SAH'], until: 1976, name: 'Spanish Sahara', sub: 'Spain' },
  { codes: ['TLS'], until: 1975, name: 'Portuguese Timor', sub: 'Portugal' },
  { codes: ['ZWE'], until: 1980, name: 'Rhodesia' },                 // Zimbabwe from April 1980
  { codes: ['VUT'], until: 1980, name: 'New Hebrides', sub: 'United Kingdom' }, // a British–French condominium
  { codes: ['BLZ'], until: 1973, name: 'British Honduras', sub: 'United Kingdom' },
  { codes: ['NAM'], until: 1990, name: 'South West Africa', sub: 'South Africa' }, // Namibia, independent 1990
  { codes: ['ABW', 'CUW', 'SXM'], until: 1986, name: 'Netherlands Antilles', sub: 'Netherlands' }, // Aruba left in 1986
  { codes: ['RUS', 'UKR', 'BLR', 'MDA', 'EST', 'LVA', 'LTU', 'GEO', 'ARM', 'AZE', 'KAZ', 'UZB', 'TKM', 'KGZ', 'TJK'],
    until: 1992, name: 'USSR' },                                     // dissolved in December 1991
  { codes: ['SVN', 'HRV', 'BIH', 'MKD', 'SRB', 'MNE', 'KOS'], until: 1992, name: 'Yugoslavia' }, // broke up in 1991–92
  { codes: ['CZE', 'SVK'], until: 1993, name: 'Czechoslovakia' },   // split on 1 January 1993
  { codes: ['ERI'], until: 1993, into: 'ETH' },                      // Eritrea, independent 1993
  { codes: ['SOL'], until: 1992, into: 'SOM' },                      // Somaliland declared itself in May 1991
  { codes: ['SDS'], until: 2011, into: 'SDN' },                      // South Sudan, independent 2011
  { codes: ['SRB', 'MNE', 'KOS'], until: 2006, name: 'Yugoslavia' }, // Serbia and Montenegro split in 2006
  { codes: ['KOS'], until: 2008, into: 'SRB' },                      // Kosovo declared independence in 2008
  { codes: ['TLS'], until: 1999, into: 'IDN' },                      // East Timor, under Indonesia until 1999
  { codes: ['CUW', 'SXM'], until: 2011, name: 'Netherlands Antilles', sub: 'Netherlands' }, // dissolved in October 2010
];
// Territories that belonged elsewhere.
const SUB_UNTIL = {
  HKG: ['United Kingdom', 1997], MAC: ['Portugal', 1999],
  PSX: ['Israel', 1994],         // occupied until the Palestinian Authority, 1994
  PLW: ['United States', 1995],  // a US-administered trust territory until October 1994
  FSM: ['United States', 1987], MHL: ['United States', 1987], // the same until 1986
  // Colonies that became independent between 1970 and 1985.
  AGO: ['Portugal', 1975], MOZ: ['Portugal', 1975], GNB: ['Portugal', 1974], CPV: ['Portugal', 1975], STP: ['Portugal', 1975],
  SUR: ['Netherlands', 1975], PNG: ['Australia', 1975], COM: ['France', 1975], DJI: ['France', 1977],
  BHR: ['United Kingdom', 1971], QAT: ['United Kingdom', 1971], FJI: ['United Kingdom', 1971], TON: ['United Kingdom', 1971],
  BHS: ['United Kingdom', 1973], GRD: ['United Kingdom', 1974], SYC: ['United Kingdom', 1976], SLB: ['United Kingdom', 1978],
  TUV: ['United Kingdom', 1978], DMA: ['United Kingdom', 1978], LCA: ['United Kingdom', 1979], KIR: ['United Kingdom', 1979],
  VCT: ['United Kingdom', 1979], BLZ: ['United Kingdom', 1981], ATG: ['United Kingdom', 1981], KNA: ['United Kingdom', 1983],
  BRN: ['United Kingdom', 1984],
};

// Borders Natural Earth no longer has, drawn by hand along their known course (to a few km).
// Each polygon is the eastern or southern state; it reaches past the outer borders, which the
// country's own shape cuts off.
// East Germany, with West Berlin as a hole: the inner German border from the Baltic at
// Priwall down the Elbe and over the Harz, the Eichsfeld and the Rhön to the Czech border.
const EAST_GERMANY = [[
  [10.95, 54.2], [10.9, 53.96], [10.8, 53.88], [10.79, 53.7], [10.91, 53.58], [10.77, 53.45], [10.6, 53.38],
  [10.8, 53.3], [11.05, 53.18], [11.25, 53.14], [11.57, 53.04], [11.45, 52.95], [11.05, 52.85], [11.05, 52.73],
  [10.93, 52.6], [10.95, 52.45], [11.05, 52.33], [11.05, 52.2], [10.95, 52.05], [10.62, 51.88], [10.68, 51.72],
  [10.62, 51.58], [10.45, 51.55], [10.3, 51.47], [10.05, 51.35], [10.05, 51.25], [10.2, 51.0], [10.0, 50.84],
  [10.05, 50.65], [10.1, 50.55], [10.4, 50.45], [11.0, 50.35], [11.15, 50.3], [11.4, 50.5], [11.6, 50.42],
  [11.88, 50.42], [12.02, 50.37], [12.14, 50.32], [12.3, 50.25], [13.5, 50.2], [15.5, 50.9], [15.5, 54.8],
  [10.95, 54.8], [10.95, 54.2],
], [
  [13.11, 52.5], [13.12, 52.58], [13.22, 52.63], [13.3, 52.66], [13.37, 52.6], [13.4, 52.56], [13.38, 52.53],
  [13.45, 52.49], [13.43, 52.42], [13.37, 52.39], [13.25, 52.38], [13.13, 52.4], [13.11, 52.5],
]];
// South Vietnam: south of the demilitarised zone on the 17th parallel (the Bến Hải river).
const SOUTH_VIETNAM = [[[100, 17.0], [106.6, 17.0], [107.12, 17.08], [115, 17.1], [115, 5], [100, 5], [100, 17.0]]];
// Sinai, held by Israel from 1967 to 1982: east of the Suez Canal and the Gulf of Suez.
const SINAI = [[[32.3, 31.45], [32.33, 31.25], [32.35, 30.6], [32.55, 29.97], [33.5, 28.0], [34.25, 27.7], [35.0, 29.5], [34.9, 31.6], [32.3, 31.45]]];
// South Yemen: from the coast east of Bab el-Mandeb, between Ta'izz and Lahij, Qa'tabah and
// Dhale, al-Bayda and Mukayras, Harib and Bayhan, then into the desert; Socotra is inside.
const SOUTH_YEMEN = [[
  [43.55, 12.62], [44.15, 13.25], [44.75, 13.78], [45.55, 14.05], [45.7, 14.95], [46.4, 15.45], [47.2, 16.3],
  [48.0, 17.5], [50.0, 19.0], [55.0, 19.0], [55.0, 11.5], [44.0, 11.5], [43.55, 12.62],
]];
// Splits one country by a polygon into two states.
async function split(features, code, poly, inside, outside) {
  const f = features.find(x => x.properties.ADM0_A3 === code);
  const fc = list => JSON.stringify({ type: 'FeatureCollection', features: list });
  const files = { 'f.json': fc([f]), 'p.json': fc([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: poly } }]) };
  const cut = async op => JSON.parse((await ms.applyCommands(
    `-i f.json name=f -i p.json name=p -${op} p target=f -o out.json precision=0.01 format=geojson geojson-type=FeatureCollection`, files))['out.json']).features;
  const state = (pieces, [ADMIN, ADM0_A3, SOVEREIGNT = ADMIN]) => pieces.map(x => ({ ...x, properties: { ADMIN, SOVEREIGNT, TYPE: 'Sovereign country', ADM0_A3 } }));
  return [...features.filter(x => x !== f), ...state(await cut('clip'), inside), ...state(await cut('erase'), outside)];
}
async function neYear(year) {
  let base = neMap.features;
  if (year < 1991) base = await split(base, 'DEU', EAST_GERMANY, ['East Germany', 'DDR'], ['West Germany', 'BRD']); // reunited October 1990
  if (year < 1990) base = await split(base, 'YEM', SOUTH_YEMEN, ['South Yemen', 'YDR'], ['North Yemen', 'YAR']);     // united May 1990
  if (year < 1976) base = await split(base, 'VNM', SOUTH_VIETNAM, ['South Vietnam', 'SVN_'], ['North Vietnam', 'NVN']); // united July 1976
  if (year < 1982) base = await split(base, 'EGY', SINAI, ['Sinai', 'SIN', 'Israel'], ['Egypt', 'EGY']);              // returned April 1982
  const byCode = Object.fromEntries(base.map(f => [f.properties.ADM0_A3, f]));
  const features = base.map(f => {
    const { ADMIN, SOVEREIGNT, TYPE, ADM0_A3: code } = f.properties;
    let G = code, NAME = neName(ADMIN, year);
    let SUBJECTO = SOVEREIGNT !== ADMIN && TYPE !== 'Indeterminate' ? neName(SOVEREIGNT, year) : '';
    const rule = NE_RULES.find(r => r.codes.includes(code) && year < r.until);
    if (rule?.into) { G = rule.into; NAME = neName(byCode[rule.into].properties.ADMIN, year); SUBJECTO = ''; }
    else if (rule) { G = rule.name; NAME = rule.name; SUBJECTO = rule.sub ?? ''; }
    if (SUB_UNTIL[code] && year < SUB_UNTIL[code][1]) SUBJECTO = SUB_UNTIL[code][0];
    // In the shape of the source's features: every border is a precise one.
    return { type: 'Feature', properties: { G, NAME, SUBJECTO, BORDERPRECISION: 3 }, geometry: f.geometry };
  });
  const out = await ms.applyCommands('-i in.json -dissolve G copy-fields=NAME,SUBJECTO,BORDERPRECISION -o out.json precision=0.01 format=geojson',
    { 'in.json': JSON.stringify({ type: 'FeatureCollection', features }) });
  return JSON.parse(out['out.json']);
}

const NE_YEARS = [1970, 1985, 1991, 1993, 1994, 2000, 2010, 2011, 2019];
const years = [...index.map(y => y.year).filter(y => !NE_YEARS.includes(y)), ...NE_YEARS];
for (const year of years) {
  const hb = index.find(y => y.year === year);
  const fc = NE_YEARS.includes(year) ? await neYear(year) : await simplify(path.join(HB, hb.filename), '35%');
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
