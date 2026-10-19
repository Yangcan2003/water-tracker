import test from "node:test";
import assert from "node:assert/strict";
import { previewAssistantReply } from "../js/assistant-stream.js";
import { createPlanClient } from "../js/chatgpt-plan-client.js";

test("every partial JSON boundary previews only decoded reply text, never actions or transport escapes", () => {
  const reply = '先看 **营养**。\n\n🥛 标签写着“原味”\\每100g\t"引用"';
  const raw = JSON.stringify({ actions: [{ values: { reply: "不是回答", note: '"reply":"陷阱"' } }], reply });
  for (let i = 0; i <= raw.length; i++) {
    const preview = previewAssistantReply(raw.slice(0, i));
    assert.ok(reply.startsWith(preview), `invalid prefix at ${i}: ${preview}`);
    assert.ok(!/[\uD800-\uDBFF]$/.test(preview));
  }
  assert.equal(previewAssistantReply(raw), reply);
  assert.equal(previewAssistantReply('{"reply":"行\\n\\u81b3\\u98df\\uD83E'), "行\n膳食");
  assert.equal(previewAssistantReply('{"reply":"行\\n\\u81b3\\u98df\\uD83E\\uDD5B'), "行\n膳食🥛");
  for (const invalid of [null, "", "plain text", '[{"reply":"bad"}]', '{"reply":42}', '{"reply":"bad\\q']) assert.equal(previewAssistantReply(invalid), invalid?.includes("bad\\q") ? "bad" : "");
});

function bridge() {
  let emit, resolve, reject, options, removed = 0;
  const started = new Promise(done => {
    const plugin = {
      async addListener(name, callback) { assert.equal(name, "chatProgress"); emit = callback; return { async remove() { removed++; } }; },
      chat(value) { options = value; done(); return new Promise((yes, no) => { resolve = yes; reject = no; }); },
      async cancel() { reject(new DOMException("cancel", "AbortError")); },
    };
    queueMicrotask(() => { state.client = createPlanClient(plugin); state.ready(); });
  });
  const state = { client: null, ready: null };
  const ready = new Promise(done => { state.ready = done; });
  return { ready, started, state, emit: event => emit({ requestID: options.requestID, ...event }), resolve: value => resolve(value), reject: error => reject(error), removed: () => removed };
}

test("native progress appears before completion, rejects other requests, replaces retries and removes listeners", async () => {
  const f = bridge(); await f.ready; const updates = [];
  const pending = f.state.client.request("", { method: "POST", body: { interactive: true }, onProgress: value => updates.push(value) });
  await f.started;
  f.emit({ requestID: "old-request", text: '{"reply":"old"}' }); assert.equal(updates.length, 0);
  f.emit({ text: "", reasoningSummary: "公开摘要" });
  f.emit({ text: '{"reply":"已读取', reasoningSummary: "公开摘要" });
  assert.equal(updates.at(-1).reply, "已读取");
  f.emit({ text: "", reasoningSummary: "" }); assert.equal(updates.at(-1).reply, "");
  f.emit({ text: '{"reply":"新回答","actions":[{"category":"food"}]}' });
  assert.deepEqual(updates.at(-1), { reply: "新回答", reasoningSummary: "" });
  f.resolve({ reply: "新回答", actions: [] }); await pending;
  const count = updates.length;
  f.emit({ text: '{"reply":"late"}' }); assert.equal(updates.length, count); assert.equal(f.removed(), 1);
});

test("failed and manually cancelled native streams remove progress listeners and ignore late updates", async () => {
  for (const cancel of [false, true]) {
    const f = bridge(); await f.ready; const updates = [], controller = new AbortController();
    const pending = f.state.client.request("", { method: "POST", body: { interactive: true }, signal: controller.signal, onProgress: value => updates.push(value) });
    await f.started;
    if (cancel) controller.abort(); else f.reject(new Error("network"));
    await assert.rejects(pending);
    f.emit({ text: '{"reply":"late"}' }); assert.equal(updates.length, 0); assert.equal(f.removed(), 1);
  }
});
