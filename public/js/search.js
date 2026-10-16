import { KINDS } from './map.js';
import { fmtYear, fmtRange } from './time.js';

const norm = s => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ё/g, 'е');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Едно общо търсене по всичко: събития, държави, култури, градове, пътища.
export function createSearch(input, list, data, onSelect) {
  const { events, wd, entities, cultures, cities, routes } = data;
  const index = [];
  const add = (label, extra, item) => index.push({ key: norm(label + (extra ? ' ' + extra : '')), label, ...item });

  for (const e of events) add(e.t, '', { kind: KINDS[e.k]?.[0], y: e.y, when: fmtYear(e.y), lon: e.lon, lat: e.lat, w: 3 + e.i, hit: { type: 'event', item: e } });
  for (const e of wd) add(e.t, e.en, { kind: KINDS[e.k]?.[0], y: e.y, when: fmtYear(e.y), lon: e.lon, lat: e.lat, w: 1, hit: { type: 'wd', item: e } });
  for (const [en, ent] of Object.entries(entities)) {
    // Към картата се отива в снимката, където е най-голяма.
    const best = ent.at.reduce((a, b) => (b[3] > a[3] ? b : a));
    const ys = ent.at.map(a => a[0]);
    add(ent.n, en !== ent.n ? en : '', { kind: 'Държава', y: best[0], when: fmtRange(Math.min(...ys), Math.max(...ys)), lon: best[1], lat: best[2], area: best[3], w: 2 + Math.min(3, Math.log10(best[3] + 1) / 2), hit: { type: 'polity', item: { n: ent.n, e: en, p: best[4] ?? 1, s: '' } } });
  }
  for (const c of cultures) add(c.n, '', { kind: 'Култура', y: Math.round((c.s + c.e) / 2), when: fmtRange(c.s, c.e), lon: c.lon, lat: c.lat, w: 4, hit: { type: 'culture', item: c } });
  for (const c of cities) {
    const names = [...new Set(c.n.map(n => n[1]))];
    names.forEach((n, i) => add(n, names.filter(x => x !== n).join(' '), { kind: 'Град', y: Math.max(c.s, c.n[i]?.[0] ?? c.s), when: fmtRange(c.s, c.e), lon: c.lon, lat: c.lat, w: 4 - c.r * 0.5, hit: { type: 'city', item: c } }));
  }
  for (const r of routes) {
    const s = r.k === 'trade' ? r.s : r.p[0][2], e = r.k === 'trade' ? r.e : r.p[r.p.length - 1][2];
    const mid = r.p[Math.floor(r.p.length / 2)];
    add(r.n, '', { kind: r.k === 'trade' ? 'Път' : 'Поход', y: r.k === 'trade' ? Math.round((s + e) / 2) : s, when: fmtRange(s, e), lon: mid[0], lat: mid[1], w: 4, hit: { type: 'route', item: r } });
  }

  let results = [], sel = -1;
  function run() {
    const q = norm(input.value.trim());
    if (q.length < 2) { list.hidden = true; results = []; return; }
    const words = q.split(/\s+/);
    results = index
      .map(it => {
        if (!words.every(w => it.key.includes(w))) return null;
        const label = norm(it.label);
        const score = (label === q ? 50 : label.startsWith(q) ? 20 : (' ' + it.key).includes(' ' + words[0]) ? 8 : 0) + it.w - label.length / 40;
        return [score, it];
      })
      .filter(Boolean)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 12)
      .map(r => r[1]);
    sel = results.length ? 0 : -1;
    list.innerHTML = results.length
      ? results.map((r, i) => `<li role="option" data-i="${i}" aria-selected="${i === sel}"><span class="k">${esc(r.kind || '')}</span><span class="t">${esc(r.label)}</span><span class="y">${esc(r.when)}</span></li>`).join('')
      : '<li class="empty">Нищо не намерих</li>';
    list.hidden = false;
  }
  function pick(i) {
    const r = results[i];
    if (!r) return;
    list.hidden = true;
    input.blur();
    onSelect(r);
  }
  function mark() { [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === sel))); list.children[sel]?.scrollIntoView({ block: 'nearest' }); }

  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) run(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(results.length - 1, sel + 1); mark(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); mark(); e.preventDefault(); }
    else if (e.key === 'Enter') pick(sel);
    else if (e.key === 'Escape') { list.hidden = true; input.blur(); }
  });
  list.addEventListener('pointerdown', e => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); pick(+li.dataset.i); }
  });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
}
