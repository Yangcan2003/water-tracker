// Isolated UI fixture: one simulated meal permission failure, then recovery.
import { mkdtemp, cp } from "node:fs/promises";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
const directory = await mkdtemp("/private/tmp/water-sync-qa-");
const localMode = process.argv.includes("--local");
const historyFixture = process.argv.includes("--history");
const slowWrites = process.argv.includes("--slow-writes");
const slowStartup = process.argv.includes("--slow-startup");
const delayedAuth = process.argv.includes("--delayed-auth");
const stalledSync = process.argv.includes("--stalled-sync");
const cleanFixture = process.argv.includes("--clean");
const port = Number(process.env.QA_PORT) || (localMode ? 4183 : 4182);
await cp("www", directory, { recursive: true });
await build({
  stdin: { contents: `import { mock } from "./tests/firebase-mock.mjs"; mock.failMealOnce = ${!cleanFixture && !localMode && !slowWrites && !slowStartup && !delayedAuth && !stalledSync}; mock.localMode = ${localMode}; mock.writeDelay = ${slowStartup ? 10000 : slowWrites ? 1500 : 0}; mock.readDelay = ${slowStartup ? 10000 : 0}; mock.authDelay = ${delayedAuth ? 6000 : 0}; mock.repeatAuthDelay = ${delayedAuth ? 12000 : 0}; ${slowStartup || delayedAuth || stalledSync ? 'import { seedStartupFixture } from "./tests/startup-fixture.mjs"; seedStartupFixture();' : ''} ${stalledSync ? 'import { stallFixtureNetwork } from "./tests/stalled-sync-fixture.mjs"; stallFixtureNetwork();' : ''} ${historyFixture ? 'import { seedHistoryFixture } from "./tests/history-fixture.mjs"; seedHistoryFixture();' : ''} import "./app.js";`, resolveDir: process.cwd() },
  bundle: true, format: "esm", target: "safari15", outfile: `${directory}/app.js`,
  plugins: [{ name: "test-firebase", setup(build) {
    build.onResolve({ filter: /^firebase\/(app|auth|firestore)$/ }, () => ({ path: new URL("./firebase-mock.mjs", import.meta.url).pathname }));
  } }],
});
const types = { html: "text/html", js: "text/javascript", css: "text/css", png: "image/png", json: "application/json" };
createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path.includes("..") || path === "/api/config") { response.writeHead(404).end(); return; }
  try {
    const file = path === "/" ? "/index.html" : path;
    response.setHeader("Cache-Control", "no-store");
    if (file === "/sw.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end('self.addEventListener("install", () => self.skipWaiting()); self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));');
      return;
    }
    response.setHeader("Content-Type", types[file.split(".").at(-1)] || "application/octet-stream");
    response.end(await readFile(`${directory}${file}`));
  } catch { response.writeHead(404).end(); }
}).listen(port, "127.0.0.1", () => console.log(`UI QA at http://127.0.0.1:${port} (no cloud traffic)`));
