import { KINDS, cityName, eventAlpha, spanAlpha, isBattle } from './map.js';
import { REGIONS, regionOf, fmtYear, fmtRange } from './time.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ——— „Едновременно“: какво има по света в тази година ———
export function createPanel(root, toggle, { data, onFocus }) {
  const { events, cultures, cities } = data;
  let last = '';
  let items = [];
  let pref = null;
  try { pref = localStorage.getItem('side'); } catch {}
  // На телефон панелът закрива половината карта — затворен е, докато не го поискаш.
  if (pref === 'closed' || (!pref && window.innerWidth < 760)) root.parentElement.classList.add('closed');
  toggle.setAttribute('aria-expanded', String(!root.parentElement.classList.contains('closed')));
  toggle.addEventListener('click', () => {
    const closed = root.parentElement.classList.toggle('closed');
    toggle.setAttribute('aria-expanded', String(!closed));
    try { localStorage.setItem('side', closed ? 'closed' : 'open'); } catch {}
  });
  root.addEventListener('click', e => {
    const li = e.target.closest('li[data-i]');
    if (li) onFocus(items[+li.dataset.i]);
  });

  function update(year, win, labels, snap) {
    if (root.parentElement.classList.contains('closed')) return;
    const key = `${Math.round(year)}|${Math.round(win)}|${snap}`;
    if (key === last) return;
    last = key;
    items = [];
    const by = Object.fromEntries(REGIONS.map(([k]) => [k, { states: [], other: [], events: [] }]));

    for (const [lon, lat, area, name, sharp, color, extra] of labels) {
      if (extra) continue;
      const r = by[regionOf(lon, lat)];
      (sharp ? r.states : r.other).push({ type: 'label', name, lon, lat, area, color });
    }
    for (const c of cultures) {
      const a = spanAlpha(c.s, c.e, Math.max(40, (c.e - c.s) * 0.15), year);
      if (a > 0.2) by[regionOf(c.lon, c.lat)].other.unshift({ type: 'culture', item: c, name: c.n, lon: c.lon, lat: c.lat, area: Infinity });
    }
    for (const e of events) {
      const a = eventAlpha(e.y, year, win);
      if (a > 0) by[regionOf(e.lon, e.lat)].events.push({ type: 'event', item: e, a });
    }

    let html = `<h2>Светът около ${esc(fmtYear(year))}</h2><div class="sub">Държави по площ, култури без граници и събития от последните ${Math.round(win)} години</div>`;
    const push = it => { items.push(it); return items.length - 1; };
    for (const [k, title] of REGIONS) {
      const r = by[k];
      const states = r.states.sort((a, b) => b.area - a.area).slice(0, 4);
      const other = r.other.sort((a, b) => b.area - a.area).slice(0, states.length ? 2 : 4);
      const evs = r.events.sort((a, b) => b.item.i - a.item.i || a.a - b.a).slice(0, 3);
      if (!states.length && !other.length && !evs.length) continue;
      html += `<section><h3>${esc(title)}</h3><ul>`;
      for (const it of evs) {
        const e = it.item;
        html += `<li class="ev" data-i="${push(it)}"><span class="sw ev" style="background:${KINDS[e.k]?.[1]}"></span><span class="t">${esc(e.t)}</span><span class="y">${esc(fmtYear(e.y, true))}</span></li>`;
      }
      for (const it of [...states, ...other]) {
        const color = it.type === 'culture' ? '#f0c674' : it.color || 'rgba(236,226,205,0.4)';
        html += `<li data-i="${push(it)}"><span class="sw" style="background:${color}"></span><span class="t">${esc(it.name)}</span></li>`;
      }
      html += '</ul></section>';
    }
    root.innerHTML = html;
  }
  return { update, refresh() { last = ''; } };
}

// ——— Картичката ———
const card = document.getElementById('card');
let cardToken = 0;

export function hideCard() {
  card.hidden = true;
  cardToken++;
}

export function showCard(hit, { entities, onGo }) {
  const token = ++cardToken;
  let kind = '', title = '', when = '', desc = '', extra = '', wiki = null, go = null;
  const it = hit.item;
  switch (hit.type) {
    case 'event':
      kind = KINDS[it.k]?.[0] || 'Събитие';
      title = it.t; when = it.ye ? fmtRange(it.y, it.ye) : fmtYear(it.y); desc = it.d;
      wiki = { bg: it.w, en: it.we };
      go = it;
      break;
    case 'wd':
      kind = (KINDS[it.k]?.[0] || 'Събитие') + ' · Wikidata';
      title = it.t; when = fmtYear(it.y);
      wiki = { bg: it.wb, en: it.we, wd: it.id };
      go = it;
      break;
    case 'city': {
      kind = 'Град';
      title = cityName(it, hit.year);
      when = fmtRange(it.s, it.e);
      const names = it.n.map(([y, n]) => n);
      if (names.length > 1) extra = `<p class="wiki">Имена през вековете: ${names.map(esc).join(' → ')}</p>`;
      desc = it.d;
      wiki = { bg: it.w || names[names.length - 1] };
      go = { y: hit.year, lon: it.lon, lat: it.lat };
      break;
    }
    case 'culture':
      kind = 'Култура';
      title = it.n; when = fmtRange(it.s, it.e); desc = it.d;
      wiki = { bg: it.w, en: it.we };
      go = { y: hit.year, lon: it.lon, lat: it.lat };
      break;
    case 'route':
      kind = { trade: 'Търговски път', campaign: 'Поход', voyage: 'Плаване', migration: 'Преселение' }[it.k];
      title = it.n;
      when = it.k === 'trade' ? fmtRange(it.s, it.e) : fmtRange(it.p[0][2], it.p[it.p.length - 1][2]);
      desc = it.d;
      wiki = { bg: it.w, en: it.we };
      break;
    case 'polity': {
      const p = it, ent = entities[p.e];
      kind = p.p ? 'Държава' : 'Народ / култура';
      title = p.n;
      if (ent) {
        const ys = ent.at.map(a => a[0]);
        when = `В картите: ${fmtRange(Math.min(...ys), Math.max(...ys))}`;
      }
      if (p.n !== p.e) extra += `<p class="wiki" lang="en">${esc(p.e)}</p>`;
      if (p.s) extra += `<p class="wiki">Под властта на: <b>${esc(p.s)}</b></p>`;
      if (!p.p) extra += '<p class="wiki">Границата е приблизителна — затова е размита.</p>';
      wiki = { en: p.e, bgGuess: p.n };
      break;
    }
  }
  card.innerHTML = `<button class="close" aria-label="Затвори">×</button><div class="body">
    <div class="kind">${esc(kind)}</div><h2>${esc(title)}</h2><div class="when">${esc(when)}</div>
    ${desc ? `<p>${esc(desc)}</p>` : ''}${extra}<div class="wiki-slot"></div>
    <div class="links">${go ? '<button data-go>Покажи</button>' : ''}</div></div>`;
  card.hidden = false;
  card.scrollTop = 0;
  card.querySelector('.close').onclick = hideCard;
  if (go) card.querySelector('[data-go]').onclick = () => onGo(go);
  if (wiki) loadWiki(wiki, !desc).then(w => {
    if (token !== cardToken || !w) return;
    if (w.thumb) card.insertAdjacentHTML('afterbegin', `<img class="img" src="${esc(w.thumb)}" alt="">`);
    if (w.text) card.querySelector('.wiki-slot').innerHTML = `<p class="wiki">${esc(w.text)}${w.lang === 'en' ? ' <i>(англ.)</i>' : ''}</p>`;
    card.querySelector('.links').insertAdjacentHTML('beforeend', `<a href="${esc(w.url)}" target="_blank" rel="noopener">Уикипедия ↗</a>`);
  });
}

// Резюме и снимка от Уикипедия — на живо, ако има мрежа. Без мрежа картичката си остава.
const wikiCache = new Map();
async function wikiQuery(lang, title, wantText) {
  const key = lang + ':' + title + ':' + wantText;
  if (wikiCache.has(key)) return wikiCache.get(key);
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*', redirects: '1', titles: title,
    prop: 'pageimages|langlinks|info' + (wantText ? '|extracts' : ''), piprop: 'thumbnail', pithumbsize: '640',
    lllang: 'bg', inprop: 'url', ...(wantText ? { exintro: '1', explaintext: '1', exsentences: '3' } : {}),
  });
  const p = fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`)
    .then(r => r.json())
    .then(j => {
      const page = j.query?.pages?.[0];
      if (!page || page.missing) return null;
      return { lang, title: page.title, url: page.fullurl, text: page.extract?.trim(), thumb: page.thumbnail?.source, bg: page.langlinks?.[0]?.title };
    })
    .catch(() => null);
  wikiCache.set(key, p);
  return p;
}
async function loadWiki({ bg, en, bgGuess }, wantText) {
  let page = bg ? await wikiQuery('bg', bg, true) : null;
  if (!page && en) {
    const e = await wikiQuery('en', en, true);
    if (e?.bg) page = await wikiQuery('bg', e.bg, true);
    if (page && !page.thumb) page.thumb = e.thumb;
    page ??= e;
  }
  if (!page && bgGuess) page = await wikiQuery('bg', bgGuess, true);
  if (!page) return null;
  return { ...page, text: wantText || page.lang === 'bg' ? page.text : null };
}
