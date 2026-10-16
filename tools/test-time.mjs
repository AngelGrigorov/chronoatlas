// node tools/test-time.mjs — проверка на чистите помощни функции.
import assert from 'node:assert/strict';
import { wrapLine, fmtYear, fmtRange, regionOf } from '../public/js/time.js';

// Магелан: от −150° до −215° пресича ±180° веднъж.
const parts = wrapLine([[-150, -10], [-215.3, 13.4]]);
assert.equal(parts.length, 2);
assert.deepEqual(parts[0][0], [-150, -10]);
assert.equal(parts[0].at(-1)[0], -180);
assert.equal(parts[1][0][0], 180);
assert.ok(Math.abs(parts[1].at(-1)[0] - 144.7) < 1e-9);
assert.ok(parts.flat().every(([x]) => x >= -180 && x <= 180));
// Линия изцяло отвъд −180° само се отмества.
assert.deepEqual(wrapLine([[-236, 10], [-232, 0]]), [[[124, 10], [128, 0]]]);
// Обикновена линия остава същата.
assert.deepEqual(wrapLine([[10, 10], [20, 20]]), [[[10, 10], [20, 20]]]);

assert.equal(fmtYear(-490), '490 г. пр.Хр.');
assert.equal(fmtYear(-10000), '10 000 г. пр.Хр.');
assert.equal(fmtRange(-27, 476), '27 г. пр.Хр. – 476 г.');
assert.equal(regionOf(23.3, 42.7), 'europe');
assert.equal(regionOf(44.4, 33.3), 'mena');
assert.equal(regionOf(116.4, 39.9), 'east');
console.log('time.js: всичко мина');
