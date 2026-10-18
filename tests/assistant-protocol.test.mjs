import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ASSISTANT_RESPONSE_FORMAT, parseAssistantResponse, validateAssistantPhotos } from "../js/assistant-protocol.js";
import { normalizeAssistantHistory } from "../js/assistant-history.js";
import { handleAI } from "../server/ai-service.js";

const photo = "data:image/jpeg;base64,YWJj";
test("images accept only bounded compressed uploads, never remote URLs or active content", () => {
  assert.deepEqual(validateAssistantPhotos([photo]), [photo]);
  for (const photos of [["https://tracker.invalid/"], ["data:image/svg+xml,<svg/>"], [photo, photo, photo, photo], [photo + "A".repeat(180000)]]) assert.throws(() => validateAssistantPhotos(photos));
  assert.throws(() => parseAssistantResponse('{"reply":"not finished"'));
  assert.throws(() => parseAssistantResponse({ reply: "ok", actions: Array(9).fill({}) }));
});
test("history stores attachment references and results without persisting image bytes or replayable operations", () => {
  const id = "a".repeat(64);
  const history = normalizeAssistantHistory({ activeId: "one", conversations: [{ id: "one", updatedAt: 1, messages: [
    { role: "user", content: "看图", photos: [photo], photoIds: [id, "invalid"] },
    { role: "assistant", content: "待确认", proposals: [{ category: "water" }], actionNotice: "需要重新核对" },
  ] }] });
  assert.deepEqual(history.conversations[0].messages[0].photoIds, [id]);
  assert.ok(!JSON.stringify(history).includes(photo)); assert.ok(!JSON.stringify(history).includes("proposals"));
  assert.equal(history.conversations[0].messages[1].actionNotice, "需要重新核对");
});
test("native and web structured proposal schemas cannot drift", async () => {
  const swift = await readFile(new URL("../ios/App/App/ChatGPTCore.swift", import.meta.url), "utf8");
  const text = swift.match(/let data = Data\(#"(\{"type":"json_schema","name":"health_assistant".+)"#\.utf8\)/)?.[1];
  assert.deepEqual(JSON.parse(text), ASSISTANT_RESPONSE_FORMAT);
});
test("interactive request transports current images and only returns unexecuted structured proposals", async () => {
  const body = { provider: "openai", interactive: true, photos: [photo], shareRecords: false, context: null, actionCatalog: { records: [], localDate: "2026-10-18" }, messages: [{ role: "user", content: "记录喝水 250ml" }] };
  const request = () => new Request("https://test.invalid/api/ai", { method: "POST", headers: { Authorization: "Bearer fake-token", "Content-Type": "application/json", "X-AI-Task": "assistant" }, body: JSON.stringify(body) });
  let payload;
  const env = { FIREBASE_API_KEY: "test", AI_ALLOWED_UIDS: "protocol-test", OPENAI_API_KEY: "test-secret" };
  const response = await handleAI(request(), env, async (url, options) => {
    if (url.includes("identitytoolkit")) return Response.json({ users: [{ localId: "protocol-test" }] });
    payload = JSON.parse(options.body);
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ reply: "请确认", actions: [{ operation: "create", category: "water", values: { amount: 250 } }] }) }] }] });
  });
  assert.equal(response.status, 200); assert.equal((await response.json()).actions.length, 1);
  assert.deepEqual(payload.text.format, ASSISTANT_RESPONSE_FORMAT); assert.equal(payload.store, false);
  assert.equal(payload.input.at(-1).content[1].image_url, photo);
  assert.match(payload.instructions, /普通咨询 actions=\[\]/);
  body.photos = ["https://unapproved.invalid/image"];
  assert.equal((await handleAI(request(), env, () => assert.fail("bad image must not call a model"))).status, 400);
  body.photos = []; body.actionCatalog.records = [{ ref: "r1" }];
  assert.equal((await handleAI(request(), env, () => assert.fail("unshared records must not be sent"))).status, 400);
});
