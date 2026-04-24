/**
 * Automation script driven by qianwen.csv
 *
 * qianwen.csv format (3 columns):
 * Action,Data,Expected Result
 *
 * Example rows in qianwen.csv (as provided):
 * - 用chrome-devtools打开http://www.qianwen.com,,
 * - 输入 Return value field of JSON format. Provide the United States CPI (All items) year-over-year percentage for Mar. Use keys: value
 * - 点击 Send Chat
 *
 * This script will:
 * 1) Parse qianwen.csv
 * 2) Open http(s) URLs specified or embedded in the Action text
 * 3) Type the provided message into the chat input on www.qianwen.com
 * 4) Click the "Send Chat" button (or fallback to pressing Enter)
 *
 * Requirements to run:
 *   npm install puppeteer
 * Then:
 *   node qianwen_runner.js
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const LOG_PATH = path.resolve(__dirname, 'log.json');
let LOG_BUFFER = [];
function resetLogFile() {
  try { fs.writeFileSync(LOG_PATH, '[]'); LOG_BUFFER = []; } catch { }
}
function logStep(entry) {
  const record = Object.assign({ ts: new Date().toISOString() }, entry);
  LOG_BUFFER.push(record);
  try { fs.writeFileSync(LOG_PATH, JSON.stringify(LOG_BUFFER, null, 2)); } catch { }
}

// Allow keeping the browser open for debugging via flag or env
const KEEP_OPEN = process.env.KEEP_OPEN === '1' || process.argv.includes('--keep-open');

function parseCsvThreeColumns(csvText) {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  // Assume first line is header
  const dataLines = lines.slice(1);
  const rows = [];

  for (const line of dataLines) {
    // Simple three-column split. Assumes there are exactly two commas per line.
    // If more complex CSV is introduced later, replace with a proper CSV parser.
    const parts = [];
    let current = '';
    let commaCount = 0;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === ',' && commaCount < 2) {
        parts.push(current);
        current = '';
        commaCount++;
      } else {
        current += ch;
      }
    }
    parts.push(current);
    while (parts.length < 3) parts.push('');
    const [Action, Data, Expected] = parts.map(s => s.trim());
    if (Action || Data || Expected) {
      rows.push({ Action, Data, Expected });
    }
  }
  return rows;
}

function extractUrl(text) {
  const m = text.match(/https?:\/\/\S+/i);
  return m ? m[0].replace(/[)\]]+$/, '') : null;
}

function extractAfterKeyword(action, keyword) {
  const idx = action.indexOf(keyword);
  if (idx === -1) return;
  const rest = action.slice(idx + keyword.length).trim();
  return rest || null;
}

// Try to detect a local Chrome/Edge executable if env var is not set
function detectBrowserPath() {
  const candidates = [
    'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    'C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
    'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe'
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { }
  }
  return undefined;
}

async function waitVisibleHandles(page, selectors, minWidth = 200, minHeight = 30) {
  const handles = [];
  for (const sel of selectors) {
    const list = await page.$$(sel);
    for (const h of list) {
      try {
        const box = await h.boundingBox();
        if (box && box.width >= minWidth && box.height >= minHeight) {
          handles.push(h);
        } else {
          await h.dispose();
        }
      } catch {
        // ignore
      }
    }
    if (handles.length) break;
  }
  return handles;
}

async function findChatInput(page) {
  // Try a set of common selectors for chat inputs
  const selectors = [
    'textarea',
    'div[contenteditable="true"]',
    'div[role="textbox"]',
    'input[type="text"]',
    'input[type="search"]',
    'input:not([type])',
    'textarea[placeholder]',
    'div[contenteditable]'
  ];

  // First, try visible and reasonably sized elements
  let candidates = await waitVisibleHandles(page, selectors, 200, 30);

  // If none found, relax size constraints
  if (!candidates.length) {
    candidates = await waitVisibleHandles(page, selectors, 50, 20);
  }

  if (!candidates.length) return null;

  // Choose the largest by area as a heuristic
  let best = null;
  let bestArea = 0;
  for (const h of candidates) {
    const box = await h.boundingBox();
    if (box) {
      const area = box.width * box.height;
      if (area > bestArea) {
        best = h;
        bestArea = area;
      }
    }
  }
  // Dispose others
  for (const h of candidates) {
    if (h !== best) await h.dispose?.();
  }
  return best;
}

async function typeMessage(page, handle, message) {
  const tag = await handle.evaluate(el => el.tagName.toLowerCase()).catch(() => null);

  try {
    await handle.focus();
  } catch { }

  if (tag === 'textarea' || tag === 'input') {
    await page.evaluate(el => { el.value = ''; }, handle).catch(() => { });
    await handle.type(message, { delay: 10 });
    return true;
  }

  // contenteditable or others
  const contentEditable = await page.evaluate(el => el.getAttribute('contenteditable'), handle).catch(() => null);
  if (contentEditable !== null) {
    await page.evaluate((el, text) => {
      el.innerHTML = '';
      el.focus();
    }, handle, message).catch(() => { });
    // Type the message
    try {
      await page.keyboard.type(message, { delay: 10 });
    } catch { }
    return true;
  }

  // Generic fallback: click and type
  try {
    await handle.click({ clickCount: 1, delay: 50 });
  } catch { }
  await page.keyboard.type(message, { delay: 10 });
  return true;
}

async function clickButtonByText(page, textCandidates) {
  // Try CSS selector for common button tags and filter by innerText
  const cssCandidates = ['button', '[role="button"]', 'div[role="button"]', 'a[role="button"]', 'input[type="button"]', 'input[type="submit"]'];
  for (const sel of cssCandidates) {
    const elems = await page.$$(sel);
    for (const el of elems) {
      const txt = await page.evaluate(e => (e.innerText || e.value || '').trim(), el).catch(() => '');
      if (textCandidates.some(t => txt.includes(t))) {
        try {
          await el.click({ delay: 20 });
          return true;
        } catch { }
      }
    }
  }

  return false;
}

async function extractValueFromText(text) {
  let raw = (text || '').trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  let jsonStr = null;
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    jsonStr = raw.slice(first, last + 1);
  }
  if (jsonStr) {
    try {
      const obj = JSON.parse(jsonStr);
      if (obj && Object.prototype.hasOwnProperty.call(obj, 'value')) {
        return { value: obj.value, raw: jsonStr };
      }
    } catch { }
  }
  let m = raw.match(/"value"\s*:\s*("?)(-?\d+(?:\.\d+)?)\1/);
  if (m) return { value: parseFloat(m[2]), raw };
  m = raw.match(/"value"\s*:\s*"?(-?\d+(?:\.\d+)?)%"?/);
  if (m) return { value: parseFloat(m[1]), raw };
  return { value: null, raw };
}

async function readJsonValueFromPage(page) {
  const selectors = ['pre', 'code', 'div[class*="code"]', 'div[class*="json"]', 'div[role="textbox"]', 'div[data-language]'];
  for (const sel of selectors) {
    const elems = await page.$$(sel);
    for (const el of elems) {
      const text = await page.evaluate(e => (e.innerText || e.textContent || '').trim(), el).catch(() => '');
      const res = extractValueFromText(text);
      if (res.value !== null && res.value !== undefined) {
        try { await el.dispose?.(); } catch { }
        return res;
      }
    }
  }
  // Fallback: scan whole page text for a JSON block containing "value"
  try {
    const whole = await page.evaluate(() => (document.body && (document.body.innerText || document.body.textContent) || '').trim());
    const resWhole = extractValueFromText(whole || '');
    if (resWhole.value !== null && resWhole.value !== undefined) {
      return resWhole;
    }
  } catch { }
  return { value: null, raw: null };
}

async function readValueFromTokenStream(page) {
  return await page.evaluate(() => {
    const tokens = Array.from(document.querySelectorAll('.token'));
    const norm = (s) => (s || '').trim().replace(/^"|"$/g, '');
    const items = tokens.map(el => ({
      el,
      text: (el.textContent || '').trim(),
      cls: el.className || ''
    }));
    const idx = items.findIndex(t => norm(t.text).toLowerCase() === 'value');
    if (idx === -1) return { value: null, raw: null };
    for (let j = idx + 1; j < items.length; j++) {
      const txt = norm(items[j].text);
      if (!txt) continue;
      if (txt === ':' || txt === ',' || txt === '{' || txt === '}' || txt === '[' || txt === ']') continue;
      const m = txt.match(/-?\d+(?:\.\d+)?/);
      if (m) {
        const v = parseFloat(m[0]);
        return { value: v, raw: txt };
      }
    }
    return { value: null, raw: null };
  });
}

async function run() {
  // Initialize log.json (truncate) at start of run
  resetLogFile();
  logStep({ event: 'start' });

  const csvPath = path.resolve(__dirname, 'qianwen.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('qianwen.csv not found in directory.');
    logStep({ event: 'error', message: 'qianwen.csv not found in directory.' });
    process.exit(1);
  }

  const csvText = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsvThreeColumns(csvText);
  if (!rows.length) {
    console.error('No actionable rows found in qianwen.csv.');
    logStep({ event: 'error', message: 'No actionable rows found in qianwen.csv.' });
    process.exit(1);
  }

  // CSV parsed
  logStep({ event: 'csv_parsed', rows: rows.length });

  // Open DevTools automatically if CSV mentions chrome-devtools
  const needDevtools = rows.some(r => /chrome-?devtools/i.test(r.Action || ''));

  const browser = await puppeteer.launch({
    headless: false, // so you can see the actions
    devtools: needDevtools,
    defaultViewport: { width: 1280, height: 800 },
    args: needDevtools
      ? [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--auto-open-devtools-for-tabs'
      ]
      : [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ],
    // If you want to use an existing Chrome, set PUPPETEER_EXECUTABLE_PATH env var before running
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || detectBrowserPath()
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // Graceful shutdown on Ctrl+C or termination
  const cleanup = async () => {
    try { await page.close(); } catch { }
    try { await browser.close(); } catch { }
  };
  process.once('SIGINT', () => { cleanup().finally(() => process.exit(130)); });
  process.once('SIGTERM', () => { cleanup().finally(() => process.exit(143)); });

  try {
    for (const [i, row] of rows.entries()) {
      const action = row.Action || '';
      const data = row.Data || '';
      const expected = row.Expected || '';

      const lower = action.toLowerCase();

      if (/(chrome|devtools|浏览器|打开)/i.test(action) || /https?:\/\//i.test(action)) {
        // Open URL: prefer Data column, otherwise extract from Action
        const url = data || extractUrl(action);
        if (!url) {
          console.warn(`[Row ${i + 2}] No URL found to open.`);
          logStep({ row: i + 2, step: 'navigate', url: null, status: 'no_url' });
          continue;
        }
        console.log(`[Row ${i + 2}] Navigating to: ${url}`);
        logStep({ row: i + 2, step: 'navigate', url });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(async (e) => {
          console.warn(`Navigation warning: ${e.message}`);
          logStep({ row: i + 2, step: 'navigate_warning', url, message: e && e.message ? e.message : String(e) });
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
        });
        // Give page time to settle dynamic content
        await new Promise(r => setTimeout(r, 2000));
        logStep({ row: i + 2, step: 'navigate_done', url, status: 'ok' });
        continue;
      }

      if (/^输入/.test(action)) {
        // Extract message either from Data col or from text after "输入"
        const message = data || extractAfterKeyword(action, '输入') || extractAfterKeyword(action, '输入:') || extractAfterKeyword(action, '输入：');
        if (!message) {
          console.warn(`[Row ${i + 2}] No input message found.`);
          continue;
        }
        console.log(`[Row ${i + 2}] Typing message (${message.length} chars)...`);
        logStep({ row: i + 2, step: 'input', messageLength: message.length });
        const inputHandle = await findChatInput(page);
        if (!inputHandle) {
          console.warn(`[Row ${i + 2}] No chat input box detected.`);
          logStep({ row: i + 2, step: 'input', status: 'no_input_box' });
          continue;
        }
        await typeMessage(page, inputHandle, message);
        try { await inputHandle.dispose?.(); } catch { }
        logStep({ row: i + 2, step: 'input_done', messageLength: message.length });
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      if (/^点击/.test(action) || /click/i.test(action)) {
        const label = (data || extractAfterKeyword(action, '点击') || extractAfterKeyword(action, '点击:') || extractAfterKeyword(action, '点击：') || '').trim();
        const textCandidates = [];
        if (label) textCandidates.push(label);
        // Known common labels
        for (const t of ['Send Chat', '发送', 'Send', 'Submit', '发送消息', 'Send Message']) {
          if (!textCandidates.includes(t)) textCandidates.push(t);
        }

        console.log(`[Row ${i + 2}] Clicking button (candidates: ${textCandidates.join(' | ')})...`);
        logStep({ row: i + 2, step: 'click', candidates: textCandidates });
        let clicked = await clickButtonByText(page, textCandidates);
        logStep({ row: i + 2, step: 'click_result', clicked });
        if (!clicked) {
          // Fallback: try pressing Enter in focused input (common in chat UIs)
          console.warn(`[Row ${i + 2}] Button not found, trying Enter key fallback...`);
          logStep({ row: i + 2, step: 'click_fallback', method: 'Enter' });
          await page.keyboard.press('Enter').catch(() => { });
        }
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }

      if (/^(?:回车)$/i.test(action) || /(?:enter|回车)/i.test(action)) {
        console.log(`[Row ${i + 2}] Pressing Enter...`);
        logStep({ row: i + 2, step: 'press_enter' });
        try { await page.keyboard.press('Enter'); } catch { }
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      if (/^读取/.test(action)) {
        if (/class=['"]token['"]/.test(action)) {
          console.log(`[Row ${i + 2}] Reading next .token after "value"...`);
          let res = null;
          for (let t = 0; t < 20; t++) {
            res = await readValueFromTokenStream(page);
            if (res && res.value !== null && res.value !== undefined) break;
            await new Promise(r => setTimeout(r, 1000));
          }
          if (res && res.value !== null && res.value !== undefined) {
            console.log(`[Row ${i + 2}] Extracted value: ${res.value}`);
            const expectedTrim = (expected || '').toString().trim();
            logStep({ row: i + 2, step: 'read_token_value', value: res.value, expected: expectedTrim || null });
            const expectedNum = parseFloat((expectedTrim || '').replace('%', ''));
            if (!Number.isNaN(expectedNum)) {
              const diff = Math.abs(parseFloat(res.value) - expectedNum);
              logStep({ row: i + 2, step: 'compare', expected: expectedTrim, diff, match: diff <= 0.1 });
              if (diff <= 0.1) {
                console.log(`[Row ${i + 2}] Value matches expected (${expected}).`);
              } else {
                console.warn(`[Row ${i + 2}] Value ${res.value} differs from expected ${expected}.`);
              }
            }
          } else {
            console.warn(`[Row ${i + 2}] Could not find the next .token value after "value".`);
            logStep({ row: i + 2, step: 'read_token_value', status: 'not_found' });
          }
          await new Promise(r => setTimeout(r, 500));
          continue;
        } else {
          console.log(`[Row ${i + 2}] Reading JSON 'value' from page...`);
          // Wait/poll up to ~20s for the response to render
          let res = null;
          for (let t = 0; t < 20; t++) {
            res = await readJsonValueFromPage(page);
            if (res && res.value !== null && res.value !== undefined) break;
            await new Promise(r => setTimeout(r, 1000));
          }
          if (res && res.value !== null && res.value !== undefined) {
            console.log(`[Row ${i + 2}] Extracted value: ${res.value}`);
            const expectedTrim = (expected || '').toString().trim();
            logStep({ row: i + 2, step: 'read_json_value', value: res.value, expected: expectedTrim || null });
            const expectedNum = parseFloat((expectedTrim || '').replace('%', ''));
            if (!Number.isNaN(expectedNum)) {
              const diff = Math.abs(parseFloat(res.value) - expectedNum);
              logStep({ row: i + 2, step: 'compare', expected: expectedTrim, diff, match: diff <= 0.1 });
              if (diff <= 0.1) {
                console.log(`[Row ${i + 2}] Value expected (${expected}).`);
              } else {
                console.warn(`[Row ${i + 2}] Value ${res.value} differs from expected ${expected}.`);
              }
            }
          } else {
            console.warn(`[Row ${i + 2}] Could not find a JSON block with a 'value' key after waiting.`);
            logStep({ row: i + 2, step: 'read_json_value', status: 'not_found' });
          }
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
      }

      // Unknown action fallback
      console.warn(`[Row ${i + 2}] Unrecognized action: ${action}`);
      logStep({ row: i + 2, step: 'unrecognized', action });
    }

    console.log('Automation sequence complete.');
    logStep({ event: 'complete' });
  } catch (err) {
    console.error('Automation error:', err);
    logStep({ event: 'error', message: (err && err.message) ? err.message : String(err) });
  } finally {
    if (!KEEP_OPEN) {
      try { await page.close(); } catch { }
      try { await browser.close(); } catch { }
    } else {
      console.log('KEEP_OPEN enabled: leaving the browser open. Use Ctrl+C to exit and we will close the browser.');
    }
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});