# 每日健康追踪（Web + iOS）

饮水、药物、补剂和每日健康记录应用。Web 版仍可作为 PWA 部署；iOS 版由 Capacitor 8 驱动，使用同一套业务代码并提供原生能力。

## Git 版本管理

原仓库：[Yangcan2003/water-tracker](https://github.com/Yangcan2003/water-tracker)，`main` 保存已完成并验证的集成版本。

本项目默认在每项修改完成并验证后自动提交、上传，并集成到远端 `main`。多个窗口并行工作时，各任务使用独立 worktree 和任务分支，主分支集成与手机安装分别串行执行；具体约定见 [AGENTS.md](./AGENTS.md)。不要在共享目录批量提交其他窗口尚未完成的改动。

新电脑可用 `git clone https://github.com/Yangcan2003/water-tracker.git` 获取项目，再按下文安装依赖。

提交源码、iOS 工程和依赖锁文件；`node_modules/`、`www/`、`artifacts/`、Xcode 构建缓存、个人配置、密钥和签名文件由 `.gitignore` 排除。`ai-backend.local.json` 和 `chatgpt-host.local.json` 仅保存在本机。GitHub Pages 工作流会安装锁定版本的依赖，构建后发布 `www/` 中的静态文件。

## iOS 功能

账户缓存按 Firebase UID 隔离；退出后进入独立本地模式，重新登录原账户可继续读取该账户缓存。升级时，旧版共享缓存的归属会独立保存，不随登录态失效、退出或切换账号而改变；原缓存保留为恢复副本。存储不足时保存会失败并保留现有记录，不再自动裁掉 90 天前的日记录。

“我的 → 导出健康记录”会读取当前账户的完整云端历史与饮食照片，再合并未同步记录；无法确认完整性时会提示失败，登录状态下需联网导出。“恢复数据备份”支持新版单账户备份和可明确归属的旧 JSON 备份，先预览新增、重复、冲突数量，再合并恢复。重复与冲突项保留当前内容；目标、计划、水杯、头像和提醒偏好可选择恢复。恢复后的新增记录进入正常同步队列，不包含其他账户缓存或助手登录凭据。

历史日详情支持逐条编辑饮水、饮食、药物、补剂与如厕记录，训练标记可修改或清除；日历可选择没有记录的日期补录。详情页顶部可切换记录日期，过去的饮食编辑和补录保留原日期。首页饮食卡片显示蛋白质、膳食纤维的目标差额与钠剩余额度，缺少营养数据时标注未知或仅已知摄入。药物和补剂使用稳定计划 ID 关联服用记录，改名保留进度。

完整云端刷新会移除本机已确认删除的饮食缓存，同时保留尚未上传的新增、修改和删除操作；历史、首页摄入与备份使用一致结果。含 `/` 的旧计划 ID 可原样备份恢复，服用统计会累计同一计划的所有记录，与当天进度保持一致。

- 可直接用 Xcode 构建和安装的原生 iOS 工程
- iPhone 刘海、灵动岛和底部 Home Indicator 安全区适配
- iOS 风格底部标签栏
- 原生触觉反馈
- 每日重复的原生本地饮水通知，App 退出后仍可提醒
- 系统分享面板导出数据
- Firebase、Chart.js 和业务代码打入 App 包，冷启动不依赖 CDN
- 本地优先存储；登录后继续使用原有 Firebase 云同步
- 在“我的 → 偏好设置 → 配色与图标”选择七套配色，界面主题和 iOS 桌面图标同步切换；选择保存在本机，重启后保留

网页版使用相同的配色设置。浏览器管理已添加到主屏幕的 PWA 图标，无法像原生 iOS 版一样即时切换已安装图标。
- “我的 → 药物设置”管理药物名称、剂量、每日次数和频率，支持启用、停用、编辑和删除；停用及删除计划不影响历史服用记录。
- “我的 → 身体数据”按测量日期记录身高（cm）、体重（kg）、体脂率（%），支持单项更新、补录、历史查看和误录删除；记录包含在数据备份中，登录后同步到当前账户。

## 环境要求

- Node.js 22+
- pnpm 11+
- Xcode 26+
- iOS 15+

## 在 Xcode 中运行

首次拉取仓库：

```bash
pnpm install
pnpm ios:open
```

`ios:open` 会构建 Web 资源、同步原生插件并打开 Xcode。随后在 Xcode 中：

1. 选择 `App` Target。
2. 在 `Signing & Capabilities` 中选择你的 Apple Developer Team。
3. 如 `com.yangcan.watertracker` 已被占用，修改 Bundle Identifier。
4. 选择 iPhone 模拟器或已连接设备，点击 Run。

以后每次修改 HTML、CSS 或 JavaScript 后，运行：

```bash
pnpm ios:sync
```

## Web 构建与部署

```bash
pnpm install
pnpm build
```

静态产物位于 `www/`。Cloudflare Pages 推荐配置：

- Build command：`pnpm build`
- Build output directory：`www`

Pages 项目需要以下公开 Firebase Web 配置变量：

```text
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
```

未提供 Pages Function 配置时，应用会回退到 `js/config.js` 中现有的 Firebase Web 配置。

## AI 健康助手

“饮食”页顶部和“我的 → 健康管理”均可进入“我的冰箱”。支持添加、编辑、搜索食材，按冷藏/冷冻/常温筛选，填写可选的剩余数量、单位、到期日和备注；吃完后可移除。库存按 App 账号隔离，本机未登录时也可用，首次登录会带入本地库存；按食材同步离线变更和移除标记，包含在导出的完整备份中。临期提示仅依据用户填写的日期，不自动推测保质期。

冰箱里的“AI 帮我存”可把文字或照片交给助手整理（例如“把鸡蛋6个和牛奶2瓶存入冰箱”），核对保存卡片后入库；“用现有食材配餐”将问题带入助手，由用户发送。开启结合健康记录时，每次提问读取当前库存、今日已记录的摄入和营养目标，库存不受历史日期范围限制；关闭分享后不发送现有库存。库存不是已吃记录，也不是常吃食物营养库，菜单生成不会扣库存。用户明确要求后，助手可提出剩余数量修改或吃完移除卡片，确认后执行；已有食材在卡片生成后发生变化时拒绝覆盖。营养库可带入名称，份量与营养参考继续独立管理。

助手保留 Firebase App 登录，记录仍存放在 Firebase / 本机。iOS 默认直连 ChatGPT 会员调用路径；Web 的独立 Cloudflare Worker 验证账号并转发 API 请求，不保存对话或健康记录。OpenAI 请求设置 `store: false`，这不等于服务商的零保留承诺。助手页使用顶部账号菜单、可滚动对话和底部输入框，没有模型、地址或密钥配置项。按用户偏好，默认分享所有历史日期的饮水、饮食、训练、身体测量、药物、补剂和如厕记录，在提问时发送至 OpenAI；输入框旁可关闭分享或改为 7/30 天。账号、头像、照片和记录内部 ID 不在分析字段中。超出明细预算时按日、按月或整个时段生成统计摘要，覆盖所有已读取日期，注明原始明细省略情况；无法在预算内表示时明确提示，避免静默缩短日期范围。历史读取使用完整范围缓存，云端不完整时不假装读到了全部记录。

后台首次部署：在本机执行 `pnpm ai:setup`（或双击 `配置AI.command`），可通过 `AI_ALLOWED_UIDS` 或 `AI_ALLOWED_EMAILS`、`OPENAI_API_KEY` 环境变量提供账号与密钥；缺少时脚本提示登录 Cloudflare、输入 App 登录邮箱或 Firebase UID，并隐藏输入 Key。按邮箱授权时，服务端只信任 Firebase 返回的已验证邮箱，未验证账号可在助手中主动发送验证邮件并在验证后重试。Key 通过 Wrangler 标准输入写入 Worker Secret，不写入仓库。默认使用 `gpt-5-mini`，开发者可通过 `OPENAI_MODEL` 环境变量调整。部署脚本保存公开域名，之后重新构建并安装 App 即自动连接，用户无需在手机内配置。

服务配置：

| 变量 | 作用 |
| --- | --- |
| `OPENAI_API_KEY`（Secret） | OpenAI 密钥 |
| `OPENAI_MODEL` | OpenAI 模型，默认 `gpt-5-mini` |
| `FIREBASE_API_KEY` | 此 Firebase 项目的公开 Web 配置，用于验证登录 |
| `AI_ALLOWED_UIDS` | 允许使用助手的 Firebase UID，多个用逗号分隔 |
| `AI_ALLOWED_EMAILS` | 可替代 UID 使用的登录邮箱，多个用逗号分隔；仅允许 Firebase 返回的已验证邮箱，两类白名单都为空时拒绝调用 |
| `DEEPSEEK_API_KEY`（Secret） / `DEEPSEEK_MODEL` | 可选 DeepSeek，默认 `deepseek-flash` |
| `COMPATIBLE_API_KEY`（Secret） / `COMPATIBLE_BASE_URL` / `COMPATIBLE_MODEL` / `COMPATIBLE_LABEL` | 可选兼容 Chat Completions 的服务，例如通义千问；base URL 包含 API 版本路径 |

修改 Secret 可以执行 `node node_modules/wrangler/bin/wrangler.js secret put OPENAI_API_KEY --config wrangler.ai.jsonc`。其他配置在 Cloudflare Worker 设置中管理。服务端不接受客户端传入模型地址或密钥，不会在服务商之间自动切换。每次请求有输入长度、输出 token 和超时限制；每个 Worker 实例每账号每分钟最多 10 次请求，此限制不是跨实例精确配额。应同时在模型服务商侧设置项目预算。

脚本会生成被 Git 忽略的 `ai-backend.local.json`，仅包含公开域名。`pnpm build` 会使用它或环境变量 `AI_BACKEND_URL` 写入客户端默认地址，并仅将该域名加入 Web CSP。手机只使用构建时写入的可信 HTTPS 后端，忽略旧版手动配置的域名；使用原生 CapacitorHttp，不放宽 WebView 的连接策略。Web 版需要同源 Pages Function `/api/ai`，或构建时明确配置外部 Worker 域名。

自动测试使用模拟模型和模拟身份响应，不消耗真实额度、不上传真实健康记录。对话仅在内存中保留，换账号或修改记录分享开关会清空对话，避免旧记录继续进入后续请求。真实联调需部署后使用已授权账号发送问题。

2026-10-15 已通过 OpenAI 官方 Sign in with ChatGPT 完成本机 Plus 实际调用测试，模型 `gpt-6.1-sol` 返回“连接成功”。`pnpm ai:probe-plus` 可复测，仅发送固定文本，不读取健康记录；测试令牌只在进程内存中保留，`chatgpt-host.local.json` 只保存本机标识及公开注册 ID。

iOS 助手默认使用 ChatGPT 会员用量，在助手页点“连接 ChatGPT”后由用户在系统登录页完成授权。手机单独注册本机标识，凭据保存在 `WhenUnlockedThisDeviceOnly` 钥匙串中，不进入 JavaScript、Firebase、Cloudflare 或日志；续期串行进行并原子替换钥匙串记录。直接请求官方模型目录与 Responses API，按目录顺序默认选择可用模型，固定 `store:false` / `stream:true`，在 `response.completed` 后显示回答并结束等待。首次连接仅发送固定文本以确认可用性；健康数据按页面显示的分享范围随提问发送。断开会尝试撤销远端会话并清除本机令牌，保留公开客户端注册信息以便重连。Web 版本沿用已部署的 API 后端，不自动改用另一种计费方式。手机完整 OAuth 与实际提问仍需用户在设备上完成首次授权后验证。发送后立即显示用户消息和进度，支持停止、重试、复制回答；即使底层桥接忽略取消，界面也会按截止时间恢复并拒绝迟到回答。

## 主要目录

```text
app.js                    主应用逻辑
js/native.js              iOS 原生桥接（通知、触觉、分享）
scripts/build.mjs         Web/iOS 共用构建脚本
capacitor.config.json     Capacitor 应用配置
ios/                      Xcode 工程
www/                      构建产物（不提交）
```
