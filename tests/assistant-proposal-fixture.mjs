// Synthetic legacy conversation for manual QA. Never imported by production.
export function seedLegacyProposalFixture() {
  const key = "health_tracker_assistant_history:sync-test";
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, JSON.stringify({ activeId: "legacy-proposal-test", conversations: [{
    id: "legacy-proposal-test", updatedAt: Date.now(), shareRecords: true, range: "all", messages: [
      { role: "user", content: "保存卡片测试：请添加一份测试晚餐" },
      { role: "assistant", content: "这是一条旧版本模拟对话：测试晚餐估算 881 kcal，碳水 91.3 g、蛋白质 58.4 g、脂肪 29.3 g，请核对后保存。", actionNotice: "包含待确认的记录变更；重新打开后请重新提问以核对最新记录。" },
    ],
  }] }));
}
