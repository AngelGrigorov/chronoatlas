// Пуска приложението в headless Chrome, минава през основните неща и прави снимки
// в .cache/shots. Сървърът трябва да върви (npm run serve).
// node tools/smoke.mjs [база]
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

async function open(hash, viewport = { width: 1440, height: 860 }) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/wd-events|favicon/.test(m.text() + m.location()?.url)) errors.push(m.text() + ' @ ' + (m.location()?.url || '')); });
  // MapLibre сам отказва плочките, които излизат от изгледа при движение — това не е грешка.
  page.on('requestfailed', r => { if (r.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`failed (${r.failure()?.errorText}): ${r.url()}`); });
  page.on('response', r => { if (r.status() >= 400 && !/wd-events/.test(r.url())) errors.push(r.status() + ' ' + r.url()); });
  await page.goto(BASE + '#' + hash, { waitUntil: 'load' });
  await page.waitForSelector('#loading.done', { timeout: 30000 });
  await page.waitForFunction(() => window.atlas.map.loaded() && document.getElementById('snap').textContent, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 600));
  return { page, errors };
}
const state = page => page.evaluate(() => ({
  year: Math.round(window.atlas.app.year),
  span: Math.round(window.atlas.app.span),
  yearText: document.getElementById('year').textContent,
  snap: document.getElementById('snap').textContent,
  card: !document.getElementById('card').hidden && document.querySelector('#card h2')?.textContent,
}));

console.log('Десктоп, 330 г. пр.Хр.');
{
  const { page, errors } = await open('y=-330&s=1200&c=40,33&z=2.6');
  let s = await state(page);
  check(s.yearText === '330 г. пр.Хр.', `година на екрана: ${s.yearText}`);
  check(/400 г\. пр\.Хр\./.test(s.snap), `снимка на границите: ${s.snap}`);
  await page.screenshot({ path: path.join(SHOTS, '01-desktop-330bc.png') });

  // Колелцето върху таймлайна мести времето напред.
  const tl = await page.$('#timeline');
  const box = await tl.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel({ deltaY: 120 });
  await new Promise(r => setTimeout(r, 900));
  const s2 = await state(page);
  check(s2.year > s.year, `колелцето мести напред: ${s.year} → ${s2.year}`);

  // Ctrl+колелцето мащабира.
  await page.keyboard.down('Control');
  await page.mouse.wheel({ deltaY: -300 });
  await page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 300));
  const s3 = await state(page);
  check(s3.span < s2.span, `Ctrl+колелце приближава: ${s2.span} → ${s3.span} години`);

  // Влачене назад.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 300, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 900));
  const s4 = await state(page);
  check(s4.year < s3.year, `влаченето надясно връща назад: ${s3.year} → ${s4.year}`);

  // Търсене.
  await page.click('#q');
  await page.type('#q', 'Маратон');
  await new Promise(r => setTimeout(r, 200));
  const first = await page.$eval('#results li', li => li.textContent).catch(() => '');
  check(/Маратон/.test(first), `търсенето намира: ${first}`);
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 2500));
  const s5 = await state(page);
  check(s5.year === -490 && /Маратон/.test(s5.card || ''), `скок до Маратон: ${s5.year}, картичка „${s5.card}“`);
  await page.screenshot({ path: path.join(SHOTS, '02-search-marathon.png') });

  // Клик върху държава отваря картичка.
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.atlas.map.jumpTo({ center: [44, 33], zoom: 3.5 }));
  await new Promise(r => setTimeout(r, 1500));
  const mapBox = await (await page.$('#map')).boundingBox();
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await new Promise(r => setTimeout(r, 1500));
  const s6 = await state(page);
  check(!!s6.card, `клик върху картата: „${s6.card}“`);
  await page.screenshot({ path: path.join(SHOTS, '03-click-polity.png') });

  // ▶ с интервал.
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement.blur());
  const before = (await state(page)).year;
  await page.evaluate(() => {
    window.__frames = [];
    const tick = t => { window.__frames.push(t); if (window.__frames.length < 400) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.keyboard.press('Space');
  await new Promise(r => setTimeout(r, 1500));
  await page.keyboard.press('Space');
  const after = (await state(page)).year;
  check(after - before > 40, `▶ върви: ${before} → ${after}`);
  const fps = await page.evaluate(() => { const f = window.__frames; return Math.round((f.length - 1) / ((f[f.length - 1] - f[0]) / 1000)); });
  console.log(`  · кадри при ▶: ${fps}/с`);

  // Стрелките местят времето.
  const y0 = (await state(page)).year;
  await page.keyboard.press('ArrowRight');
  await new Promise(r => setTimeout(r, 200));
  check((await state(page)).year > y0, 'стрелка надясно мести напред');

  check(errors.length === 0, `без грешки в конзолата (${errors.length})`);
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
  check(errors.length === 0, `без грешки (${errors.length})`);
  errors.slice(0, 5).forEach(e => console.log('     ', e));
  await page.close();
}

console.log('Телефон');
{
  const { page, errors } = await open('y=681&s=600&c=26,43&z=3.5', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.screenshot({ path: path.join(SHOTS, '10-mobile.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, 'без хоризонтален скрол');
  check(errors.length === 0, `без грешки (${errors.length})`);
  await page.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} проблема` : '\nвсичко мина');
process.exit(failures.length ? 1 : 0);
