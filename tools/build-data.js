// Сглобява public/data от суровите набори в .cache:
//   borders/<year>.json  — опростени граници + точки за етикети
//   entities.json        — всяко име: български превод, години, къде е било
//   base/*.json          — суша, океан, реки, езера (Natural Earth)
// Пуска се с `npm run data`. Изтеглянето е описано в README.
import fs from 'node:fs';
import path from 'node:path';
import ms from 'mapshaper';
import polylabel from 'polylabel';

const ROOT = path.resolve(import.meta.dirname, '..');
const HB = path.join(ROOT, '.cache/hb');
const NE = path.join(ROOT, '.cache/ne');
const OUT = path.join(ROOT, 'public/data');
// Преводите са на партиди в tools/names-bg/*.json; по-късен файл печели.
const NB_DIR = path.join(ROOT, 'tools/names-bg');
const nkey = s => s.normalize('NFC').trim();
const NAMES_BG = {};
for (const f of fs.readdirSync(NB_DIR).filter(f => f.endsWith('.json')).sort()) {
  for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(NB_DIR, f), 'utf8')))) NAMES_BG[nkey(k)] = v;
}
const bgName = n => NAMES_BG[nkey(n)];

fs.mkdirSync(path.join(OUT, 'borders'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'base'), { recursive: true });

// Приглушени цветове, които стоят добре върху релефа. Индексът е по хеш на името,
// за да е Рим един и същ цвят във всяка снимка.
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

// Площ в km² по сферичния ексцес — достатъчно точно, за да се подредят етикетите.
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

// Sutherland–Hodgman: пръстенът, отрязан до правоъгълник.
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

// Огромна държава (Русия, Монголската империя) има етикет и в другите си краища,
// иначе при приближение в Европа етикетът ѝ е някъде в Сибир.
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
const missing = new Map();
const entities = {};
const index = JSON.parse(fs.readFileSync(path.join(HB, 'index.json'), 'utf8')).years;

for (const { year, filename } of index) {
  const fc = await simplify(path.join(HB, filename), '35%');
  const feats = [], labels = [];
  for (const f of fc.features) {
    const p = f.properties;
    if (!p.NAME?.trim() || !f.geometry) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let best = null, bestA = -1, total = 0;
    for (const poly of polys) {
      const a = polyArea(poly);
      total += a;
      if (a > bestA) { bestA = a; best = poly; }
    }
    if (!best) continue;
    const bg = bgName(p.NAME);
    if (bg == null) missing.set(p.NAME, (missing.get(p.NAME) || 0) + total);
    const name = bg || p.NAME;
    const sub = p.SUBJECTO && p.SUBJECTO !== p.NAME ? p.SUBJECTO : null;
    const id = feats.length;
    feats.push({
      type: 'Feature', id,
      properties: { n: name, e: p.NAME, c: colorFor(sub || p.NAME), p: p.BORDERPRECISION >= 2 ? 1 : 0, s: sub ? (bgName(sub) || sub) : '' },
      geometry: f.geometry,
    });
    const [lx, ly] = polylabel(best, 0.05);
    // Празен превод значи „без етикет“ — за имена като „?“ в данните.
    if (bg !== '') {
      const sharp = p.BORDERPRECISION >= 2 ? 1 : 0, color = colorFor(sub || p.NAME);
      labels.push([r2(lx), r2(ly), Math.round(total), name, sharp, color]);
      // Седмото поле 1 значи „допълнителен етикет“ — панелът го прескача.
      if (bestA > 2500000) for (const [ex, ey, ea] of extraLabels(best, [lx, ly])) labels.push([ex, ey, ea, name, sharp, color, 1]);
    }
    const ent = entities[p.NAME] ??= { n: name, at: [] };
    // Една точка на снимка: най-голямата част на името през тази година.
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

fs.writeFileSync(path.join(OUT, 'snapshots.json'), JSON.stringify(index.map(y => y.year)));
fs.writeFileSync(path.join(OUT, 'entities.json'), JSON.stringify(entities));

// Основа: Natural Earth 1:50m.
const shp = n => path.join(NE, n, `${n}.shp`);
async function base(name, pct, fields) {
  const out = await ms.applyCommands(
    `-i ${shp(name)} -simplify ${pct} keep-shapes -filter-fields ${fields || 'scalerank'} -o out.json precision=0.01 format=geojson`);
  fs.writeFileSync(path.join(OUT, 'base', `${name.replace('ne_50m_', '')}.json`), out['out.json']);
}
await base('ne_50m_land', '60%');
await base('ne_50m_ocean', '60%');
await base('ne_50m_lakes', '60%', 'name,scalerank');
await base('ne_50m_rivers_lake_centerlines', '60%', 'name,scalerank,featurecla');

const miss = [...missing].sort((a, b) => b[1] - a[1]);
fs.writeFileSync(path.join(ROOT, '.cache/missing-names.txt'), miss.map(([n, a]) => `${n}\t${a}`).join('\n'));
console.log(`без превод: ${miss.length} имена (списъкът е в .cache/missing-names.txt)`);
