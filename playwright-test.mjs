import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:3000/';
const MAX_RETRIES = 5;
const TIMEOUT = 15000;

async function testPage() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`Attempt ${attempt}/${MAX_RETRIES}...`);
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }).catch(e => { console.log('  launch err:', e.message); return null; });
    if (!browser) {
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', err => { console.log('  PAGE ERROR:', err.message); errors.push(err.message); });
    page.on('console', msg => { if (msg.type() === 'error') { console.log('  CONSOLE ERROR:', msg.text()); errors.push(msg.text()); } });
    page.on('response', r => { if (!r.ok()) console.log('  HTTP ERROR:', r.status(), r.url()); });

    try {
      await page.goto(URL, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
      // Wait for Firebase/auth to settle
      await page.waitForTimeout(3000);
      
      // Check if app loaded
      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200));
      console.log(`  Body text: ${bodyText.substring(0, 100)}...`);
      
      // Check ribbon elements
      const navBtn = await page.$('#prev-btn-page-prev');
      console.log(`  nav btn exists: ${!!navBtn}`);
      
      // Check view-pdf-template visibility
      const tplVisible = await page.evaluate(() => {
        const v = document.getElementById('view-pdf-template');
        return v ? v.classList.contains('active') : 'NOT FOUND';
      });
      console.log(`  view-pdf-template active: ${tplVisible}`);

      // Check a4-canvas-container properties
      const a4Props = await page.evaluate(() => {
        const c = document.querySelector('.a4-canvas-container');
        if (!c) return { error: 'not found' };
        const style = getComputedStyle(c);
        return {
          flex: style.flex,
          overflow: style.overflow,
          minHeight: style.minHeight,
          height: style.height,
          display: style.display
        };
      });
      console.log(`  a4-canvas:`, JSON.stringify(a4Props));

      // Check if main canvas scrolls
      const a4Scroll = await page.evaluate(() => {
        const c = document.querySelector('.a4-canvas-container');
        return c ? { scrollH: c.scrollHeight, clientH: c.clientHeight, offsetH: c.offsetHeight } : null;
      });
      if (a4Scroll) console.log(`  a4-scroll: scrollH=${a4Scroll.scrollH} clientH=${a4Scroll.clientH}`);
      
      if (errors.length > 0) {
        console.log(`  FAIL - ${errors.length} error(s)`);
      } else {
        console.log('  PASS - No errors');
      }
      
      await browser.close();
      return { ok: errors.length === 0, errors };
    } catch (err) {
      console.log(`  Error: ${err.message}`);
      await browser.close().catch(() => {});
      if (attempt < MAX_RETRIES) {
        console.log(`  Retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
  return { ok: false, errors: ['Max retries reached'] };
}

const result = await testPage();
console.log(`Result: ${result.ok ? 'PASS' : 'FAIL'}`);
process.exit(result.ok ? 0 : 1);
