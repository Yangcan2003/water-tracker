import { MAX_BACKUP_BYTES, parseBackup } from "./data-backup.js";

export function createBackupPage({ storage, showToast, onRestored }) {
  const el = id => document.getElementById(id);
  const picker = el("backupFileInput"), dialog = el("backupImportDialog"), message = el("backupImportMessage");
  const confirm = el("backupImportConfirm"), settings = el("backupRestoreSettings");
  let draft = null, busy = false, revision = 0;
  const target = () => storage.currentUser ? `当前账户${storage.currentUser.email ? `（${storage.currentUser.email}）` : ""}` : "此设备的本地模式";
  function reset() { revision++; draft = null; if (!busy) dialog.close(); }
  el("accountImportButton").addEventListener("click", () => { if (!busy) picker.click(); });
  picker.addEventListener("change", async () => {
    const file = picker.files?.[0]; picker.value = "";
    if (!file || busy) return;
    const version = ++revision, generation = storage.sync.generation;
    busy = true; confirm.disabled = true; settings.checked = false;
    el("backupImportTarget").textContent = `恢复到${target()}。已有记录会保留，重复项会跳过。`;
    message.textContent = "正在核对备份与现有记录…";
    el("backupImportSummary").textContent = ""; dialog.showModal();
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("备份超过 50 MB，请选择较小的备份文件");
      const backup = parseBackup(await file.text());
      const counts = await storage.previewBackupImport(backup);
      if (version !== revision || generation !== storage.sync.generation) return;
      draft = { backup, generation };
      el("backupImportSummary").textContent = `可新增 ${counts.added} 条 · 重复 ${counts.duplicates} 条 · 冲突 ${counts.conflicts} 条`;
      message.textContent = counts.conflicts ? "冲突项保留当前内容，其余新记录可合并恢复。" : "已完成核对，确认后合并保存。";
      confirm.disabled = false;
    } catch (error) { if (version === revision) { draft = null; message.textContent = error.message; } }
    finally { busy = false; }
  });
  confirm.addEventListener("click", async () => {
    if (!draft || busy || draft.generation !== storage.sync.generation) { reset(); return; }
    busy = true; confirm.disabled = true; settings.disabled = true;
    message.textContent = "正在合并恢复，请稍候…";
    try {
      const counts = await storage.restoreBackup(draft.backup, { restoreSettings: settings.checked });
      if (draft?.generation !== storage.sync.generation) return;
      await onRestored();
      dialog.close(); showToast(`已恢复 ${counts.added} 条记录，跳过 ${counts.duplicates} 条重复记录`, false);
    } catch (error) { message.textContent = error.message; }
    finally { busy = false; confirm.disabled = !draft; settings.disabled = false; }
  });
  el("backupImportClose").addEventListener("click", () => { if (!busy) dialog.close(); });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => { revision++; draft = null; });
  return { reset };
}
