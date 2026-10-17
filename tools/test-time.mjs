// node tools/test-time.mjs — checks for the pure helpers in time.js.
import assert from 'node:assert/strict';
import { wrapLine, fmtYear, fmtRange, regionOf, setTimeLang, yearsBetween } from '../public/js/time.js';
import { tidyName } from '../public/js/i18n.js';

// Magellan: from −150° to −215° crosses ±180° once.
const parts = wrapLine([[-150, -10], [-215.3, 13.4]]);
assert.equal(parts.length, 2);
assert.deepEqual(parts[0][0], [-150, -10]);
assert.equal(parts[0].at(-1)[0], -180);
assert.equal(parts[1][0][0], 180);
assert.ok(Math.abs(parts[1].at(-1)[0] - 144.7) < 1e-9);
assert.ok(parts.flat().every(([x]) => x >= -180 && x <= 180));
// A line entirely beyond −180° is only shifted.
assert.deepEqual(wrapLine([[-236, 10], [-232, 0]]), [[[124, 10], [128, 0]]]);
// An ordinary line stays as it is.
assert.deepEqual(wrapLine([[10, 10], [20, 20]]), [[[10, 10], [20, 20]]]);

// English is the default.
assert.equal(fmtYear(-490), '490 BC');
assert.equal(fmtYear(117), 'AD 117');
assert.equal(fmtYear(1453), '1453');
assert.equal(fmtYear(-10000), '10,000 BC');
assert.equal(fmtRange(-27, 476), '27 BC – AD 476');
assert.equal(fmtRange(-3100, -2686), '3100–2686 BC');
assert.equal(fmtRange(1914, 1918), '1914–1918');
assert.equal(fmtRange(1453, null), 'since 1453');

setTimeLang('bg');
assert.equal(fmtYear(-490), '490 г. пр.Хр.');
assert.equal(fmtYear(-490, true), '490 пр.Хр.');
assert.equal(fmtYear(-10000), '10 000 г. пр.Хр.');
assert.equal(fmtRange(-27, 476), '27 г. пр.Хр. – 476 г.');
setTimeLang('en');

// Ovid, 43 BC – AD 17: 59 years; at AD 1 he is 43.
assert.equal(yearsBetween(-43, 17), 59);
assert.equal(yearsBetween(-43, 1), 43);
assert.equal(yearsBetween(-356, -323), 33);
assert.equal(yearsBetween(1452, 1519), 67);

assert.equal(regionOf(23.3, 42.7), 'europe');
assert.equal(regionOf(44.4, 33.3), 'mena');
assert.equal(regionOf(116.4, 39.9), 'east');

// Names in scripts the font lacks keep their Latin part.
assert.equal(tidyName('ᏣᎳᎫᏪᏘᏱ Tsalaguwetiyi (Cherokee, East)'), 'Tsalaguwetiyi (Cherokee, East)');
assert.equal(tidyName('𐓏𐒰𐓓𐒰𐓓𐒷  𐒼𐓂𐓊𐒻  𐓆𐒻𐒿𐒷  𐓀𐒰^𐓓𐒰^(Osage)'), 'Osage');
assert.equal(tidyName('Dakeł Keyoh (ᑕᗸᒡ ᗲᘏᑋ)'), 'Dakeł Keyoh');
assert.equal(tidyName('Niitsítpiis-stahkoii ᖹᐟᒧᐧᐨᑯᐧ ᓴᐦᖾᐟ (Blackfoot / Niitsítapi ᖹᐟᒧᐧᒣᑯ)'), 'Niitsítpiis-stahkoii (Blackfoot / Niitsítapi)');
assert.equal(tidyName('Kō Hawaiʻi Paeʻāina (Hawaiian Kingdom)'), 'Kō Hawaiʻi Paeʻāina (Hawaiian Kingdom)');
console.log('time.js, i18n.js: all checks passed');
