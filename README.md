# 每日饮水记录

静态前端部署在 Cloudflare Pages，注册登录使用 Firebase Authentication，数据存储使用 Cloud Firestore。

## 1. 创建 Firebase 项目

1. 在 Firebase Console 创建项目。
2. 在 `Authentication -> Sign-in method` 中启用“电子邮件/密码”。
3. 在 `Firestore Database` 中创建数据库，选择离用户较近的区域。
4. 打开 Firestore 的 `Rules` 页面，将 [`firestore.rules`](./firestore.rules) 完整粘贴并发布。
5. 在项目设置中添加一个 Web 应用，并复制 Firebase 配置对象。

Firebase Web 配置中的 API Key 是公开项目标识，不是管理员私钥。真正的数据权限由 Firestore Rules 控制。

## 2. 部署到 Cloudflare Pages

推荐把目录提交到 GitHub，然后在 Cloudflare Dashboard 创建 Pages 项目并连接仓库。

- Framework preset：`None`
- Build command：留空
- Build output directory：`.`

在 Pages 项目的 `Settings -> Variables and Secrets` 添加：

```text
FIREBASE_API_KEY=Firebase 配置中的 apiKey
FIREBASE_AUTH_DOMAIN=Firebase 配置中的 authDomain
FIREBASE_PROJECT_ID=Firebase 配置中的 projectId
FIREBASE_STORAGE_BUCKET=Firebase 配置中的 storageBucket
FIREBASE_MESSAGING_SENDER_ID=Firebase 配置中的 messagingSenderId
FIREBASE_APP_ID=Firebase 配置中的 appId
```

变量添加后重新部署。Cloudflare Pages Functions 会通过 `/api/config` 把公开配置提供给前端。

## 3. 本地预览

完整功能需要 Pages Function 输出 Firebase 配置。安装 Node.js 后，在本目录运行：

```powershell
npx wrangler pages dev . `
  --binding FIREBASE_API_KEY=你的apiKey `
  --binding FIREBASE_AUTH_DOMAIN=你的authDomain `
  --binding FIREBASE_PROJECT_ID=你的projectId `
  --binding FIREBASE_STORAGE_BUCKET=你的storageBucket `
  --binding FIREBASE_MESSAGING_SENDER_ID=你的messagingSenderId `
  --binding FIREBASE_APP_ID=你的appId
```
