import { randomBytes, createHash, createPublicKey, verify, timingSafeEqual } from "node:crypto";

export const ISSUER = "https://auth.openai.com";
export const RESOURCE = "https://api.openai.com/v1";
export const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const random = () => randomBytes(32).toString("base64url");
const same = (a, b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createAttempt({ hostId, clientId, port, now = Date.now() }) {
  if (!/^urn:uuid:[a-f0-9-]{36}$/i.test(hostId) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("授权环境无效");
  const attempt = { state: random(), nonce: random(), verifier: random(), clientId: clientId || null, redirect: `http://127.0.0.1:${port}/auth/callback`, expires: now + 10 * 60000, used: false };
  const url = new URL(`${ISSUER}/api/accounts/authorize`);
  url.search = new URLSearchParams({ client_id: clientId || "dynamic_agent_client", ...(clientId ? {} : { agent_name_hint: "每日健康追踪" }), ext_agent_host_id: hostId, response_type: "code", redirect_uri: attempt.redirect, scope: SCOPES, resource: RESOURCE, state: attempt.state, nonce: attempt.nonce, code_challenge_method: "S256", code_challenge: createHash("sha256").update(attempt.verifier).digest("base64url") }).toString();
  return { attempt, url: url.href };
}

export function acceptCallback(attempt, callbackURL, now = Date.now()) {
  const url = new URL(callbackURL);
  if (url.origin !== new URL(attempt.redirect).origin || url.pathname !== "/auth/callback") throw new Error("授权回调地址不匹配");
  if (attempt.used || now > attempt.expires || url.searchParams.getAll("state").length !== 1 || !same(url.searchParams.get("state"), attempt.state)) throw new Error("授权已过期或状态不匹配");
  attempt.used = true;
  if (url.searchParams.has("error")) throw new Error("授权未获允许或该账号暂不支持会员接入");
  const clientId = url.searchParams.get("client_id") || attempt.clientId;
  const code = url.searchParams.get("code");
  if (url.searchParams.getAll("code").length !== 1 || url.searchParams.getAll("client_id").length > 1 || !code || code.length > 8192 || !clientId || clientId === "dynamic_agent_client" || !/^[a-zA-Z0-9_-]{1,200}$/.test(clientId) || (attempt.clientId && clientId !== attempt.clientId)) throw new Error("授权注册未完成");
  return { code, clientId };
}

export function validateIdentity(token, jwks, { clientId, nonce, now = Math.floor(Date.now() / 1000) }) {
  try {
    if (typeof token !== "string" || token.length > 32000) throw new Error();
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error();
    const header = JSON.parse(Buffer.from(parts[0], "base64url"));
    const claims = JSON.parse(Buffer.from(parts[1], "base64url"));
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error();
    const keys = jwks.keys?.filter(key => key.kid === header.kid && key.kty === "RSA" && (!key.alg || key.alg === "RS256") && (!key.use || key.use === "sig"));
    if (keys?.length !== 1 || !verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: keys[0], format: "jwk" }), Buffer.from(parts[2], "base64url"))) throw new Error();
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== ISSUER || !audience.includes(clientId) || (audience.length > 1 && claims.azp !== clientId) || !same(claims.nonce, nonce) || typeof claims.exp !== "number" || claims.exp <= now || (typeof claims.nbf === "number" && claims.nbf > now + 60) || (typeof claims.iat === "number" && claims.iat > now + 60) || typeof claims.sub !== "string" || !claims.sub) throw new Error();
    return { subject: claims.sub };
  } catch { throw new Error("OpenAI 身份验证未通过，已停止测试"); }
}

export function requirePlanScope(tokens) {
  const scopes = String(tokens.scope || "").split(/\s+/);
  if (!tokens.access_token || tokens.token_type?.toLowerCase() !== "bearer" || !scopes.includes("resource.invoke") || !scopes.includes("chatgpt.tokens.use.direct")) throw new Error("已登录，但未获准使用 ChatGPT 会员用量");
}

export async function readCompletedResponse(stream) {
  if (!stream) throw new Error("模型响应为空");
  const reader = stream.getReader(), decoder = new TextDecoder();
  let buffer = "", text = "", bytes = 0, completed = false;
  const consume = block => {
    const data = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data);
    if (["response.failed", "response.incomplete", "error"].includes(event.type)) throw new Error("模型请求失败或未完成");
    if (event.type === "response.output_text.delta") { if (typeof event.delta !== "string") throw new Error("模型文本格式无效"); text += event.delta; }
    if (text.length > 4096) throw new Error("连接测试输出超出范围");
    if (event.type === "response.completed") { if (event.response?.status && event.response.status !== "completed") throw new Error("模型请求未完成"); completed = true; }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) { buffer += decoder.decode(); if (buffer.trim()) consume(buffer); break; }
      bytes += value.byteLength;
      if (bytes > 256000) throw new Error("连接测试响应超出范围");
      buffer += decoder.decode(value, { stream: true });
      let split;
      while ((split = /\r?\n\r?\n/.exec(buffer))) { consume(buffer.slice(0, split.index)); buffer = buffer.slice(split.index + split[0].length); }
    }
    if (!completed || !text.trim()) throw new Error("未收到完整模型回答，不能确认会员调用成功");
    return text.trim();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
