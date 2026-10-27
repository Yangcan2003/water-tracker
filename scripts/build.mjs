import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const webDir = new URL("../www/", import.meta.url);
let backendURL = process.env.AI_BACKEND_URL || "";
if (!backendURL) {
  try { backendURL = JSON.parse(await readFile(new URL("../ai-backend.local.json", import.meta.url), "utf8")).backendURL || ""; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
if (backendURL) {
  const url = new URL(backendURL);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("AI_BACKEND_URL 必须是可信后端的 HTTPS 域名");
  backendURL = url.origin;
}

await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });

await build({
  entryPoints: [new URL("../app.js", import.meta.url).pathname],
  outfile: new URL("app.js", webDir).pathname,
  bundle: true,
  format: "esm",
  target: ["safari15"],
  sourcemap: true,
  minify: true,
  legalComments: "none",
  define: { __AI_BACKEND_URL__: JSON.stringify(backendURL) },
});

const assets = [
  "index.html",
  "styles.css",
  "revamp.css",
  "meta.css",
  "history.css",
  "meals.css",
  "fridge.css",
  "themes.css",
  "assistant.css",
  "intake.css",
  "workout.css",
  "toilet.css",
  "manifest.json",
  "sw.js",
  "_routes.json",
  "icons",
  "admin",
];

for (const asset of assets) {
  await cp(new URL(`../${asset}`, import.meta.url), new URL(asset, webDir), {
    recursive: true,
  });
}

if (backendURL) {
  const index = new URL("index.html", webDir);
  const html = await readFile(index, "utf8");
  await writeFile(index, html.replace("connect-src 'self'", `connect-src 'self' ${backendURL}`));
}

console.log("Built web assets in www/");
