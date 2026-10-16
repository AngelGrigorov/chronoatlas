// Years are historical: −490 is 490 BC, there is no year zero.
export const MIN_YEAR = -10000;
export const MAX_YEAR = 2025;
export const clampYear = y => Math.min(MAX_YEAR, Math.max(MIN_YEAR, y));
// Whole years from a to b; there is no year zero, so 43 BC → AD 1 is 43 years, not 44.
export const yearsBetween = (a, b) => b - a - (a < 0 && b > 0 ? 1 : 0);

// Year formatting per language. English: "490 BC", "AD 117", "1453".
const FORMATS = {
  en: {
    locale: 'en-US',
    bc: n => `${n} BC`,
    ad: (n, r) => (r < 1000 ? `AD ${n}` : n),
    rangeBc: (a, b) => `${a}–${b} BC`,
    rangeAd: (a, b, s) => (s < 1000 ? `AD ${a}–${b}` : `${a}–${b}`),
    since: y => `since ${y}`,
    sep: ' – ',
  },
  bg: {
    locale: 'bg-BG',
    bc: (n, r, short) => (short ? `${n} пр.Хр.` : `${n} г. пр.Хр.`),
    ad: (n, r, short) => (short ? n : `${n} г.`),
    rangeBc: (a, b) => `${a} – ${b} г. пр.Хр.`,
    rangeAd: (a, b) => `${a} – ${b} г.`,
    since: y => `от ${y}`,
    sep: ' – ',
  },
};
let F = FORMATS.en;
export const setTimeLang = lang => { F = FORMATS[lang] || FORMATS.en; };

const num = n => (n >= 10000 ? n.toLocaleString(F.locale) : String(n));

export function fmtYear(y, short = false) {
  const r = Math.round(y);
  if (r < 0) return F.bc(num(-r), r, short);
  const n = Math.max(1, r);
  return F.ad(num(n), n, short);
}

export function fmtRange(s, e) {
  if (e == null) return F.since(fmtYear(s));
  const a = Math.round(s), b = Math.round(e);
  if (a === b) return fmtYear(s);
  if (a < 0 && b < 0) return F.rangeBc(num(-a), num(-b));
  if (a >= 0) return F.rangeAd(num(Math.max(1, a)), num(b), a);
  return fmtYear(s) + F.sep + fmtYear(e);
}

// Broad regions for the side panel. Rough boxes — enough to sort the world into
// columns, not to draw borders. Names come from the language pack (region.<key>).
export const REGIONS = ['europe', 'mena', 'africa', 'asia', 'east', 'americas', 'oceania'];
export function regionOf(lon, lat) {
  if (lon < -25) return 'americas';
  if (lon > 150 || (lon > 112 && lat < -10)) return 'oceania';
  if (lat > 36 && lon < 45 && !(lon > 26 && lat < 42)) return 'europe';
  if (lat > 50 && lon < 66) return 'europe';
  if (lon < 63 && lat > 12 && !(lon < 42 && lat < 17)) return 'mena';
  if (lon < 52) return 'africa';
  if (lon > 92 && (lat < 50 || lon > 120)) return 'east';
  return 'asia';
}

// Routes are written with continuous longitudes (Magellan reaches −383°) so they don't
// jump across the whole world. Here they are cut at ±180° into pieces MapLibre can draw.
export function wrapLine(coords) {
  const wrap = x => Math.floor((x + 180) / 360) * 360;
  const parts = [[]];
  coords.forEach(([x, y], i) => {
    const shift = wrap(x);
    if (i > 0) {
      const [px, py] = coords[i - 1], pshift = wrap(px);
      if (pshift !== shift) {
        const edge = shift > pshift ? pshift + 180 : pshift - 180;
        const ey = py + (y - py) * (edge - px) / (x - px);
        parts[parts.length - 1].push([edge - pshift, ey]);
        parts.push([[edge - shift, ey]]);
      }
    }
    parts[parts.length - 1].push([x - shift, y]);
  });
  return parts.filter(p => p.length > 1);
}
