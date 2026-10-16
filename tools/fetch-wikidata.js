// Fetches events with a place and a date from Wikidata into .cache/wikidata.json.
// node tools/fetch-wikidata.js
// Two steps, because one big query hits the WDQS timeout:
// first the ids per class, then the details in batches.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const UA = 'chronoatlas/0.1 (personal, non-commercial)';

// Event kind → Wikidata classes and a minimum number of sitelinks (a measure of notability).
const KINDS = {
  battle: { classes: ['Q178561', 'Q1261499', 'Q2001676', 'Q1072326'], min: 6 },
  siege: { classes: ['Q188055'], min: 6 },
  treaty: { classes: ['Q131569', 'Q625298'], min: 8 },
  eruption: { classes: ['Q7692360'], min: 8 },
  quake: { classes: ['Q7944', 'Q1520311'], min: 12 },
};

async function sparql(q) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://query.wikidata.org/sparql', {
      method: 'POST',
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'query=' + encodeURIComponent(q),
      signal: AbortSignal.timeout(90000),
    }).catch(err => ({ ok: false, status: err.name }));
    if (res.ok) return (await res.json()).results.bindings;
    console.warn('WDQS', res.status, 'try', attempt + 1);
    await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
  }
  return null;
}
const qid = uri => uri.split('/').pop();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const kindOf = {};
for (const [kind, { classes, min }] of Object.entries(KINDS)) {
  for (const cls of classes) {
    const rows = await sparql(`SELECT ?item WHERE { ?item wdt:P31 wd:${cls} ; wikibase:sitelinks ?l . FILTER(?l >= ${min}) }`) || [];
    for (const r of rows) kindOf[qid(r.item.value)] ??= kind;
    console.log(kind, cls, rows.length);
    await sleep(1000);
  }
}

// Progress is saved, so an interrupted run can resume.
const PARTIAL = path.join(ROOT, '.cache/wikidata.partial.json');
const ids = Object.keys(kindOf);
const out = fs.existsSync(PARTIAL) ? JSON.parse(fs.readFileSync(PARTIAL, 'utf8')) : {};
const done = new Set(out.__done || []);
delete out.__done;
for (let i = 0; i < ids.length; i += 200) {
  if (done.has(i)) continue;
  const batch = ids.slice(i, i + 200);
  const rows = await sparql(`SELECT ?item ?en ?bg ?date ?coord ?lcoord ?links ?bgwiki ?enwiki WHERE {
  VALUES ?item { ${batch.map(id => 'wd:' + id).join(' ')} }
  ?item wikibase:sitelinks ?links .
  OPTIONAL { ?item wdt:P585 ?d1 } OPTIONAL { ?item wdt:P580 ?d2 }
  BIND(COALESCE(?d1, ?d2) AS ?date)
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item wdt:P276 ?loc . ?loc wdt:P625 ?lcoord }
  OPTIONAL { ?item rdfs:label ?bg FILTER(lang(?bg) = "bg") }
  OPTIONAL { ?item rdfs:label ?en FILTER(lang(?en) = "en") }
  OPTIONAL { ?bgwiki schema:about ?item ; schema:isPartOf <https://bg.wikipedia.org/> }
  OPTIONAL { ?enwiki schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
}`);
  if (!rows) { console.warn('skipped batch', i); continue; }
  for (const r of rows) {
    const id = qid(r.item.value);
    const m = r.date && /^(-?\d+)-/.exec(r.date.value);
    const cv = r.coord?.value || r.lcoord?.value;
    const c = cv && /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(cv);
    if (!m || !c) continue;
    // WDQS returns astronomical years (0 = 1 BC); this project uses historical years.
    let y = +m[1];
    if (y <= 0) y -= 1;
    const prev = out[id];
    if (prev && prev.y <= y) continue;
    out[id] = {
      id, kind: kindOf[id], y, lon: +c[1], lat: +c[2], links: +r.links.value,
      bg: r.bg?.value, en: r.en?.value,
      bgwiki: r.bgwiki && decodeURIComponent(r.bgwiki.value.split('/wiki/')[1]),
      enwiki: r.enwiki && decodeURIComponent(r.enwiki.value.split('/wiki/')[1]),
    };
  }
  done.add(i);
  fs.writeFileSync(PARTIAL, JSON.stringify({ ...out, __done: [...done] }));
  process.stdout.write(`${Math.min(i + 200, ids.length)}/${ids.length}\r`);
  await sleep(700);
}
const list = Object.values(out);
fs.writeFileSync(path.join(ROOT, '.cache/wikidata.json'), JSON.stringify(list));
console.log('\ntotal', list.length, 'with a Bulgarian label', list.filter(e => e.bg).length);
