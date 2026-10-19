import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createPlanClient } from "../js/chatgpt-plan-client.js";
import { buildHealthContext } from "../js/assistant-context.js";

test("native chat preserves bounded JSON decimals, all-history records and current photos without mutating the request", async () => {
  const context = buildHealthContext(Array.from({ length: 17 }, (_, i) => ({
    dateKey: `2026-09-${String(i + 1).padStart(2, "0")}`, mealRecs: [{ mealType: "lunch", name: "酸奶/燕麦/水果", note: "每100g/每杯/营养标签", nutrition: { kcal: 123.4, carbsG: 12.3, proteinG: 4.5, fatG: 6.7 } }],
  })), { compact: true, rangeDays: "all", categories: ["meal"], now: new Date("2026-10-19T12:00:00Z") });
  let sent;
  const client = createPlanClient({ chat: async value => { sent = value.body; return { reply: "已识别", actions: [] }; } });
  const body = { messages: [{ role: "user", content: "添加到常吃" }], shareRecords: true, interactive: true, context,
    actionCatalog: { records: [], localDate: "2026-10-19", goals: { fatG: 56.7 } }, photos: ["data:image/jpeg;base64,YQ==", "data:image/jpeg;base64,Yg=="] };
  await client.request("", { method: "POST", body });
  assert.equal(sent.context, JSON.stringify(context));
  assert.deepEqual(JSON.parse(sent.actionCatalog), body.actionCatalog);
  assert.deepEqual(sent.photos, body.photos);
  assert.equal(body.context, context); assert.equal(typeof body.actionCatalog, "object");
  assert.equal(JSON.parse(sent.context).days.length, 17);
});

test("native plan bridge sends only selected chat and cancels requests without forwarding Firebase credentials", async () => {
  const calls = [];
  const client = createPlanClient({
    getState: async () => ({ connected: false, account: "test" }),
    chat: async value => { calls.push(value); return { reply: "连接成功" }; },
    cancel: async () => { calls.push("cancel"); },
  });
  assert.equal(client.managesRequestLifetime, true);
  assert.equal((await client.request("https://unused.invalid")).providers[0].configured, false);
  const body = { messages: [{ role: "user", content: "hi" }], shareRecords: false, context: null };
  assert.equal((await client.request("https://unused.invalid", { method: "POST", token: "fake-firebase-token", body })).reply, "连接成功");
  assert.deepEqual(calls, [{ body }]);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.request("", { method: "POST", signal: controller.signal, body }), { name: "AbortError" });
  const pending = new AbortController();
  const aborted = client.request("", { method: "POST", body, signal: pending.signal }); pending.abort();
  await assert.rejects(aborted, { name: "AbortError" });
  assert.equal(calls.at(-1), "cancel");
});

test("Swift native OAuth rejects invalid signatures, claims, callbacks and unfinished streams", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp("/private/tmp/water-plan-native-tests-");
  try {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "RS256", use: "sig" }] };
    const jwt = (claims = {}, header = {}) => {
      const parts = [Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-kid", ...header })).toString("base64url"), Buffer.from(JSON.stringify({ iss: "https://auth.openai.com", aud: "oaiapp_test", sub: "fake-subject", nonce: "test-nonce", exp: 2000, iat: 900, ...claims })).toString("base64url")];
      return [...parts, sign("RSA-SHA256", Buffer.from(parts.join(".")), privateKey).toString("base64url")].join(".");
    };
    const valid = jwt(); const tampered = valid.split("."); tampered[1] = Buffer.from('{"sub":"attacker"}').toString("base64url");
    const invalid = [{ iss: "https://wrong.invalid" }, { aud: "other" }, { exp: 999 }, { nonce: "wrong" }, { sub: "" }, { iat: 5000 }, { nbf: 5000 }, { aud: ["oaiapp_test", "other"], azp: "other" }].map(value => jwt(value));
    invalid.push(jwt({}, { alg: "none" }), jwt({}, { kid: "missing" }), tampered.join("."));
    // Real compact all-history snapshot near the JS budget. Foundation's
    // NSNumber re-encoding expands decimal values enough to reject this input.
    let snapshot;
    for (let n = 1; n <= 25; n++) {
      const candidate = buildHealthContext(Array.from({ length: n }, (_, i) => ({ dateKey: `2026-09-${String(i + 1).padStart(2, "0")}`, mealRecs: [{ name: "酸奶/燕麦/水果", note: "每100g/每杯/营养标签", mealType: "lunch", nutrition: { kcal: 123.4, carbsG: 12.3, proteinG: 4.5, fatG: 6.7 } }] })), { compact: true, rangeDays: "all", categories: ["meal"], now: new Date("2026-10-19T12:00:00Z") });
      if (!candidate.summarized) snapshot = candidate;
    }
    assert.ok(JSON.stringify(snapshot).length > 17000);
    const bridgeContext = JSON.stringify(snapshot);
    const bridgeCatalog = JSON.stringify({ records: [{ category: "food", ref: "r1", values: { name: "🥛原味酸奶", fatG: 6.7 } }] });
    await writeFile(`${directory}/fixtures.json`, JSON.stringify({ jwks, valid, invalid, bridgeContext, bridgeCatalog }));
    execFileSync("xcrun", ["swiftc", "-module-cache-path", "/private/tmp/water-tracker-swift-cache", "ios/App/App/ChatGPTCore.swift", "tests/ChatGPTCoreTests.swift", "-o", `${directory}/checks`], { timeout: 60000, stdio: "pipe" });
    assert.match(execFileSync(`${directory}/checks`, [`${directory}/fixtures.json`], { encoding: "utf8", timeout: 10000 }), /checks passed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
