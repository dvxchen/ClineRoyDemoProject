'use strict';

/**
 * roy.js
 * Generated from RoyDemo.csv
 *
 * CSV Steps:
 * 1. 用chrome-devtools打开 https://usj-demo-dev-ui5.e17df97.stage.kyma.ondemand.com/
 * 2. 点击 Forecast Deviation Alert: Royalty 里面的 link: View
 * 3. 点击 TAB: Key Drivers for Future Performance
 * 4. 点击 第一个 .sapMLnkText 的 link
 * 5. 点击 FX Forecast Agent
 * 6. 点击 TAB：Interest Rate Differentials
 * 7. 读取 United States 行的 CPI 字段值，与qianwen数据 data.json 比较
 *
 * 要运行此脚本，需要先安装 Playwright：
 *   npm i - playwright
 *   npx playwright install
 * 运行：
 *   node roy.js
 */

const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    devtools: true, // 打开 DevTools，满足“chrome-devtools打开”的要求
    slowMo: 50
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  // JSON 日志：将每一步执行写入 log.json（每次运行清空重写）
  const logFile = 'log.json';
  let runLog = {
    runId: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    startedAt: new Date().toISOString(),
    status: 'running',
    steps: []
  };
  function flushLog() {
    try {
      fs.writeFileSync(logFile, JSON.stringify(runLog, null, 2), 'utf-8');
    } catch (e) {
      console.error('写入 log.json 失败：', e && e.message ? e.message : e);
    }
  }
  // 记录补充信息到当前步骤
  function logNote(data) {
    try {
      const last = runLog.steps[runLog.steps.length - 1];
      if (last) {
        last.note = Object.assign({}, last.note, data);
        flushLog();
      }
    } catch (e) { }
  }
  // 初始化：清空并写入初始内容
  flushLog();

  let stepCounter = 0;
  // 包装 step，记录开始/成功/失败等信息
  const step = async (title, fn) => {
    const entry = { index: ++stepCounter, title, status: 'start', start: new Date().toISOString() };
    runLog.steps.push(entry);
    flushLog();

    console.log(`\n=== ${title} ===`);
    const t0 = Date.now();
    try {
      await fn();
      entry.status = 'success';
      entry.end = new Date().toISOString();
      entry.durationMs = Date.now() - t0;
      flushLog();
    } catch (e) {
      entry.status = 'fail';
      entry.error = e && e.message ? e.message : String(e);
      entry.end = new Date().toISOString();
      entry.durationMs = Date.now() - t0;
      flushLog();
      throw e;
    }
  };

  try {
    // 1) 打开页面
    await step('打开页面', async () => {
      await page.goto('https://usj-demo-dev-ui5.e17df97.stage.kyma.ondemand.com/', { waitUntil: 'domcontentloaded' });
      // 等到网络相对空闲
      try {
        await page.waitForLoadState('networkidle', { timeout: 15000 });
      } catch { /* 可忽略 */ }
    });

    // 2) 点击 Forecast Deviation Alert: Royalty 里的 View
    await step('点击 Forecast Deviation Alert: Royalty 内的 View', async () => {
      // 优先在包含该标题的区域里找“View”
      const container = page.locator('xpath=//*[contains(normalize-space(.), "Forecast Deviation Alert: Royalty")]').first();
      const viewInContainer = container.locator('xpath=.//a[normalize-space()="View"] | .//button[normalize-space()="View"]');
      if (await viewInContainer.count()) {
        await viewInContainer.first().click();
      } else {
        // 退而求其次：全局找“View”
        await page.locator('xpath=//a[normalize-space()="View"] | //button[normalize-space()="View"]').first().click();
      }
      try {
        await page.waitForLoadState('networkidle', { timeout: 15000 });
      } catch { /* 可忽略 */ }
    });

    // 3) 点击 TAB: Key Drivers for Future Performance
    await step('点击 TAB: Key Drivers for Future Performance', async () => {
      const tab = page.getByRole ? page.getByRole('tab', { name: /Key Drivers for Future Performance/i }) : page.locator('xpath=//*[contains(@role,"tab") and contains(.,"Key Drivers for Future Performance")]');
      await tab.first().click();
    });

    // 4) 点击 第一个 .sapMLnkText 的 link
    await step('点击第一个 .sapMLnkText', async () => {
      const firstLink = page.locator('.sapMLnkText').first();
      await firstLink.click();
      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      } catch { /* 可忽略 */ }
    });

    // 5) 点击 FX Forecast Agent
    await step('点击 FX Forecast Agent', async () => {
      const target = page.getByText ? page.getByText('FX Forecast Agent', { exact: true }) : page.locator('xpath=//*[normalize-space()="FX Forecast Agent"]');
      await target.first().click();
      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      } catch { /* 可忽略 */ }
    });

    // 6) 点击 TAB：Interest Rate Differentials
    await step('点击 TAB：Interest Rate Differentials', async () => {
      const tab = page.getByRole ? page.getByRole('tab', { name: /Interest Rate Differentials/i }) : page.locator('xpath=//*[contains(@role,"tab") and contains(.,"Interest Rate Differentials")]');
      await tab.first().click();
    });





    // 7) 读取 United States 行的 CPI 字段值并与 data.json 比较
    await step('读取 United States 行的 CPI 字段值并与 data.json 比较', async () => {
      // 在页面上定位包含 United States 的行，然后通过表头 CPI 定位列
      const cpiValue = await page.evaluate(() => {
        function getText(el) {
          return (el && (el.textContent || '')).trim();
        }

        function findCpiInTable(table) {
          const ths = Array.from(table.querySelectorAll('thead th, tr th'));
          let cpiIndex = -1;

          if (ths.length) {
            const headerTexts = ths.map(getText);
            cpiIndex = headerTexts.findIndex(h => /(^|\s)CPI(\s|$)/i.test(h));
          }

          // 若找不到表头，尝试推测列：返回 -1 则之后用 heuristic
          const rows = Array.from(table.querySelectorAll('tbody tr, tr'));
          for (const tr of rows) {
            const cells = Array.from(tr.querySelectorAll('th, td'));
            if (!cells.length) continue;

            const hasUS = cells.some(c => /United States/i.test(getText(c)));
            if (!hasUS) continue;

            if (cpiIndex >= 0 && cpiIndex < cells.length) {
              return getText(cells[cpiIndex]);
            }

            // 没有表头时的启发式：找与 CPI 相邻的数值列或百分比列
            // 这里简单地取最后一个包含 % 的单元格作为猜测
            const percentCell = cells.reverse().find(c => /%$/.test(getText(c)));
            if (percentCell) {
              return getText(percentCell);
            }
            return null;
          }
          return null;
        }

        // 遍历所有表尝试
        const tables = Array.from(document.querySelectorAll('table'));
        for (const t of tables) {
          const val = findCpiInTable(t);
          if (val) return val;
        }

        // 如果不是标准 table 结构，可能是 UI5 的 grid，尝试基于 aria/grid 的定位
        const rowsAria = Array.from(document.querySelectorAll('[role="row"]'));
        if (rowsAria.length) {
          // 找 CPI 列索引
          const headerCells = Array.from(document.querySelectorAll('[role="columnheader"]'));
          let cpiCol = -1;
          for (let i = 0; i < headerCells.length; i++) {
            const txt = getText(headerCells[i]);
            if (/(^|\s)CPI(\s|$)/i.test(txt)) { cpiCol = i; break; }
          }
          for (const row of rowsAria) {
            const cells = Array.from(row.querySelectorAll('[role="cell"], [role="rowheader"]'));
            const rowText = getText(row);
            if (/United States/i.test(rowText)) {
              if (cpiCol >= 0 && cpiCol < cells.length) {
                return getText(cells[cpiCol]);
              }
              // 兜底：找看起来像百分比的 cell
              const pc = cells.reverse().find(c => /%$/.test(getText(c)));
              if (pc) return getText(pc);
              return null;
            }
          }
        }

        return null;
      });

      if (!cpiValue) {
        throw new Error('未能找到 United States 行的 CPI 值');
      }
      console.log('读取到的 CPI 值：', cpiValue);

      function normPercent(s) {
        if (s == null) return null;
        const m = String(s).match(/-?\d+(?:\.\d+)?\s*%/);
        return m ? m[0].replace(/\s+/g, '') : String(s).trim();
      }
      const gotRaw = String(cpiValue).trim();
      const got = normPercent(gotRaw);

      // 解析数值
      const m = got && got.match(/-?\d+(?:\.\d+)?/);
      const num = m ? parseFloat(m[0]) : null;

      // 仅当通过 CLI/ENV 显式提供期望值时才进行断言
      const argv = process.argv.slice(2);
      function getArgVal(key) {
        const prefix = `--${key}`;
        for (const a of argv) {
          if (a === prefix) return '';
          if (a.startsWith(prefix + '=')) return a.substring(prefix.length + 1);
        }
        return null;
      }
      const argExpect = getArgVal('expect-cpi') || process.env.EXPECT_CPI || null;
      const argExpectNum = getArgVal('expect-cpi-num') || process.env.EXPECT_CPI_NUM || null;
      const expectedRaw = argExpect ? argExpect : (argExpectNum ? `${argExpectNum}%` : null);
      const expected = expectedRaw ? normPercent(expectedRaw) : null;
      // 记录本步骤的提取与期望信息
      logNote({
        cpiRaw: gotRaw,
        cpi: got,
        value: num,
        expectRaw: expectedRaw || null,
        expect: expected || null
      });

      if (expected) {
        if (got !== expected) {
          const toNum = v => {
            const m2 = v && v.match(/-?\d+(?:\.\d+)?/);
            return m2 ? parseFloat(m2[0]) : NaN;
          };
          const diff = toNum(got) - toNum(expected);
          throw new Error(`CPI 值不匹配，期望 ${expectedRaw}（规范化为 ${expected}），实际 ${gotRaw}（规范化为 ${got}），差值 ${isNaN(diff) ? 'N/A' : diff.toFixed(2)}%`);
        }
        console.log(`断言通过：CPI 值为 ${expected}`);
      }

      // 将结果写入 data.json
      const payload = { cpiRaw: gotRaw, cpi: got, value: num, timestamp: new Date().toISOString() };
      /*     
           try {
             fs.writeFileSync('data.json', JSON.stringify(payload, null, 2), 'utf-8');
             console.log('已写入 data.json');
           } catch (e) {
             console.error('写入 data.json 失败：', e && e.message ? e.message : e);
             throw e;
           }
     */
      //将结果从 data.json 读出

      //    console.log(__dirname);
      const path = require('path');
      const parentDir = path.join(__dirname, '..');
      const dataPath = path.join(__dirname, 'data.json');

      let jsonStr = null;
      try {
        const data = require(dataPath);
        jsonStr = data && data.value;
        // 记录来自 data.json 的期望值
        logNote({ expectedFromDataJson: jsonStr });
      } catch (e) {
        console.warn('未找到 data.json，跳过与 data.json 的比较');
        logNote({ dataJsonMissing: true });
      }

      if (jsonStr != null) {
        if (String(cpiValue).indexOf(String(jsonStr)) !== -1) {
          console.log(`断言通过：期望 ${jsonStr}，实际 ${cpiValue}`);
        } else {
          throw new Error(`CPI 值不匹配，期望 ${jsonStr}，实际 ${cpiValue}`);
        }
      } else {
        console.warn('未提供 data.json 期值，已跳过该断言');
      }

    });

    console.log('\n所有步骤执行完成。');
    runLog.status = 'success';
    runLog.finishedAt = new Date().toISOString();
    flushLog();
    await context.close();
    await browser.close();
    process.exitCode = 0;
  } catch (err) {
    console.error('执行出错：', err && err.message ? err.message : err);
    try {
      runLog.status = 'error';
      runLog.finishedAt = new Date().toISOString();
      runLog.error = err && err.message ? err.message : String(err);
      flushLog();
    } catch { }
    try {
      await page.screenshot({ path: 'roy-failure.png', fullPage: true });
      console.error('已截取失败截图：roy-failure.png');
    } catch { }
    await context.close();
    await browser.close();
    process.exitCode = 1;
  }
})();