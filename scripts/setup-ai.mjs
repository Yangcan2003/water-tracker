// Interactive setup. Provider secrets are read without echo and sent directly to
// Wrangler's stdin; they are never written to the repository or command arguments.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = resolve(project, "node_modules/wrangler/bin/wrangler.js");
const config = resolve(project, "wrangler.ai.jsonc");
async function command(args, { secret, capture = false } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [wrangler, ...args], {
      cwd: project, env: process.env,
      stdio: [secret === undefined ? "inherit" : "pipe", capture ? "pipe" : "inherit", "inherit"],
    });
    let output = "";
    if (capture) child.stdout.on("data", data => { output += data; process.stdout.write(data); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? done(output) : reject(new Error(`部署工具退出，状态码 ${code}；请根据上方提示处理后重试。`)));
    if (secret !== undefined) { child.stdin.on("error", () => {}); child.stdin.end(`${secret}\n`); }
  });
}
async function ask(question) {
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await reader.question(question)).trim(); } finally { reader.close(); }
}
async function hiddenKey(question) {
  if (!process.stdin.isTTY) throw new Error("请在本机终端中运行，以隐藏密钥输入。");
  process.stdout.write(question);
  return new Promise((done, reject) => {
    let value = "";
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
    const finish = error => {
      process.stdin.off("data", read); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write("\n");
      error ? reject(error) : done(value.trim());
    };
    const read = chunk => {
      for (const character of chunk) {
        if (character === "\u0003") { value = ""; finish(new Error("已取消配置")); return; }
        if (character === "\r" || character === "\n") { finish(); return; }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (character >= " ") value += character;
      }
    };
    process.stdin.on("data", read);
  });
}

try {
  console.log("配置健康助手：登录 Cloudflare → 授权你的 App 账号 → 安全保存 OpenAI Key。\n密钥输入不会显示，也不会写入项目文件。\n");
  const identity = await command(["whoami"], { capture: true });
  if (/not authenticated|not logged in/i.test(identity)) await command(["login", "--scopes", "account:read", "user:read", "workers_scripts:write", "--use-keyring"]);
  const owner = process.env.AI_ALLOWED_UIDS || process.env.AI_ALLOWED_EMAILS || await ask("请输入 App 登录邮箱或 Firebase 用户 UID（仅首次部署需要）：");
  const email = owner.includes("@");
  if (email ? owner.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner) : !/^[a-zA-Z0-9_-]{1,128}$/.test(owner)) throw new Error("账号格式无效，请填写 App 登录邮箱或 Firebase 用户 UID。");
  const model = process.env.OPENAI_MODEL || "gpt-5-mini";
  if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(model)) throw new Error("模型名称格式无效。");
  let key = process.env.OPENAI_API_KEY || await hiddenKey("请粘贴 OpenAI API Key，然后回车（输入隐藏）：");
  if (!key || /\s/.test(key)) throw new Error("密钥不能为空或含空格。");
  const output = await command(["deploy", "--config", config, "--var", `AI_ALLOWED_UIDS:${email ? "" : owner}`, "--var", `AI_ALLOWED_EMAILS:${email ? owner.toLowerCase() : ""}`, "--var", `OPENAI_MODEL:${model}`], { capture: true });
  const backendURL = output.match(/https:\/\/[a-zA-Z0-9.-]+\.workers\.dev\b/)?.[0];
  if (!backendURL) { key = ""; throw new Error("未找到部署地址，请确认已启用 workers.dev 域名后重试。"); }
  await command(["secret", "put", "OPENAI_API_KEY", "--config", config], { secret: key });
  key = "";
  await writeFile(resolve(project, "ai-backend.local.json"), JSON.stringify({ backendURL }, null, 2) + "\n");
  const response = await fetch(`${backendURL}/api/ai`, { signal: AbortSignal.timeout(15000) });
  const metadata = await response.json();
  if (!response.ok || !metadata.providers?.find(item => item.id === "openai")?.configured) throw new Error("服务已部署，但配置检查未通过。请检查 Cloudflare Worker 中的密钥与账号授权。");
  console.log(`\n服务已部署，默认 GPT 地址已保存：${backendURL}\n重新构建并更新手机 App 后即会自动使用该服务，无需在 App 内填写任何配置。\n本次检查仅验证服务配置，模型权限和额度以真实回答为准。`);
} catch (error) {
  console.error(`\n配置尚未完成：${error.message}`);
  process.exitCode = 1;
}
