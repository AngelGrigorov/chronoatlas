// Takes the README screenshots into docs/screenshots. The dev server must be running.
// node tools/screenshots.mjs
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs/screenshots');
const BASE = 'http://localhost:8642/';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const wait = ms => new Promise(r => setTimeout(r, ms));

async function shot(name, hash, { viewport = { width: 1600, height: 900, deviceScaleFactor: 1 }, lang = 'en', before } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  // No first-visit hint in screenshots; pick the language up front.
  await page.evaluateOnNewDocument(l => { localStorage.setItem('hint', '1'); localStorage.setItem('lang', l); }, lang);
  await page.goto(BASE + '#' + hash);
  await page.waitForSelector('#loading.done', { timeout: 30000 });
  await page.waitForFunction(() => window.atlas.map.loaded() && document.getElementById('snap').textContent, { timeout: 30000 });
  await wait(1500);
  if (before) { await before(page); await wait(2500); }
  await page.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 86 });
  console.log(name);
  await ctx.close();
}

await shot('ancient-world', 'y=-330&s=1200&c=36,34&z=2.75');
await shot('europe-1815', 'y=1815&s=120&c=14,48&z=3.9');
await shot('ottoman-card', 'y=1600&s=600&c=30,38&z=3.3', {
  before: async page => {
    await page.click('#q');
    await page.type('#q', 'Ottoman Empire');
    await wait(300);
    await page.keyboard.press('Enter');
  },
});
await shot('magellan-pacific', 'y=1521.4&s=12&c=175,2&z=1.75');
await shot('phone', 'y=681&s=600&c=26,43&z=4', { viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
await shot('bulgarian', 'y=1396&s=300&c=25,42&z=4.6', { lang: 'bg' });
await browser.close();
