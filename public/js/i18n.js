// Language packs. English is the default and loads like any other data file.
// Other languages are downloaded on request and kept in localStorage, so after the
// first download they work offline; index.json carries a version per pack, and a
// stale cached pack is refreshed when the browser is online.
import { setTimeLang } from './time.js';

const LANG_KEY = 'lang';
const packKey = lang => `i18n:${lang}`;
let pack = null;
export let lang = 'en';

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
};

export function t(key, vars) {
  let s = pack?.ui[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return s;
}
export const texts = () => pack;
export const polityName = name => pack?.polities?.[name] ?? name;

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
const fetchIndex = () => fetchJSON('data/i18n/index.json', { cache: 'no-cache' }).catch(() => null);

// Downloads a pack and stores it. Returns false if it could not be fetched or stored.
export async function downloadLanguage(code) {
  const index = await fetchIndex();
  try {
    const data = await fetchJSON(`data/i18n/${code}.json?v=${index?.langs[code]?.v ?? ''}`);
    return storage.set(packKey(code), JSON.stringify({ v: index?.langs[code]?.v, data }));
  } catch {
    return false;
  }
}

export function setLanguage(code) {
  storage.set(LANG_KEY, code);
}

export async function loadLanguage() {
  const wanted = storage.get(LANG_KEY) || 'en';
  const index = await fetchIndex();
  if (wanted !== 'en') {
    let cached = null;
    try { cached = JSON.parse(storage.get(packKey(wanted))); } catch {}
    const latest = index?.langs[wanted]?.v;
    if (cached && (!latest || cached.v === latest)) pack = cached.data;
    else if (await downloadLanguage(wanted)) pack = JSON.parse(storage.get(packKey(wanted))).data;
    else if (cached) pack = cached.data;
  }
  if (!pack) pack = await fetchJSON(`data/i18n/en.json?v=${index?.langs.en?.v ?? ''}`);
  lang = pack.lang;
  setTimeLang(lang);
  document.documentElement.lang = lang;
  return pack;
}

// Static markup: data-i18n="key" sets the text, data-i18n-attr="attr:key;attr:key" sets attributes.
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.innerHTML = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr, t(key));
    }
  }
  document.title = t('app.title');
}
