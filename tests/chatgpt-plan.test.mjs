import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { createAttempt, acceptCallback, validateIdentity, requirePlanScope, readCompletedResponse, ISSUER } from "../scripts/chatgpt-plan-auth.mjs";

const options = { hostId: "urn:uuid:12345678-1234-4234-8234-123456789abc", port: 1455, now: 1000 };
function callback(attempt, extra = {}) {
  return `${attempt.redirect}?${new URLSearchParams({ state: attempt.state, code: "test-code", client_id: "oaiapp_test", ...extra })}`;
}
test("personal ChatGPT registration binds state, nonce, PKCE and an exact loopback callback", () => {
  const { attempt, url } = createAttempt(options);
  const parsed = new URL(url);
  assert.equal(parsed.origin, ISSUER);
  assert.equal(parsed.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(parsed.searchParams.get("redirect_uri"), "http://127.0.0.1:1455/auth/callback");
  assert.equal(parsed.searchParams.get("code_challenge"), createHash("sha256").update(attempt.verifier).digest("base64url"));
  assert.match(parsed.searchParams.get("scope"), /chatgpt.tokens.use.direct/);
  assert.notEqual(attempt.nonce, attempt.state);
  assert.throws(() => acceptCallback(attempt, callback(attempt, { state: "wrong" }), 1001), /状态/);
  assert.equal(attempt.used, false);
  assert.deepEqual(acceptCallback(attempt, callback(attempt), 1001), { code: "test-code", clientId: "oaiapp_test" });
  assert.throws(() => acceptCallback(attempt, callback(attempt), 1002), /状态/);
});
test("OAuth rejects expired, duplicate and changed registration callbacks", () => {
  const { attempt } = createAttempt(options);
  assert.throws(() => acceptCallback(attempt, callback(attempt), attempt.expires + 1), /过期/);
  assert.throws(() => acceptCallback(attempt, callback(attempt).replace("127.0.0.1", "localhost"), 1001), /地址/);
  assert.throws(() => acceptCallback(attempt, callback(attempt) + "&state=other", 1001), /状态/);
  const returning = createAttempt({ ...options, clientId: "oaiapp_original" });
  assert.equal(new URL(returning.url).searchParams.has("agent_name_hint"), false);
  assert.throws(() => acceptCallback(returning.attempt, callback(returning.attempt), 1001), /注册/);
});

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "RS256", use: "sig" }] };
const identityOptions = { clientId: "oaiapp_test", nonce: "test-nonce", now: 1000 };
function jwt(overrides = {}, header = {}) {
  const parts = [Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-kid", ...header })).toString("base64url"), Buffer.from(JSON.stringify({ iss: ISSUER, aud: "oaiapp_test", sub: "fake-subject", nonce: "test-nonce", exp: 2000, iat: 900, ...overrides })).toString("base64url")];
  return [...parts, sign("RSA-SHA256", Buffer.from(parts.join(".")), privateKey).toString("base64url")].join(".");
}
test("OIDC requires a valid signature, issuer, audience, expiry and nonce", () => {
  assert.deepEqual(validateIdentity(jwt(), jwks, identityOptions), { subject: "fake-subject" });
  for (const claims of [{ iss: "https://other.invalid" }, { aud: "other-client" }, { nonce: "other" }, { exp: 999 }, { iat: 5000 }, { sub: "" }, { aud: ["oaiapp_test", "other"], azp: "other" }]) assert.throws(() => validateIdentity(jwt(claims), jwks, identityOptions), /验证未通过/);
  for (const header of [{ alg: "none" }, { alg: "HS256" }, { kid: "unknown" }]) assert.throws(() => validateIdentity(jwt({}, header), jwks, identityOptions), /验证未通过/);
  const tampered = jwt().split("."); tampered[1] = Buffer.from(JSON.stringify({ sub: "attacker" })).toString("base64url");
  assert.throws(() => validateIdentity(tampered.join("."), jwks, identityOptions), /验证未通过/);
});
test("identity sign-in alone never enables ChatGPT plan inference", () => {
  assert.throws(() => requirePlanScope({ access_token: "fake", token_type: "Bearer", scope: "openid profile email" }), /未获准/);
  requirePlanScope({ access_token: "fake", token_type: "Bearer", scope: "openid resource.invoke chatgpt.tokens.use.direct" });
});
const stream = text => new ReadableStream({ start(controller) { const bytes = new TextEncoder().encode(text); for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } });
test("stream parsing preserves split UTF-8 and requires completed inference", async () => {
  const output = 'data: {"type":"response.output_text.delta","delta":"连接成功"}\r\n\r\n';
  const completion = 'data: {"type":"response.completed","response":{"status":"completed"}}\n\n';
  assert.equal(await readCompletedResponse(stream(output + completion)), "连接成功");
  await assert.rejects(readCompletedResponse(stream(output + "data: [DONE]\n\n")), /完整/);
  await assert.rejects(readCompletedResponse(stream(output + 'data: {"type":"response.failed"}\n\n')), /失败/);
});
