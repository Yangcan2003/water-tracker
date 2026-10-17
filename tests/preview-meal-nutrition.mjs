// End-to-end fixture: real client/server/IndexedDB, simulated identity and AI only.
import { mkdtemp, cp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { build } from "esbuild";
import { handleAI } from "../server/ai-service.js";
const directory = await mkdtemp("/private/tmp/water-nutrition-qa-");
await cp("www", directory, { recursive: true });
for (const native of [false, true]) await build({
  stdin: { contents: `import { mock } from "./tests/firebase-mock.mjs"; import { MealPhotoStore } from "./js/meal-photos.js"; mock.localMode = false;
    const photos = new MealPhotoStore(); const local = JSON.parse(localStorage.getItem("health_tracker_data") || "null");
    const now = new Date(); const day = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
    if (local) { mock.documents.set("users/sync-test", {...local.profile, bodyMeasurements: local.bodyMeasurements?.["sync-test"] || {}}); for (const [date, rows] of Object.entries(local.records)) for (const record of rows.meal || []) mock.documents.set("users/sync-test/mealLogs/"+record.id, {...record, recordedAt: new Date(record.recordedAt), photos: await photos.get(record.photoIds || []) }); }
    else { mock.documents.set("users/sync-test/mealLogs/old-lunch", {name:"原有午餐记录",note:"原有备注：米饭半碗",mealType:"lunch",logDate:day(now),recordedAt:new Date(now.getFullYear(),now.getMonth(),now.getDate(),12,0)}); now.setDate(now.getDate()-1);mock.documents.set("users/sync-test/mealLogs/yesterday",{name:"不应出现的昨天记录",mealType:"dinner",logDate:day(now),recordedAt:now}); }
    await import("./app.js");`, resolveDir: process.cwd() },
  bundle: true, format: "esm", target: "safari15", outfile: `${directory}/${native ? "app-plan" : "app"}.js`, define: { __AI_BACKEND_URL__: '""' },
  plugins: [{ name: "isolated-firebase", setup(build) {
    build.onResolve({ filter: /^firebase\/(app|auth|firestore)$/ }, () => ({ path: new URL("./firebase-mock.mjs", import.meta.url).pathname }));
    if (native) build.onResolve({ filter: /chatgpt-plan-client\.js$/ }, () => ({ path: new URL("./meal-plan-mock.mjs", import.meta.url).pathname }));
  } }],
});
const requests = [];
const env = { FIREBASE_API_KEY: "fake-key", AI_ALLOWED_UIDS: "sync-test", OPENAI_API_KEY: "fake-key" };
const fetcher = async (url, options) => {
  if (url.includes("identitytoolkit")) return Response.json({ users: [{ localId: "sync-test" }] });
  const payload = JSON.parse(options.body), text = payload.input[0].content[0].text;
  requests.push({ images: payload.input[0].content.filter(item => item.type === "input_image").length, strict: payload.text.format.strict });
  await new Promise(resolve => setTimeout(resolve, text.includes("慢速") ? 1200 : 120));
  if (text.includes("失败测试")) return new Response("fake upstream failure", { status: 500 });
  const value = { isFood: !text.includes("非食物"), name: "米饭与鸡肉", kcal: 580, carbsG: 62, proteinG: 35, fatG: 21, portion: "米饭约150g，鸡肉约120g", note: "烹饪油量存在误差" };
  return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
};
const types = { html: "text/html", js: "text/javascript", css: "text/css", png: "image/png", svg: "image/svg+xml", json: "application/json" };
createServer(async (incoming, outgoing) => {
  const path = new URL(incoming.url, "http://localhost").pathname;
  if (path === "/api/ai") {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    const response = await handleAI(new Request("https://test.invalid/api/ai", { method: incoming.method, headers: incoming.headers, ...(incoming.method === "POST" ? { body: Buffer.concat(chunks) } : {}) }), env, fetcher);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text()); return;
  }
  if (path === "/__qa") { outgoing.setHeader("Content-Type", "application/json"); outgoing.end(JSON.stringify({ requests })); return; }
  if (path.includes("..") || path === "/api/config") { outgoing.writeHead(404).end(); return; }
  try {
    let file = path.replace(/^\/plan/, "") || "/";
    if (file === "/") file = "/index.html";
    outgoing.setHeader("Cache-Control", "no-store"); outgoing.setHeader("Content-Type", types[file.split(".").at(-1)] || "application/octet-stream");
    if (file === "/sw.js") { outgoing.end('self.addEventListener("install",()=>self.skipWaiting());'); return; }
    let contents = await readFile(`${directory}${file}`);
    if (path.startsWith("/plan/") && file === "/index.html") contents = contents.toString().replace('src="app.js"', 'src="app-plan.js"');
    outgoing.end(contents);
  } catch { outgoing.writeHead(404).end(); }
}).listen(Number(process.env.QA_PORT) || 54016, "127.0.0.1", () => console.log("Meal nutrition QA: http://127.0.0.1:54016 · no real identity/model traffic"));
