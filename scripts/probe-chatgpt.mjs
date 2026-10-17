// Personal, local feasibility probe. OAuth tokens stay in memory and are never
// sent to Cloudflare, printed, written to disk, or read from another application.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { ISSUER, RESOURCE, createAttempt, acceptCallback, validateIdentity, requirePlanScope, readCompletedResponse } from "./chatgpt-plan-auth.mjs";

const registrationPath = new URL("../chatgpt-host.local.json", import.meta.url);
let registration;
try { registration = JSON.parse(await readFile(registrationPath, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw new Error("本机授权注册文件无效"); registration = { hostId: `urn:uuid:${randomUUID()}` }; }
async function saveRegistration() { await writeFile(registrationPath, JSON.stringify(registration, null, 2) + "\n", { mode: 0o600 }); }
await saveRegistration();
const fetchOptions = () => ({ signal: AbortSignal.timeout(30000), redirect: "error" });
let server, timer, tokens;
try {
  const discoveryResponse = await fetch(`${ISSUER}/.well-known/openid-configuration`, fetchOptions());
  if (!discoveryResponse.ok) throw new Error(`OpenAI 授权发现服务不可用（HTTP ${discoveryResponse.status}）`);
  const discovery = await discoveryResponse.json();
  if (discovery.issuer !== ISSUER || discovery.authorization_endpoint !== `${ISSUER}/api/accounts/authorize` || discovery.token_endpoint !== `${ISSUER}/api/accounts/oauth/token` || discovery.jwks_uri !== `${ISSUER}/.well-known/jwks.json`) throw new Error("OpenAI 发布的授权端点与官方文档不一致，已停止测试");
  let attempt;
  const callback = new Promise((resolve, reject) => {
    server = createServer((request, response) => {
      const origin = attempt ? new URL(attempt.redirect).origin : "http://127.0.0.1";
      const url = new URL(request.url, origin);
      if (!attempt || request.method !== "GET" || url.pathname !== "/auth/callback" || request.headers.host !== new URL(attempt.redirect).host) { response.writeHead(404).end(); return; }
      try {
        const result = acceptCallback(attempt, url.href);
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" });
        response.end("<!doctype html><title>每日健康追踪</title><h1>授权回调已收到</h1><p>请返回 Codex 查看连接测试结果。</p>");
        resolve(result);
      } catch (error) { response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end("授权无效，请返回 Codex。"); if (attempt.used) reject(error); }
    });
    server.once("error", () => reject(new Error("无法启动本机授权回调服务")));
    timer = setTimeout(() => reject(new Error("等待授权超时，请重新开始会员连接测试")), 10 * 60000);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const started = createAttempt({ hostId: registration.hostId, clientId: registration.clientId, port: server.address().port });
  attempt = started.attempt;
  console.log("请在官方页面登录 ChatGPT，并允许此个人本地工具使用会员用量。测试仅发送固定连接文本。");
  console.log(`AUTH_URL=${started.url}`);
  const received = await callback;
  clearTimeout(timer); server.close();
  registration.clientId = received.clientId; await saveRegistration();
  const exchange = await fetch(discovery.token_endpoint, { ...fetchOptions(), method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: received.clientId, code: received.code, code_verifier: attempt.verifier, redirect_uri: attempt.redirect, resource: RESOURCE }) });
  attempt.verifier = ""; received.code = "";
  if (!exchange.ok) throw new Error(`OpenAI 未完成授权兑换（HTTP ${exchange.status}）`);
  tokens = await exchange.json();
  const keyResponse = await fetch(discovery.jwks_uri, fetchOptions());
  if (!keyResponse.ok) throw new Error("无法获取 OpenAI 身份签名公钥");
  validateIdentity(tokens.id_token, await keyResponse.json(), { clientId: received.clientId, nonce: attempt.nonce });
  requirePlanScope(tokens);
  console.log("IDENTITY_VERIFIED=true PLAN_USAGE_AUTHORIZED=true");
  const headers = { Authorization: `Bearer ${tokens.access_token}` };
  const catalogResponse = await fetch(`${RESOURCE}/models`, { ...fetchOptions(), headers });
  if (!catalogResponse.ok) throw new Error(`会员模型目录不可用（HTTP ${catalogResponse.status}）`);
  const catalog = await catalogResponse.json();
  const model = catalog.models?.find(item => item.visibility === "list" && typeof item.slug === "string")?.slug;
  if (!model) throw new Error("该会员账号未返回可用的模型，已停止测试");
  const response = await fetch(`${RESOURCE}/responses`, { ...fetchOptions(), method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ model, input: [{ role: "user", content: "请只回复：连接成功" }], store: false, stream: true }) });
  if (!response.ok) throw new Error(`会员模型请求未成功（HTTP ${response.status}）`);
  const reply = await readCompletedResponse(response.body);
  console.log(JSON.stringify({ chatGPTPlanWorks: true, model, reply: reply.slice(0, 80), healthRecordsSent: false }));
} catch (error) {
  console.error(`会员连接尚未验证成功：${error instanceof TypeError ? "网络连接失败" : error instanceof SyntaxError ? "官方接口返回了无法识别的内容" : error.message}`);
  process.exitCode = 1;
} finally { tokens = null; clearTimeout(timer); server?.close(); }
