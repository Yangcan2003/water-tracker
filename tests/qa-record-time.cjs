// Run against tests/preview-sync.mjs --local; uses synthetic records only.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.QA_URL || 'http://127.0.0.1:4185';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' });
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.locator('#dashboardQuickWater').click();
    await page.locator('[data-home-toilet="small"]').click();
    for (const [category, list] of [['water', '#historyList'], ['toilet', '#toiletHistoryList']]) {
      await page.locator(`[data-detail="${category}"]`).click();
      const record = page.locator(`${list} .time-editable`).first();
      await record.waitFor();
      const original = await record.getAttribute('data-time');
      const id = await record.getAttribute('data-id');
      const row = page.locator(`${list} .time-editable[data-id="${id}"]`);
      const dialog = page.locator('#recordTimeDialog');
      const input = page.locator('#recordTimeInput');
      const changed = original === '03:17' ? '04:28' : '03:17';
      await row.click();
      for (const time of [changed, '23:59', changed]) {
        await input.fill(time);
        await input.dispatchEvent('change');
        await page.locator('#recordTimeSaveButton').focus(); // Picker loses focus without confirmation.
        await page.waitForTimeout(1600);
        assert.equal(await dialog.isVisible(), true);
        assert.equal(await row.getAttribute('data-time'), original);
      }
      for (const width of [320, 393, 430]) {
        await page.setViewportSize({ width, height: 852 });
        assert.equal(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth), true);
        assert.equal(await page.locator('#recordTimeSaveButton').isVisible(), true);
      }
      if (category === 'water') await page.screenshot({ path: 'artifacts/record-time-confirmation.png' });
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await row.getAttribute('data-time'), original);
      // Every dismissal path discards the draft, including the backdrop.
      for (const dismiss of ['close', 'escape', 'backdrop']) {
        await row.click();
        assert.equal(await input.inputValue(), original);
        await input.fill(changed);
        if (dismiss === 'close') await dialog.getByRole('button', { name: '关闭', exact: true }).click();
        if (dismiss === 'escape') await page.keyboard.press('Escape');
        if (dismiss === 'backdrop') await page.mouse.click(1, 1);
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(await row.getAttribute('data-time'), original);
      }
      await page.reload();
      await page.locator(`[data-detail="${category}"]`).click();
      assert.equal(await row.getAttribute('data-time'), original);
      await row.click();
      await input.fill(changed);
      await page.locator('#recordTimeSaveButton').click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await row.getAttribute('data-time'), changed);
      await page.reload();
      await page.locator(`[data-detail="${category}"]`).click();
      assert.equal(await row.getAttribute('data-time'), changed);
      await page.locator('#detailBackButton').click();
    }
    assert.deepEqual(errors, []);
    console.log('PASS: water/toilet changes and blur remain unsaved after 1.6s pauses; cancel, close, Escape and backdrop discard edits; confirmation persists across reload; 320–430px layout fits.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
