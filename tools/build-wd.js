// .cache/wikidata.json → public/data/wd-events.json
// Компактни редове: [y, lon, lat, вид, езици, заглавие, en, bg уики, en уики, id].
// Без събитията, които вече са подбрани на ръка (същият вид, ±1 година, до 150 км).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, '.cache/wikidata.json'), 'utf8'));
const CONTENT = path.join(ROOT, 'public/data/content');
const curated = fs.readdirSync(CONTENT).filter(f => f.startsWith('events-')).flatMap(f => JSON.parse(fs.readFileSync(path.join(CONTENT, f), 'utf8')));

const km = (a, b) => {
  const R = 6371, r = Math.PI / 180;
  const dlat = (b.lat - a.lat) * r, dlon = (b.lon - a.lon) * r;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const group = k => (k === 'battle' || k === 'siege' || k === 'war' ? 'fight' : k === 'quake' || k === 'eruption' || k === 'disaster' ? 'nature' : k);
// Етикетът на Wikidata понякога е само id или съдържа година в скоби — махаме я, датата е отделно.
const clean = s => s?.replace(/\s*\((\d{1,4}\s*(г\.|BC|AD)?[^)]*)\)\s*$/u, '').trim();

// Преводи на английските заглавия без български етикет; празен превод изключва събитието.
const WD_BG_FILE = path.join(ROOT, 'tools/wd-bg.json');
const WD_BG = fs.existsSync(WD_BG_FILE) ? JSON.parse(fs.readFileSync(WD_BG_FILE, 'utf8')) : {};
let dup = 0, noTitle = 0;
const rows = [], untranslated = [];
for (const e of raw) {
  if (e.y < -3500 || e.y > 2025) continue;
  if (Math.abs(e.lat) > 85) continue;
  const title = clean(e.bg) || (e.links >= 20 ? WD_BG[clean(e.en)] ?? clean(e.en) : null);
  if (!title || /^Q\d+$/.test(title)) { noTitle++; continue; }
  // Същото място и година е същото събитие, дори видът да е записан другояче („Fall of Nineveh“).
  if (curated.some(c => Math.abs(c.y - e.y) <= 1 && (km(c, e) < 60 || (group(c.k) === group(e.kind) && km(c, e) < 150)))) { dup++; continue; }
  if (!/[а-я]/i.test(title)) untranslated.push(title);
  rows.push([e.y, +e.lon.toFixed(2), +e.lat.toFixed(2), e.kind, e.links, title, e.bg ? clean(e.en) || '' : '', e.bgwiki || '', e.enwiki || '', e.id]);
}
rows.sort((a, b) => a[0] - b[0]);
fs.writeFileSync(path.join(ROOT, 'public/data/wd-events.json'), JSON.stringify(rows));
const bg = rows.filter(r => r[6] !== '' || /[а-я]/i.test(r[5])).length;
fs.writeFileSync(path.join(ROOT, '.cache/wd-untranslated.txt'), [...new Set(untranslated)].join('\n'));
console.log(`събития: ${rows.length} (на български ${bg}), дубликати с подбраните: ${dup}, без заглавие: ${noTitle}`);
