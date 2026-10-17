import { chatGPTPlan } from "./chatgpt-plan-client.js";
import { assistantRequest, DEFAULT_AI_BACKEND } from "./assistant-client.js";
import { parseMealAnalysis, validateMealAnalysis } from "./meal-nutrition.js";

export async function analyzeMeal(body, { user, signal, plan = chatGPTPlan, request = assistantRequest } = {}) {
  const selected = validateMealAnalysis(body);
  let response;
  if (plan) response = await plan.analyzeMeal(selected, signal);
  else {
    if (!user) throw Object.assign(new Error("请先登录 App，再识别食物营养"), { code: "MEAL_LOGIN_REQUIRED" });
    const token = await user.getIdToken();
    response = await request(DEFAULT_AI_BACKEND, { method: "POST", token, signal, body: { ...selected, provider: "openai", task: "meal-nutrition" } });
  }
  if (response.incomplete) throw new Error("识别未完成，请稍后重试");
  const result = parseMealAnalysis(response.reply);
  result.nutrition.model = typeof response.model === "string" ? response.model.slice(0, 160) : "";
  return result;
}
export const analyzeMealPhotos = analyzeMeal;
