import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  createUserWithEmailAndPassword, getAuth, onAuthStateChanged,
  signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  getFirestore, serverTimestamp, setDoc, doc,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";
import { getFirebaseConfig, AVATAR_COLORS, DEFAULT_MEDICINES, DEFAULT_SUPPLEMENTS } from "./js/config.js";
import { toDateKey, fromDateKey, isWeekday, esc, toFriendlyError, toTimeValue, toTimeDisplay, getProgressMessage, genAvatarSVG, TOILET_SVG } from "./js/utils.js";
import { storage } from "./js/storage.js";

// ========== 全局状态 ==========
let auth = null, db = null, currentUser = null;
let selectedDate = toDateKey(new Date());
let records = [], dailyGoal = 2000, authMode = "login";
let lastDeleted = null, toastTimer = null, requestVersion = 0;

let medicineRecords = [], supplementRecords = [], toiletRecords = [];
let userMedicines = [], userSupplements = [];
let currentEditItem = null;
let isWorkoutDay = false;
let workoutDaysCache = {};
let historyDayData = [];
let historyViewMode = "overview";
let historyOffset = 0;
const HISTORY_PAGE_SIZE = 14;

let avatarType = "default";
let avatarColor = "#168d84";
let avatarUrl = "";

// ========== DOM 元素 ==========
const E = {};
function $(sel) { return document.querySelector(sel); }
[
  "authShell","appShell","authForm","loginTab","registerTab","authEyebrow","authTitle",
  "emailInput","passwordInput","authMessage","authSubmit",
  "currentAmount","goalAmount","progressPercent","progressBar","progressMessage",
  "waterFill","waterWave","dateLabel","fullDate","datePicker","datePickerButton",
  "previousDay","nextDay","historyList","recordCount",
  "goalDialog","goalForm","goalInput",
  "customButton","customDialog","customForm","customName","customAmount",
  "toast","toastText","undoButton",
  "waterTab","medicineTab","supplementTab",
  "waterPanel","medicinePanel","supplementPanel",
  "historyDialog","historyContent",
  "avatarButton","avatarImg","profileDialog","profileAvatar","profileEmail",
  "editAvatarButton","profileGoalButton","profileGoalVal",
  "profileHistoryButton","profileExportButton","profileLogoutButton",
  "avatarDialog","avatarPreview","avatarColors","avatarUrlInput","avatarSaveButton",
  "medicineGrid","medicineTakenCount","medicineTotalCount","medicinePercent",
  "medicineRecordCount","medicineHistoryList","medicineHint",
  "customMedicineButton","customMedicineDialog","customMedicineForm",
  "customMedicineName","customMedicineDosage","customMedicineTarget","customMedicineSchedule",
  "medicineWorkoutToggle",
  "supplementGrid","supplementTakenCount","supplementTotalCount","supplementPercent",
  "supplementRecordCount","supplementHistoryList","supplementHint",
  "customSupplementButton","customSupplementDialog","customSupplementForm",
  "customSupplementName","customSupplementDosage","customSupplementTarget","customSupplementSchedule",
  "supplementWorkoutToggle","deleteSupplementBtn","deleteMedicineBtn",
  "toiletRecordCount","toiletHistoryList",
  "syncButton","syncIcon","syncLabel","offlineBadge","authDialog","authDialogClose",
].forEach(id => { const el = $("#"+id); if (el) E[id] = el; });

// ========== 事件绑定 ==========
document.querySelectorAll(".source-card").forEach(btn => {
  btn.addEventListener("click", () => addRecord(btn.dataset.source, Number(btn.dataset.amount)));
});
document.querySelectorAll("[data-goal]").forEach(btn => {
  btn.addEventListener("click", () => { E.goalInput.value = btn.dataset.goal; });
});

// 认证对话框
if (E.loginTab) E.loginTab.addEventListener("click", () => setAuthMode("login"));
if (E.registerTab) E.registerTab.addEventListener("click", () => setAuthMode("register"));
if (E.authForm) E.authForm.addEventListener("submit", handleAuthSubmit);
if (E.authDialogClose) E.authDialogClose.addEventListener("click", () => E.authDialog.close());

// 同步按钮
if (E.syncButton) E.syncButton.addEventListener("click", () => {
  if (currentUser) { openProfile(); }
  else { setAuthMode("login"); E.authDialog.showModal(); }
});

// 个人主页
E.avatarButton.addEventListener("click", openProfile);
E.profileGoalButton.addEventListener("click", () => { E.profileDialog.close(); E.goalInput.value = dailyGoal; E.goalDialog.showModal(); setTimeout(() => E.goalInput.select(), 50); });
E.profileHistoryButton.addEventListener("click", () => { E.profileDialog.close(); loadHistory(); E.historyDialog.showModal(); });
E.profileExportButton.addEventListener("click", exportData);
E.profileLogoutButton.addEventListener("click", () => { E.profileDialog.close(); if (currentUser) { signOut(auth); } else { setAuthMode("login"); E.authDialog.showModal(); } });
E.editAvatarButton.addEventListener("click", openAvatarEditor);
E.avatarSaveButton.addEventListener("click", saveAvatar);
E.goalButton = E.profileGoalButton;
E.goalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const goal = Number(E.goalInput.value);
  if (!E.goalForm.reportValidity() || goal < 500 || goal > 10000) return;
  try {
    await storage.updateProfile({ dailyGoal: goal });
    dailyGoal = goal; E.goalDialog.close(); E.profileGoalVal.textContent = `${goal} ml`; render();
    showToast(`每日目标已设为 ${goal} ml`, false);
  } catch (e) { showToast(toFriendlyError(e), false); }
});
E.customButton.addEventListener("click", () => { E.customDialog.showModal(); setTimeout(() => E.customAmount.select(), 50); });
E.customForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!E.customForm.reportValidity()) return;
  addRecord(E.customName.value.trim(), Number(E.customAmount.value));
  E.customDialog.close();
});
E.previousDay.addEventListener("click", () => changeDay(-1));
E.nextDay.addEventListener("click", () => changeDay(1));
E.datePickerButton.addEventListener("click", () => {
  E.datePicker.value = selectedDate;
  if (typeof E.datePicker.showPicker === "function") E.datePicker.showPicker();
  else E.datePicker.click();
});
E.datePicker.addEventListener("change", () => {
  if (!E.datePicker.value) return;
  const today = toDateKey(new Date());
  selectedDate = E.datePicker.value > today ? today : E.datePicker.value;
  loadDay();
});
E.undoButton.addEventListener("click", undoDelete);
E.historyList.addEventListener("click", (event) => {
  const delBtn = event.target.closest(".delete-record");
  if (delBtn) { deleteRecord(delBtn.dataset.id); return; }
  handleTimeEditClick(event);
});

E.historyContent.addEventListener("click", (event) => {
  const row = event.target.closest(".hist-row");
  if (!row) return;
  const idx = parseInt(row.dataset.dayIndex);
  if (!isNaN(idx) && historyDayData[idx]) renderDayDetail(historyDayData[idx]);
});
E.historyContent.addEventListener("click", (event) => {
  const backBtn = event.target.closest(".history-back-btn");
  if (backBtn) loadHistory();
});

[E.goalDialog, E.customDialog, E.customSupplementDialog, E.customMedicineDialog, E.historyDialog, E.authDialog].forEach(dlg => {
  if (!dlg) return;
  dlg.addEventListener("click", (event) => {
    const b = dlg.getBoundingClientRect();
    if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) dlg.close();
  });
});

E.waterTab.addEventListener("click", () => switchTab("water"));
E.medicineTab.addEventListener("click", () => switchTab("medicine"));
E.supplementTab.addEventListener("click", () => switchTab("supplement"));

E.medicineWorkoutToggle.addEventListener("click", () => toggleWorkoutDay());
E.supplementWorkoutToggle.addEventListener("click", () => toggleWorkoutDay());

E.deleteSupplementBtn.addEventListener("click", () => {
  if (currentEditItem?.type === "supplement") deleteCustomItem("supplement", currentEditItem.name);
});
E.deleteMedicineBtn.addEventListener("click", () => {
  if (currentEditItem?.type === "medicine") deleteCustomItem("medicine", currentEditItem.name);
});

E.customSupplementButton.addEventListener("click", () => openAddDialog("supplement"));
E.customSupplementForm.addEventListener("submit", (e) => handleItemFormSubmit(e, "supplement"));
E.supplementGrid.addEventListener("click", (e) => handleGridClick(e, "supplement"));
E.supplementHistoryList.addEventListener("click", (e) => {
  const delBtn = e.target.closest(".delete-record");
  if (delBtn) { deleteItemRecord("supplement", delBtn.dataset.id); return; }
  handleTimeEditClick(e);
});

document.querySelectorAll(".toilet-btn").forEach(btn => {
  btn.addEventListener("click", () => addToiletRecord(btn.dataset.type));
});
E.toiletHistoryList.addEventListener("click", (e) => {
  const delBtn = e.target.closest(".delete-record");
  if (delBtn) { deleteToiletRecord(delBtn.dataset.id); return; }
  handleTimeEditClick(e);
});

E.customMedicineButton.addEventListener("click", () => openAddDialog("medicine"));
E.customMedicineForm.addEventListener("submit", (e) => handleItemFormSubmit(e, "medicine"));
E.medicineGrid.addEventListener("click", (e) => handleGridClick(e, "medicine"));
E.medicineHistoryList.addEventListener("click", (e) => {
  const delBtn = e.target.closest(".delete-record");
  if (delBtn) { deleteItemRecord("medicine", delBtn.dataset.id); return; }
  handleTimeEditClick(e);
});

// 离线检测
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);

// ========== 排程工具 ==========
function isItemActiveOnDay(sch, wd, wo) {
  switch (sch) {
    case "everyday": return true;
    case "weekday": return wd;
    case "workout": return wo;
    case "workout_weekday": return wd && wo;
    default: return true;
  }
}

function isItemActiveToday(type, item) {
  return isItemActiveOnDay(item.schedule || "everyday", isWeekday(selectedDate), isWorkoutDay);
}

function getSkipReason(type, item) {
  const sch = item.schedule || "everyday";
  const wd = isWeekday(selectedDate);
  if (sch === "weekday" && !wd) return "周末休息";
  if (sch === "workout" && !isWorkoutDay) return "非健身日";
  if (sch === "workout_weekday") {
    if (!wd && !isWorkoutDay) return "周末休息 · 非健身日";
    if (!wd) return "周末休息";
    if (!isWorkoutDay) return "非健身日";
  }
  return "";
}

// ========== 在线状态 ==========
function updateOnlineStatus() {
  const online = navigator.onLine;
  if (E.offlineBadge) E.offlineBadge.hidden = online;
  if (E.syncIcon && !currentUser) {
    E.syncIcon.textContent = online ? "☁️" : "📡";
  }
}

// ========== 同步按钮 UI ==========
function updateSyncButton() {
  if (!E.syncButton) return;
  if (currentUser) {
    E.syncIcon.textContent = "✅";
    E.syncLabel.textContent = "已同步";
    E.syncButton.title = "个人主页";
  } else {
    E.syncIcon.textContent = navigator.onLine ? "☁️" : "📡";
    E.syncLabel.textContent = "本地模式";
    E.syncButton.title = "登录以同步数据";
  }
  updateOnlineStatus();
}

// ========== 健身日 ==========
async function loadWorkoutDay() {
  if (workoutDaysCache.hasOwnProperty(selectedDate)) {
    isWorkoutDay = workoutDaysCache[selectedDate];
    return;
  }
  isWorkoutDay = await storage.getWorkoutDay(selectedDate);
  workoutDaysCache[selectedDate] = isWorkoutDay;
}

async function toggleWorkoutDay() {
  const newVal = !isWorkoutDay;
  await storage.setWorkoutDay(selectedDate, newVal);
  isWorkoutDay = newVal;
  workoutDaysCache[selectedDate] = newVal;
  updateWorkoutToggleUI();
  const activeTab = E.waterPanel.hidden ? (E.medicinePanel.hidden ? "supplement" : "medicine") : "water";
  if (activeTab !== "water") renderItemList(activeTab);
  showToast(newVal ? "已标记为健身日 🏋️" : "已取消健身日", false);
}

function updateWorkoutToggleUI() {
  [E.medicineWorkoutToggle, E.supplementWorkoutToggle].forEach(btn => {
    if (!btn) return;
    btn.classList.toggle("active", isWorkoutDay);
    const indicator = btn.querySelector(".workout-indicator");
    if (indicator) indicator.textContent = isWorkoutDay ? "✓" : "";
    const label = btn.querySelector(".workout-label");
    if (label) label.textContent = isWorkoutDay ? "今天是健身日" : "今天不是健身日";
  });
}

// ========== 标签页切换 ==========
function switchTab(tab) {
  const tabs = [
    { id: "water", button: E.waterTab, panel: E.waterPanel, title: "今天喝水了吗？" },
    { id: "medicine", button: E.medicineTab, panel: E.medicinePanel, title: "今天吃药了吗？" },
    { id: "supplement", button: E.supplementTab, panel: E.supplementPanel, title: "今天吃补剂了吗？" },
  ];
  tabs.forEach(t => {
    const active = t.id === tab;
    t.button.classList.toggle("active", active);
    t.button.setAttribute("aria-selected", active);
    t.panel.hidden = !active;
    if (active) document.querySelector(".topbar h1").textContent = t.title;
  });
  if (tab === "water") render();
  else renderItemList(tab);
}

// ========== 初始化 ==========
async function initialize() {
  try {
    const fbConfig = await getFirebaseConfig();
    const app = initializeApp(fbConfig);
    auth = getAuth(app); db = getFirestore(app);
    storage.setUser(null, null);
    onAuthStateChanged(auth, applyUser);
  } catch (e) { showAuthMessage(`初始化失败：${e.message}`); if (E.authSubmit) E.authSubmit.disabled = true; }
}

async function applyUser(user) {
  currentUser = user;
  if (!user) {
    // 未登录 → 本地模式，应用仍然可用
    storage.setUser(null, null);
    records = []; medicineRecords = []; supplementRecords = []; toiletRecords = [];
    userMedicines = []; userSupplements = [];
    isWorkoutDay = false; workoutDaysCache = {};
    E.authShell.hidden = true;
    E.appShell.hidden = false;
    updateSyncButton();
    // 从 localStorage 加载 profile
    const profile = await storage.getProfile();
    dailyGoal = profile.dailyGoal || 2000;
    userMedicines = profile.medicines || [...DEFAULT_MEDICINES];
    userSupplements = profile.supplements || [...DEFAULT_SUPPLEMENTS];
    avatarType = profile.avatarType || "default";
    avatarColor = profile.avatarColor || "#168d84";
    avatarUrl = profile.avatarUrl || "";
    renderAvatar();
    await loadDay();
    switchTab("water");
    return;
  }
  // 已登录 → 云端模式
  storage.setUser(user, db);
  E.authShell.hidden = true;
  E.appShell.hidden = false;
  E.profileEmail.textContent = user.email || "已登录";
  updateSyncButton();

  // 检查是否有本地数据需要合并
  if (storage.hasLocalData()) {
    showToast("正在同步本地数据到云端...", false);
    try {
      await storage.mergeLocalToCloud();
      showToast("本地数据已同步到云端 ✅", false);
    } catch (e) {
      showToast("云端同步失败，数据保留在本地", false);
    }
  }

  await Promise.all([loadProfile(), loadDay()]);
  switchTab("water");
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!auth || !E.authForm.reportValidity()) return;
  setAuthBusy(true); showAuthMessage("");
  const email = E.emailInput.value.trim(), pw = E.passwordInput.value;
  try {
    if (authMode === "register") {
      const cred = await createUserWithEmailAndPassword(auth, email, pw);
      await setDoc(doc(db, "users", cred.user.uid), {
        dailyGoal: 2000, medicines: DEFAULT_MEDICINES, supplements: DEFAULT_SUPPLEMENTS,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    } else {
      await signInWithEmailAndPassword(auth, email, pw);
    }
    E.authDialog.close();
  } catch (e) { showAuthMessage(toFriendlyError(e)); }
  finally { setAuthBusy(false); }
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  if (E.loginTab) E.loginTab.classList.toggle("active", isLogin);
  if (E.registerTab) E.registerTab.classList.toggle("active", !isLogin);
  if (E.authEyebrow) E.authEyebrow.textContent = isLogin ? "WELCOME BACK" : "CREATE ACCOUNT";
  if (E.authTitle) E.authTitle.textContent = isLogin ? "登录你的账户" : "创建云端账户";
  if (E.authSubmit) E.authSubmit.textContent = isLogin ? "登录" : "注册";
  if (E.passwordInput) E.passwordInput.autocomplete = isLogin ? "current-password" : "new-password";
  showAuthMessage("");
}
function setAuthBusy(b) { E.authSubmit.disabled = b; E.authSubmit.textContent = b ? "请稍候..." : authMode === "login" ? "登录" : "注册"; }
function showAuthMessage(m, s = false) { if (E.authMessage) { E.authMessage.textContent = m; E.authMessage.classList.toggle("success", s); } }

// ========== 加载 ==========
async function loadProfile() {
  try {
    const profile = await storage.getProfile();
    dailyGoal = Number(profile.dailyGoal) || 2000;
    userMedicines = (Array.isArray(profile.medicines) ? profile.medicines : [...DEFAULT_MEDICINES]).map(s => ({ targetCount: 1, schedule: "everyday", ...s }));
    userSupplements = (Array.isArray(profile.supplements) ? profile.supplements : [...DEFAULT_SUPPLEMENTS]).map(s => ({ targetCount: 1, schedule: "everyday", ...s }));
    // 迁移旧 "workout" 排程 → "workout_weekday"（保持工作日+健身日原有行为）
    let migrated = false;
    for (const arr of [userMedicines, userSupplements]) {
      for (const item of arr) {
        if (item.schedule === "workout") { item.schedule = "workout_weekday"; migrated = true; }
      }
    }
    if (migrated && currentUser) {
      storage.saveItems("medicine", userMedicines).catch(() => {});
      storage.saveItems("supplement", userSupplements).catch(() => {});
    }
    avatarType = profile.avatarType || "default";
    avatarColor = profile.avatarColor || AVATAR_COLORS[0];
    avatarUrl = profile.avatarUrl || "";
    renderAvatar();
    render();
    renderItemList("medicine"); renderItemList("supplement");
  } catch (e) { showToast(toFriendlyError(e), false); }
}

async function loadDay() {
  const version = ++requestVersion;
  renderDate();
  E.historyList.innerHTML = '<div class="empty-state">正在读取记录...</div>';

  try {
    const [waterLogs, medLogs, suppLogs, toiletLogs] = await Promise.all([
      storage.getWaterLogs(selectedDate),
      storage.getLogs("medicine", selectedDate),
      storage.getLogs("supplement", selectedDate),
      storage.getLogs("toilet", selectedDate),
      loadWorkoutDay(),
    ]);
    if (version !== requestVersion) return;

    records = waterLogs;
    medicineRecords = medLogs;
    supplementRecords = suppLogs;
    toiletRecords = toiletLogs;
    updateWorkoutToggleUI();
  } catch (e) {
    if (version !== requestVersion) return;
    records = []; medicineRecords = []; supplementRecords = []; toiletRecords = [];
    showToast(toFriendlyError(e), false);
  }
  render();
  renderItemList("medicine"); renderItemList("supplement");
}

// ========== 头像 & 个人主页 ==========
function renderAvatar() {
  const svg = genAvatarSVG(avatarColor, 42);
  if (avatarType === "custom" && avatarUrl) {
    E.avatarImg.innerHTML = `<img src="${esc(avatarUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    E.avatarImg.innerHTML = svg;
  }
  if (avatarType === "custom" && avatarUrl) {
    E.profileAvatar.innerHTML = `<img src="${esc(avatarUrl)}" alt="">`;
  } else {
    E.profileAvatar.innerHTML = svg;
  }
  E.profileGoalVal.textContent = `${dailyGoal} ml`;
}

function openProfile() {
  E.profileEmail.textContent = currentUser?.email || "本地模式（未登录）";
  E.profileGoalVal.textContent = `${dailyGoal} ml`;
  // 未登录时隐藏退出按钮，改为显示登录提示
  if (E.profileLogoutButton) {
    if (currentUser) {
      E.profileLogoutButton.textContent = "🚪 退出登录";
      E.profileLogoutButton.style.display = "";
    } else {
      E.profileLogoutButton.textContent = "🔐 登录以同步数据";
      E.profileLogoutButton.style.display = "";
    }
  }
  renderAvatar();
  E.profileDialog.showModal();
}

function openAvatarEditor() {
  E.avatarColors.innerHTML = AVATAR_COLORS.map(c =>
    `<span class="avatar-color-dot${c === avatarColor ? " selected" : ""}" data-color="${c}" style="background:${c}" title="${c}"></span>`
  ).join("");
  E.avatarColors.querySelectorAll(".avatar-color-dot").forEach(dot => {
    dot.addEventListener("click", () => {
      E.avatarColors.querySelectorAll(".avatar-color-dot").forEach(d => d.classList.remove("selected"));
      dot.classList.add("selected");
      avatarColor = dot.dataset.color;
      updateAvatarPreview();
    });
  });
  E.avatarUrlInput.value = avatarType === "custom" ? avatarUrl : "";
  updateAvatarPreview();
  E.profileDialog.close();
  E.avatarDialog.showModal();
}

function updateAvatarPreview() {
  E.avatarPreview.innerHTML = genAvatarSVG(avatarColor, 56);
}

async function saveAvatar() {
  const url = E.avatarUrlInput.value.trim();
  if (url) { avatarType = "custom"; avatarUrl = url; }
  else { avatarType = "default"; avatarUrl = ""; }
  await storage.updateProfile({ avatarType, avatarColor, avatarUrl });
  renderAvatar();
  E.avatarDialog.close();
  E.profileDialog.showModal();
}

[E.profileDialog, E.avatarDialog].forEach(dlg => {
  dlg.addEventListener("click", (event) => {
    const b = dlg.getBoundingClientRect();
    if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) dlg.close();
  });
});

// ========== 饮水 ==========
async function addRecord(source, amount) {
  try {
    const now = new Date();
    const rec = await storage.addWaterLog({ source, amount, logDate: selectedDate, recordedAt: now });
    records.push({ id: rec.id, source, amount, logDate: selectedDate, recordedAt: now });
    render(); showToast(`已记录 ${amount} ml`, false);
  } catch (e) { showToast(toFriendlyError(e), false); }
}

async function deleteRecord(id) {
  const idx = records.findIndex(r => r.id === id);
  if (idx < 0) return;
  const [rec] = records.splice(idx, 1); render();
  lastDeleted = { record: rec, index: idx, type: "water" };
  showToast(`已删除 ${rec.amount} ml 记录`, true);
  try {
    await storage.deleteWaterLog(id);
  } catch (e) {
    records.splice(idx, 0, rec); render();
    lastDeleted = null;
    showToast(toFriendlyError(e), false);
  }
}

async function undoDelete() {
  if (!lastDeleted) return;
  const p = lastDeleted; lastDeleted = null; hideToast();
  if (p.type === "water") {
    try {
      const rec = await storage.addWaterLog({ source: p.record.source, amount: p.record.amount, logDate: p.record.logDate, recordedAt: new Date(p.record.recordedAt) });
      records.splice(p.index, 0, { ...p.record, id: rec.id }); render();
    } catch (e) { showToast(toFriendlyError(e), false); }
  } else if (p.type === "toilet") {
    try {
      const rec = await storage.addLog("toilet", { type: p.record.type, logDate: p.record.logDate, recordedAt: new Date(p.record.recordedAt) });
      toiletRecords.splice(p.index, 0, { ...p.record, id: rec.id }); renderToiletHistory();
    } catch (e) { showToast(toFriendlyError(e), false); }
  } else {
    const arr = p.type === "medicine" ? medicineRecords : supplementRecords;
    try {
      const rec = await storage.addLog(p.type, { name: p.record.name, dosage: p.record.dosage, count: p.record.count, logDate: p.record.logDate, recordedAt: new Date(p.record.recordedAt) });
      arr.splice(p.index, 0, { ...p.record, id: rec.id }); renderItemList(p.type);
    } catch (e) { showToast(toFriendlyError(e), false); }
  }
}

// ========== 修改记录时间 ==========
async function updateRecordTime(coll, id, newTime) {
  try {
    if (coll === "waterLogs") {
      await storage.updateWaterLogTime(id, newTime);
      const idx = records.findIndex(r => r.id === id);
      if (idx >= 0) records[idx].recordedAt = newTime;
      records.sort((a, b) => a.recordedAt - b.recordedAt);
      render();
    } else if (coll === "toiletLogs") {
      await storage.updateLogTime("toilet", id, newTime);
      const idx = toiletRecords.findIndex(r => r.id === id);
      if (idx >= 0) toiletRecords[idx].recordedAt = newTime;
      toiletRecords.sort((a, b) => a.recordedAt - b.recordedAt);
      renderToiletHistory();
    } else if (coll === "medicineLogs") {
      await storage.updateLogTime("medicine", id, newTime);
      const idx = medicineRecords.findIndex(r => r.id === id);
      if (idx >= 0) medicineRecords[idx].recordedAt = newTime;
      medicineRecords.sort((a, b) => a.recordedAt - b.recordedAt);
      renderItemList("medicine");
    } else if (coll === "supplementLogs") {
      await storage.updateLogTime("supplement", id, newTime);
      const idx = supplementRecords.findIndex(r => r.id === id);
      if (idx >= 0) supplementRecords[idx].recordedAt = newTime;
      supplementRecords.sort((a, b) => a.recordedAt - b.recordedAt);
      renderItemList("supplement");
    }
    showToast("时间已更新", false);
  } catch (e) { showToast(toFriendlyError(e), false); }
}

function handleTimeEditClick(event) {
  const timeEl = event.target.closest(".time-editable");
  if (!timeEl || timeEl.dataset.editing === "true") return;
  const id = timeEl.dataset.id;
  const coll = timeEl.dataset.coll;
  const currentTime = timeEl.dataset.time;
  timeEl.dataset.editing = "true";

  const input = document.createElement("input");
  input.type = "time";
  input.value = currentTime;
  input.className = "time-input";
  timeEl.textContent = "";
  timeEl.appendChild(input);
  input.focus();

  let saved = false;
  const save = () => {
    if (saved) return;
    const newTimeStr = input.value;
    if (!newTimeStr || newTimeStr === currentTime) {
      saved = true;
      timeEl.textContent = toTimeDisplay(currentTime);
      timeEl.dataset.editing = "false";
      return;
    }
    saved = true;
    const [h, m] = newTimeStr.split(":").map(Number);
    const d = fromDateKey(selectedDate);
    d.setHours(h, m, 0, 0);
    updateRecordTime(coll, id, d);
  };
  input.addEventListener("change", save);
  input.addEventListener("blur", () => setTimeout(save, 150));
}

// ========== 厕所记录 ==========
async function addToiletRecord(type) {
  try {
    const now = new Date();
    const rec = await storage.addLog("toilet", { type, logDate: selectedDate, recordedAt: now });
    toiletRecords.push({ id: rec.id, type, logDate: selectedDate, recordedAt: now });
    renderToiletHistory();
    const label = type === "big" ? "大号" : "小号";
    showToast(`已记录 ${label} 🧻`, false);
  } catch (e) { showToast(toFriendlyError(e), false); }
}

async function deleteToiletRecord(id) {
  const idx = toiletRecords.findIndex(r => r.id === id);
  if (idx < 0) return;
  const [rec] = toiletRecords.splice(idx, 1); renderToiletHistory();
  lastDeleted = { record: rec, index: idx, type: "toilet" };
  const label = rec.type === "big" ? "大号" : "小号";
  showToast(`已删除 ${label} 记录`, true);
  try {
    await storage.deleteLog("toilet", id);
  } catch (e) {
    toiletRecords.splice(idx, 0, rec); renderToiletHistory();
    lastDeleted = null;
    showToast(toFriendlyError(e), false);
  }
}

// ========== 药物/补剂 通用 ==========
function getCfg(type) {
  if (type === "medicine") return { defs: DEFAULT_MEDICINES, userList: userMedicines, recs: medicineRecords, coll: "medicineLogs" };
  return { defs: DEFAULT_SUPPLEMENTS, userList: userSupplements, recs: supplementRecords, coll: "supplementLogs" };
}
function getFullList(type) {
  const cfg = getCfg(type); const seen = new Set(); const list = [];
  for (const s of [...cfg.defs, ...cfg.userList]) { if (!seen.has(s.name)) { seen.add(s.name); list.push(s); } }
  return list;
}
function getCount(type, name) { const r = getCfg(type).recs.find(r => r.name === name); return r ? (r.count || 0) : 0; }

async function incrementItem(type, name) {
  const full = getFullList(type);
  const item = full.find(s => s.name === name);
  if (!item) return;
  if (!isItemActiveToday(type, item)) {
    showToast(`${name}: ${getSkipReason(type, item)}，无需服用`, false);
    return;
  }
  const cfg = getCfg(type);
  const target = item.targetCount || 1;
  const dosage = item.dosage || "1份/次";
  const idx = cfg.recs.findIndex(r => r.name === name);
  const now = new Date();
  if (idx >= 0) {
    const rec = cfg.recs[idx];
    const newCount = rec.count >= target ? 0 : rec.count + 1;
    try {
      await storage.updateLogCount(type, rec.id, newCount, now);
      cfg.recs[idx] = { ...rec, count: newCount, recordedAt: now };
      renderItemList(type);
      if (newCount === 0) showToast(`${name} 已归零`, false);
      else if (newCount >= target) showToast(`${name} ✓ 已完成 ${newCount}/${target}`, false);
      else showToast(`${name} ${newCount}/${target}`, false);
    } catch (e) { showToast(toFriendlyError(e), false); }
  } else {
    try {
      const rec = await storage.addLog(type, { name, dosage, count: 1, logDate: selectedDate, recordedAt: now });
      cfg.recs.push({ id: rec.id, name, dosage, count: 1, logDate: selectedDate, recordedAt: now });
      renderItemList(type);
      showToast(`${name} 1/${target}`, false);
    } catch (e) { showToast(toFriendlyError(e), false); }
  }
}

async function decrementItem(type, name) {
  const cfg = getCfg(type);
  const idx = cfg.recs.findIndex(r => r.name === name);
  if (idx < 0) return;
  const rec = cfg.recs[idx];
  const newCount = Math.max(0, (rec.count || 0) - 1);
  try {
    await storage.updateLogCount(type, rec.id, newCount, new Date());
    cfg.recs[idx] = { ...rec, count: newCount, recordedAt: new Date() };
    renderItemList(type);
    const target = (getFullList(type).find(s => s.name === name) || {}).targetCount || 1;
    showToast(`${name} ${newCount}/${target}`, false);
  } catch (e) { showToast(toFriendlyError(e), false); }
}

async function resetItemCount(type, name) {
  const cfg = getCfg(type);
  const idx = cfg.recs.findIndex(r => r.name === name);
  if (idx < 0) return;
  const rec = cfg.recs[idx];
  try {
    await storage.updateLogCount(type, rec.id, 0, new Date());
    cfg.recs[idx] = { ...rec, count: 0, recordedAt: new Date() };
    renderItemList(type); showToast(`${name} 已归零`, false);
  } catch (e) { showToast(toFriendlyError(e), false); }
}

function handleGridClick(event, type) {
  const editIcon = event.target.closest(".card-edit-icon");
  if (editIcon) { openEditDialog(type, editIcon.dataset.name); return; }
  const minusBtn = event.target.closest(".count-minus");
  if (minusBtn) { decrementItem(type, minusBtn.dataset.name); return; }
  const resetBtn = event.target.closest(".count-reset");
  if (resetBtn) { resetItemCount(type, resetBtn.dataset.name); return; }
  const card = event.target.closest(".supplement-card");
  if (card) { incrementItem(type, card.dataset.name); }
}

function getDlg(type) {
  const isMed = type === "medicine";
  return {
    dialog: isMed ? E.customMedicineDialog : E.customSupplementDialog,
    name: isMed ? E.customMedicineName : E.customSupplementName,
    dosage: isMed ? E.customMedicineDosage : E.customSupplementDosage,
    target: isMed ? E.customMedicineTarget : E.customSupplementTarget,
    schedule: isMed ? E.customMedicineSchedule : E.customSupplementSchedule,
    label: isMed ? "药物" : "补剂",
  };
}

function openAddDialog(type) {
  currentEditItem = null;
  const d = getDlg(type);
  d.name.value = ""; d.dosage.value = ""; d.target.value = "1"; d.schedule.value = "everyday";
  d.dialog.querySelector(".dialog-heading h2").textContent = "自定义" + d.label;
  d.dialog.querySelector(".primary-button").textContent = "添加" + d.label;
  const delBtn = type === "medicine" ? E.deleteMedicineBtn : E.deleteSupplementBtn;
  if (delBtn) delBtn.style.display = "none";
  d.dialog.showModal();
  setTimeout(() => d.name.focus(), 50);
}

function openEditDialog(type, name) {
  const full = getFullList(type);
  const item = full.find(s => s.name === name);
  if (!item) return;
  currentEditItem = { type, name: item.name };
  const d = getDlg(type);
  d.name.value = item.name;
  d.dosage.value = item.dosage || "";
  d.target.value = item.targetCount || 1;
  d.schedule.value = item.schedule || "everyday";
  d.dialog.querySelector(".dialog-heading h2").textContent = "编辑" + d.label;
  d.dialog.querySelector(".primary-button").textContent = "保存修改";
  const delBtn = type === "medicine" ? E.deleteMedicineBtn : E.deleteSupplementBtn;
  if (delBtn) delBtn.style.display = "";
  d.dialog.showModal();
  setTimeout(() => d.name.select(), 50);
}

async function handleItemFormSubmit(event, type) {
  event.preventDefault();
  const d = getDlg(type);
  if (!d.dialog.querySelector("form").reportValidity()) return;
  const name = d.name.value.trim();
  const dosage = d.dosage.value.trim() || "1份/次";
  const targetCount = parseInt(d.target.value) || 1;
  const schedule = d.schedule.value || "everyday";
  if (currentEditItem) await editItem(type, currentEditItem.name, name, dosage, targetCount, schedule);
  else await addCustomItem(type, name, dosage, targetCount, schedule);
  currentEditItem = null; d.dialog.close();
}

async function addCustomItem(type, name, dosage, targetCount, schedule) {
  if (getFullList(type).some(s => s.name === name)) { showToast(`"${name}" 已存在`, false); return; }
  const arr = type === "medicine" ? userMedicines : userSupplements;
  const newList = [...arr, { name, dosage, targetCount, schedule, emoji: "💊" }];
  try {
    await storage.saveItems(type, newList);
    if (type === "medicine") userMedicines = newList; else userSupplements = newList;
    renderItemList(type);
    showToast(`已添加${type === "medicine" ? "药物" : "补剂"} "${name}"`, false);
  } catch (e) { showToast(toFriendlyError(e), false); }
}

async function editItem(type, oldName, newName, newDosage, newTarget, newSchedule) {
  if (oldName !== newName && getFullList(type).some(s => s.name === newName)) { showToast(`"${newName}" 已存在`, false); return; }
  const arr = type === "medicine" ? userMedicines : userSupplements;
  const defs = type === "medicine" ? DEFAULT_MEDICINES : DEFAULT_SUPPLEMENTS;
  const isDef = defs.some(d => d.name === oldName);
  let newList;
  if (isDef) {
    newList = [...arr.filter(s => s.name !== oldName), { name: newName, dosage: newDosage, targetCount: newTarget, schedule: newSchedule, emoji: "💊" }];
  } else {
    newList = arr.map(s => s.name === oldName ? { ...s, name: newName, dosage: newDosage, targetCount: newTarget, schedule: newSchedule } : s);
  }
  try {
    await storage.saveItems(type, newList);
    if (type === "medicine") userMedicines = newList; else userSupplements = newList;
    renderItemList(type);
    showToast(`已更新${type === "medicine" ? "药物" : "补剂"} "${newName}"`, false);
  } catch (e) { showToast(toFriendlyError(e), false); }
}

async function deleteCustomItem(type, name) {
  const arr = type === "medicine" ? userMedicines : userSupplements;
  const label = type === "medicine" ? "药物" : "补剂";
  const defs = type === "medicine" ? DEFAULT_MEDICINES : DEFAULT_SUPPLEMENTS;
  const isDef = defs.some(d => d.name === name);
  const newList = arr.filter(s => s.name !== name);
  const dlg = type === "medicine" ? E.customMedicineDialog : E.customSupplementDialog;
  dlg.close();
  currentEditItem = null;
  try {
    await storage.saveItems(type, newList);
    if (type === "medicine") userMedicines = newList; else userSupplements = newList;
    renderItemList(type);
    showToast(`已删除${label} "${name}"`, true);
  } catch (e) { showToast(toFriendlyError(e), false); }
}

async function deleteItemRecord(type, id) {
  const cfg = getCfg(type);
  const idx = cfg.recs.findIndex(r => r.id === id);
  if (idx < 0) return;
  const [rec] = cfg.recs.splice(idx, 1); renderItemList(type);
  lastDeleted = { record: rec, index: idx, type };
  showToast(`已删除 ${rec.name} 记录`, true);
  try {
    await storage.deleteLog(type, id);
  } catch (e) {
    cfg.recs.splice(idx, 0, rec); renderItemList(type);
    lastDeleted = null;
    showToast(toFriendlyError(e), false);
  }
}

// ========== 饮水渲染 ==========
function render() {
  const total = records.reduce((s, r) => s + Number(r.amount), 0);
  const ratio = dailyGoal > 0 ? total / dailyGoal : 0;
  const pct = Math.round(ratio * 100), capped = Math.min(ratio * 100, 100);
  E.currentAmount.textContent = total; E.goalAmount.textContent = dailyGoal;
  E.progressPercent.textContent = `${pct}%`; E.progressBar.style.width = `${capped}%`;
  E.waterFill.setAttribute("y", 190 - capped * 1.9);
  E.waterWave.setAttribute("transform", `translate(0 ${190 - capped * 1.9})`);
  E.progressMessage.textContent = getProgressMessage(total, dailyGoal);
  renderDate(); renderHistory(); renderToiletHistory();
}

function renderDate() {
  const sel = fromDateKey(selectedDate);
  const today = toDateKey(new Date());
  const yst = new Date(); yst.setDate(yst.getDate() - 1);
  if (selectedDate === today) E.dateLabel.textContent = "今天";
  else if (selectedDate === toDateKey(yst)) E.dateLabel.textContent = "昨天";
  else E.dateLabel.textContent = sel.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
  E.fullDate.textContent = sel.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  E.nextDay.disabled = selectedDate >= today;
  E.datePicker.max = today;
}

function renderHistory() {
  E.recordCount.textContent = `${records.length} 条`;
  if (records.length === 0) {
    E.historyList.innerHTML = '<div class="empty-state">这一天还没有饮水记录，点击上方卡片添加一杯吧。</div>';
    return;
  }
  E.historyList.innerHTML = [...records].reverse().map(r => {
    const tv = toTimeValue(r.recordedAt);
    const td = toTimeDisplay(tv);
    return `<article class="history-item"><span class="history-dot">◒</span><div class="history-info"><strong>${esc(r.source)}</strong><span class="time-editable" data-id="${r.id}" data-coll="waterLogs" data-time="${tv}" title="点击修改时间">${td}</span></div><strong class="history-amount">+${r.amount} ml</strong><button class="delete-record" type="button" data-id="${r.id}" aria-label="删除">×</button></article>`;
  }).join("");
}

// ========== 厕所渲染 ==========
function renderToiletHistory() {
  E.toiletRecordCount.textContent = `${toiletRecords.length} 条`;
  if (toiletRecords.length === 0) {
    E.toiletHistoryList.innerHTML = '<div class="empty-state">这一天还没有厕所记录，点击上方按钮记录吧。</div>';
    return;
  }
  E.toiletHistoryList.innerHTML = [...toiletRecords].reverse().map(r => {
    const tv = toTimeValue(r.recordedAt);
    const td = toTimeDisplay(tv);
    const icon = r.type === "big" ? TOILET_SVG.big : TOILET_SVG.small;
    const label = r.type === "big" ? "大号" : "小号";
    return `<article class="history-item toilet-history-item">
      <span class="history-dot toilet-dot">${icon}</span>
      <div class="history-info"><strong>${label}</strong><span class="time-editable" data-id="${r.id}" data-coll="toiletLogs" data-time="${tv}" title="点击修改时间">${td}</span></div>
      <button class="delete-record" type="button" data-id="${r.id}" aria-label="删除">×</button>
    </article>`;
  }).join("");
}

// ========== 药物/补剂渲染 ==========
function renderItemList(type) {
  const isMed = type === "medicine";
  const fullList = getFullList(type);
  const activeList = fullList.filter(s => isItemActiveToday(type, s));
  const skipList = fullList.filter(s => !isItemActiveToday(type, s));
  let takenCount = 0;
  for (const s of activeList) {
    if (getCount(type, s.name) >= (s.targetCount || 1)) takenCount++;
  }
  const totalCount = activeList.length;
  const percent = totalCount > 0 ? Math.round((takenCount / totalCount) * 100) : 0;

  (isMed ? E.medicineTakenCount : E.supplementTakenCount).textContent = takenCount;
  (isMed ? E.medicineTotalCount : E.supplementTotalCount).textContent = totalCount;
  (isMed ? E.medicinePercent : E.supplementPercent).textContent = `${percent}%`;

  const workoutRow = isMed ? document.querySelector("#medicineWorkoutRow") : document.querySelector("#supplementWorkoutRow");
  const hasWorkoutItems = fullList.some(s => (s.schedule || "everyday") === "workout");
  if (workoutRow) workoutRow.style.display = hasWorkoutItems ? "" : "none";

  const grid = isMed ? E.medicineGrid : E.supplementGrid;
  const allCards = [...activeList, ...skipList];
  grid.innerHTML = allCards.map(item => {
    const active = isItemActiveToday(type, item);
    const reason = active ? "" : getSkipReason(type, item);
    const count = getCount(type, item.name);
    const target = item.targetCount || 1;
    const done = count >= target && active;
    const clsBase = isMed ? "supplement-card medicine-card" : "supplement-card";
    const cls = `${clsBase} ${done ? "taken" : ""} ${!active ? "skipped" : ""}`;
    let dots = "";
    for (let i = 1; i <= target; i++) dots += `<span class="count-dot ${i <= count ? "filled" : ""}">${i <= count ? "●" : "○"}</span>`;
    const skipBadge = reason ? `<span class="skip-badge">${reason}</span>` : "";
    return `
      <div class="${cls}" data-name="${esc(item.name)}">
        <span class="card-edit-icon" data-action="edit" data-name="${esc(item.name)}" title="编辑">⚙</span>
        <span class="supplement-emoji">${item.emoji || "💊"}</span>
        <span class="supplement-name">${esc(item.name)}</span>
        <span class="supplement-dosage">${esc(item.dosage || "")} · ${active ? count + "/" + target : "—"}</span>
        ${active ? `<span class="count-dots">${dots}</span>` : skipBadge}
        ${active ? `
        <span class="count-actions">
          <span class="count-minus" data-name="${esc(item.name)}" title="减一次">−</span>
          <span class="count-reset" data-name="${esc(item.name)}" title="归零" style="${count > 0 ? '' : 'visibility:hidden'}">↺</span>
        </span>` : ""}
      </div>`;
  }).join("");

  const hint = isMed ? E.medicineHint : E.supplementHint;
  hint.textContent = `点击卡片 +1 · 灰色=今日跳过`;

  const label = isMed ? "药物" : "补剂";
  renderItemHistoryHTML(type, isMed, fullList, label);
}

// ========== 药物/补剂渲染辅助 ==========
function renderItemHistoryHTML(type, isMed, fullList, label) {
  const recs = isMed ? medicineRecords : supplementRecords;
  const countEl = isMed ? E.medicineRecordCount : E.supplementRecordCount;
  const listEl = isMed ? E.medicineHistoryList : E.supplementHistoryList;
  const coll = isMed ? "medicineLogs" : "supplementLogs";
  countEl.textContent = `${recs.length} 条`;
  if (recs.length === 0) {
    listEl.innerHTML = `<div class="empty-state">这一天还没有${label}记录，点击上方卡片开始记录吧。</div>`;
    return;
  }
  listEl.innerHTML = [...recs].reverse().map(r => {
    const tv = toTimeValue(r.recordedAt);
    const td = toTimeDisplay(tv);
    const item = fullList.find(s => s.name === r.name);
    const target = item?.targetCount || 1;
    const cnt = r.count || 0;
    const done = cnt >= target;
    const icon = done ? "✓" : (cnt > 0 ? "◐" : "✗");
    const cls = done ? "taken" : (cnt > 0 ? "partial" : "missed");
    const txt = done ? `已完成 ${cnt}/${target}` : (cnt > 0 ? `部分 ${cnt}/${target}` : "未服用");
    return `<article class="history-item supplement-history-item">
      <span class="history-dot supplement-dot ${cls}">${icon}</span>
      <div class="history-info"><strong>${esc(r.name)}</strong><span>${esc(r.dosage || "")} · <span class="time-editable" data-id="${r.id}" data-coll="${coll}" data-time="${tv}" title="点击修改时间">${td}</span></span></div>
      <strong class="history-amount supplement-status ${cls}">${txt}</strong>
      <button class="delete-record" type="button" data-id="${r.id}" aria-label="删除">×</button>
    </article>`;
  }).join("");
}

function renderDayDetailItemHTML(type, recs) {
  if (!recs || recs.length === 0) return "";
  const isToilet = type === "toilet";
  const isMed = type === "medicine";
  const isSupp = type === "supplement";
  const fullList = isMed ? getFullList("medicine") : isSupp ? getFullList("supplement") : null;
  return [...recs].sort((a, b) => {
    const ta = a.recordedAt?.toDate?.() ?? new Date(0);
    const tb = b.recordedAt?.toDate?.() ?? new Date(0);
    return tb - ta;
  }).map(r => {
    const t = r.recordedAt?.toDate?.() ?? new Date();
    const td = t.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    if (isToilet) {
      const icon = r.type === "big" ? TOILET_SVG.bigSmall : TOILET_SVG.smallSmall;
      const label = r.type === "big" ? "大号" : "小号";
      return `<div class="detail-item"><span class="detail-dot">${icon}</span><span class="detail-name">${label}</span><span class="detail-time">${td}</span></div>`;
    }
    const cnt = r.count || 0;
    const item = fullList.find(s => s.name === r.name);
    const target = item?.targetCount || 1;
    const done = cnt >= target;
    const cls = done ? "taken" : (cnt > 0 ? "partial" : "missed");
    const txt = done ? `✓ ${cnt}/${target}` : (cnt > 0 ? `${cnt}/${target}` : "未服");
    return `<div class="detail-item"><span class="detail-dot ${cls}">💊</span><span class="detail-name">${esc(r.name)}</span><span class="detail-dosage">${esc(r.dosage || "")}</span><span class="detail-time">${td}</span><strong class="detail-val detail-status-${cls}">${txt}</strong></div>`;
  }).join("");
}

function toiletItems(toiletRecs) {
  if (!toiletRecs || toiletRecs.length === 0) return "";
  const big = toiletRecs.filter(r => r.type === "big").length;
  const small = toiletRecs.filter(r => r.type === "small").length;
  const parts = [];
  if (big > 0) parts.push(`<span class="hist-dot" style="background:#fff0ef;padding:4px" title="大号 ×${big}">${TOILET_SVG.histBig}</span>`);
  if (small > 0) parts.push(`<span class="hist-dot" style="background:#e3f0fb;padding:4px" title="小号 ×${small}">${TOILET_SVG.histSmall}</span>`);
  return parts.join("");
}

// ========== 历史记录弹窗 ==========
async function loadHistory(more = false) {
  if (!more) {
    historyOffset = 0;
    historyDayData = [];
    E.historyContent.innerHTML = '<div class="empty-state">正在加载历史记录...</div>';
  }
  try {
    const dates = [];
    for (let i = historyOffset; i < historyOffset + HISTORY_PAGE_SIZE; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      dates.push(toDateKey(d));
    }
    historyOffset += HISTORY_PAGE_SIZE;
    const dayData = await storage.getHistory(dates);
    if (more) {
      historyDayData = [...historyDayData, ...dayData];
    } else {
      historyDayData = dayData;
    }
    historyViewMode = "overview";

    const now = new Date();
    const offset = more ? historyDayData.length - dayData.length : 0;
    const html = dayData.map((day, i) => {
      const d = fromDateKey(day.dateKey);
      const isToday = day.dateKey === toDateKey(now);
      const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
      const isYesterday = day.dateKey === toDateKey(yesterday);
      let dateLabel;
      if (isToday) dateLabel = "今天";
      else if (isYesterday) dateLabel = "昨天";
      else dateLabel = d.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
      const fullDate = d.toLocaleDateString("zh-CN", { weekday: "short", month: "short", day: "numeric" });
      const isWkdy = d.getDay() >= 1 && d.getDay() <= 5;

      const waterPct = dailyGoal > 0 ? Math.min(Math.round((day.waterTotal / dailyGoal) * 100), 100) : 0;
      const waterBar = `<div class="hist-bar"><div class="hist-fill" style="width:${waterPct}%"></div></div>`;

      const medItems = getFullList("medicine").map(item => {
        const rec = day.medRecs.find(r => r.name === item.name);
        const cnt = rec ? rec.count : 0;
        const tgt = item.targetCount || 1;
        const sch = item.schedule || "everyday";
        const active = isItemActiveOnDay(sch, isWkdy, day.isWorkout);
        if (!active) return `<span class="hist-dot gray" title="${item.name}: 跳过">—</span>`;
        if (cnt >= tgt) return `<span class="hist-dot green" title="${item.name}: ✓ ${cnt}/${tgt}">✓</span>`;
        if (cnt > 0) return `<span class="hist-dot yellow" title="${item.name}: ${cnt}/${tgt}">◐</span>`;
        return `<span class="hist-dot red" title="${item.name}: 未服">✗</span>`;
      }).join("");

      const suppItems = getFullList("supplement").map(item => {
        const rec = day.suppRecs.find(r => r.name === item.name);
        const cnt = rec ? rec.count : 0;
        const tgt = item.targetCount || 1;
        const sch = item.schedule || "everyday";
        const active = isItemActiveOnDay(sch, isWkdy, day.isWorkout);
        if (!active) return `<span class="hist-dot gray" title="${item.name}: 跳过">—</span>`;
        if (cnt >= tgt) return `<span class="hist-dot green" title="${item.name}: ✓ ${cnt}/${tgt}">✓</span>`;
        if (cnt > 0) return `<span class="hist-dot yellow" title="${item.name}: ${cnt}/${tgt}">◐</span>`;
        return `<span class="hist-dot red" title="${item.name}: 未服">✗</span>`;
      }).join("");

      const idx = offset + i;
      return `<div class="hist-row" data-day-index="${idx}" title="点击查看详情">
        <div class="hist-date"><strong>${dateLabel}</strong><span>${fullDate}${day.isWorkout ? " 🏋️" : ""}</span></div>
        <div class="hist-col"><span class="hist-label">💧</span><span class="hist-val">${day.waterTotal}ml</span>${waterBar}<span class="hist-pct">${waterPct}%</span></div>
        <div class="hist-col"><span class="hist-label">💚</span>${medItems || '<span class="hist-empty">—</span>'}</div>
        <div class="hist-col"><span class="hist-label">💊</span>${suppItems || '<span class="hist-empty">—</span>'}</div>
        <div class="hist-col"><span class="hist-label">🧻</span>${toiletItems(day.toiletRecs) || '<span class="hist-empty">—</span>'}</div>
      </div>`;
    }).join("");

    const loadMoreBtn = dayData.length >= HISTORY_PAGE_SIZE
      ? '<div class="hist-load-more"><button class="text-button" id="histLoadMoreBtn" type="button">加载更多...</button></div>'
      : '<div class="hist-end">已加载全部记录</div>';

    if (more) {
      // 移除旧按钮，追加新数据+新按钮
      const oldBtn = E.historyContent.querySelector(".hist-load-more");
      const oldEnd = E.historyContent.querySelector(".hist-end");
      if (oldBtn) oldBtn.remove();
      if (oldEnd) oldEnd.remove();
      E.historyContent.insertAdjacentHTML("beforeend", html + loadMoreBtn);
    } else {
      E.historyContent.innerHTML = html + loadMoreBtn;
    }
    // 绑定加载更多按钮
    const btn = E.historyContent.querySelector("#histLoadMoreBtn");
    if (btn) btn.addEventListener("click", () => loadHistory(true));
  } catch (e) {
    E.historyContent.innerHTML = `<div class="empty-state">加载失败：${toFriendlyError(e)}</div>`;
  }
}

// ========== 日详情视图 ==========
function renderDayDetail(day) {
  if (!day) return;
  historyViewMode = "detail";
  const d = fromDateKey(day.dateKey);
  let dateLabel;
  const now = new Date();
  if (day.dateKey === toDateKey(now)) dateLabel = "今天";
  else {
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    if (day.dateKey === toDateKey(yesterday)) dateLabel = "昨天";
    else dateLabel = d.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
  }
  const fullDate = d.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });

  let waterItems = day.waterRecs?.length > 0
    ? [...day.waterRecs].sort((a, b) => {
        const ta = a.recordedAt?.toDate?.() ?? new Date(0);
        const tb = b.recordedAt?.toDate?.() ?? new Date(0);
        return tb - ta;
      }).map(r => {
        const t = r.recordedAt?.toDate?.() ?? new Date();
        const td = t.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
        return `<div class="detail-item"><span class="detail-dot">◒</span><span class="detail-name">${esc(r.source || "饮水")}</span><span class="detail-time">${td}</span><strong class="detail-val">+${r.amount} ml</strong></div>`;
      }).join("")
    : '<div class="detail-empty">这一天没有饮水记录</div>';

  const medHtml = renderDayDetailItemHTML("medicine", day.medRecs);
  let medItems = medHtml || '<div class="detail-empty">这一天没有药物记录</div>';

  const suppHtml = renderDayDetailItemHTML("supplement", day.suppRecs);
  let suppItems = suppHtml || '<div class="detail-empty">这一天没有补剂记录</div>';

  const toiletHtml = renderDayDetailItemHTML("toilet", day.toiletRecs);
  let toiletItemsHtml = toiletHtml || '<div class="detail-empty">这一天没有厕所记录</div>';

  E.historyContent.innerHTML = `
    <div class="detail-header">
      <button class="history-back-btn text-button" type="button">← 返回历史列表</button>
      <div><strong class="detail-date-label">${dateLabel}</strong><span class="detail-full-date">${fullDate}${day.isWorkout ? " 🏋️ 健身日" : ""}</span></div>
    </div>
    <div class="detail-section"><h3>💧 饮水记录</h3><div class="detail-water-total">当日饮水：<strong>${day.waterTotal} ml</strong></div>${waterItems}</div>
    <div class="detail-section"><h3>💚 药物记录</h3>${medItems}</div>
    <div class="detail-section"><h3>💊 补剂记录</h3>${suppItems}</div>
    <div class="detail-section"><h3>🧻 厕所记录</h3>${toiletItemsHtml}</div>`;
}

// ========== 工具 ==========
async function changeDay(offset) {
  const d = fromDateKey(selectedDate); d.setDate(d.getDate() + offset);
  const nk = toDateKey(d); if (nk > toDateKey(new Date())) return;
  selectedDate = nk; await loadDay();
}

function showToast(m, undo) {
  clearTimeout(toastTimer); E.toastText.textContent = m;
  E.undoButton.hidden = !undo; E.toast.classList.add("show");
  toastTimer = setTimeout(hideToast, undo ? 5000 : 2600);
}

function hideToast() { E.toast.classList.remove("show"); }

function exportData() {
  try {
    const raw = localStorage.getItem("health_tracker_data");
    const data = raw ? JSON.parse(raw) : { records: {}, profile: {}, workoutDays: {} };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `健康追踪_数据备份_${toDateKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("数据已导出", false);
    E.profileDialog.close();
  } catch (e) {
    showToast("导出失败", false);
  }
}

initialize();
