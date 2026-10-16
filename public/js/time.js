// Годините са исторически: −490 е 490 г. пр.Хр., нулева година няма.
export const MIN_YEAR = -10000;
export const MAX_YEAR = 2025;
export const clampYear = y => Math.min(MAX_YEAR, Math.max(MIN_YEAR, y));

const num = n => n >= 10000 ? n.toLocaleString('bg-BG') : String(n);

export function fmtYear(y, short = false) {
  const r = Math.round(y);
  if (r < 0) return short ? `${num(-r)} пр.Хр.` : `${num(-r)} г. пр.Хр.`;
  return short ? num(Math.max(1, r)) : `${num(Math.max(1, r))} г.`;
}

export function fmtRange(s, e) {
  if (e == null) return `от ${fmtYear(s)}`;
  if (Math.round(s) === Math.round(e)) return fmtYear(s);
  if (s < 0 && e < 0) return `${num(-Math.round(s))} – ${num(-Math.round(e))} г. пр.Хр.`;
  if (s >= 0) return `${num(Math.round(s))} – ${num(Math.round(e))} г.`;
  return `${fmtYear(s)} – ${fmtYear(e)}`;
}

// Широки области за панела „Едновременно“. Груби кутии — стигат, за да
// се подреди светът в колони, а не за да се чертаят граници.
export const REGIONS = [
  ['europe', 'Европа'],
  ['mena', 'Близкият изток и Северна Африка'],
  ['africa', 'Африка на юг от Сахара'],
  ['asia', 'Централна и Южна Азия'],
  ['east', 'Източна и Югоизточна Азия'],
  ['americas', 'Америките'],
  ['oceania', 'Океания'],
];
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
