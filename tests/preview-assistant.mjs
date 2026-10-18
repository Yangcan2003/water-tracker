// Isolated integration preview: real app/client/server code, fake Firebase and model.
import { mkdtemp, cp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { build } from "esbuild";
import { handleAI } from "../server/ai-service.js";
const directory = await mkdtemp("/private/tmp/water-ai-qa-");
await cp("www", directory, { recursive: true });
for (const asset of ["index.html", "styles.css", "revamp.css", "meta.css", "history.css", "themes.css", "assistant.css", "icons"]) await cp(asset, `${directory}/${asset}`, { recursive: true });
await build({
  stdin: { contents: 'import { mock } from "./tests/firebase-mock.mjs"; mock.localMode = false; import { seedHistoryFixture } from "./tests/history-fixture.mjs"; seedHistoryFixture(); import "./app.js";', resolveDir: process.cwd() },
  bundle: true, format: "esm", target: "safari15", outfile: `${directory}/app.js`, define: { __AI_BACKEND_URL__: '""' },
  plugins: [{ name: "test-firebase", setup(build) {
    build.onResolve({ filter: /^firebase\/(app|auth|firestore)$/ }, () => ({ path: new URL("./firebase-mock.mjs", import.meta.url).pathname }));
    if (process.argv.includes("--plan")) build.onResolve({ filter: /chatgpt-plan-client\.js$/ }, () => ({ path: new URL("./chatgpt-plan-mock.mjs", import.meta.url).pathname }));
  } }],
});
const env = { FIREBASE_API_KEY: "test-key", AI_ALLOWED_EMAILS: "test-owner@example.invalid", OPENAI_API_KEY: "fake-key", DEEPSEEK_API_KEY: "fake-key", OPENAI_MODEL: "测试模型 · 无真实调用" };
let emailVerified = true, verificationTestStarted = false;
let requests = [];
const fetcher = async (url, options) => {
  if (url.includes("identitytoolkit")) return Response.json({ users: [{ localId: "sync-test", email: env.AI_ALLOWED_EMAILS, emailVerified }] });
  const payload = JSON.parse(options.body); requests.push(payload);
  const question = payload.input?.at(-1)?.content || payload.messages?.at(-1)?.content;
  if (question.includes("失败测试")) return new Response("private error", { status: 500 });
  return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "这是一条模拟回答，用于检查对话和记录授权。\n未记录不代表零摄入。<img src=x onerror=alert(1)>" }] }], choices: [{ message: { content: "这是一条国内模型的模拟回答。" }, finish_reason: "stop" }] });
};
const types = { html: "text/html", js: "text/javascript", css: "text/css", png: "image/png", svg: "image/svg+xml", json: "application/json" };
createServer(async (incoming, outgoing) => {
  const path = new URL(incoming.url, "http://localhost").pathname;
  if (path === "/api/ai") {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    if (incoming.method === "POST" && !verificationTestStarted && Buffer.concat(chunks).toString().includes("邮箱验证测试")) { emailVerified = false; verificationTestStarted = true; }
    const response = await handleAI(new Request("https://test.invalid/api/ai", { method: incoming.method, headers: incoming.headers, ...(incoming.method === "POST" ? { body: Buffer.concat(chunks) } : {}) }), env, fetcher);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text()); return;
  }
  if (path === "/__qa/email-verified" && incoming.method === "POST") { emailVerified = true; outgoing.writeHead(204).end(); return; }
  if (path === "/__qa") { outgoing.setHeader("Content-Type", "application/json"); outgoing.end(JSON.stringify({ requests })); return; }
  if (path.includes("..") || path === "/api/config") { outgoing.writeHead(404).end(); return; }
  try {
    const file = path === "/" ? "/index.html" : path;
    outgoing.setHeader("Cache-Control", "no-store");
    if (file === "/sw.js") { outgoing.setHeader("Content-Type", "text/javascript"); outgoing.end('self.addEventListener("install", () => self.skipWaiting()); self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));'); return; }
    outgoing.setHeader("Content-Type", types[file.split(".").at(-1)] || "application/octet-stream");
    outgoing.end(await readFile(`${directory}${file}`));
  } catch { outgoing.writeHead(404).end(); }
}).listen(Number(process.env.QA_PORT) || 4188, "127.0.0.1", () => console.log(`AI QA at http://127.0.0.1:${Number(process.env.QA_PORT) || 4188} · mocked identity/model, no cloud traffic`));
