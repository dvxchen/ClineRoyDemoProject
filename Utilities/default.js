/**
 * Daily Node runner for CSV UI tests using Puppeteer.
 * - Scans current directory for all *.csv files
 * - Parses each CSV with columns: Action, Data, Expected Result
 * - Executes simple flows:
 *    - "open Base Url" => opens baseUrl and verifies page loaded
 *    - "open <url>" / "打开 <url>" / "用chrome-devtools打开 <url>" => opens the specified URL (verifies optional "text appears: <text>")
 *    - "input <text>" / "输入：<文本>" => types Data into a search/text input (including [role=textbox]) and verifies displayed value
 *    - "click <text or css:selector>" / "点击 <文本或 css:选择器>" => clicks a button/link by visible text or via a CSS selector
 *    - "wait for <text>" / "等待 文本出现：<文本>" / "等待 <N> 秒" => waits until the given text appears in page OR sleeps for N seconds
 *    - "read ..." / "读取第N个黑框里的数据" => extracts text from the N-th visible dark-background block (for Joule RESULT 等)
 * - Saves per-file JSON reports under ./reports/YYYY-MM-DD/<csvname>.json
 *
 * Usage:
 *   node run-tests.js --baseUrl=http://your-app:3000 [--reports=./reports] [--headless=true]
 *
 * Notes:
 * - baseUrl is REQUIRED
 * - Designed for Windows Task Scheduler daily runs
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const puppeteer = require('puppeteer');

function parseArgs(argv) {
  const args = {};
  for (const part of argv.slice(2)) {
    if (part.startsWith('--')) {
      const idx = part.indexOf('=');
      if (idx !== -1) {
        const key = part.slice(2, idx);
        const value = part.slice(idx + 1);
        args[key] = value;
      } else {
        const key = part.slice(2);
        args[key] = 'true';
      }
    }
  }
  return args;
}

function toBool(v, def = true) {
  if (v === undefined) return def;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y';
}

function ymd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

/**
 * Minimal CSV parser supporting quoted fields with commas and quotes.
 * Returns an array of rows, each row is an array of fields.
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r') {
        // ignore, handle on \n
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }
  // Flush last field/row
  if (inQuotes) {
    // Unclosed quotes — push as is
    inQuotes = false;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  const objects = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = r[c] !== undefined ? r[c] : '';
    }
    objects.push(obj);
  }
  return objects;
}

async function findInput(page) {
  const selectors = [
    'input[type="search"]',
    'input[role="searchbox"]',
    'input[type="text"]',
    'input:not([type])',
    'textarea',
    '[contenteditable="true"]',
    '[role="textbox"]'
  ];
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) return el;
  }
  return null;
}

async function findInputByLabel(page, keywords = [], typeHint) {
  const handle = await page.evaluateHandle((keywords, typeHint) => {
    const norm = s => (s || '').toLowerCase().trim();
    const needles = (keywords || []).map(k => norm(k)).filter(Boolean);
    const matchesNeedle = (text) => {
      const n = norm(text);
      return n && needles.some(k => n.includes(k));
    };
    const isVisible = (e) => {
      if (!e) return false;
      const cs = window.getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const inputs = Array.from(document.querySelectorAll('input,textarea')).filter(isVisible);
    let best = null;
    let bestScore = -1;
    for (const el of inputs) {
      let score = 0;
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (typeHint && type === String(typeHint).toLowerCase()) score += 4;

      // label[for] association
      const id = el.getAttribute('id');
      if (id) {
        try {
          const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (label && matchesNeedle(label.innerText || label.textContent)) score += 5;
        } catch (_) {}
      }

      // placeholder/title/aria-label/name
      const attrs = [
        el.getAttribute('placeholder'),
        el.getAttribute('title'),
        el.getAttribute('aria-label'),
        el.getAttribute('name')
      ];
      if (attrs.some(a => matchesNeedle(a))) score += 3;

      // preceding label sibling
      const prev = el.previousElementSibling;
      if (prev && prev.tagName && prev.tagName.toLowerCase() === 'label' && matchesNeedle(prev.innerText || prev.textContent)) score += 3;

      // nearby container text (within few ancestors)
      let anc = el.parentElement;
      let hops = 0;
      while (anc && hops < 3) {
        const t = anc.innerText || anc.textContent || '';
        if (matchesNeedle(t)) { score += 1; break; }
        anc = anc.parentElement;
        hops++;
      }

      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best || null;
  }, keywords, typeHint);
  const el = handle && handle.asElement ? handle.asElement() : null;
  return el;
}

async function runStep(page, stepIndex, action, data, expectedResult, reportDir, baseUrl) {
  const result = {
    index: stepIndex,
    action,
    data,
    expectedResult,
    status: 'pending',
    details: ''
  };

  try {
    const actionLower = action.trim().toLowerCase();

    if (actionLower.startsWith('open base url')) {
      // Navigate to baseUrl
      const nav = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // Verify page readyState
      const readyState = await page.evaluate(() => document.readyState);
      const pageOpen = readyState === 'complete' || readyState === 'interactive';

      result.status = pageOpen ? 'passed' : 'failed';
      result.details = `readyState=${readyState}`;
      if (!pageOpen) {
        const shot = path.join(reportDir, `step${stepIndex}-open-fail.png`);
        await page.screenshot({ path: shot, fullPage: true });
        result.screenshot = shot;
      }
      return result;
    }
 
    // Open arbitrary URL (supports English and Chinese patterns)
    if (actionLower.startsWith('open ') || /^(?:打开|用chrome-?devtools打开)\s*/i.test(action.trim())) {
      let url = '';
      const actTrim = action.trim();
      const m1 = /^open\s+(.+)$/i.exec(actTrim);
      const m2 = /^(?:打开|用chrome-?devtools打开)\s*(.+)$/i.exec(actTrim);
      if (m1 && m1[1]) url = m1[1].trim();
      else if (m2 && m2[1]) url = m2[1].trim();
      // Fallback: support no-space pattern like "用chrome-devtools打开http://..."
      if (!url) {
        const m3 = /(https?:\/\/\S+)/i.exec(actTrim);
        if (m3 && m3[1]) url = m3[1].trim();
      }
      if (!url && data) url = String(data).trim();
      // If action token after "open" isn't an absolute URL but Data provides one, prefer Data
      if (url && !/^https?:\/\//i.test(url) && data) {
        const d = String(data).trim();
        if (/^https?:\/\//i.test(d)) {
          url = d;
        }
      }
      if (!url) {
        result.status = 'failed';
        result.details = 'No URL provided for open action';
        const shot = path.join(reportDir, `step${stepIndex}-open-url-missing.png`);
        try { await page.screenshot({ path: shot, fullPage: true }); result.screenshot = shot; } catch (_) {}
        return result;
      }
      if (!/^https?:\/\//i.test(url) && baseUrl) {
        try { url = new URL(url, baseUrl).toString(); } catch (_) {}
      }
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        // Optional verification after open: "text appears: ..."`
        if (expectedResult) {
          const idx = expectedResult.toLowerCase().indexOf('text appears:');
          if (idx !== -1) {
            let expectText = expectedResult.slice(idx + 'text appears:'.length).trim();
            if ((expectText.startsWith('"') && expectText.endsWith('"')) || (expectText.startsWith("'") && expectText.endsWith("'"))) {
              expectText = expectText.slice(1, -1);
            }
            await page.waitForFunction((t) => {
              const bodyText = document.body ? (document.body.innerText || document.body.textContent) : '';
              return bodyText && bodyText.indexOf(t) !== -1;
            }, { timeout: 10000 }, expectText);
            result.details = `Opened URL and verified text appears: "${expectText}"`;
          } else {
            result.details = 'Opened URL';
          }
        } else {
          result.details = 'Opened URL';
        }
        result.status = 'passed';
      } catch (e) {
        result.status = 'failed';
        result.details = `Failed to open URL "${url}": ${e.message}`;
        try {
          const shot = path.join(reportDir, `step${stepIndex}-open-url-fail.png`);
          await page.screenshot({ path: shot, fullPage: true });
          result.screenshot = shot;
        } catch (_) {}
      }
      return result;
    }
 
    // New: explicit email/password input handling, e.g. "输入email: xxx" or "输入password: yyy"
    if (/输入/.test(action) && /(email|e-mail|邮箱|电子邮件)/i.test(action)) {
      const actTrim2 = action.trim();
      const getVal = () => {
        if (data && data.length) return data;
        const mQ = /[“"](.*?)[”"]/.exec(actTrim2) || /'(.*?)'/.exec(actTrim2);
        if (mQ && mQ[1]) return mQ[1].trim();
        const m = /[:：]\s*(.+)$/.exec(actTrim2);
        return m && m[1] ? m[1].trim() : '';
      };
      const inputText = getVal();
      const inputEl = await findInputByLabel(page, ['email', 'e-mail', '邮箱', '电子邮件'], 'email') || await findInput(page);
      if (!inputEl) {
        result.status = 'failed';
        result.details = 'No email input found';
        const shot = path.join(reportDir, `step${stepIndex}-no-email-input.png`);
        try { await page.screenshot({ path: shot, fullPage: true }); result.screenshot = shot; } catch (_) {}
        return result;
      }
      await inputEl.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      if (inputText) await inputEl.type(inputText, { delay: 20 });

      const currentValue = await page.evaluate(el => (el.value !== undefined ? el.value : (el.innerText || el.textContent) || ''), inputEl);
      result.status = String(currentValue) === String(inputText) ? 'passed' : 'failed';
      result.details = `typed email, currentValue="${currentValue}" expected="${inputText}"`;
      if (result.status !== 'passed') {
        const shot = path.join(reportDir, `step${stepIndex}-email-input-fail.png`);
        try { await page.screenshot({ path: shot, fullPage: true }); result.screenshot = shot; } catch (_) {}
      }
      return result;
    }

    if (/输入/.test(action) && /(password|密码)/i.test(action)) {
      const actTrim2 = action.trim();
      const getVal = () => {
        if (data && data.length) return data;
        const mQ = /[“"](.*?)[”"]/.exec(actTrim2) || /'(.*?)'/.exec(actTrim2);
        if (mQ && mQ[1]) return mQ[1].trim();
        const m = /[:：]\s*(.+)$/.exec(actTrim2);
        return m && m[1] ? m[1].trim() : '';
      };
      const inputText = getVal();
      const inputEl = await findInputByLabel(page, ['password', '密码'], 'password') || await findInput(page);
      if (!inputEl) {
        result.status = 'failed';
        result.details = 'No password input found';
        const shot = path.join(reportDir, `step${stepIndex}-no-password-input.png`);
        try { await page.screenshot({ path: shot, fullPage: true }); result.screenshot = shot; } catch (_) {}
        return result;
      }
      await inputEl.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      if (inputText) await inputEl.type(inputText, { delay: 10 });

      const currentValue = await page.evaluate(el => (el.value !== undefined ? el.value : (el.innerText || el.textContent) || ''), inputEl);
      // For password fields, value is available but masked visually; still compare
      result.status = String(currentValue) === String(inputText) ? 'passed' : 'failed';
      result.details = `typed password (masked), length=${(currentValue || '').length}`;
      if (result.status !== 'passed') {
        const shot = path.join(reportDir, `step${stepIndex}-password-input-fail.png`);
        try { await page.screenshot({ path: shot, fullPage: true }); result.screenshot = shot; } catch (_) {}
      }
      return result;
    }

    if (actionLower.startsWith('input') || /输入/.test(action)) {
      // Find a search/text input and type the provided data
      const inputEl = await findInput(page);
      if (!inputEl) {
        result.status = 'failed';
        result.details = 'No input element found';
        const shot = path.join(reportDir, `step${stepIndex}-no-input.png`);
        await page.screenshot({ path: shot, fullPage: true });
        result.screenshot = shot;
        return result;
      }

      // Clear then type
      await inputEl.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      const actTrim2 = action.trim();
      let inputText = data && data.length ? data : '';
      if (!inputText) {
        // Prefer quoted text anywhere in the action (supports Chinese quotes)
        const mQ = /[“"](.*?)[”"]/.exec(actTrim2);
        if (mQ && mQ[1]) {
          inputText = mQ[1].trim();
        } else {
          // Fallback: take text after the last occurrence of "输入"
          const idxInput = actTrim2.lastIndexOf('输入');
          if (idxInput !== -1) {
            inputText = actTrim2.slice(idxInput + '输入'.length).replace(/^\s*[:：]?\s*/, '').trim();
          }
        }
      }
      if (inputText && inputText.length) {
        await inputEl.type(inputText, { delay: 20 });
      }

      // Determine expected value
      let expectedValue = inputText || data || '';
      if (expectedResult) {
        const idx = expectedResult.toLowerCase().indexOf('search box shows:');
        if (idx !== -1) {
          expectedValue = expectedResult.slice(idx + 'search box shows:'.length).trim();
          // Trim surrounding quotes if present
          if ((expectedValue.startsWith('"') && expectedValue.endsWith('"')) || (expectedValue.startsWith("'") && expectedValue.endsWith("'"))) {
            expectedValue = expectedValue.slice(1, -1);
          }
        }
      }

      // Read current value (support contenteditable)
      const currentValue = await page.evaluate(el => (el.value !== undefined ? el.value : (el.innerText || el.textContent) || ''), inputEl);

      let pass = String(currentValue) === String(expectedValue);
      result.status = pass ? 'passed' : 'failed';
      result.details = `currentValue="${currentValue}" expected="${expectedValue}"`;

      if (!pass) {
        const shot = path.join(reportDir, `step${stepIndex}-input-fail.png`);
        await page.screenshot({ path: shot, fullPage: true });
        result.screenshot = shot;
      }

      // Additional: for Google-like searches, support natural language expected
      // pattern: Search results for "<q>" are displayed
      if (expectedResult) {
        const mSearch = /search\s*results\s*for\s*[:：]?\s*["']?(.+?)["']?\s*are\s*displayed/i.exec(expectedResult);
        if (mSearch) {
          const query = (mSearch[1] && mSearch[1].trim()) || (inputText || data || '');
          try {
            // Trigger the search by pressing Enter
            await page.keyboard.press('Enter');
            // Wait for navigation or results container
            try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }); } catch (_) {}
            try { await page.waitForSelector('#search, #rso', { timeout: 15000 }); } catch (_) {}
            // Verify the query appears on the results page
            await page.waitForFunction((t) => {
              const bodyText = document.body ? (document.body.innerText || document.body.textContent) : '';
              return bodyText && bodyText.toLowerCase().includes(String(t).toLowerCase());
            }, { timeout: 20000 }, query);

            result.status = 'passed';
            result.details = `Search results page displayed for "${query}"`;
            pass = true;
          } catch (e) {
            result.status = 'failed';
            result.details = `Expected search results for "${query}" not displayed: ${e.message}`;
            try {
              const shot2 = path.join(reportDir, `step${stepIndex}-search-results-fail.png`);
              await page.screenshot({ path: shot2, fullPage: true });
              result.screenshot = result.screenshot || shot2;
            } catch (_) {}
          }
        }
      }
      return result;
    }
 
     if (/^(?:click|点击|單擊|单击)/i.test(action.trim())) {
       // Click a target by visible text or CSS selector
       let target = action.replace(/^(?:click|点击|單擊|单击)\s*[:：]?\s*/i, '').trim();
       if (!target && data) target = String(data).trim();
       result.details = '';
       try {
         if (!target) {
           result.status = 'failed';
           result.details = 'No click target provided (use "click <text>" or Data with css:selector or text)';
           const shot = path.join(reportDir, `step${stepIndex}-click-missing-target.png`);
           await page.screenshot({ path: shot, fullPage: true });
           result.screenshot = shot;
           return result;
         }
 
         // CSS selector mode: css: or selector:
         const cssMatch = /^(\s*(css|selector)\s*:\s*)(.+)$/i.exec(target);
         if (cssMatch) {
           const selector = cssMatch[3].trim();
           const el = await page.$(selector);
           if (!el) {
             result.status = 'failed';
             result.details = `No element found for selector "${selector}"`;
             const shot = path.join(reportDir, `step${stepIndex}-click-not-found.png`);
             await page.screenshot({ path: shot, fullPage: true });
             result.screenshot = shot;
             return result;
           }
           await el.click();
           result.status = 'passed';
        } else {
          // Text mode: robust search by visible text/value/aria-label/title; tolerate trailing words like "button"/"link"
          const targetNorm = (() => {
            let t = (target || '').trim();
            t = t.replace(/\b(button|link)\b\s*$/i, '').replace(/(按钮|链接|图标|图示)\s*$/i, '').trim();
            if (t.toLowerCase().startsWith('text:')) t = t.slice(5).trim();
            return t || target;
          })();

          // Build candidate needles with simple synonyms to support new actions in Joule.csv
          const candidateNeedles = [targetNorm];
          // 点击发送 -> try English/Chinese variants commonly used as aria-label/title/text
          if (/发送/.test(target)) {
            candidateNeedles.push('send', 'send message', '发送', '发送消息', 'paper-plane', 'paper plane', 'paperplane');
          }
          // 点击Expand/Collapse -> try split variants and CN equivalents
          if (/expand\s*\/\s*collapse/i.test(targetNorm) || /(展开|收起)/.test(target)) {
            candidateNeedles.push('expand / collapse', 'expand', 'collapse', '展开', '收起');
          }
          // Add a stopword-less variant to increase fuzzy match success
          try {
            const tokens = targetNorm
              .replace(/[^\p{L}\p{N}]+/gu, ' ')
              .split(' ')
              .map(s => s.trim())
              .filter(Boolean);
            const stop = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'about', 'on', 'in', 'at', 'for', '图标', '按钮', '链接', '图示']);
            const filtered = tokens.filter(w => !stop.has(w));
            const compact = filtered.join(' ').trim();
            if (compact && compact !== targetNorm && !candidateNeedles.includes(compact)) {
              candidateNeedles.push(compact);
            }
          } catch (_) {}

          // Allow DOM to settle
          try { await page.waitForSelector('body', { timeout: 3000 }); } catch (_) {}

          // Try each candidate until one is clickable
          let clicked = false;
          for (const needle of candidateNeedles) {
            try {
              // Wait briefly for the candidate text to appear if it's dynamic
              try {
                await page.waitForFunction((t) => {
                  const norm = (s) => (s || '')
                    .toLowerCase()
                    .replace(/[\/\\|]+/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                  const n = norm(t);
                  const words = n.split(' ').filter(Boolean);
                  const bodyText = document.body ? (document.body.innerText || document.body.textContent) : '';
                  const b = norm(bodyText);
                  return words.length ? words.every(w => b.includes(w)) : b.includes(n);
                }, { timeout: 8000 }, needle);
              } catch (_) {}

              // Search across all frames for a clickable element
              let el = null;
              const frames = page.frames();
              for (const frame of frames) {
                try {
                  const handle = await frame.evaluateHandle((needle) => {
                    const norm = (s) => (s || '')
                      .toLowerCase()
                      .replace(/[\/\\|]+/g, ' ')
                      .replace(/\s+/g, ' ')
                      .trim();
                    const n = norm(needle);
                    const nWords = n.split(' ').filter(Boolean);

                    const isVisible = (e) => {
                      const style = window.getComputedStyle(e);
                      if (style.visibility === 'hidden' || style.display === 'none') return false;
                      const rect = e.getBoundingClientRect();
                      return rect.width > 0 && rect.height > 0;
                    };

                    const isClickableTag = (e) => {
                      if (!e || e.nodeType !== 1) return false;
                      const tag = e.tagName.toLowerCase();
                      if (tag === 'button' || tag === 'a') return true;
                      if (tag === 'input') {
                        const type = (e.getAttribute('type') || '').toLowerCase();
                        return type === 'button' || type === 'submit' || type === 'reset';
                      }
                      if ((e.getAttribute('role') || '').toLowerCase() === 'button') return true;
                      if (typeof e.onclick === 'function') return true;
                      const cs = window.getComputedStyle(e);
                      if (cs.pointerEvents !== 'none' && cs.cursor === 'pointer') return true;
                      return false;
                    };

                    const getTextFields = (e) => {
                      const t = norm(e.innerText || e.textContent).toLowerCase();
                      const v = norm(e.value).toLowerCase();
                      const aria = norm(e.getAttribute('aria-label')).toLowerCase();
                      const title = norm(e.getAttribute('title')).toLowerCase();
                      const alt = norm(e.getAttribute('alt')).toLowerCase();
                      // aria-labelledby -> resolve referenced element text
                      const labelledby = (e.getAttribute('aria-labelledby') || '').trim();
                      let labelledText = '';
                      if (labelledby) {
                        labelledText = labelledby
                          .split(/\s+/)
                          .map(id => {
                            const n = document.getElementById(id);
                            return n ? norm(n.textContent).toLowerCase() : '';
                          })
                          .filter(Boolean)
                          .join(' ');
                      }
                      // data-tooltip (common custom tooltip attr)
                      const tooltip = norm(e.getAttribute('data-tooltip')).toLowerCase();
                      // Include common icon label sources like <svg><title> and nested title text
                      const svgTitles = Array.from(e.querySelectorAll('svg title')).map(n => norm(n.textContent).toLowerCase()).filter(Boolean);
                      // Closest ancestor labels (button wrapper)
                      const anc = e.closest('[aria-label],[title]');
                      const ancAria = anc && anc !== e ? norm(anc.getAttribute('aria-label')).toLowerCase() : '';
                      const ancTitle = anc && anc !== e ? norm(anc.getAttribute('title')).toLowerCase() : '';
                      return [t, v, aria, title, alt, labelledText, tooltip, ancAria, ancTitle, ...svgTitles].filter(Boolean);
                    };

                    const scoreFor = (e) => {
                      const fields = getTextFields(e);
                      if (!fields.length) return 0;
                      // exact match
                      if (fields.some(f => f === n)) return 4;
                      // contains either way
                      if (fields.some(f => f.includes(n) || n.includes(f))) return 3;
                      // all words present
                      if (nWords.length && fields.some(f => nWords.every(w => f.includes(w)))) return 2;
                      return 0;
                    };

                    // Search all visible elements deeply (pierce shadow DOM); prefer clickable ancestors
                    const all = (() => {
                      const out = [];
                      const pushDeep = (root) => {
                        if (!root) return;
                        const nodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
                        for (const el of nodes) {
                          out.push(el);
                          if (el.shadowRoot) {
                            pushDeep(el.shadowRoot);
                          }
                        }
                      };
                      pushDeep(document);
                      return out.filter(isVisible);
                    })();
                    let best = null;
                    let bestScore = 0;
                    for (const e of all) {
                      const s = scoreFor(e);
                      if (s > bestScore) {
                        let c = e;
                        while (c && !isClickableTag(c) && c !== document.body) c = c.parentElement;
                        const candidate = c && isClickableTag(c) ? c : (s >= 3 ? e : null);
                        if (candidate) {
                          best = candidate;
                          bestScore = s;
                          if (s === 4 && isClickableTag(best)) break;
                        }
                      }
                    }
                    return best || null;
                  }, needle);
                  const candidate = handle && handle.asElement ? handle.asElement() : null;
                  if (candidate) {
                    el = candidate;
                    break;
                  }
                } catch (__) {
                  // ignore frame errors and continue
                }
              }

              if (el) {
                try { await el.evaluate(e => { try { e.scrollIntoView({ block: 'center', inline: 'center' }); } catch(_){} }); } catch (_){}
                await el.click();
                result.status = 'passed';
                result.details = `Clicked by text match: "${needle}"`;
                clicked = true;
                break;
              }
            } catch (__) {
              // Try next candidate
            }
          }

          if (!clicked) {
            // Special fallback for "发送"/Send buttons that are icon-only (e.g., aria-label/title = "paper-plane")
            if (/发送/.test(target) || /send/i.test(targetNorm)) {
              try {
                const handle = await page.evaluateHandle(() => {
                  const isVisible = (e) => {
                    if (!e) return false;
                    const cs = getComputedStyle(e);
                    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
                    const r = e.getBoundingClientRect();
                    return r.width > 0 && r.height > 0;
                  };
                  const all = Array.from(document.querySelectorAll('button,[role="button"],[aria-label],[title]')).filter(isVisible);
                  const score = (e) => {
                    const name = ((e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || e.textContent) || '').toLowerCase().trim();
                    let s = 0;
                    if (!name) return 0;
                    if (name.includes('paper-plane')) s += 3;
                    if (name.includes('send')) s += 2;
                    if (name.includes('发送')) s += 2;
                    return s;
                  };
                  const ranked = all
                    .map(e => ({ e, s: score(e) }))
                    .filter(x => x.s > 0)
                    .sort((a, b) => b.s - a.s);
                  // Prefer buttons near the Joule input area
                  const input = Array.from(document.querySelectorAll('textarea,[role="textbox"],input'))
                    .find(el => /message\s+joule/i.test((el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.innerText || el.textContent || '')));
                  if (input) {
                    const near = ranked.find(x => x.e.closest('contentinfo') || (input.parentElement && x.e.parentElement === input.parentElement));
                    if (near) return near.e;
                  }
                  return ranked.length ? ranked[0].e : null;
                });
                const el = handle && handle.asElement ? handle.asElement() : null;
                if (el) {
                  try { await el.evaluate(e => { try { e.scrollIntoView({ block: 'center', inline: 'center' }); } catch(_){} }); } catch (_){}
                  await el.click();
                  result.status = 'passed';
                  result.details = 'Clicked via fallback (send/paper-plane)';
                  clicked = true;
                }
              } catch (_) {}
            }

            if (!clicked) {
              result.status = 'failed';
              result.details = `No clickable element found with candidates for "${target}"`;
              const shot = path.join(reportDir, `step${stepIndex}-click-not-found.png`);
              await page.screenshot({ path: shot, fullPage: true });
              result.screenshot = shot;
              return result;
            }
          }
        }
 
         // Optional expected verification: "text appears: ..."
         if (expectedResult) {
           const idx = expectedResult.toLowerCase().indexOf('text appears:');
           if (idx !== -1) {
             let expectText = expectedResult.slice(idx + 'text appears:'.length).trim();
             if ((expectText.startsWith('"') && expectText.endsWith('"')) || (expectText.startsWith("'") && expectText.endsWith("'"))) {
               expectText = expectText.slice(1, -1);
             }
             try {
               await page.waitForFunction((t) => {
                 const bodyText = document.body ? (document.body.innerText || document.body.textContent) : '';
                 return bodyText && bodyText.indexOf(t) !== -1;
               }, { timeout: 5000 }, expectText);
               result.details = `Verified text appears: "${expectText}"`;
             } catch (e) {
               result.status = 'failed';
               result.details = `After click, expected text not found: "${expectText}"`;
               const shot = path.join(reportDir, `step${stepIndex}-click-verify-fail.png`);
               await page.screenshot({ path: shot, fullPage: true });
               result.screenshot = shot;
             }
           }
         }
         return result;
       } catch (e) {
         result.status = 'failed';
         result.details = `Exception during click: ${e.message}`;
         try {
           const shot = path.join(reportDir, `step${stepIndex}-click-exception.png`);
           await page.screenshot({ path: shot, fullPage: true });
           result.screenshot = shot;
         } catch (_) {}
         return result;
       }
      }
  
      // Wait action: support "wait for <text>" / "等待 文本出现：<文本>" / "等待 <N> 秒"
      if (/^(?:wait)(?:\s+for)?/i.test(action.trim()) || /等待/.test(action)) {
        try {
          const actTrim = action.trim();
          // Sleep pattern: 等待 2 秒 or wait 2000 ms
          const mSecCn = /等待\s*(\d+)\s*秒/.exec(actTrim);
          const mMsEn = /wait(?:\s+for)?\s*(\d+)\s*(ms|milliseconds)?/i.exec(actTrim);
          if (mSecCn && mSecCn[1]) {
            const ms = parseInt(mSecCn[1], 10) * 1000;
            await page.waitForTimeout(ms);
            result.status = 'passed';
            result.details = `Slept for ${ms} ms`;
            return result;
          }
          if (mMsEn && mMsEn[1]) {
            const ms = parseInt(mMsEn[1], 10);
            await page.waitForTimeout(ms);
            result.status = 'passed';
            result.details = `Slept for ${ms} ms`;
            return result;
          }

          // Extract target text
          let targetText = '';
          // Prefer quoted content (supports Chinese/English quotes)
          const mQ = /[“"](.*?)[”"]/.exec(actTrim);
          if (mQ && mQ[1]) {
            targetText = mQ[1].trim();
          }
          if (!targetText) {
            // After separators like ":" "：" or keyword "出现"/"text appears:"
            const mText1 = /(?:text\s*appears|等待.*?出现)\s*[:：]\s*(.+)$/i.exec(actTrim);
            if (mText1 && mText1[1]) targetText = mText1[1].trim();
          }
          if (!targetText) {
            // Fallback: remove leading "wait..." or "等待..." and take the rest
            targetText = actTrim.replace(/^wait(?:\s+for)?\s*[:：]?/i, '')
                                .replace(/^等待/, '')
                                .replace(/^出现[:：]?/, '')
                                .trim();
          }
          // Trim surrounding quotes if still present
          if ((targetText.startsWith('"') && targetText.endsWith('"')) || (targetText.startsWith("'") && targetText.endsWith("'"))) {
            targetText = targetText.slice(1, -1);
          }

          if (!targetText) {
            result.status = 'failed';
            result.details = 'No target text provided for wait action';
            return result;
          }

          await page.waitForFunction((t) => {
            const bodyText = document.body ? (document.body.innerText || document.body.textContent) : '';
            return bodyText && bodyText.indexOf(t) !== -1;
          }, { timeout: 20000 }, targetText);

          result.status = 'passed';
          result.details = `Waited for text to appear: "${targetText}"`;
          return result;
        } catch (e) {
          result.status = 'failed';
          result.details = `Wait action failed: ${e.message}`;
          try {
            const shot = path.join(reportDir, `step${stepIndex}-wait-fail.png`);
            await page.screenshot({ path: shot, fullPage: true });
            result.screenshot = shot;
          } catch (_) {}
          return result;
        }
      }

      // Read/extract action: support "读取第N个黑框里的数据" or English "read ..."
      if (/^(?:read|读取)/i.test(actionLower) || /读取/.test(action)) {
        // Default index to 1 if not specified
        let n = 1;
        const actTrim = action.trim();
        // Extract index like "第2个" or "第二个"
        const mIdx = /第\s*([一二三四五六七八九十\d]+)\s*个/.exec(actTrim);
        const mapCN = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
        const parseCN = (s) => {
          if (!s) return NaN;
          if (/^\d+$/.test(s)) return parseInt(s, 10);
          if (s === '十') return 10;
          if (s.length === 2 && s[0] === '十') return 10 + (mapCN[s[1]] || 0);
          if (s.length === 2 && s[1] === '十') return (mapCN[s[0]] || 0) * 10;
          if (s.length === 3 && s[1] === '十') return (mapCN[s[0]] || 0) * 10 + (mapCN[s[2]] || 0);
          return mapCN[s] || NaN;
        };
        if (mIdx && mIdx[1]) {
          const v = parseCN(mIdx[1]);
          if (!Number.isNaN(v) && v > 0) n = v;
        }
        const includesBlack = /黑框/.test(actTrim);
  
        try {
          const resultObj = await page.evaluate((n, includesBlack) => {
            function isVisible(e) {
              if (!e) return false;
              const style = window.getComputedStyle(e);
              if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
              const rect = e.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }
            function parseRgb(c) {
              const m = c && c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
              if (!m) return null;
              return { r: +m[1], g: +m[2], b: +m[3] };
            }
            function luma(rgb) {
              if (!rgb) return 255;
              const { r, g, b } = rgb;
              return 0.2126 * r + 0.7152 * g + 0.0722 * b;
            }
            const all = Array.from(document.querySelectorAll('*')).filter(isVisible);
            let candidates = all.filter(e => {
              const txt = (e.innerText || e.textContent || '').trim();
              if (!txt) return false;
              if (includesBlack) {
                const cs = getComputedStyle(e);
                const bg = parseRgb(cs.backgroundColor);
                // Consider "black box" if background is dark (low luma) and not fully transparent
                if (!bg || luma(bg) > 80) return false;
              }
              return true;
            }).map(e => {
              const r = e.getBoundingClientRect();
              return { e, top: r.top, left: r.left, text: (e.innerText || e.textContent || '').trim() };
            });
  
            // Sort visually: top-to-bottom, then left-to-right
            candidates.sort((a, b) => (a.top === b.top ? a.left - b.left : a.top - b.top));
  
            // Deduplicate nested elements by selecting larger ancestor first
            const uniq = [];
            for (const c of candidates) {
              if (!uniq.some(u => c.e === u.e || c.e.contains(u.e) || u.e.contains(c.e))) {
                uniq.push(c);
              }
            }
  
            const idx = Math.max(0, Math.min(n - 1, uniq.length - 1));
            const item = uniq[idx];
            return {
              count: uniq.length,
              index: idx + 1,
              text: item ? item.text : ''
            };
          }, n, includesBlack);
  
          if (!resultObj || !resultObj.text) {
            result.status = 'failed';
            result.details = `No ${includesBlack ? 'black-box ' : ''}element found at index ${n}. Candidates=${resultObj ? resultObj.count : 0}`;
            try {
              const shot = path.join(reportDir, `step${stepIndex}-read-not-found.png`);
              await page.screenshot({ path: shot, fullPage: true });
              result.screenshot = shot;
            } catch (_) {}
            return result;
          }
  
          try {
            const out = path.join(reportDir, `step${stepIndex}-read.txt`);
            await fsp.writeFile(out, resultObj.text, 'utf8');
            result.extractedFile = out;
          } catch (_) {}
  
          result.status = 'passed';
          const text = resultObj.text;
          const preview = text.length > 200 ? `${text.slice(0, 200)}...` : text;
          result.details = `Extracted text (index ${resultObj.index}/${resultObj.count}): ${preview}`;
          return result;
        } catch (e) {
          result.status = 'failed';
          result.details = `Exception during read: ${e.message}`;
          try {
            const shot = path.join(reportDir, `step${stepIndex}-read-exception.png`);
            await page.screenshot({ path: shot, fullPage: true });
            result.screenshot = shot;
          } catch (_) {}
          return result;
        }
      }
  
      // Default/unknown action handler: no-op but mark as failed
     result.status = 'failed';
     result.details = `Unknown action "${action}" - implement handler if needed.`;
     const shot = path.join(reportDir, `step${stepIndex}-unknown.png`);
     await page.screenshot({ path: shot, fullPage: true });
     result.screenshot = shot;
     return result;

  } catch (err) {
    result.status = 'failed';
    result.details = `Exception: ${err.message}`;
    try {
      const shot = path.join(reportDir, `step${stepIndex}-exception.png`);
      await page.screenshot({ path: shot, fullPage: true });
      result.screenshot = shot;
    } catch (e) {
      // ignore
    }
    return result;
  }
}

async function runCsvFile(filePath, options) {
  const { baseUrl, reportsDir, headless } = options;

  const name = path.basename(filePath);
  const dateDir = path.join(reportsDir, ymd());
  await ensureDir(dateDir);

  const reportFile = path.join(dateDir, `${path.basename(filePath, '.csv')}.json`);
  const perFileReportDir = path.join(dateDir, path.basename(filePath, '.csv'));
  await ensureDir(perFileReportDir);

  const content = await fsp.readFile(filePath, 'utf8');
  const rows = parseCSV(content);
  const objects = rowsToObjects(rows);

  // ====================== 关键：自动创建策略文件 ======================
    const policyDir = path.join(__dirname, 'policies', 'managed');
    if (!fs.existsSync(policyDir)) fs.mkdirSync(policyDir, { recursive: true });
  
    // 强制自动选择证书：匹配所有 HTTPS，不弹窗
    const policy = {
      AutoSelectCertificateForUrls: [
        {
          "pattern": "https://*/*",
          "filter": {} // 空 = 匹配任意证书（最稳）
        }
      ]
    };
  
    fs.writeFileSync(
      path.join(policyDir, 'policy.json'),
      JSON.stringify(policy, null, 2)
    );

  // Use a unique userDataDir per run to avoid "browser already running" conflicts
  const profileBase = path.join(process.env.APPDATA, 'cline-Remote', 'puppeteer-profiles');
  await ensureDir(profileBase);
  const profileDir = path.join(profileBase, `${path.basename(filePath, '.csv')}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
  
  let chromePath;
  try {
    chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'; // 自动获取Chrome路径
  } catch (e) {
    console.log('未找到系统Chrome，使用内置Chromium');
  }

  const browser = await puppeteer.launch({
    executablePath: chromePath ,
    headless: headless ? 'new' : false,
       defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors',
      '--start-maximized'
    ],
    defaultViewport: { width: 1366, height: 768 },
       // 核心：让 Chrome 加载我们的策略目录
    userDataDir: profileDir,
  });
  const page = await browser.newPage();

  const results = [];
  let suiteStatus = 'passed';

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    const action = (obj['Action'] || '').trim();
    const data = (obj['Data'] || '').trim();
    const expectedResult = (obj['Expected Result'] || '').trim();

    const stepResult = await runStep(page, i, action, data, expectedResult, perFileReportDir, baseUrl);
    results.push(stepResult);
    if (stepResult.status !== 'passed') {
      suiteStatus = 'failed';
    }
  }

  await browser.close();

  const report = {
    file: name,
    baseUrl,
    date: new Date().toISOString(),
    status: suiteStatus,
    steps: results
  };

  await fsp.writeFile(reportFile, JSON.stringify(report, null, 2), 'utf8');
  return { reportFile, status: suiteStatus };
}

async function main() {
  const args = parseArgs(process.argv);
  
  const headless = toBool(args.headless ?? process.env.HEADLESS, true);

  // Recursively find all case directories (containing Settings.json)
  function findCaseDirs(root) {
    const out = [];
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const dir = path.join(root, ent.name);
      const settings = path.join(dir, 'Settings.json');
      if (fs.existsSync(settings)) {
        out.push(dir);
        continue;
      }
      out.push(...findCaseDirs(dir));
    }
    return out;
  }

  const casesRoot = path.join(__dirname, 'Cases');
  const caseDirs = findCaseDirs(casesRoot);
  const summary = [];

  console.log(`Discovered ${caseDirs.length} case folder(s).`);

  for (const dir of caseDirs) {
    const caseName = path.relative(casesRoot, dir);
    console.log(`Case: ${caseName}`);

    const settingsPath = path.join(dir, 'Settings.json');
    let jsonData;
    try {
      jsonData = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      console.error(`Invalid Settings.json in ${caseName}: ${e.message}`);
      summary.push({ file: `${caseName}/Settings.json`, status: 'error', error: e.message });
      continue;
    }

    const enabledRaw = jsonData.Enabled;
    const enabled = typeof enabledRaw === 'string' ? enabledRaw.toLowerCase() !== 'false' : (enabledRaw !== false);
    if (!enabled) {
      console.log(`Skipped (Enabled=false): ${caseName}`);
      continue;
    }
    let aaa;

    if (jsonData.BASE_URL.includes('index.html')) {
      const currentDir = __dirname;
      aaa = `file://${currentDir}`+jsonData.BASE_URL.replace(/\\/g, '/');
    } else {
      aaa = jsonData.BASE_URL || args.baseUrl;
    }

    const baseUrl = aaa;



    if (!baseUrl) {
      console.error(`Missing BASE_URL for ${caseName}; skipping.`);
      summary.push({ file: `${caseName}`, status: 'error', error: 'Missing BASE_URL' });
      continue;
    }

    const reportsDir = path.join(process.env.APPDATA, 'cline-Remote', 'Cases', caseName, 'Reports');
    await ensureDir(reportsDir);

    const entries = await fsp.readdir(dir);
    const csvFiles = entries.filter(f => f.toLowerCase().endsWith('.csv'));
    if (csvFiles.length === 0) {
      console.log(`No CSV files found in ${caseName}; continuing.`);
      continue;
    }

    console.log(`Found ${csvFiles.length} CSV file(s): ${csvFiles.join(', ')}`);

    for (const f of csvFiles) {
      const filePath = path.join(dir, f);
      console.log(`Running: ${caseName}/${f}`);
      try {
        const { reportFile, status } = await runCsvFile(filePath, { baseUrl, reportsDir, headless });
        console.log(`Report: ${reportFile} (${status})`);

    // 1. 异步读取 json 文件
        const jsonText = fs.readFileSync(reportFile, 'utf8');

        const reportFile1 = jsonText;


        summary.push({ file: `${caseName}/${f}`, status, reportFile1 });
      } catch (err) {
        console.error(`Failed ${caseName}/${f}: ${err.message}`);
        summary.push({ file: `${caseName}/${f}`, status: 'error', error: err.message });
      }
    }
  }
    const savePath = path.join(process.env.APPDATA, 'cline-Remote', 'Cases', 'result.json');
    await ensureDir(path.dirname(savePath));
    fs.writeFileSync(savePath, JSON.stringify(summary, null, 2), 'utf8');

// 2. 把 JSON 转成漂亮 HTML
    const htmlContent = `
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>测试报告</title>

      </head>
      <body style="margin:0; padding:20px; font-family:Arial, sans-serif; line-height:1.6;">

        <h2>自动化测试报告</h2>

 
        ${summary.map((item, index) => `
  

 
  <div class="collapse-content">

            <h4>第 ${index+1} 条结果 - ${item.file}</h4>
            <p>状态：<span class="${item.status === 'passed' ? 'pass' : 'fail'}">${item.status}</span></p>
            <p>用例：${item.testCase || ''}</p>
            <pre>信息：${(item.reportFile1 ? item.reportFile1.replace(/\n/g, "<br>") : '')}</pre>
            <p>时间：${item.time || new Date().toLocaleString()}</p>

  

  </div>
        `).join('')}
      </body>
    </html>
  `;
// 3. 保存 HTML 文件（作为附件）
  const savePath1 = path.join(process.env.APPDATA, 'cline-Remote', 'Cases');
  const htmlFile = path.join(savePath1, 'report.html');
  await ensureDir(savePath1);
  fs.writeFileSync(htmlFile, htmlContent, 'utf8');




  // Aggregate exit code: non-zero if any failed/error
  const anyFailed = summary.some(s => s.status !== 'passed');
  if (anyFailed) {
    process.exit(2);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}