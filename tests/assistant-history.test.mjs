import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantHistory } from "../js/assistant-history.js";

const conversation = { id: "one", createdAt: 1, updatedAt: 2, shareRecords: true, range: "all", messages: [{ role: "user", content: "回顾一下", state: "failed" }] };
function fixture() {
  const data = new Map();
  return { data, persistence: { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) } };
}
test("history survives reopening with interrupted questions and stays isolated by App account", () => {
  const { persistence } = fixture();
  createAssistantHistory(persistence).save("account-a", { activeId: "one", conversations: [conversation] });
  assert.deepEqual(createAssistantHistory(persistence).load("account-a"), { activeId: "one", conversations: [conversation] });
  assert.deepEqual(createAssistantHistory(persistence).load("account-b"), { activeId: null, conversations: [] });
  assert.deepEqual(createAssistantHistory(persistence).load(null), { activeId: null, conversations: [] });
});
test("new conversation preserves older chats; only display messages and scope are persisted", () => {
  const { persistence, data } = fixture(), history = createAssistantHistory(persistence);
  history.save("a", { activeId: null, token: "secret-token", conversations: [
    { ...conversation, context: { privateRecords: "raw-health-context" }, messages: [{ role: "system", content: "hidden" }, { role: "user", content: "回顾一下", token: "secret-token" }, { role: "assistant", content: "好的", source: "健康记录摘要" }] },
    { ...conversation, id: "two", updatedAt: 3, shareRecords: false, range: "7" },
  ] });
  const loaded = history.load("a");
  assert.equal(loaded.activeId, null); assert.equal(loaded.conversations.length, 2);
  assert.equal(loaded.conversations[0].id, "two"); assert.equal(loaded.conversations[0].shareRecords, false);
  assert.equal(loaded.conversations[1].messages.length, 2);
  assert.ok(![...data.values()][0].includes("secret-token"));
  assert.ok(![...data.values()][0].includes("raw-health-context"));
});
test("storage failures surface instead of silently discarding conversation history", () => {
  const persistence = { getItem: () => "invalid-json", setItem: () => { throw new Error("quota"); } };
  const history = createAssistantHistory(persistence);
  assert.throws(() => history.load("a"), SyntaxError);
  assert.throws(() => history.save("a", { conversations: [conversation] }), /quota/);
});
test("public reasoning summaries survive reopening but raw reasoning is never persisted", () => {
  const { persistence, data } = fixture(), history = createAssistantHistory(persistence);
  history.save("a", { conversations: [{ ...conversation, messages: [{ role: "assistant", content: "回答", reasoningSummary: "公开摘要", reasoning: "private-raw-reasoning" }] }] });
  assert.equal(history.load("a").conversations[0].messages[0].reasoningSummary, "公开摘要");
  assert.ok(![...data.values()][0].includes("private-raw-reasoning"));
});
