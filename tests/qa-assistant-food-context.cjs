const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const base = process.env.QA_URL || 'http://127.0.0.1:54029';
const foods = catalog => catalog.entries || catalog.rows.map(row => Object.fromEntries(catalog.columns.map((key, i) => [key, row[i]])));
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' });
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().endsWith('/api/ai') && request.method() === 'POST') requests.push(request.postDataJSON()); });
    await page.goto(base); await page.locator('#accountTab').click(); await page.locator('#accountFoodsButton').click(); await page.locator('#foodCatalogAdd').click();
    await page.locator('#foodName').fill('测试冰烤薯'); await page.locator('#foodAliases').fill('测试品牌冰薯');
    for (const [key, value] of Object.entries({ kcal: 100, carbsG: 23, proteinG: 1, fatG: 0 })) await page.locator(`#foodValue${key}`).fill(String(value));
    await page.locator('#foodNote').fill('测试营养表，每100g');
    const saveFood = async () => { await page.locator('#foodCatalogSave').click(); await page.locator('#foodCatalogEditor').waitFor({ state: 'hidden' }); await page.locator('#foodCatalogDialog').waitFor({ state: 'visible' }); await page.locator('#foodCatalogDialog .close-button').click(); };
    await saveFood();
    await page.locator('#assistantTab').click();
    const send = async question => {
      const previous = requests.length;
      await page.locator('#assistantInput').fill(question); await page.locator('#assistantSend').click();
      await page.waitForFunction(() => document.querySelector('#assistantPanel').dataset.busy === 'false');
      assert.equal(requests.length, previous + 1);
      return requests.at(-1);
    };
    let request = await send('测试冰烤薯按照我记录的数据来，108g能算吗？');
    assert.equal(request.shareRecords, true);
    assert.equal(request.context.foodCatalog.count, 1);
    const first = foods(request.context.foodCatalog)[0];
    assert.equal(first.name, '测试冰烤薯'); assert.equal(first.aliases, '测试品牌冰薯');
    assert.equal(first.servingAmount, 100); assert.equal(first.servingUnit, 'g');
    assert.equal(first.kcal, 100); assert.equal(first.carbsG, 23); assert.equal(first.proteinG, 1); assert.equal(first.fatG, 0);
    assert.equal(request.context.todayNutrition.kcal, null);
    assert.match(await page.locator('.assistant-message-source').last().textContent(), /常吃食物 1 种/);
    const modelRequests = await (await page.request.get(`${base}/__qa`)).json();
    const snapshot = modelRequests.requests.at(-1).input.at(-2).content;
    assert.match(snapshot, /foodCatalog/); assert.match(snapshot, /测试冰烤薯/); assert.match(snapshot, /carbsG/);
    await page.screenshot({ path: 'artifacts/assistant-food-reference-source.png', fullPage: true });
    // Same chat reads the library again after a saved edit.
    await page.locator('#accountTab').click(); await page.locator('#accountFoodsButton').click(); await page.locator('[data-food-edit]').click();
    await page.locator('#foodValuecarbsG').fill('25'); await saveFood(); await page.locator('#assistantTab').click();
    request = await send('我刚修改了常吃食物，按最新数值再算一下。');
    assert.equal(foods(request.context.foodCatalog)[0].carbsG, 25);
    assert.ok(request.messages.some(message => message.role === 'assistant'));
    // Scope and sharing apply to reference foods too; switching sharing clears prior chat data.
    await page.locator('#assistantRecordsToggle').click(); await page.getByRole('radio', { name: '近 7 天', exact: true }).click();
    assert.match(await page.locator('#assistantPrivacy').textContent(), /提问时读取/);
    request = await send('看一下这次记录中有哪些常吃食物。');
    assert.equal(request.context.foodCatalog.count, 1);
    await page.locator('#assistantRecordsToggle').click(); await page.locator('#assistantShare').uncheck();
    assert.equal(await page.locator('#assistantRangeOptions').isVisible(), false);
    assert.equal(await page.locator('#assistantRangeOptions').isDisabled(), true);
    request = await send('只聊一般话题，不需要读取记录。');
    assert.equal(request.shareRecords, false); assert.equal(request.context, null);
    assert.ok(!JSON.stringify(request).includes('测试冰烤薯'));
    assert.equal(await page.locator('.assistant-message-source').count(), 0);
    // Deleted references are absent from the very next shared snapshot.
    await page.locator('#accountTab').click(); await page.locator('#accountFoodsButton').click(); await page.locator('[data-food-edit]').click();
    await page.locator('#foodCatalogDelete').click(); await page.locator('#foodCatalogDelete').click();
    await page.locator('#foodCatalogEditor').waitFor({ state: 'hidden' }); await page.locator('#foodCatalogDialog').waitFor({ state: 'visible' }); await page.locator('#foodCatalogDialog .close-button').click();
    await page.locator('#assistantTab').click(); await page.locator('#assistantRecordsToggle').click(); await page.locator('#assistantShare').check();
    assert.equal(await page.getByRole('radio', { name: '近 7 天', exact: true }).isChecked(), true);
    request = await send('重新读取我的常吃食物。');
    assert.equal(request.context.foodCatalog.count, 0); assert.deepEqual(request.context.foodCatalog.entries, []);
    assert.deepEqual(errors, []);
    console.log('PASS: saved reference foods reach assistant request and model snapshot, source count, full serving/nutrients, same-chat fresh edits, range changes, sharing off excludes data, deletion clears next snapshot.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
