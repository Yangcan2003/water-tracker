import test from "node:test";
import assert from "node:assert/strict";
import { prepareAssistantAction, buildActionCatalog } from "../js/assistant-actions.js";
import { serializeAssistantProposal, restoreAssistantProposal, needsProposalRecovery, proposalRecoveryQuestion } from "../js/assistant-proposals.js";

test("stored review cards whitelist target fields and do not retain full profiles, credentials or image bytes", () => {
  const profile = { dailyGoal: 2000, email: "private-email", token: "private-token", secret: "private-secret", foodCatalog: [], nutritionGoal: { weightKg: 70, ratios: { carbsG: 3, proteinG: 1.6, fatG: 0.8 }, daily: { fiberG: 30, sodiumMg: 1800 } } };
  const change = prepareAssistantAction({ operation: "update", category: "goals", ref: "goals", values: { waterGoalMl: 2400 } }, buildActionCatalog([], {}, profile));
  change.after.photos = ["data:image/jpeg;base64,cHJpdmF0ZS1waG90bw=="];
  const stored = serializeAssistantProposal(change), text = JSON.stringify(stored);
  assert.ok(!text.includes("private-")); assert.ok(!text.includes("data:image")); assert.ok(!text.includes("foodCatalog"));
  const restored = restoreAssistantProposal(JSON.parse(text));
  assert.equal(restored.state, "pending"); assert.equal(restored.after.dailyGoal, 2400);
  assert.deepEqual(restored.after.nutritionGoal.daily, { fiberG: 30, sodiumMg: 1800 });
});
test("malformed stored cards cannot become executable or point to unvalidated targets", () => {
  const change = prepareAssistantAction({ operation: "create", category: "water", values: { amount: 250 } }, { references: new Map() });
  const stored = serializeAssistantProposal(change);
  for (const value of [{ ...stored, writeID: "../bad" }, { ...stored, action: { ...stored.action, category: "account" } }, { ...stored, action: { ...stored.action, values: { amount: -1 } } }, { ...stored, action: { ...stored.action, operation: "delete" } }]) assert.equal(restoreAssistantProposal(value).state, "invalid");
});
test("legacy missing cards expose an explicit recovery request without parsing or saving chat text", () => {
  const legacy = { content: "请核对这餐881 kcal。", actionNotice: "包含待确认的记录变更；重新打开后请重新提问以核对最新记录。" };
  assert.equal(needsProposalRecovery(legacy), true);
  assert.equal(needsProposalRecovery({ ...legacy, proposals: [{ state: "applied" }] }), false);
  assert.equal(needsProposalRecovery({ content: "普通饮食建议" }), false);
  const question = proposalRecoveryQuestion(legacy, "请添加晚餐");
  assert.match(question, /保存卡片/); assert.match(question, /请添加晚餐/); assert.match(question, /881 kcal/); assert.ok(question.length <= 2000);
  assert.equal(needsProposalRecovery({ ...legacy, actionNotice: "已重新生成保存卡片，请在最新回复中确认。" }), false);
  assert.match(proposalRecoveryQuestion({ ...legacy, source: "12:59 读取 · 2026-06-14 — 2026-10-19 · 健康记录摘要" }), /当时读取记录的日期是2026-10-19/);
});
