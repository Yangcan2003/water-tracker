// Isolated browser fixture, never used in a production build.
import { validateMealAnalysis } from "../js/meal-nutrition.js";
let connected = false;
export const chatGPTPlan = {
  async getState() { return { connected }; },
  async connect() { connected = true; return { connected }; },
  async request() { return { providers: [{ id: "openai", configured: connected }], connected }; },
  async analyzeMeal(body, signal) {
    validateMealAnalysis(body);
    if (!connected) throw Object.assign(new Error("请先连接 ChatGPT"), { code: "PLAN_AUTH_REQUIRED" });
    await new Promise(resolve => setTimeout(resolve, 120));
    if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");
    return { reply: JSON.stringify({ isFood: true, name: "米饭与鸡肉", kcal: 580, carbsG: 62, proteinG: 35, fatG: 21, portion: "可见整份食物", note: "烹饪油量存在误差" }), model: "模拟视觉模型" };
  },
};
