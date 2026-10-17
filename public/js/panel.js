import { KINDS, KIND_GROUPS, kindLabel, eventAlpha, spanAlpha, cityName } from './map.js';
import { REGIONS, regionOf, fmtYear, fmtRange, yearsBetween } from './time.js';
import { t, lang } from './i18n.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ——— "Around the world": what exists in the chosen year ———
export function createPanel(root, toggle, { data, onFocus, kinds: kindsEl, onKinds, onOpen }) {
  const { events, wd, cultures, people } = data;
  const side = root.closest('#side');
  let last = '';
  let items = [];
  let pref = null;
  try { pref = localStorage.getItem('side'); } catch {}
  // On a phone the panel covers half the map, so it starts closed.
  if (pref === 'closed' || (!pref && window.innerWidth < 760)) side.classList.add('closed');
  toggle.setAttribute('aria-expanded', String(!side.classList.contains('closed')));
  toggle.addEventListener('click', () => {
    const closed = side.classList.toggle('closed');
    // A closed panel is not updated, so redraw it as soon as it opens.
    if (!closed) { last = ''; onOpen?.(); }
    toggle.setAttribute('aria-expanded', String(!closed));
    try { localStorage.setItem('side', closed ? 'closed' : 'open'); } catch {}
  });
  root.addEventListener('click', e => {
    const li = e.target.closest('li[data-i]');
    if (li) onFocus(items[+li.dataset.i]);
  });
  // The list works from the keyboard too: Tab to an item, Enter or Space to show it.
  root.addEventListener('keydown', e => {
    const li = e.target.closest('li[data-i]');
    if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onFocus(items[+li.dataset.i]); }
  });

  // Event kind filter — buttons above the list; all on means no filter.
  const ALL = Object.keys(KIND_GROUPS);
  let groups = ALL;
  try {
    const g = JSON.parse(localStorage.getItem('kinds'));
    if (Array.isArray(g) && g.some(k => KIND_GROUPS[k])) groups = g.filter(k => KIND_GROUPS[k]);
  } catch {}
  const kinds = () => (groups.length === ALL.length ? null : groups.flatMap(g => KIND_GROUPS[g]));
  const kindOk = k => { const ks = kinds(); return !ks || ks.includes(k); };
  function renderKinds() {
    kindsEl.innerHTML = Object.entries(KIND_GROUPS).map(([g, ks]) =>
      `<button data-g="${g}" aria-pressed="${groups.includes(g)}" style="--dot:${KINDS[ks[0]]}"><i></i>${esc(t('group.' + g))}</button>`).join('');
  }
  kindsEl.addEventListener('click', e => {
    const b = e.target.closest('button[data-g]');
    if (!b) return;
    const g = b.dataset.g;
    // Clicking the only one left switches all back on; otherwise it toggles.
    groups = groups.includes(g) ? (groups.length === 1 ? ALL : groups.filter(x => x !== g)) : [...groups, g];
    try { localStorage.setItem('kinds', JSON.stringify(groups)); } catch {}
    renderKinds();
    last = '';
    onKinds(kinds());
  });
  renderKinds();

  function update(year, win, labels, snap) {
    if (side.classList.contains('closed')) return;
    const key = `${Math.round(year)}|${Math.round(win)}|${snap}`;
    if (key === last) return;
    last = key;
    items = [];
    const by = Object.fromEntries(REGIONS.map(k => [k, { states: [], other: [], events: [] }]));

    // A huge state has extra labels in its other parts (Russia in Europe and in Siberia):
    // it is listed in every region it has a label in, ranked by its whole area.
    // A name can have several parts (the Ottoman Empire also on the Eritrean coast): the largest counts.
    const whole = new Map();
    for (const l of labels) if (!l[6] && l[2] > (whole.get(l[3]) ?? 0)) whole.set(l[3], l[2]);
    // …and is a state if any of its parts has a precise border.
    const precise = new Set(labels.filter(l => l[4]).map(l => l[3]));
    for (const [lon, lat, area, name, , color] of labels) {
      const r = by[regionOf(lon, lat)];
      const list = precise.has(name) ? r.states : r.other;
      if (!list.some(x => x.name === name)) list.push({ type: 'label', name, lon, lat, area: whole.get(name) ?? area, color });
    }
    for (const c of cultures) {
      const a = spanAlpha(c.s, c.e, Math.max(40, (c.e - c.s) * 0.15), year);
      if (a > 0.2) by[regionOf(c.lon, c.lat)].other.unshift({ type: 'culture', item: c, name: c.n, lon: c.lon, lat: c.lat, area: Infinity });
    }
    for (const [type, list] of [['event', events], ['wd', wd]]) {
      for (const e of list) {
        const a = eventAlpha(e.y, year, win, e.ye);
        if (a > 0 && kindOk(e.k)) by[regionOf(e.lon, e.lat)].events.push({ type, item: e, a });
      }
    }

    let html = `<h2>${esc(t('side.title', { year: fmtYear(year) }))}</h2><div class="sub">${esc(t(win ? 'side.sub' : 'side.subExact', { n: Math.round(win), year: fmtYear(year) }))}</div>`;
    const push = it => { items.push(it); return items.length - 1; };

    // Who is alive this year — the best known first, then those in their prime.
    const ranked = people
      .filter(p => year >= p.b + 15 && year <= p.d)
      .sort((a, b) => b.i - a.i || Math.abs(year - (a.b + 40)) - Math.abs(year - (b.b + 40)));
    // The whole world, not six Europeans: at most two per region, then the rest by rank.
    const perRegion = {}, alive = [];
    for (const p of ranked) {
      const r = regionOf(p.lon, p.lat);
      if (alive.length < 6 && (perRegion[r] = (perRegion[r] || 0) + 1) <= 2) alive.push(p);
    }
    for (const p of ranked) if (alive.length < 6 && !alive.includes(p)) alive.push(p);
    if (alive.length) {
      html += `<section><h3>${esc(t('side.alive'))}</h3><ul>`;
      for (const p of alive) {
        html += `<li class="person" tabindex="0" role="button" data-i="${push({ type: 'person', item: p, lon: p.lon, lat: p.lat })}"><span class="sw pe"></span><span class="t">${esc(p.n)}<small>${esc(p.t)}</small></span><span class="y">${esc(t('side.age', { n: yearsBetween(p.b, Math.round(year)) }))}</span></li>`;
      }
      html += '</ul></section>';
    }
    for (const k of REGIONS) {
      const r = by[k];
      const states = r.states.sort((a, b) => b.area - a.area).slice(0, 4);
      const evs = r.events.sort((a, b) => (b.item.i || 0) - (a.item.i || 0) || (b.item.l || 0) - (a.item.l || 0) || b.a - a.a).slice(0, 8);
      // An event, a culture and a state of the same name ("Great Zimbabwe", "Elam") are listed once.
      const named = new Set([...states.map(s => s.name), ...evs.map(e => e.item.t)]);
      const other = r.other.sort((a, b) => b.area - a.area).filter(o => !named.has(o.name) && named.add(o.name)).slice(0, states.length ? 2 : 4);
      if (!states.length && !other.length && !evs.length) continue;
      html += `<section><h3>${esc(t('region.' + k))}</h3><ul>`;
      for (const it of evs) {
        const e = it.item;
        html += `<li class="ev" tabindex="0" role="button" data-i="${push(it)}"><span class="sw ev" style="background:${KINDS[e.k]}"></span><span class="t">${esc(e.t)}</span><span class="y">${esc(fmtYear(e.y, true))}</span></li>`;
      }
      for (const it of [...states, ...other]) {
        const color = it.type === 'culture' ? '#f0c674' : it.color || 'rgba(236,226,205,0.4)';
        html += `<li tabindex="0" role="button" data-i="${push(it)}"><span class="sw" style="background:${color}"></span><span class="t">${esc(it.name)}</span></li>`;
      }
      html += '</ul></section>';
    }
    root.innerHTML = html;
  }
  return { update, refresh() { last = ''; }, kinds };
}

// ——— The detail card ———
const card = document.getElementById('card');
let cardToken = 0;
// What the open card shows, as "type:id" — it goes into the address so a link opens it again.
export let cardKey = null;
const setKey = k => { cardKey = k; card.dispatchEvent(new Event('cardchange')); };

export function hideCard() {
  card.hidden = true;
  cardToken++;
  setKey(null);
}

export function showCard(hit, { entities, onGo }) {
  const token = ++cardToken;
  setKey(`${hit.type}:${hit.type === 'polity' ? hit.item.e : hit.item.id}`);
  let kind = '', title = '', when = '', desc = '', extra = '', wiki = null, go = null;
  const it = hit.item;
  switch (hit.type) {
    case 'event':
      kind = kindLabel(it.k);
      title = it.t; when = it.ye ? fmtRange(it.y, it.ye) : fmtYear(it.y); desc = it.d;
      wiki = { title: it.w, en: it.we };
      go = it;
      break;
    case 'wd':
      kind = `${kindLabel(it.k)} · ${t('card.wikidata')}`;
      title = it.t; when = fmtYear(it.y);
      wiki = { title: it.w, en: it.we };
      go = it;
      break;
    case 'city': {
      kind = t('card.city');
      title = cityName(it, hit.year);
      when = fmtRange(it.s, it.e);
      const names = it.n.map(([, n]) => n);
      if (names.length > 1) extra = `<p class="wiki">${esc(t('card.cityNames', { names: names.join(' → ') }))}</p>`;
      wiki = { title: it.w || names[names.length - 1], en: it.we };
      go = { y: hit.year, lon: it.lon, lat: it.lat };
      break;
    }
    case 'person':
      kind = it.t;
      title = it.n;
      when = t('card.lifespan', { range: fmtRange(it.b, it.d), n: yearsBetween(it.b, it.d) });
      wiki = { title: it.w, en: it.we };
      go = { y: Math.round(it.b + Math.min(40, (it.d - it.b) * 0.6)), lon: it.lon, lat: it.lat };
      break;
    case 'culture':
      kind = t('card.culture');
      title = it.n; when = fmtRange(it.s, it.e); desc = it.d;
      wiki = { title: it.w, en: it.we };
      go = { y: hit.year, lon: it.lon, lat: it.lat };
      break;
    case 'route':
      kind = t('route.' + it.k);
      title = it.n;
      when = it.k === 'trade' ? fmtRange(it.s, it.e) : fmtRange(it.p[0][2], it.p[it.p.length - 1][2]);
      desc = it.d;
      wiki = { title: it.w, en: it.we };
      break;
    case 'polity': {
      const p = it, ent = entities[p.e];
      // Border precision says nothing about what the polity is: an empire drawn with a
      // fuzzy border in one snapshot is still an empire. "People" only if never precise.
      kind = p.p || ent?.at.some(a => a[4]) ? t('card.state') : t('card.people');
      title = p.n;
      if (ent) {
        const ys = ent.at.map(a => a[0]);
        when = t('card.inMaps', { range: fmtRange(Math.min(...ys), Math.max(...ys)) });
        extra += areaChart(ent.at, hit.year);
      }
      if (p.n !== p.e) extra += `<p class="wiki" lang="en">${esc(p.e)}</p>`;
      if (p.s) extra += `<p class="wiki">${t('card.under', { s: `<b>${esc(p.s)}</b>` })}</p>`;
      if (!p.p) extra += `<p class="wiki">${esc(t('card.fuzzy'))}</p>`;
      // Polity names are English Wikipedia-style names; find the article in the current language from there.
      wiki = { en: p.e };
      break;
    }
  }
  card.innerHTML = `<button class="close" aria-label="${esc(t('card.close'))}">×</button><div class="body">
    <div class="kind">${esc(kind)}</div><h2>${esc(title)}</h2><div class="when">${esc(when)}</div>
    ${desc ? `<p>${esc(desc)}</p>` : ''}${extra}<div class="wiki-slot"></div>
    <div class="links">${go ? `<button data-go>${esc(t('card.show'))}</button>` : ''}<button data-copy>${esc(t('card.copy'))}</button></div></div>`;
  card.hidden = false;
  card.scrollTop = 0;
  card.querySelector('.close').onclick = hideCard;
  if (go) card.querySelector('[data-go]').onclick = () => onGo(go);
  // The address already names the year, the view and this card.
  const copy = card.querySelector('[data-copy]');
  copy.onclick = () => navigator.clipboard?.writeText(location.href).then(() => { copy.textContent = t('card.copied'); }, () => {});
  card.querySelectorAll('[data-jump]').forEach(el => {
    el.onclick = () => { const [y, lon, lat] = el.dataset.jump.split(',').map(Number); onGo({ y, lon, lat }); };
  });
  if (wiki) loadWiki(wiki, !desc).then(w => {
    if (token !== cardToken || !w) return;
    if (w.thumb) card.insertAdjacentHTML('afterbegin', `<img class="img" src="${esc(w.thumb)}" alt="">`);
    if (w.text) card.querySelector('.wiki-slot').innerHTML = `<p class="wiki">${esc(w.text)}${w.lang !== lang ? ` <i>${esc(t('card.otherLang'))}</i>` : ''}</p>`;
    copy.insertAdjacentHTML('beforebegin', `<a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(t('card.wiki'))}</a>`);
  });
}

const fmtArea = a => {
  const loc = lang === 'bg' ? 'bg-BG' : 'en-US';
  return a >= 1e6
    ? t('area.million', { n: (a / 1e6).toLocaleString(loc, { maximumFractionDigits: 1 }) })
    : t('area.thousand', { n: Math.round(a / 1e3).toLocaleString(loc) });
};

// The area of the polity in every snapshot — rise and fall at a glance.
// Each dot jumps to its year; the current one is highlighted.
function areaChart(at, year) {
  const pts = [...at].sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return '';
  const W = 340, H = 86, P = 8;
  const y0 = pts[0][0], y1 = pts[pts.length - 1][0];
  const max = Math.max(...pts.map(p => p[3]));
  const X = y => P + (y - y0) / (y1 - y0 || 1) * (W - 2 * P);
  const Y = a => H - 18 - Math.sqrt(a / max) * (H - 30);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[3]).toFixed(1)}`).join('');
  const area = `${line}L${X(y1).toFixed(1)},${H - 18}L${X(y0).toFixed(1)},${H - 18}Z`;
  const peak = pts.reduce((a, b) => (b[3] > a[3] ? b : a));
  const cur = pts.reduce((a, b) => (Math.abs(b[0] - year) < Math.abs(a[0] - year) ? b : a));
  const dots = pts.map(p => `<circle data-jump="${p[0]},${p[1]},${p[2]}" cx="${X(p[0]).toFixed(1)}" cy="${Y(p[3]).toFixed(1)}" r="${p === cur ? 4.5 : 3}" class="${p === cur ? 'cur' : ''}"><title>${esc(fmtYear(p[0]))} · ${esc(fmtArea(p[3]))}</title></circle>`).join('');
  return `<div class="chart"><div class="chart-h">${esc(t('chart.title'))} <span>${esc(t('chart.peak', { area: fmtArea(peak[3]), year: fmtYear(peak[0]) }))}</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('chart.aria'))}">
      <path d="${area}" class="fill"/><path d="${line}" class="line"/>${dots}
      <text x="${P}" y="${H - 4}">${esc(fmtYear(y0, true))}</text><text x="${W - P}" y="${H - 4}" text-anchor="end">${esc(fmtYear(y1, true))}</text>
    </svg></div>`;
}

// Wikipedia summary and picture — live when there is a network. Offline the card simply stays without them.
const wikiCache = new Map();
function wikiQuery(wikiLang, title) {
  const key = wikiLang + ':' + title;
  if (wikiCache.has(key)) return wikiCache.get(key);
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*', redirects: '1', titles: title,
    prop: 'pageimages|langlinks|info|extracts', piprop: 'thumbnail', pithumbsize: '640',
    lllang: lang, inprop: 'url', exintro: '1', explaintext: '1', exsentences: '3',
  });
  const p = fetch(`https://${wikiLang}.wikipedia.org/w/api.php?${params}`)
    .then(r => r.json())
    .then(j => {
      const page = j.query?.pages?.[0];
      if (!page || page.missing) return null;
      return { lang: wikiLang, url: page.fullurl, text: page.extract?.trim(), thumb: page.thumbnail?.source, local: page.langlinks?.[0]?.title };
    })
    .catch(() => null);
  wikiCache.set(key, p);
  return p;
}
// `title` is an article in the current language; `en` is an English one to translate from.
async function loadWiki({ title, en }, wantText) {
  let page = title ? await wikiQuery(lang, title) : null;
  if (!page && en) {
    const e = await wikiQuery('en', en);
    if (lang !== 'en' && e?.local) page = await wikiQuery(lang, e.local);
    if (page && !page.thumb) page.thumb = e.thumb;
    page ??= e;
  }
  if (!page) return null;
  return { ...page, text: wantText || page.lang === lang ? page.text : null };
}
