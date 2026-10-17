// Runs the app in headless Chrome, goes through the main interactions and takes
// screenshots into .cache/shots. The dev server must be running (npm run serve).
// node tools/smoke.mjs [base-url]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE = process.argv[2] || 'http://localhost:8642/';
const SHOTS = path.join(ROOT, '.cache/shots');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'],
});
const failures = [];
const check = (ok, msg) => { console.log(ok ? '  ✓' : '  ✗', msg); if (!ok) failures.push(msg); };
const wait = ms => new Promise(r => setTimeout(r, ms));

async function open(hash, viewport = { width: 1440, height: 860 }, page = null) {
  page ??= await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text() + m.location()?.url)) errors.push(m.text() + ' @ ' + (m.location()?.url || '')); });
  // MapLibre cancels tiles that leave the view while moving — that is not an error.
  page.on('requestfailed', r => { if (r.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`failed (${r.failure()?.errorText}): ${r.url()}`); });
  page.on('response', r => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
  await page.goto(BASE + '#' + hash, { waitUntil: 'load' });
  await ready(page);
  return { page, errors };
}
async function ready(page) {
  await page.waitForSelector('#loading.done', { timeout: 30000 });
  await page.waitForFunction(() => window.atlas.map.loaded() && document.getElementById('snap').textContent, { timeout: 30000 });
  await wait(600);
}
const state = page => page.evaluate(() => ({
  year: Math.round(window.atlas.app.year),
  span: Math.round(window.atlas.app.span),
  yearText: document.getElementById('year').textContent,
  snap: document.getElementById('snap').textContent,
  card: !document.getElementById('card').hidden && document.querySelector('#card h2')?.textContent,
}));

console.log('Desktop, 330 BC');
{
  const { page, errors } = await open('y=-330&s=1200&c=40,33&z=2.6');
  const s = await state(page);
  check(s.yearText === '330 BC', `year on screen: ${s.yearText}`);
  check(/400 BC/.test(s.snap), `border snapshot: ${s.snap}`);
  await page.screenshot({ path: path.join(SHOTS, '01-desktop-330bc.png') });

  // The wheel over the timeline moves time forward.
  const box = await (await page.$('#timeline')).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel({ deltaY: 120 });
  await wait(900);
  const s2 = await state(page);
  check(s2.year > s.year, `wheel moves forward: ${s.year} → ${s2.year}`);

  // Ctrl+wheel zooms.
  await page.keyboard.down('Control');
  await page.mouse.wheel({ deltaY: -300 });
  await page.keyboard.up('Control');
  await wait(300);
  const s3 = await state(page);
  check(s3.span < s2.span, `Ctrl+wheel zooms in: ${s2.span} → ${s3.span} years`);

  // Dragging right goes back.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 300, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await wait(900);
  const s4 = await state(page);
  check(s4.year < s3.year, `dragging right goes back: ${s3.year} → ${s4.year}`);

  // Search.
  await page.click('#q');
  await page.type('#q', 'Marathon');
  await wait(200);
  const first = await page.$eval('#results li', li => li.textContent).catch(() => '');
  check(/Marathon/.test(first), `search finds: ${first}`);
  await page.keyboard.press('Enter');
  await wait(2500);
  const s5 = await state(page);
  check(s5.year === -490 && /Marathon/.test(s5.card || ''), `jump to Marathon: ${s5.year}, card "${s5.card}"`);
  await page.screenshot({ path: path.join(SHOTS, '02-search-marathon.png') });

  // Clicking the map opens a card.
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.atlas.map.jumpTo({ center: [44, 33], zoom: 3.5 }));
  await wait(1500);
  const mapBox = await (await page.$('#map')).boundingBox();
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await wait(1500);
  const s6 = await state(page);
  check(!!s6.card, `click on the map: "${s6.card}"`);
  await page.screenshot({ path: path.join(SHOTS, '03-click-polity.png') });

  // Play with the space bar.
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement.blur());
  const before = (await state(page)).year;
  await page.evaluate(() => {
    window.__frames = [];
    const tick = t => { window.__frames.push(t); if (window.__frames.length < 400) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.keyboard.press('Space');
  await wait(1500);
  await page.keyboard.press('Space');
  const after = (await state(page)).year;
  check(after - before > 40, `play runs: ${before} → ${after}`);
  const fps = await page.evaluate(() => { const f = window.__frames; return Math.round((f.length - 1) / ((f[f.length - 1] - f[0]) / 1000)); });
  console.log(`  · frames while playing: ${fps}/s`);

  // Arrow keys move time.
  const y0 = (await state(page)).year;
  await page.keyboard.press('ArrowRight');
  await wait(200);
  check((await state(page)).year > y0, 'right arrow moves forward');

  check(errors.length === 0, `no console errors (${errors.length})`);
  errors.slice(0, 8).forEach(e => console.log('     ', e));
  await page.close();
}

for (const [name, hash] of [
  ['04-117-rome', 'y=117&s=600&c=20,40&z=2.6'],
  ['05-1241-mongols', 'y=1241&s=200&c=60,45&z=2.3'],
  ['06-1520-magellan', 'y=1520&s=200&c=-60,-10&z=1.6'],
  ['07-1812-napoleon', 'y=1812&s=60&c=30,52&z=3.6'],
  ['08-1878-bulgaria', 'y=1878&s=60&c=25,42.5&z=5.2'],
  ['09-flat-1914', 'y=1914&s=200&c=15,30&z=1.8&p=flat'],
]) {
  console.log(name);
  const { page, errors } = await open(hash);
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  check(errors.length === 0, `no errors (${errors.length})`);
  errors.slice(0, 5).forEach(e => console.log('     ', e));
  await page.close();
}

console.log('Old events fade out');
{
  // Reported bug: in 2024 with a zoomed-out timeline the map still showed the fall of the Berlin Wall.
  const { page, errors } = await open('y=2024&s=2400&c=8,50&z=4.6');
  const side = await page.$eval('#side-list', el => el.innerText);
  const visible = await page.evaluate(() => {
    const m = window.atlas.map;
    return m.queryRenderedFeatures({ layers: ['ev', 'bt'] })
      .filter(f => { const a = 2024 - f.properties.y; return a >= 0 && a <= m.getGlobalState?.().win; })
      .map(f => f.properties.y);
  }).catch(() => []);
  check(!/Berlin Wall|1989/.test(side), 'the fall of the Berlin Wall is gone by 2024');
  check(visible.every(y => 2024 - y <= 60), `only recent events on the map: ${[...new Set(visible)].join(', ') || 'none'}`);
  check(errors.length === 0, `no errors (${errors.length})`);
  await page.close();
}

console.log('Events of the shown year only');
{
  const panelAt = async (page, y) => {
    await page.evaluate(y => window.atlas.app.setYear(y, { instant: true }), y);
    await wait(700);
    return page.$eval('#side-list', el => el.innerText);
  };
  const { page, errors } = await open('y=-490&s=1200&c=24,38&z=4');
  check(/Battle of Marathon/.test(await panelAt(page, -490)), 'Marathon shows in 490 BC');
  check(!/Battle of Marathon/.test(await panelAt(page, -489)), 'and is gone in 489 BC');
  check(!/Battle of Marathon/.test(await panelAt(page, -491)), 'and is not there yet in 491 BC');
  check(/Peloponnesian War/.test(await panelAt(page, -420)), 'a war shows through its years (Peloponnesian War, 420 BC)');
  check(errors.length === 0, `no errors (${errors.length})`);
  await page.close();
}

console.log('Links to a card');
{
  const { page, errors } = await open('y=-490&s=1200&c=24,38&z=4&o=event%3Abattle-of-marathon');
  const title = () => page.$eval('#card', el => (el.hidden ? '' : el.querySelector('h2').textContent));
  check(/Marathon/.test(await title()), `the link opens the card: "${await title()}"`);
  await page.click('#card .close');
  await wait(300);
  check(!/[#&]o=/.test(await page.evaluate(() => location.hash)), 'closing it takes it out of the address');
  await page.goto(BASE + '#y=1600&s=600&c=30,38&z=3.3&o=polity%3AOttoman%20Empire', { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  check(/Ottoman/.test(await title()), `a state opens too: "${await title()}"`);
  check(/o=polity%3AOttoman/.test(await page.evaluate(() => location.hash)), 'and stays in the address');
  check(errors.length === 0, `no errors (${errors.length})`);
  await page.close();
}

console.log('Phone');
{
  const { page, errors } = await open('y=681&s=600&c=26,43&z=3.5', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.screenshot({ path: path.join(SHOTS, '10-mobile.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, 'no horizontal scroll');
  check(errors.length === 0, `no errors (${errors.length})`);
  await page.close();
}

console.log('Bulgarian');
{
  // A fresh browser context, so the language choice and the cached pack start empty.
  const ctx = await browser.createBrowserContext();
  const { page, errors } = await open('y=1396&s=300&c=25,42&z=4.2', undefined, await ctx.newPage());
  check(await page.evaluate(() => document.documentElement.lang) === 'en', 'English by default');
  await Promise.all([page.waitForNavigation(), page.click('#lang-switch button[aria-pressed="false"]')]);
  await ready(page);
  const s = await state(page);
  check(s.yearText === '1396 г.' && /Граници/.test(s.snap), `switches to Bulgarian: ${s.yearText} · ${s.snap}`);
  const stored = await page.evaluate(() => [localStorage.getItem('lang'), (localStorage.getItem('i18n:bg') || '').length]);
  check(stored[0] === 'bg' && stored[1] > 100000, `pack kept in localStorage: ${Math.round(stored[1] / 1024)} K chars`);
  await page.screenshot({ path: path.join(SHOTS, '11-bulgarian.png') });
  // Without the network for the pack, Bulgarian still comes from localStorage.
  await page.setRequestInterception(true);
  const block = r => (/data\/i18n\//.test(r.url()) ? r.abort() : r.continue());
  page.on('request', block);
  await page.reload();
  await ready(page);
  check((await state(page)).yearText === '1396 г.', 'Bulgarian works with the pack blocked');
  page.off('request', block);
  await page.setRequestInterception(false);
  errors.length = 0;
  await page.reload();
  await ready(page);
  await Promise.all([page.waitForNavigation(), page.click('#lang-switch button[aria-pressed="false"]')]);
  await ready(page);
  check((await state(page)).yearText === '1396', 'back to English');
  check(errors.length === 0, `no errors (${errors.length})`);
  errors.slice(0, 5).forEach(e => console.log('     ', e));
  await ctx.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} problem(s)` : '\nall passed');
process.exit(failures.length ? 1 : 0);
