// Browser-only QA fixture; never bundled into the production app.
let connected = false;
export const chatGPTPlan = {
  async connect() { connected = true; return this.getState(); },
  async getState() { return { connected, account: "会员测试账号", model: "GPT" }; },
  async disconnect() { connected = false; return { connected, revoked: true }; },
  async request(_, { method = "GET", body } = {}) {
    if (method === "GET") return { providers: [{ id: "openai", configured: connected }], connected, account: "会员测试账号" };
    if (!connected) throw Object.assign(new Error("请先连接 ChatGPT"), { code: "PLAN_AUTH_REQUIRED" });
    if (body.messages.at(-1).content.includes("等待测试")) return new Promise(() => {});
    if (body.messages.at(-1).content.includes("额度测试")) throw Object.assign(new Error("ChatGPT 会员用量已达当前限制，请稍后重试或在 ChatGPT 中查看用量"), { code: "PLAN_LIMIT" });
    await new Promise(resolve => setTimeout(resolve, 400));
    return { reply: "从已记录的数据看，可以先关注饮水的分布，给自己留一点调整的空间。\n\n### 可以从两件小事开始\n- **上午分次补水**：在习惯的时间喝一杯，不必集中补足。\n- **训练后留意体感**：结合实际出汗和身体状态调整。\n\n没有记录的日期，不能直接当作零摄入。" };
  },
};
