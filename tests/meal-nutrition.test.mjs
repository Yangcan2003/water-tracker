import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseMealAnalysis, normalizeMealNutrition, mealAnalysisInput, validateMealAnalysis } from "../js/meal-nutrition.js";
import { analyzeMealPhotos } from "../js/meal-nutrition-client.js";
import { createPlanClient } from "../js/chatgpt-plan-client.js";
import { handleAI } from "../server/ai-service.js";
const photo = "data:image/jpeg;base64,YQ==";
const estimate = { isFood: true, name: "米饭与鸡肉", kcal: 580, carbsG: 62, proteinG: 35, fatG: 21, portion: "米饭约150g，鸡肉约120g", note: "烹饪油量存在误差" };

test("food analysis accepts only selected compressed photos and uses Responses image content", () => {
  const input = mealAnalysisInput({ photos: [photo, photo], description: "米饭只吃了一半" });
  assert.equal(input[0].content.length, 3);
  assert.equal(input[0].content[1].type, "input_image");
  assert.equal(input[0].content[1].image_url, photo);
  for (const photos of [[], Array(4).fill(photo), ["https://private.invalid/food.jpg"], ["data:image/svg+xml;base64,YQ=="]]) assert.throws(() => validateMealAnalysis({ photos }));
});
test("nutrition distinguishes estimates, real zero, unknown, non-food and malformed output", () => {
  assert.equal(parseMealAnalysis(JSON.stringify(estimate)).nutrition.kcal, 580);
  assert.equal(parseMealAnalysis({ ...estimate, carbsG: 0 }).nutrition.carbsG, 0);
  for (const value of [{ ...estimate, isFood: false }, { ...estimate, kcal: null }, { ...estimate, fatG: -1 }, { ...estimate, proteinG: "35" }, { ...estimate, kcal: Infinity }, "not JSON"]) assert.throws(() => parseMealAnalysis(value));
  assert.equal(normalizeMealNutrition({ ...estimate, source: "manual" }).source, "manual");
});
test("native vision reuses plan credentials inside the plugin without forwarding Firebase tokens", async () => {
  let captured;
  const plan = createPlanClient({ analyzeMeal: async options => { captured = options; return { reply: JSON.stringify(estimate), model: "test-vision" }; }, cancel: async () => {} });
  const result = await analyzeMealPhotos({ photos: [photo], description: "一餐" }, { plan, user: { getIdToken: () => assert.fail("must not request a Firebase token") } });
  assert.deepEqual(captured, { body: { photos: [photo], description: "一餐" } });
  assert.equal(result.nutrition.model, "test-vision");
  await assert.rejects(analyzeMealPhotos({ photos: [photo] }, { plan: { analyzeMeal: async () => ({ reply: JSON.stringify(estimate), incomplete: true }) } }), /未完成/);
});
test("web analysis requires login and does not substitute a guessed result after provider failure", async () => {
  await assert.rejects(analyzeMealPhotos({ photos: [photo] }, { plan: null }), error => error.code === "MEAL_LOGIN_REQUIRED");
  let captured;
  const result = await analyzeMealPhotos({ photos: [photo] }, { plan: null, user: { getIdToken: async () => "fake-token" }, request: async (backend, options) => { captured = options; return { reply: JSON.stringify(estimate) }; } });
  assert.equal(captured.body.task, "meal-nutrition"); assert.equal(captured.token, "fake-token"); assert.equal(result.nutrition.proteinG, 35);
  await assert.rejects(analyzeMealPhotos({ photos: [photo] }, { plan: { analyzeMeal: async () => { throw new Error("网络暂不可用"); } } }), /网络/);
});
test("nutrition endpoint authenticates, sends schema-constrained images and never trusts client endpoints", async () => {
  const env = { FIREBASE_API_KEY: "fake-key", AI_ALLOWED_UIDS: "nutrition-test", OPENAI_API_KEY: "fake-server-secret" };
  const request = value => new Request("https://test.invalid/api/ai", { method: "POST", headers: { "Content-Type": "application/json", "X-AI-Task": "meal-nutrition", Authorization: "Bearer fake-token" }, body: JSON.stringify({ provider: "openai", task: "meal-nutrition", photos: [photo], ...value }) });
  const calls = [];
  const response = await handleAI(request({ baseURL: "https://attacker.invalid" }), env, async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? Response.json({ users: [{ localId: "nutrition-test" }] }) : Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(estimate) }] }] });
  });
  assert.equal(response.status, 200);
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(calls[1].url, "https://api.openai.com/v1/responses");
  assert.equal(payload.text.format.strict, true); assert.equal(payload.store, false);
  assert.equal(payload.input[0].content[1].image_url, photo);
  assert.match(payload.instructions, /不能重复计入/);
  const bad = await handleAI(request({ photos: ["https://private.invalid/x"] }), env, () => assert.fail("invalid images must not call a service"));
  assert.equal(bad.status, 400);
});
test("iOS declares Simplified Chinese for system pickers and exposes no date or meal-type controls", async () => {
  const plist = await readFile(new URL("../ios/App/App/Info.plist", import.meta.url), "utf8");
  assert.match(plist, /CFBundleDevelopmentRegion<\/key>\s*<string>zh-Hans/);
  assert.match(plist, /CFBundleLocalizations<\/key>\s*<array><string>zh-Hans/);
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const panel = html.slice(html.indexOf('id="mealPanel"'), html.indexOf('id="workoutPanel"'));
  assert.doesNotMatch(panel, /mealDateInput|mealWeekDays|mealSummaryTitle|mealFilters|data-meal-type/);
  const editor = html.slice(html.indexOf('id="mealDialog"'), html.indexOf('id="mealActionsDialog"'));
  assert.doesNotMatch(editor, /mealTypeChoices|mealTypeInput|mealEditorDate/);
});

test("daily totals sum saved estimates and manual values with missing nutrition kept distinct from zero", async () => {
  const { dailyMealNutrition } = await import("../js/meal-nutrition.js");
  const records = [
    { nutrition: { kcal: 580, carbsG: 62, proteinG: 35, fatG: 21 } },
    { nutrition: { kcal: 200.2, carbsG: 25.1, proteinG: 10.2, fatG: 5.3, source: "manual" } },
    { nutrition: null }, { nutrition: { kcal: -1, carbsG: 0, proteinG: 0, fatG: 0 } },
  ];
  assert.deepEqual(dailyMealNutrition(records), { kcal: 780.2, carbsG: 87.1, proteinG: 45.2, fatG: 26.3, entries: 4, counted: 2, missing: 2 });
  assert.deepEqual(dailyMealNutrition([]), { kcal: null, carbsG: null, proteinG: null, fatG: null, entries: 0, counted: 0, missing: 0 });
  assert.equal(dailyMealNutrition([{ nutrition: null }]).kcal, null);
  const zero = dailyMealNutrition([{ nutrition: { kcal: 0, carbsG: 0, proteinG: 0, fatG: 0 } }]);
  assert.equal(zero.kcal, 0); assert.equal(zero.counted, 1);
});

test("daily totals honor the local record date and recalculate when a record is edited or removed", async () => {
  const { dailyMealNutrition } = await import("../js/meal-nutrition.js");
  const nutrition = kcal => ({ kcal, carbsG: 0.1, proteinG: 0.2, fatG: 0.3 });
  const rows = [
    { id: "a", logDate: "2026-10-16", nutrition: nutrition(580) },
    { id: "b", recordedAt: new Date(2026, 9, 16, 15), nutrition: nutrition(200) },
    { id: "old", logDate: "2026-10-15", nutrition: nutrition(999) },
  ];
  assert.equal(dailyMealNutrition(rows, "2026-10-16").kcal, 780);
  assert.equal(dailyMealNutrition(rows, "2026-10-16").carbsG, 0.2);
  rows[0].nutrition = nutrition(620);
  assert.equal(dailyMealNutrition(rows, "2026-10-16").kcal, 820);
  rows.splice(0, 1);
  assert.equal(dailyMealNutrition(rows, "2026-10-16").kcal, 200);
});

test("saved cards keep nutrition values without duplicate AI actions", async () => {
  const { mealEntryHTML } = await import("../js/meal-diary.js");
  const record = { id: "saved-photo", recordedAt: new Date(), photos: [photo], name: "已上传图片" };
  for (const value of [record, { ...record, nutrition: estimate }, { ...record, photos: [], name: "一碗面" }]) {
    assert.doesNotMatch(mealEntryHTML(value), /data-meal-analyze|重新识别这餐营养|AI 识别热量与营养/);
    assert.match(mealEntryHTML(value), /data-meal-actions/);
  }
  assert.match(mealEntryHTML({ ...record, nutrition: estimate }), /580/);
});

test("text-only descriptions use real model input and reject empty, oversized or malformed requests", async () => {
  const body = { photos: [], description: "  米饭半碗、鸡胸肉150克、一个鸡蛋  " };
  const input = mealAnalysisInput(body);
  assert.equal(input[0].content.length, 1);
  assert.equal(input[0].content[0].type, "input_text");
  assert.match(input[0].content[0].text, /鸡胸肉150克/);
  for (const description of ["", " \n ", "饭".repeat(401), 42, {}]) assert.throws(() => validateMealAnalysis({ photos: [], description }));
  let captured;
  const result = await analyzeMealPhotos(body, { plan: { analyzeMeal: async value => { captured = value; return { reply: JSON.stringify(estimate) }; } } });
  assert.deepEqual(captured, { photos: [], description: body.description.trim() });
  assert.equal(result.nutrition.kcal, 580);
});

test("web text nutrition is authenticated and uses the same strict nutrition schema and portion assumptions", async () => {
  const env = { FIREBASE_API_KEY: "fake-key", AI_ALLOWED_UIDS: "text-test", OPENAI_API_KEY: "fake-key" };
  let payload;
  const response = await handleAI(new Request("https://test.invalid/api/ai", {
    method: "POST", headers: { "Content-Type": "application/json", "X-AI-Task": "meal-nutrition", Authorization: "Bearer fake-token" },
    body: JSON.stringify({ task: "meal-nutrition", provider: "openai", photos: [], description: "牛肉面一碗" }),
  }), env, async (url, options) => {
    if (url.includes("identitytoolkit")) return Response.json({ users: [{ localId: "text-test" }] });
    payload = JSON.parse(options.body);
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(estimate) }] }] });
  });
  assert.equal(response.status, 200);
  assert.equal(payload.input[0].content.length, 1);
  assert.match(payload.input[0].content[0].text, /牛肉面一碗/);
  assert.match(payload.instructions, /没有图片时直接识别文字/);
  assert.match(payload.instructions, /在portion列出每种食物假设的份量/);
  assert.equal(payload.text.format.strict, true);
});
