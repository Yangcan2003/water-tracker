const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.QA_URL || 'http://127.0.0.1:54036';
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' });
  try {
    for (const mode of ['', '/plan']) {
      const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + mode + '/'); await page.locator('[data-detail="meal"]').click();
      let connected = !mode;
      const analyze = async () => {
        await page.locator('#mealAnalyzeButton').click();
        if (!connected) {
          await page.locator('#mealAIConnect').waitFor({ state: 'visible', timeout: 5000 }); await page.locator('#mealAIConnect').click(); connected = true;
        }
        await page.locator('#mealNutritionResult').waitFor({ state: 'visible' });
      };
      const check = async () => {
        for (const [key, value] of [['fiberG', '8'], ['sodiumMg', '680'], ['saturatedFatG', '3'], ['sugarsG', '6'], ['addedSugarsG', '']]) assert.equal(await page.locator('#mealExtra' + key).inputValue(), value);
        assert.equal(await page.locator('#mealExtrafiberG').evaluate(el => el.closest('details') === null), true);
        assert.equal(await page.locator('#mealExtrasodiumMg').evaluate(el => el.closest('details') === null), true);
      };
      const save = async () => { await page.locator('#mealSaveButton').click(); await page.locator('#mealDialog').waitFor({ state: 'hidden' }); };
      await page.locator('#mealQuickText').click(); await page.locator('#mealNameInput').fill('补充营养测试：蔬菜鸡肉饭一份'); await analyze(); await check();
      await page.locator('#mealExtrasodiumMg').scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'artifacts/meal-ai-nutrients-' + (mode ? 'native' : 'web') + '.png' });
      await save();
      assert.equal(await page.locator('#mealDailyFiber').textContent(), '8'); assert.equal(await page.locator('#mealDailySodium').textContent(), '680');
      const entry = page.locator('[data-meal-record]').filter({ hasText: '补充营养测试' });
      assert.match(await entry.locator('.diary-entry-key-nutrients').textContent(), /膳食纤维8 g.*钠680 mg/);
      await entry.locator('[data-meal-actions]').click(); await page.locator('#mealActionEdit').click(); await check();
      await page.locator('#mealExtrasodiumMg').fill('700'); await save();
      assert.equal(await page.locator('#mealDailySodium').textContent(), '700');
      // Photo-only analysis returns the same complete nutrient contract.
      await page.locator('#mealQuickText').click();
      const photo = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 20; canvas.getContext('2d').fillRect(0, 0, 20, 20); return canvas.toDataURL('image/png').split(',')[1]; });
      await page.locator('#mealPhotoInput').setInputFiles({ name: 'test-food.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') });
      await page.waitForFunction(() => document.querySelector('#mealPhotoCount').textContent.startsWith('1 /'));
      await analyze(); await check(); await save();
      assert.equal(await page.locator('#mealDailyFiber').textContent(), '16'); assert.equal(await page.locator('#mealDailySodium').textContent(), '1,380');
      await page.reload(); await page.locator('[data-detail="meal"]').click();
      await page.waitForFunction(() => document.querySelector('#mealDailySodium').textContent === '1,380');
      assert.equal(await page.locator('#mealDailyFiber').textContent(), '16');
      for (const width of [320, 430]) {
        await page.setViewportSize({ width, height: 740 }); await page.locator('[data-meal-actions]').first().click(); await page.locator('#mealActionEdit').click();
        await page.locator('#mealExtrasodiumMg').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('#mealDialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
        await page.locator('#mealDialog .close-button').click();
      }
      assert.deepEqual(errors, []); await page.close();
    }
    const payload = await (await (await browser.newPage()).request.get(base + '/__qa')).json();
    for (const key of ['fiberG', 'sodiumMg', 'saturatedFatG', 'sugarsG', 'addedSugarsG']) assert.ok(payload.requests.every(request => request.nutrientKeys.includes(key)));
    assert.ok(payload.requests.some(request => request.images === 1)); assert.ok(payload.requests.some(request => request.images === 0));
    console.log('PASS: web/native text and photo AI nutrients, primary fiber/sodium fields, other nutrients and unknown sugar, save/edit/manual correction/reload, daily totals, 320/430px layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
