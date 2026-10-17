// The faith a state or people is coloured with when the Faith filter is on: the faith of
// most of its people (data/content/faiths.json). By name where the state is known; by
// keyword (Caliphate, Sultanate…); in the Americas and Oceania a colony takes its ruler's
// faith; otherwise by region and century — rough boxes, the first that holds wins.
// ponytail: boxes, not borders; good enough to colour a world map, not to settle a region.
import { regionOf } from './time.js';

export function faithOf(F, name, year, lon, lat, ruler) {
  const byName = (n) => {
    const v = F.names[n];
    if (!v) return null;
    return typeof v === 'string' ? v : v.find(([until]) => year < until)?.[1] ?? null;
  };
  const named = byName(name);
  if (named) return named === 'none' ? null : named;
  for (const [re, key] of F.keywords) if (new RegExp(re).test(name)) return key;
  if (ruler && F.colonial.includes(regionOf(lon, lat))) {
    const r = byName(ruler);
    if (r) return r;
  }
  for (const [key, s, e, x0, y0, x1, y1] of F.zones) {
    if (year >= s && year < e && lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1) return key;
  }
  return null;
}
