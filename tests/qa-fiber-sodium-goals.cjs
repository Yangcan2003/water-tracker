const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.QA_URL || 'http://127.0.0.1:54034';
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' });
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const text = selector => page.locator(selector).textContent();
    const saveGoal = async () => { await page.locator('#nutritionGoalSave').click(); await page.locator('#nutritionGoalDialog').waitFor({ state: 'hidden' }); };
    const saveMeal = async () => { await page.locator('#mealSaveButton').click(); await page.locator('#mealDialog').waitFor({ state: 'hidden' }); };
    await page.goto(base); await page.locator('#accountTab').click(); await page.locator('#accountNutritionButton').click();
    assert.equal(await page.locator('#nutritionGoalFiber').inputValue(), '25');
    assert.equal(await page.locator('#nutritionGoalSodium').inputValue(), '2000');
    await page.locator('#nutritionGoalWeight').fill('70');
    await page.locator('#nutritionGoalFiber').fill('30'); await page.locator('#nutritionGoalSodium').fill('1800'); await saveGoal();
    assert.equal(await text('#accountTargetFiber'), '30'); assert.equal(await text('#accountTargetSodium'), '1,800');
    await page.locator('#overviewTab').click(); await page.locator('[data-detail="meal"]').click();
    assert.equal(await text('#mealTargetFiber'), '30'); assert.equal(await text('#mealTargetSodium'), '1,800');
    assert.equal(await text('#mealDailySodium'), '—'); assert.match(await text('#mealSodiumCoverage'), /0 \/ 1 条有数据 · 统计不完整/);
    assert.equal(await text('#mealSodiumRemaining'), '待补充营养数据');
    await page.locator('#mealQuickText').click(); await page.locator('#mealNameInput').fill('有营养标签的一餐');
    await page.locator('#mealAnalyzeButton').click(); await page.locator('#mealNutritionResult').waitFor({ state: 'visible' });
    await page.locator('#mealExtraNutrition summary').click();
    await page.locator('#mealExtrafiberG').fill('10'); await page.locator('#mealExtrasodiumMg').fill('0'); await saveMeal();
    assert.equal(await text('#mealDailyFiber'), '10'); assert.equal(await text('#mealDailySodium'), '0');
    assert.equal(await text('#mealFiberRemaining'), '当前为已知摄入'); assert.equal(await text('#mealSodiumRemaining'), '当前为已知摄入');
    assert.match(await text('#mealFiberCoverage'), /1 \/ 2 条有数据 · 统计不完整/);
    assert.equal(await page.locator('#mealSodiumProgress').getAttribute('aria-valuenow'), '0');
    assert.equal(await page.locator('#mealDailyExtra').getByText('钠', { exact: true }).count(), 0);
    // Delete the incomplete old meal: only known saved values remain in totals.
    await page.locator('[data-meal-record="old-lunch"] [data-meal-actions]').click();
    await page.locator('#mealActionDelete').click(); await page.locator('#mealActionDelete').click();
    await page.locator('#mealActionsDialog').waitFor({ state: 'hidden' });
    assert.equal(await text('#mealFiberRemaining'), '还差 20 g'); assert.equal(await text('#mealSodiumRemaining'), '低于上限');
    const edit = async (fiber, sodium) => {
      await page.locator('[data-meal-actions]').click(); await page.locator('#mealActionEdit').click();
      await page.locator('#mealExtrafiberG').fill(fiber); await page.locator('#mealExtrasodiumMg').fill(sodium); await saveMeal();
    };
    await edit('30', '1500'); assert.equal(await text('#mealFiberRemaining'), '已达目标'); assert.equal(await text('#mealSodiumRemaining'), '接近上限');
    await edit('30', '1800'); assert.equal(await text('#mealSodiumRemaining'), '已到上限');
    await edit('30', '2100'); assert.equal(await text('#mealSodiumRemaining'), '已超出 300 mg');
    assert.equal(await page.locator('#mealSodiumProgress').getAttribute('aria-valuenow'), '100');
    await page.screenshot({ path: 'artifacts/fiber-sodium-diary.png', fullPage: true });
    await page.reload(); await page.locator('[data-detail="meal"]').click();
    await page.waitForFunction(() => document.querySelector('#mealTargetSodium').textContent === '1,800');
    assert.equal(await text('#mealSodiumRemaining'), '已超出 300 mg');
    await page.locator('#mealGoalButton').click();
    assert.equal(await page.locator('#nutritionGoalFiber').inputValue(), '30'); assert.equal(await page.locator('#nutritionGoalSodium').inputValue(), '1800');
    await page.locator('#nutritionGoalWeight').fill('80'); await saveGoal();
    assert.equal(await text('#mealTargetFiber'), '30'); assert.equal(await text('#mealTargetSodium'), '1,800');
    await edit('', ''); assert.equal(await text('#mealDailyFiber'), '—'); assert.equal(await text('#mealDailySodium'), '—');
    assert.equal(await text('#mealSodiumRemaining'), '待补充营养数据');
    for (const width of [320, 393, 430]) {
      await page.setViewportSize({ width, height: 740 }); await page.locator('#mealGoalButton').click();
      assert.equal(await page.locator('#nutritionGoalDialog').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await page.locator('#nutritionGoalSodium').scrollIntoViewIfNeeded();
      const field = await page.locator('#nutritionGoalSodium').boundingBox(); assert.ok(field.y >= 0 && field.y + field.height < 740);
      const button = await page.locator('#nutritionGoalSave').boundingBox(); assert.ok(button.y >= 0 && button.y + button.height <= 740);
      await page.locator('#nutritionGoalDialog .close-button').click();
    }
    await page.setViewportSize({ width: 393, height: 410 }); await page.locator('#mealGoalButton').click();
    await page.locator('#nutritionGoalSodium').scrollIntoViewIfNeeded(); await page.locator('#nutritionGoalSodium').focus();
    let button = await page.locator('#nutritionGoalSave').boundingBox(); assert.ok(button.y >= 0 && button.y + button.height <= 410);
    await page.setViewportSize({ width: 393, height: 852 }); await page.locator('#nutritionGoalWeight').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'artifacts/fiber-sodium-editor.png' });
    await page.evaluate(() => document.documentElement.dataset.theme = 'midnight');
    await page.locator('#nutritionGoalSodium').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'artifacts/fiber-sodium-editor-dark.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: fiber/sodium defaults, independent custom goals, persistence/cloud reload, null versus zero, partial/complete coverage, edited/deleted meals, near/equal/exceeded sodium limit, 320–430px and keyboard layout, dark theme.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
