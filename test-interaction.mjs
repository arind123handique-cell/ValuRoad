import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:3000/?test=true';
const TIMEOUT = 10000;

async function runInteractionTest() {
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', err => {
    console.error('  PAGE ERROR:', err.stack || err.message);
    errors.push({ type: 'pageerror', message: err.stack || err.message });
  });
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error('  CONSOLE ERROR:', msg.text());
      errors.push({ type: 'console-error', message: msg.text() });
    } else {
      console.log('  CONSOLE:', msg.text());
    }
  });

  // Handle browser dialogs (alerts, confirms)
  page.on('dialog', async dialog => {
    console.log(`  DIALOG: [${dialog.type()}] "${dialog.message()}"`);
    await dialog.accept();
  });

  try {
    console.log(`Navigating to ${URL}...`);
    await page.goto(URL, { timeout: TIMEOUT, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // 1. Create a project
    console.log("Creating project...");
    await page.click('#dash-create-project-btn');
    await page.waitForTimeout(1000);
    await page.fill('#proj-work-name', 'Test Project for Owner Lifecycle');
    await page.fill('#proj-location', 'Test Location');
    await page.click('#proj-editor-save-btn');
    await page.waitForTimeout(2000);

    // 2. Click Add Owner
    console.log("Clicking Add Owner...");
    await page.click('#project-add-owner-btn');
    await page.waitForTimeout(1000);

    // Fill Owner details
    console.log("Filling owner details...");
    await page.fill('#client-name', 'John Doe');
    await page.fill('#location', 'Village A');
    
    // Save draft
    console.log("Saving owner draft...");
    await page.click('#editor-save-draft-btn');
    await page.waitForTimeout(2000);

    // Check we are back in projectDetails and John Doe is listed
    let activeView = await page.evaluate(() => {
      const activeEl = document.querySelector('.view-container.active');
      return activeEl ? activeEl.id : 'none';
    });
    console.log("Active view after saving draft:", activeView);

    const ownerNameText = await page.evaluate(() => {
      const tbody = document.getElementById('owner-entries-list-body');
      return tbody ? tbody.innerText : 'NO TBODY';
    });
    console.log("Owner entries list text content:", ownerNameText);

    // 3. Click Edit on the owner row (or click the row)
    console.log("Clicking edit/row for John Doe...");
    // Let's click the edit button inside the table row
    await page.click('.edit-btn');
    await page.waitForTimeout(1000);

    activeView = await page.evaluate(() => {
      const activeEl = document.querySelector('.view-container.active');
      return activeEl ? activeEl.id : 'none';
    });
    console.log("Active view after clicking edit:", activeView);

    // Change name
    console.log("Modifying owner details...");
    await page.fill('#client-name', 'John Doe Modified');

    // Save modifications
    console.log("Saving modifications...");
    await page.click('#editor-complete-btn');
    await page.waitForTimeout(2000);

    // Verify back in project details with updated name
    activeView = await page.evaluate(() => {
      const activeEl = document.querySelector('.view-container.active');
      return activeEl ? activeEl.id : 'none';
    });
    console.log("Final active view:", activeView);

    const finalOwnerNameText = await page.evaluate(() => {
      const tbody = document.getElementById('owner-entries-list-body');
      return tbody ? tbody.innerText : 'NO TBODY';
    });
    console.log("Final owner entries list text content:", finalOwnerNameText);

    console.log("Done. Errors encountered:", errors.length);
  } catch (err) {
    console.error("Test script failed with exception:", err);
  } finally {
    await browser.close();
  }
}

runInteractionTest();
