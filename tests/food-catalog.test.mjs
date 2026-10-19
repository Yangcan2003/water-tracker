import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFavoriteFood, normalizeFoodCatalog, validateFoodReferences, foodServingLabel, foodEnergyToKcal, foodEnergyFromKcal } from "../js/food-catalog.js";
import { mealAnalysisInput, validateMealAnalysis, MEAL_NUTRITION_INSTRUCTIONS } from "../js/meal-nutrition.js";
import { analyzeMeal } from "../js/meal-nutrition-client.js";
import { handleAI } from "../server/ai-service.js";
const food = { id: "oats", name: "原味燕麦片", aliases: "测试燕麦", servingAmount: 100, servingUnit: "g", kcal: 380, carbsG: 60, proteinG: 13, fatG: 7, fiberG: null, sodiumMg: null, saturatedFatG: null, sugarsG: null, addedSugarsG: null, note: "干重" };
const photo = "data:image/jpeg;base64,YQ==";

test("favorite foods preserve per-portion units, zeros and decimal nutrition without trusting extra fields", () => {
  assert.deepEqual(normalizeFavoriteFood({ ...food, privateField: "omit" }), food);
  assert.equal(foodServingLabel(food), "每 100 g");
  assert.equal(foodServingLabel({ ...food, servingAmount: 1, servingUnit: "袋" }), "每 1 袋");
  assert.equal(normalizeFavoriteFood({ ...food, kcal: 0, carbsG: 0 }).kcal, 0);
  for (const patch of [{ name: " " }, { id: "" }, { servingAmount: 0 }, { servingAmount: "100" }, { servingUnit: "unknown" }, { fatG: -1 }, { kcal: NaN }, { kcal: Infinity }, { kcal: null }, { note: "字".repeat(81) }]) assert.equal(normalizeFavoriteFood({ ...food, ...patch }), null);
});
test("catalog normalization handles legacy garbage while AI validation rejects malformed or oversized context", () => {
  assert.deepEqual(normalizeFoodCatalog([food, null, food]), [food]);
  assert.deepEqual(normalizeFoodCatalog(undefined), []);
  assert.deepEqual(validateFoodReferences(undefined), []);
  for (const value of [{}, [food, food], [{ ...food, proteinG: null }], Array.from({ length: 51 }, (_, i) => ({ ...food, id: `food-${i}` }))]) assert.throws(() => validateFoodReferences(value));
});
test("text and image recognition include only validated food data, with portion/matching instructions", () => {
  for (const photos of [[], [photo]]) {
    const input = mealAnalysisInput({ photos, description: "测试燕麦50g", foodReferences: [food] });
    assert.equal(input[0].content.length, photos.length + 1);
    assert.match(input[0].content[0].text, /测试燕麦50g/);
    assert.match(input[0].content[0].text, /"servingAmount":100/);
    assert.match(input[0].content[0].text, /"kcal":380/);
    assert.match(input[0].content[0].text, /不代表本餐食用/);
  }
  assert.throws(() => validateMealAnalysis({ photos: [], description: "", foodReferences: [food] }));
  assert.match(MEAL_NUTRITION_INSTRUCTIONS, /优先采用该条目所保存的每份营养/);
  assert.match(MEAL_NUTRITION_INSTRUCTIONS, /g与ml不可默认等同/);
  assert.match(MEAL_NUTRITION_INSTRUCTIONS, /不得整表相加/);
});
test("native and web clients forward catalog context and refuse invalid context before invoking AI", async () => {
  const body = { photos: [], description: "测试燕麦50g", foodReferences: [food] };
  const estimate = { isFood: true, name: "燕麦", kcal: 190, carbsG: 30, proteinG: 6.5, fatG: 3.5, portion: "50g", note: "参考常吃食物" };
  let sent;
  await analyzeMeal(body, { plan: { analyzeMeal: async selected => { sent = selected; return { reply: JSON.stringify(estimate) }; } } });
  assert.deepEqual(sent.foodReferences, [food]);
  const env = { FIREBASE_API_KEY: "fake-key", AI_ALLOWED_UIDS: "food-test", OPENAI_API_KEY: "fake-key" };
  let payload;
  const response = await handleAI(new Request("https://test.invalid/api/ai", { method: "POST", headers: { "Content-Type": "application/json", "X-AI-Task": "meal-nutrition", Authorization: "Bearer fake-token" }, body: JSON.stringify({ ...body, task: "meal-nutrition", provider: "openai" }) }), env, async (url, options) => {
    if (url.includes("identitytoolkit")) return Response.json({ users: [{ localId: "food-test" }] });
    payload = JSON.parse(options.body);
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(estimate) }] }] });
  });
  assert.equal(response.status, 200);
  assert.match(payload.input[0].content[0].text, /"kcal":380/);
  assert.equal(payload.text.format.strict, true);
  await assert.rejects(analyzeMeal({ ...body, foodReferences: [{ ...food, servingUnit: "bad" }] }, { plan: { analyzeMeal: () => assert.fail("invalid context must not reach the model") } }));
});

test("food energy conversion keeps kJ and kcal consistent, including zero and invalid input", () => {
  assert.ok(Math.abs(foodEnergyToKcal(418.4, "kJ") - 100) < 1e-10);
  assert.ok(Math.abs(foodEnergyFromKcal(100, "kJ") - 418.4) < 1e-10);
  assert.equal(foodEnergyToKcal(0, "kJ"), 0);
  assert.equal(foodEnergyToKcal(380, "kcal"), 380);
  for (const value of [null, "", "100", NaN, Infinity, -1]) assert.equal(foodEnergyToKcal(value, "kJ"), null);
  assert.equal(foodEnergyToKcal(100, "bad"), null);
  assert.equal(normalizeFavoriteFood({ ...food, kcal: foodEnergyToKcal(418.4, "kJ") }).kcal, 100);
});

test("optional nutrients preserve unknown and true zero, and reject invalid sugar/fat composition", () => {
  const legacy = { ...food }; for (const key of ["fiberG", "sodiumMg", "saturatedFatG", "sugarsG", "addedSugarsG"]) delete legacy[key];
  assert.equal(normalizeFavoriteFood(legacy).sodiumMg, null);
  assert.equal(normalizeFavoriteFood({ ...legacy, sodiumMg: 0 }).sodiumMg, 0);
  for (const values of [{ fiberG: -1 }, { sodiumMg: "100" }, { sodiumMg: 100001 }, { saturatedFatG: 8 }, { sugarsG: 61 }, { sugarsG: 10, addedSugarsG: 11 }]) assert.equal(normalizeFavoriteFood({ ...food, ...values }), null);
  const complete = normalizeFavoriteFood({ ...food, fiberG: 7, sodiumMg: 120, saturatedFatG: 1.2, sugarsG: 3, addedSugarsG: 0 });
  assert.equal(validateFoodReferences([complete])[0].addedSugarsG, 0);
  const selected = mealAnalysisInput({ photos: [photo], foodReferences: [complete], description: "50g" });
  assert.match(selected[0].content[0].text, /"sodiumMg":120/);
  assert.match(MEAL_NUTRITION_INSTRUCTIONS, /不能把未标示添加糖当作0/);
});
