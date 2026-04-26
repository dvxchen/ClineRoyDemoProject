/**
 * Generated from first.csv
 * Steps:
 * 1) open https://www.bing.com with chrome-devtools
 * 2) input "hello world" in the searchbox
 * Expected: Search results for "hello world" are displayed
 */
const puppeteer = require('puppeteer');
const fs = require('fs/promises');

const LOG_FILE = 'log.json';
let logs = [];

async function resetLog() {
  await fs.writeFile(LOG_FILE, '[]', 'utf8');
}

async function writeLog(entry) {
  logs.push({ time: new Date().toISOString(), ...entry });
  await fs.writeFile(LOG_FILE, JSON.stringify(logs, null, 2), 'utf8');
}

(async () => {
  const TEST_INPUT = 'hello world';
  let browser;

  await resetLog();

  try {
    // Launch Chrome with DevTools open as per "with chrome-devtools"
    browser = await puppeteer.launch({
      headless: false,
      devtools: true
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    // Step 1: Open Bing
    console.log('Step 1: Open https://www.bing.com with Chrome DevTools...');
    await writeLog({ step: 1, action: 'open', url: 'https://www.bing.com', detail: 'with chrome-devtools', status: 'start' });
    await page.goto('https://www.bing.com/', { waitUntil: ['load', 'domcontentloaded'] });
    await writeLog({ step: 1, action: 'open', url: 'https://www.bing.com', status: 'success' });

    // Step 2: Input text into the search box and submit
    console.log('Step 2: Input text into the search box and submit...');
    await writeLog({ step: 2, action: 'input', selector: '#sb_form_q', value: TEST_INPUT, status: 'start' });
    const inputSelector = '#sb_form_q'; // Bing search input
    await page.waitForSelector(inputSelector, { visible: true });
    await page.click(inputSelector, { clickCount: 3 });
    await page.type(inputSelector, TEST_INPUT);
    await page.keyboard.press('Enter');

    // Wait for results/navigation
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForSelector('#b_results', { visible: true });
    await writeLog({ step: 2, action: 'input', selector: '#sb_form_q', value: TEST_INPUT, status: 'success' });

    // Validate expected result: results displayed for the query
    const resultsCount = await page.$$eval('#b_results li.b_algo', nodes => nodes.length).catch(() => 0);
    const queryEcho = await page.$eval('#sb_form_q', el => el.value).catch(() => '');

    const ok = resultsCount > 0 && queryEcho.toLowerCase().includes(TEST_INPUT.toLowerCase());

    await writeLog({ step: 3, action: 'assert', assertion: 'results displayed', resultsCount, queryEcho, expected: `Search results for "${TEST_INPUT}" are displayed.`, status: ok ? 'pass' : 'fail' });

    if (!ok) {
      throw new Error(`Expected search results for "${TEST_INPUT}" to be displayed, but validation failed. count=${resultsCount}, input="${queryEcho}"`);
    }

    console.log(`Assertion passed: Search results for "${TEST_INPUT}" are displayed.`);
  } catch (err) {
    await writeLog({ step: 'error', status: 'error', error: err && err.message ? err.message : String(err), stack: err && err.stack ? err.stack : undefined });
    console.error('Test failed:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
})();