const { chromium } = require('/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  fs.mkdirSync('artifacts', { recursive: true });
  const browser = await chromium.launch({ headless:true, executablePath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' });
  try {
    const page = await browser.newPage({ viewport:{ width:393, height:852 }, deviceScaleFactor:2 });
    const errors=[], sent=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/ai', async route => {
      if (route.request().method()==='GET') return route.fulfill({ json:{ providers:[{ id:'openai',configured:true }] } });
      const body=route.request().postDataJSON(); sent.push(body);
      const q=body.messages.at(-1).content;
      const egg=body.actionCatalog.records.find(row=>row.category==='fridge'&&row.values.name==='鸡蛋');
      const actions=q.includes('牛奶')?[{operation:'create',category:'fridge',ref:null,date:null,time:null,values:{name:'牛奶',quantity:2,unit:'瓶',location:'refrigerated'}}]:q.includes('扣减')?[{operation:'update',category:'fridge',ref:egg.ref,date:null,time:null,values:{quantity:4}}]:[];
      await route.fulfill({ json:{reply:actions.length?'已整理好，请核对下面的冰箱变更。':'可以用家里的鸡蛋安排下一餐。这里只生成菜单，库存保持不变。',actions} });
    });
    await page.goto(process.env.QA_URL||'http://127.0.0.1:54127');
    await page.locator('#accountTab').click(); await page.locator('#accountFridgeButton').click();
    await page.getByText('冰箱里，有什么？').waitFor();
    await page.locator('#fridgeAdd').click(); await page.locator('#fridgeName').fill('鸡蛋');
    await page.locator('#fridgeQuantity').fill('6'); await page.locator('#fridgeLocation').selectOption('refrigerated');
    const tomorrow=new Date(); tomorrow.setDate(tomorrow.getDate()+1); const date=tomorrow.getFullYear()+'-'+String(tomorrow.getMonth()+1).padStart(2,'0')+'-'+String(tomorrow.getDate()).padStart(2,'0');
    await page.locator('#fridgeExpires').fill(date);
    for (const width of [320,393,430]) {
      await page.setViewportSize({width,height:740});
      assert.equal(await page.locator('#fridgeEditor').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
      const box=await page.locator('#fridgeSave').boundingBox();assert.ok(box.y>=0&&box.y+box.height<=740);
    }
    await page.setViewportSize({width:393,height:410});
    let box=await page.locator('#fridgeSave').boundingBox();assert.ok(box.y>=0&&box.y+box.height<=410);
    await page.setViewportSize({width:393,height:852});
    await page.locator('#fridgeSave').click(); await page.locator('#fridgeDialog').waitFor({state:'visible'});
    assert.match(await page.locator('#fridgePriority').textContent(),/鸡蛋/);
    await page.locator('#fridgeAdd').click();await page.locator('#fridgeName').fill('燕麦 <原味>');await page.locator('#fridgeLocation').selectOption('pantry');await page.locator('#fridgeSave').click();
    await page.locator('#fridgeDialog').waitFor({state:'visible'});assert.equal(await page.locator('[data-fridge-edit]').count(),2);
    await page.locator('[data-fridge-location="refrigerated"]').click();assert.equal(await page.locator('[data-fridge-edit]').count(),1);
    await page.locator('[data-fridge-location="all"]').click();await page.locator('#fridgeSearch').fill('原味');assert.equal(await page.locator('[data-fridge-edit]').count(),1);
    await page.locator('#fridgeSearch').fill('');
    await page.screenshot({path:'artifacts/fridge-list.png'});
    await page.locator('#fridgeDialog .close-button').click();await page.reload();await page.locator('#accountTab').click();await page.locator('#accountFridgeButton').click();
    assert.equal(await page.locator('[data-fridge-edit]').count(),2);
    await page.locator('#fridgeAIAdd').click();assert.match(await page.locator('#assistantInput').inputValue(),/存入/);
    await page.locator('#assistantInput').fill('帮我把牛奶2瓶放进我的冰箱');await page.locator('#assistantSend').click();
    await page.locator('[data-confirm-action]').waitFor();
    assert.equal(await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('health_tracker_data')).fridgeInventories['sync-test']).filter(x=>!x.deleted).length),2);
    // Reopen before confirming: the persisted card must still execute once.
    await page.reload();await page.locator('#assistantTab').click();
    await page.locator('[data-confirm-action]').click();await page.getByText('已保存到 App',{exact:true}).waitFor();
    await page.locator('#accountTab').click();assert.match(await page.locator('#accountFridgeSummary').textContent(),/3 种/);
    await page.locator('#overviewTab').click();await page.locator('[data-detail="meal"]').click();assert.match(await page.locator('#mealFridgeSummary').textContent(),/3 种/);
    await page.locator('#mealFridgeButton').click();await page.locator('#fridgePlan').click();await page.locator('#assistantSend').click();
    await page.getByText('可以用家里的鸡蛋安排下一餐。这里只生成菜单，库存保持不变。').waitFor();
    assert.equal(sent.at(-1).context.fridgeInventory.count,3);assert.equal(sent.at(-1).context.todayNutrition.entries,0);
    await page.locator('#assistantInput').fill('鸡蛋吃了2个，帮我扣减冰箱库存，剩下4个');await page.locator('#assistantSend').click();
    await page.locator('[data-confirm-action]').last().click();await page.getByText('已保存到 App',{exact:true}).last().waitFor();
    await page.locator('#accountTab').click();await page.locator('#accountFridgeButton').click();assert.match(await page.locator('[data-fridge-edit]').filter({hasText:'鸡蛋'}).textContent(),/4 个/);
    await page.locator('[data-fridge-edit]').filter({hasText:'燕麦'}).click();await page.locator('#fridgeRemove').click();await page.locator('#fridgeRemove').click();await page.locator('#fridgeDialog').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-fridge-edit]').count(),2);
    await page.evaluate(()=>document.documentElement.dataset.theme='midnight');await page.screenshot({path:'artifacts/fridge-dark.png'});
    assert.deepEqual(errors,[]);
    console.log('PASS: both entry points, inventory CRUD, expiry, filters/search, safe text, reload persistence, 320–430px/keyboard layout, dark theme, AI create/reopened confirmation/update, current inventory in meal planning, no premature consumption.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
