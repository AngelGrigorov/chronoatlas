// .cache/wikidata.json → public/data/wd-events.json + tools/i18n/<lang>/wd.json
// Data rows are language-neutral: [year, lon, lat, kind, sitelinks, qid].
// Titles and Wikipedia articles go to the dictionaries: { qid: [title, wikiTitle] }.
// Events already curated by hand (same place and year) are dropped.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const raw = read('.cache/wikidata.json');
const curated = read('public/data/content/events.json');
// Hand translations of English titles that have no Bulgarian label; '' drops the event.
const BG_TITLES = read('tools/i18n/bg/wd-titles.json');

const km = (a, b) => {
  const R = 6371, r = Math.PI / 180;
  const dlat = (b.lat - a.lat) * r, dlon = (b.lon - a.lon) * r;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const group = k => (k === 'battle' || k === 'siege' || k === 'war' ? 'fight' : k === 'quake' || k === 'eruption' || k === 'disaster' ? 'nature' : k);
// Labels sometimes carry the year in brackets; the date is shown separately.
const clean = s => s?.replace(/\s*\((\d{1,4}\s*(г\.|BC|AD)?[^)]*)\)\s*$/u, '').trim();
// Many titles also start with the year ("2026 Mindanao earthquake"); the card shows it anyway.
const dropYear = (s, y) => {
  const m = s.match(/^(\d{3,4}) (.+)$/u);
  return m && +m[1] === y ? m[2][0].toLocaleUpperCase() + m[2].slice(1) : s;
};

let dup = 0, skipped = 0;
const rows = [], en = {}, bg = {}, untranslated = [];
for (const e of raw) {
  if (e.y < -3500 || e.y > new Date().getFullYear() || Math.abs(e.lat) > 85) continue;
  const enTitle = clean(e.en);
  // Same selection as before: a Bulgarian label, or a well-known event (20+ languages).
  if (!enTitle || /^Q\d+$/.test(enTitle) || !(e.bg || e.links >= 20)) { skipped++; continue; }
  const bgTitle = clean(e.bg) || BG_TITLES[enTitle];
  if (bgTitle === '') { skipped++; continue; }
  // The same place and year is the same event, even if Wikidata files it under another kind.
  if (curated.some(c => Math.abs(c.y - e.y) <= 1 && (km(c, e) < 60 || (group(c.k) === group(e.kind) && km(c, e) < 150)))) { dup++; continue; }
  if (!bgTitle) untranslated.push(enTitle);
  rows.push([e.y, +e.lon.toFixed(2), +e.lat.toFixed(2), e.kind, e.links, e.id]);
  en[e.id] = [dropYear(enTitle, e.y), e.enwiki || ''];
  bg[e.id] = [dropYear(bgTitle || enTitle, e.y), e.bgwiki || ''];
}
rows.sort((a, b) => a[0] - b[0]);
fs.writeFileSync(path.join(ROOT, 'public/data/wd-events.json'), JSON.stringify(rows));
fs.writeFileSync(path.join(ROOT, 'tools/i18n/en/wd.json'), JSON.stringify(en));
fs.writeFileSync(path.join(ROOT, 'tools/i18n/bg/wd.json'), JSON.stringify(bg));
fs.writeFileSync(path.join(ROOT, '.cache/wd-untranslated.txt'), [...new Set(untranslated)].join('\n'));
console.log(`events: ${rows.length}, duplicates of curated: ${dup}, skipped: ${skipped}, without Bulgarian title: ${untranslated.length}`);
