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
    const question = body.messages.at(-1).content;
    if (question.includes("表格测试")) return { reply: "晚餐已保存的脂肪合计约 **33.3 g**。下面是估算拆分：\n\n| 来源 | 脂肪 |\n\n|---|---:|\n\n| 5 个鸡蛋 | 约 24 g |\n\n| 牛油果油 | 约 9 g |\n\n| 土豆 | 约 0.3 g |\n\n| 合计 | **约 33.3 g** |\n\n这些是模拟数值，用于验证排版。\n\n### 需要区分\n1. 食物中的脂肪\n2. 烹饪油的脂肪\n\n> 估算不等于精确测量。", actions: [] };
    if (question.includes("图片测试")) return { reply: `已收到 **${body.photos?.length || 0} 张图片**（模拟识别）。图片只用于本次对话，没有自动添加健康记录。`, actions: [] };
    if (question.includes("新增测试")) return { reply: "请核对这条饮水记录，再确认保存。", actions: [{ operation: "create", category: "water", date: body.actionCatalog.localDate, time: "12:30", ref: null, values: { amount: 250 } }] };
    if (question.includes("修改测试") || question.includes("删除测试")) {
      const record = body.actionCatalog.records.find(record => record.category === "water" && record.values.amount === (question.includes("修改测试") ? 250 : 350));
      return { reply: "请核对要处理的原记录。", actions: record ? [{ operation: question.includes("修改测试") ? "update" : "delete", category: "water", ref: record.ref, date: record.date, values: question.includes("修改测试") ? { amount: 350 } : {} }] : [] };
    }
    return { reply: "从已记录的数据看，可以先关注饮水的分布，给自己留一点调整的空间。\n\n### 可以从两件小事开始\n- **上午分次补水**：在习惯的时间喝一杯，不必集中补足。\n- **训练后留意体感**：结合实际出汗和身体状态调整。\n\n没有记录的日期，不能直接当作零摄入。" };
  },
};
