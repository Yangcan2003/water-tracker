// Run with the isolated preview-meal-nutrition.mjs fixture; no live AI/account data.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.QA_URL || 'http://127.0.0.1:54022';
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' });
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base); await page.locator('[data-detail="meal"]').click();
    await page.getByText('原有午餐记录').waitFor();
    const close = async () => { await page.locator('#mealDialog .close-button').click(); await page.locator('#mealDialog').waitFor({ state: 'hidden' }); await page.waitForFunction(() => !document.documentElement.classList.contains('meal-editor-active')); };
    const save = async () => { await page.locator('#mealSaveButton').click(); await page.locator('#mealDialog').waitFor({ state: 'hidden' }); };
    const recognized = () => page.getByText('已识别这一餐的总营养，可检查和修改后保存。').waitFor();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#mealQuickCamera').click(); await (await chooser).setFiles([]);
    const cameraLayout = await page.locator('.diary-editor-body').evaluate(e => [...e.children].map(child => child.className));
    await close(); await page.locator('#mealQuickText').click();
    assert.deepEqual(await page.locator('.diary-editor-body').evaluate(e => [...e.children].map(child => child.className)), cameraLayout);
    assert.equal(await page.locator('#mealNoteInput').count(), 0);
    await close();
    const visibleInput = async selector => {
      const rects = await page.evaluate(selector => {
        const field = document.querySelector(selector).getBoundingClientRect();
        const body = document.querySelector('.diary-editor-body').getBoundingClientRect();
        const save = document.querySelector('#mealSaveButton').getBoundingClientRect();
        return { field: { top: field.top, bottom: field.bottom }, body: { top: body.top, bottom: body.bottom }, save: { top: save.top, bottom: save.bottom }, height: visualViewport.height, top: visualViewport.offsetTop };
      }, selector);
      assert.ok(rects.field.top >= rects.body.top && rects.field.bottom <= rects.body.bottom, JSON.stringify(rects));
      assert.ok(rects.save.top >= rects.top && rects.save.bottom <= rects.top + rects.height, JSON.stringify(rects));
    };
    // Both native-style WebView resize and browser-only visual viewport changes.
    for (const width of [320, 393, 430]) {
      await page.setViewportSize({ width, height: 852 }); await page.locator('#mealQuickText').click();
      assert.equal(await page.locator('#mealNameInput').evaluate(e => document.activeElement === e), true);
      assert.equal(await page.locator('.diary-editor-body > :first-child').getAttribute('class'), 'diary-photo-field');
      await page.setViewportSize({ width, height: 410 }); await page.waitForTimeout(100);
      await visibleInput('#mealNameInput');
      assert.equal(await page.locator('#mealNoteInput').count(), 0);
      assert.equal(await page.locator('#mealDialog').evaluate(e => e.scrollWidth <= e.clientWidth), true);
      await page.setViewportSize({ width, height: 852 }); await close();
      assert.equal(await page.locator('html').evaluate(e => e.classList.contains('meal-editor-active')), false);
    }
    await page.setViewportSize({ width: 393, height: 852 }); await page.locator('#mealQuickText').click();
    await page.evaluate(() => {
      const viewport = new EventTarget(); Object.assign(viewport, { height: 440, offsetTop: 90 });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(100); await visibleInput('#mealNameInput');
    await page.screenshot({ path: 'artifacts/meal-text-keyboard.png' });
    await page.evaluate(() => { delete window.visualViewport; window.dispatchEvent(new Event('resize')); });
    await close();

    await page.locator('#mealQuickText').click(); assert.equal(await page.locator('#mealAnalyzeButton').isDisabled(), true);
    await page.locator('#mealNameInput').fill('米饭半碗、鸡胸肉150克、一个鸡蛋，清蒸少油'); await page.locator('#mealTimeInput').fill('18:30');
    assert.equal(await page.locator('#mealAnalyzeButton').isEnabled(), true);
    await page.locator('#mealAnalyzeButton').click(); await recognized();
    assert.equal(await page.locator('#mealKcalInput').inputValue(), '580');
    assert.equal(await page.locator('#mealCarbsInput').inputValue(), '62');
    assert.equal(await page.locator('#mealProteinInput').inputValue(), '35');
    assert.equal(await page.locator('#mealFatInput').inputValue(), '21');
    assert.equal(await page.locator('#mealTimeInput').inputValue(), '18:30');
    assert.equal(await page.locator('#mealDailyKcal').textContent(), '—');
    await page.locator('#mealKcalInput').fill('620'); await save();
    assert.equal(await page.locator('#mealDailyKcal').textContent(), '620');
    let entry = page.locator('.diary-entry').filter({ hasText: '鸡胸肉150克' });
    const id = await entry.getAttribute('data-meal-record');
    await page.reload(); await page.locator('[data-detail="meal"]').click();
    entry = page.locator(`[data-meal-record="${id}"]`);
    assert.equal(await entry.locator('[data-meal-analyze]').count(), 0);
    await entry.locator('[data-meal-actions]').click();
    assert.equal(await page.locator('#mealActionAnalyze').count(), 0);
    await page.locator('#mealActionEdit').click();
    await page.locator('#mealAnalyzeButton').click(); await recognized();
    assert.equal(await page.locator('#mealTimeInput').inputValue(), '18:30'); await save();
    assert.equal(await page.locator('.diary-entry').count(), 2);
    assert.equal(await page.locator('#mealDailyKcal').textContent(), '580');
    // Existing records keep AI recognition inside their editor.
    await page.locator('[data-meal-record="old-lunch"] [data-meal-actions]').click();
    await page.locator('#mealActionEdit').click();
    assert.equal(await page.locator('#mealNameInput').inputValue(), '原有午餐记录\n原有备注：米饭半碗');
    await page.locator('#mealAnalyzeButton').click(); await recognized(); await save();
    await page.locator('[data-meal-record="old-lunch"] [data-meal-actions]').click();
    await page.locator('#mealActionEdit').click();
    assert.equal(await page.locator('#mealNameInput').inputValue(), '原有午餐记录\n原有备注：米饭半碗');
    await close();
    assert.equal(await page.locator('#mealDailyKcal').textContent(), '1,160');
    // Food descriptions alone count as input; changed text cannot keep stale nutrition.
    await page.locator('#mealQuickText').click(); await page.locator('#mealNameInput').fill('两只鸡蛋');
    await page.locator('#mealAnalyzeButton').click(); await recognized();
    await page.locator('#mealNameInput').fill('慢速测试');
    assert.equal(await page.locator('#mealNutritionResult').isVisible(), false);
    await page.locator('#mealAnalyzeButton').click(); await page.locator('#mealNameInput').fill('修改成一碗面');
    await page.waitForTimeout(1400); assert.equal(await page.locator('#mealNutritionResult').isVisible(), false);
    await page.locator('#mealNameInput').fill('非食物'); await page.locator('#mealAnalyzeButton').click();
    await page.getByText('未识别到食物，请补充具体食物名称或清晰照片').waitFor();
    await page.locator('#mealNameInput').fill('失败测试'); await page.locator('#mealAnalyzeButton').click();
    await page.getByText('模型服务暂时无法回答，请稍后重试').waitFor();
    assert.equal(await page.locator('#mealNameInput').inputValue(), '失败测试');
    assert.equal(await page.locator('#mealSaveButton').isEnabled(), true); await close();
    assert.equal(await page.locator('#mealDailyKcal').textContent(), '1,160');

    const native = await browser.newPage({ viewport: { width: 393, height: 852 } });
    native.on('pageerror', error => errors.push(error.message));
    await native.goto(`${base}/plan/`); await native.locator('[data-detail="meal"]').click();
    await native.locator('#mealQuickText').click(); await native.locator('#mealNameInput').fill('一碗牛肉面');
    await native.locator('#mealAnalyzeButton').click(); await native.locator('#mealAIConnect').waitFor({ state: 'visible' });
    await native.locator('#mealAIConnect').click(); await native.locator('#mealNutritionResult').waitFor({ state: 'visible' });
    assert.equal(await native.locator('#mealProteinInput').inputValue(), '35');
    const requests = await (await page.request.get(`${base}/__qa`)).json();
    assert.ok(requests.requests.length >= 6 && requests.requests.every(r => r.images === 0 && r.strict));
    assert.deepEqual(errors, []);
    console.log('PASS: 320–430px keyboard layout, viewport panning, focused description visible, text-only AI, saved text recognition, review/manual correction, persistence, daily totals, stale cancellation, failures, nonfood and native connection.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
