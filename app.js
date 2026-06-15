import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  createUserWithEmailAndPassword, getAuth, onAuthStateChanged,
  signInWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs,
  getFirestore, query, serverTimestamp, setDoc, where,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

let auth = null, db = null, currentUser = null;
let selectedDate = toDateKey(new Date());
let records = [], dailyGoal = 2000, authMode = "login";
let lastDeleted = null, toastTimer = null, requestVersion = 0;

// ---- 药物 & 补剂状态 ----
let medicineRecords = [], supplementRecords = [], toiletRecords = [];
let userMedicines = [], userSupplements = [];
let currentEditItem = null;
let isWorkoutDay = false;       // 当前选中日期是否是健身日
let workoutDaysCache = {};      // dateKey → bool 缓存
let historyDayData = [];        // 历史记录数据缓存
let historyViewMode = "overview"; // "overview" | "detail"

// 头像
let avatarType = "default";     // "default" | "custom"
let avatarColor = "#168d84";    // 默认头像背景色
let avatarUrl = "";             // 自定义头像图片 URL
const AVATAR_COLORS = ["#168d84","#d84f46","#428fcb","#e8923f","#8b5cf6","#ec4899","#14b8a6","#6366f1","#f43f5e","#0ea5e9"];

// 预设药物
const DEFAULT_MEDICINES = [
  { name: "EVA", dosage: "1粒/次", targetCount: 2, schedule: "everyday", emoji: "💚" },
];

// 预设补剂
const DEFAULT_SUPPLEMENTS = [
  { name: "维生素C", dosage: "1片/次", targetCount: 1, schedule: "weekday", emoji: "🍊" },
  { name: "维生素B2", dosage: "1片/次", targetCount: 1, schedule: "weekday", emoji: "💛" },
  { name: "维生素B6", dosage: "1片/次", targetCount: 1, schedule: "weekday", emoji: "💛" },
  { name: "鱼油", dosage: "1粒/次", targetCount: 1, schedule: "weekday", emoji: "🐟" },
  { name: "镁", dosage: "1粒/次", targetCount: 1, schedule: "everyday", emoji: "🔵" },
  { name: "锌片", dosage: "1粒/次", targetCount: 1, schedule: "workout", emoji: "🔋" },
  { name: "肌酸", dosage: "5g/次", targetCount: 1, schedule: "workout", emoji: "💪" },
];

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
  // 头像 & 个人主页
  "avatarButton","avatarImg","profileDialog","profileAvatar","profileEmail",
  "editAvatarButton","profileGoalButton","profileGoalVal",
  "profileHistoryButton","profileLogoutButton",
  "avatarDialog","avatarPreview","avatarColors","avatarUrlInput","avatarSaveButton",
  // 药物
  "medicineGrid","medicineTakenCount","medicineTotalCount","medicinePercent",
  "medicineRecordCount","medicineHistoryList","medicineHint",
  "customMedicineButton","customMedicineDialog","customMedicineForm",
  "customMedicineName","customMedicineDosage","customMedicineTarget","customMedicineSchedule",
  "medicineWorkoutToggle",
  // 补剂
  "supplementGrid","supplementTakenCount","supplementTotalCount","supplementPercent",
  "supplementRecordCount","supplementHistoryList","supplementHint",
  "customSupplementButton","customSupplementDialog","customSupplementForm",
  "customSupplementName","customSupplementDosage","customSupplementTarget","customSupplementSchedule",
  "supplementWorkoutToggle","deleteSupplementBtn","deleteMedicineBtn",
  // 厕所
  "toiletRecordCount","toiletHistoryList",
].forEach(id => { E[id] = $("#"+id); });

// ========== 事件绑定 ==========
document.querySelectorAll(".source-card").forEach(btn => {
  btn.addEventListener("click", () => addRecord(btn.dataset.source, Number(btn.dataset.amount)));
});
document.querySelectorAll("[data-goal]").forEach(btn => {
  btn.addEventListener("click", () => { E.goalInput.value = btn.dataset.goal; });
});
E.loginTab.addEventListener("click", () => setAuthMode("login"));
E.registerTab.addEventListener("click", () => setAuthMode("register"));
E.authForm.addEventListener("submit", handleAuthSubmit);

// 个人主页
E.avatarButton.addEventListener("click", openProfile);
E.profileGoalButton.addEventListener("click", () => { E.profileDialog.close(); E.goalInput.value = dailyGoal; E.goalDialog.showModal(); setTimeout(() => E.goalInput.select(), 50); });
E.profileHistoryButton.addEventListener("click", () => { E.profileDialog.close(); loadHistory(); E.historyDialog.showModal(); });
E.profileLogoutButton.addEventListener("click", () => { E.profileDialog.close(); if (auth) signOut(auth); });
E.editAvatarButton.addEventListener("click", openAvatarEditor);
E.avatarSaveButton.addEventListener("click", saveAvatar);
E.goalButton = E.profileGoalButton; // 保持兼容
E.goalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const goal = Number(E.goalInput.value);
  if (!E.goalForm.reportValidity() || goal < 500 || goal > 10000) return;
  try {
    await setDoc(doc(db, "users", currentUser.uid), { dailyGoal: goal, updatedAt: serverTimestamp() }, { merge: true });
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

// 历史记录弹窗：点击某天查看详情
E.historyContent.addEventListener("click", (event) => {
  const row = event.target.closest(".hist-row");
  if (!row) return;
  const idx = parseInt(row.dataset.dayIndex);
  if (!isNaN(idx) && historyDayData[idx]) {
    renderDayDetail(historyDayData[idx]);
  }
});
// 历史记录返回按钮
E.historyContent.addEventListener("click", (event) => {
  const backBtn = event.target.closest(".history-back-btn");
  if (backBtn) {
    loadHistory();
  }
});

// 对话框点击外部关闭
[E.goalDialog, E.customDialog, E.customSupplementDialog, E.customMedicineDialog, E.historyDialog].forEach(dlg => {
  dlg.addEventListener("click", (event) => {
    const b = dlg.getBoundingClientRect();
    if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) dlg.close();
  });
});

// 标签页
E.waterTab.addEventListener("click", () => switchTab("water"));
E.medicineTab.addEventListener("click", () => switchTab("medicine"));
E.supplementTab.addEventListener("click", () => switchTab("supplement"));

// 健身日开关
E.medicineWorkoutToggle.addEventListener("click", () => toggleWorkoutDay());
E.supplementWorkoutToggle.addEventListener("click", () => toggleWorkoutDay());

// 删除药物/补剂按钮
E.deleteSupplementBtn.addEventListener("click", () => {
  if (currentEditItem && currentEditItem.type === "supplement") {
    deleteCustomItem("supplement", currentEditItem.name);
  }
});
E.deleteMedicineBtn.addEventListener("click", () => {
  if (currentEditItem && currentEditItem.type === "medicine") {
    deleteCustomItem("medicine", currentEditItem.name);
  }
});

// 补剂对话框
E.customSupplementButton.addEventListener("click", () => openAddDialog("supplement"));
E.customSupplementForm.addEventListener("submit", (e) => handleItemFormSubmit(e, "supplement"));
E.supplementGrid.addEventListener("click", (e) => handleGridClick(e, "supplement"));
E.supplementHistoryList.addEventListener("click", (e) => {
  const delBtn = e.target.closest(".delete-record");
  if (delBtn) { deleteItemRecord("supplement", delBtn.dataset.id); return; }
  handleTimeEditClick(e);
});

// 厕所记录
document.querySelectorAll(".toilet-btn").forEach(btn => {
  btn.addEventListener("click", () => addToiletRecord(btn.dataset.type));
});
E.toiletHistoryList.addEventListener("click", (e) => {
  const delBtn = e.target.closest(".delete-record");
  if (delBtn) { deleteToiletRecord(delBtn.dataset.id); return; }
  handleTimeEditClick(e);
});

// 药物对话框
E.customMedicineButton.addEventListener("click", () => openAddDialog("medicine"));
E.customMedicineForm.addEventListener("submit", (e) => handleItemFormSubmit(e, "medicine"));
E.medicineGrid.addEventListener("click", (e) => handleGridClick(e, "medicine"));
E.medicineHistoryList.addEventListener("click", (e) => {
  const delBtn = e.target.closest(".delete-record");
  if (delBtn) { deleteItemRecord("medicine", delBtn.dataset.id); return; }
  handleTimeEditClick(e);
});

// ========== 排程工具 ==========
function isWeekday(dateKey) {
  const d = fromDateKey(dateKey);
  return d.getDay() >= 1 && d.getDay() <= 5; // 周一~周五
}

function isItemActiveToday(type, item) {
  const sch = item.schedule || "everyday";
  if (sch === "everyday") return true;
  if (sch === "weekday") return isWeekday(selectedDate);
  if (sch === "workout") return isWeekday(selectedDate) && isWorkoutDay;
  return true;
}

function getSkipReason(type, item) {
  const sch = item.schedule || "everyday";
  if (sch === "weekday" && !isWeekday(selectedDate)) return "周末休息";
  if (sch === "workout" && !isWeekday(selectedDate)) return "周末休息";
  if (sch === "workout" && !isWorkoutDay) return "非健身日";
  return "";
}

// ========== 健身日 ==========
async function loadWorkoutDay() {
  if (!currentUser) return;
  // 先查缓存
  if (workoutDaysCache.hasOwnProperty(selectedDate)) {
    isWorkoutDay = workoutDaysCache[selectedDate];
    return;
  }
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid, "workoutLogs", selectedDate));
    isWorkoutDay = snap.exists() && snap.data().isWorkout === true;
    workoutDaysCache[selectedDate] = isWorkoutDay;
  } catch (e) {
    isWorkoutDay = false;
  }
}

async function toggleWorkoutDay() {
  if (!currentUser) return;
  const newVal = !isWorkoutDay;
  try {
    if (newVal) {
      await setDoc(doc(db, "users", currentUser.uid, "workoutLogs", selectedDate), { isWorkout: true, updatedAt: serverTimestamp() });
    } else {
      await deleteDoc(doc(db, "users", currentUser.uid, "workoutLogs", selectedDate));
    }
    isWorkoutDay = newVal;
    workoutDaysCache[selectedDate] = newVal;
    updateWorkoutToggleUI();
    // 刷新当前标签页以更新卡片状态
    const activeTab = E.waterPanel.hidden ? (E.medicinePanel.hidden ? "supplement" : "medicine") : "water";
    if (activeTab !== "water") renderItemList(activeTab);
    showToast(newVal ? "已标记为健身日 🏋️" : "已取消健身日", false);
  } catch (e) { showToast(toFriendlyError(e), false); }
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
    const app = initializeApp({
      apiKey: "AIzaSyBkOLTe2i-uBAea4TD_nMYvIQuXkBw2LOE",
      authDomain: "water-e08be.firebaseapp.com",
      projectId: "water-e08be",
      storageBucket: "water-e08be.firebasestorage.app",
      messagingSenderId: "176629809438",
      appId: "1:176629809438:web:475d4b652c6a2b607d090f",
    });
    auth = getAuth(app); db = getFirestore(app);
    onAuthStateChanged(auth, applyUser);
  } catch (e) { showAuthMessage(`初始化失败：${e.message}`); E.authSubmit.disabled = true; }
}

async function applyUser(user) {
  currentUser = user;
  if (!user) {
    records = []; medicineRecords = []; supplementRecords = []; toiletRecords = [];
    userMedicines = []; userSupplements = [];
    E.appShell.hidden = true; E.authShell.hidden = false;
    E.passwordInput.value = "";
    return;
  }
  E.profileEmail.textContent = user.email || "已登录";
  renderAvatar();
  E.authShell.hidden = true; E.appShell.hidden = false;
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
    } else { await signInWithEmailAndPassword(auth, email, pw); }
  } catch (e) { showAuthMessage(toFriendlyError(e)); }
  finally { setAuthBusy(false); }
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  E.loginTab.classList.toggle("active", isLogin);
  E.registerTab.classList.toggle("active", !isLogin);
  E.authEyebrow.textContent = isLogin ? "WELCOME BACK" : "CREATE ACCOUNT";
  E.authTitle.textContent = isLogin ? "登录你的账户" : "创建云端账户";
  E.authSubmit.textContent = isLogin ? "登录" : "注册";
  E.passwordInput.autocomplete = isLogin ? "current-password" : "new-password";
  showAuthMessage("");
}
function setAuthBusy(b) { E.authSubmit.disabled = b; E.authSubmit.textContent = b ? "请稍候..." : authMode === "login" ? "登录" : "注册"; }
function showAuthMessage(m, s = false) { E.authMessage.textContent = m; E.authMessage.classList.toggle("success", s); }

// ========== 加载 ==========
async function loadProfile() {
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    const data = snap.data() || {};
    dailyGoal = Number(data.dailyGoal) || 2000;
    userMedicines = (Array.isArray(data.medicines) ? data.medicines : [...DEFAULT_MEDICINES]).map(s => ({ targetCount: 1, schedule: "everyday", ...s }));
    userSupplements = (Array.isArray(data.supplements) ? data.supplements : [...DEFAULT_SUPPLEMENTS]).map(s => ({ targetCount: 1, schedule: "everyday", ...s }));
    // 头像设置
    avatarType = data.avatarType || "default";
    avatarColor = data.avatarColor || AVATAR_COLORS[0];
    avatarUrl = data.avatarUrl || "";
    renderAvatar();
    render();
    renderItemList("medicine"); renderItemList("supplement");
  } catch (e) { showToast(toFriendlyError(e), false); }
}

async function loadDay() {
  if (!currentUser) return;
  const version = ++requestVersion;
  renderDate();
  E.historyList.innerHTML = '<div class="empty-state">正在读取云端记录...</div>';

  try {
    const [waterSnap, medSnap, suppSnap, toiletSnap] = await Promise.all([
      getDocs(query(collection(db, "users", currentUser.uid, "waterLogs"), where("logDate", "==", selectedDate))),
      getDocs(query(collection(db, "users", currentUser.uid, "medicineLogs"), where("logDate", "==", selectedDate))),
      getDocs(query(collection(db, "users", currentUser.uid, "supplementLogs"), where("logDate", "==", selectedDate))),
      getDocs(query(collection(db, "users", currentUser.uid, "toiletLogs"), where("logDate", "==", selectedDate))),
      loadWorkoutDay(),
    ]);
    if (version !== requestVersion) return;

    const toRec = (item) => ({
      id: item.id, ...item.data(),
      recordedAt: item.data().recordedAt?.toDate?.() ?? new Date(),
      count: item.data().count ?? (item.data().taken === true ? 1 : 0),
    });
    records = waterSnap.docs.map(toRec).sort((a, b) => a.recordedAt - b.recordedAt);
    medicineRecords = medSnap.docs.map(toRec).sort((a, b) => a.recordedAt - b.recordedAt);
    supplementRecords = suppSnap.docs.map(toRec).sort((a, b) => a.recordedAt - b.recordedAt);
    toiletRecords = toiletSnap.docs.map(toRec).sort((a, b) => a.recordedAt - b.recordedAt);
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
function getInitial() {
  const email = currentUser?.email || "U";
  return email.charAt(0).toUpperCase();
}

function genAvatarSVG(color, size) {
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="50" fill="${color}"/>
    <circle cx="50" cy="28" r="14" fill="white" opacity="0.95"/>
    <path d="M50 44 C26 44 18 82 17 98 L83 98 C82 82 74 44 50 44Z" fill="white" opacity="0.95"/>
  </svg>`;
}

function renderAvatar() {
  const svg = genAvatarSVG(avatarColor, 42);
  if (avatarType === "custom" && avatarUrl) {
    E.avatarImg.innerHTML = `<img src="${esc(avatarUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    E.avatarImg.innerHTML = svg;
  }
  // 同步更新个人主页的大头像
  if (avatarType === "custom" && avatarUrl) {
    E.profileAvatar.innerHTML = `<img src="${esc(avatarUrl)}" alt="">`;
  } else {
    E.profileAvatar.innerHTML = svg;
  }
  E.profileGoalVal.textContent = `${dailyGoal} ml`;
}

function openProfile() {
  E.profileEmail.textContent = currentUser?.email || "已登录";
  E.profileGoalVal.textContent = `${dailyGoal} ml`;
  renderAvatar();
  E.profileDialog.showModal();
}

function openAvatarEditor() {
  // 渲染颜色选项
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
  if (url) {
    avatarType = "custom";
    avatarUrl = url;
  } else {
    avatarType = "default";
    avatarUrl = "";
  }
  if (currentUser) {
    try {
      await setDoc(doc(db, "users", currentUser.uid), {
        avatarType, avatarColor, avatarUrl,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (e) { /* 静默失败 */ }
  }
  renderAvatar();
  E.avatarDialog.close();
  E.profileDialog.showModal();
}

// 点击对话框外部关闭
[E.profileDialog, E.avatarDialog].forEach(dlg => {
  dlg.addEventListener("click", (event) => {
    const b = dlg.getBoundingClientRect();
    if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) dlg.close();
  });
});

// ========== 饮水 ==========
async function addRecord(source, amount) {
  if (!currentUser) return;
  try {
    const now = new Date();
    const ref = await addDoc(collection(db, "users", currentUser.uid, "waterLogs"), { source, amount, logDate: selectedDate, recordedAt: now });
    records.push({ id: ref.id, source, amount, logDate: selectedDate, recordedAt: now });
    render(); showToast(`已同步 ${amount} ml`, false);
  } catch (e) { showToast(toFriendlyError(e), false); }
}
async function deleteRecord(id) {
  const idx = records.findIndex(r => r.id === id);
  if (idx < 0) return;
  const [rec] = records.splice(idx, 1); render();
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "waterLogs", id));
    lastDeleted = { record: rec, index: idx, type: "water" };
    showToast(`已删除 ${rec.amount} ml 记录`, true);
  } catch (e) { records.splice(idx, 0, rec); render(); showToast(toFriendlyError(e), false); }
}
async function undoDelete() {
  if (!lastDeleted) return;
  const p = lastDeleted; lastDeleted = null; hideToast();
  if (p.type === "water") {
    try {
      const ref = await addDoc(collection(db, "users", currentUser.uid, "waterLogs"), {
        source: p.record.source, amount: p.record.amount, logDate: p.record.logDate, recordedAt: p.record.recordedAt,
      });
      records.splice(p.index, 0, { ...p.record, id: ref.id }); render();
    } catch (e) { showToast(toFriendlyError(e), false); }
  } else if (p.type === "toilet") {
    try {
      const ref = await addDoc(collection(db, "users", currentUser.uid, "toiletLogs"), {
        type: p.record.type, logDate: p.record.logDate, recordedAt: p.record.recordedAt,
      });
      toiletRecords.splice(p.index, 0, { ...p.record, id: ref.id }); renderToiletHistory();
    } catch (e) { showToast(toFriendlyError(e), false); }
  } else {
    const arr = p.type === "medicine" ? medicineRecords : supplementRecords;
    const coll = p.type === "medicine" ? "medicineLogs" : "supplementLogs";
    try {
      const ref = await addDoc(collection(db, "users", currentUser.uid, coll), {
        name: p.record.name, dosage: p.record.dosage, count: p.record.count,
        logDate: p.record.logDate, recordedAt: p.record.recordedAt,
      });
      arr.splice(p.index, 0, { ...p.record, id: ref.id }); renderItemList(p.type);
    } catch (e) { showToast(toFriendlyError(e), false); }
  }
}

// ========== 修改记录时间 ==========
function toTimeValue(d) {
  const dt = new Date(d);
  return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
}
function toTimeDisplay(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

async function updateRecordTime(coll, id, newTime) {
  if (!currentUser) return;
  try {
    await setDoc(doc(db, "users", currentUser.uid, coll, id), { recordedAt: newTime }, { merge: true });
    if (coll === "waterLogs") {
      const idx = records.findIndex(r => r.id === id);
      if (idx >= 0) records[idx].recordedAt = newTime;
      records.sort((a, b) => a.recordedAt - b.recordedAt);
      render();
    } else if (coll === "toiletLogs") {
      const idx = toiletRecords.findIndex(r => r.id === id);
      if (idx >= 0) toiletRecords[idx].recordedAt = newTime;
      toiletRecords.sort((a, b) => a.recordedAt - b.recordedAt);
      renderToiletHistory();
    } else if (coll === "medicineLogs") {
      const idx = medicineRecords.findIndex(r => r.id === id);
      if (idx >= 0) medicineRecords[idx].recordedAt = newTime;
      medicineRecords.sort((a, b) => a.recordedAt - b.recordedAt);
      renderItemList("medicine");
    } else if (coll === "supplementLogs") {
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
  if (!currentUser) return;
  try {
    const now = new Date();
    const ref = await addDoc(collection(db, "users", currentUser.uid, "toiletLogs"), { type, logDate: selectedDate, recordedAt: now });
    toiletRecords.push({ id: ref.id, type, logDate: selectedDate, recordedAt: now });
    renderToiletHistory();
    const label = type === "big" ? "大号" : "小号";
    showToast(`已记录 ${label} 🧻`, false);
  } catch (e) { showToast(toFriendlyError(e), false); }
}
async function deleteToiletRecord(id) {
  const idx = toiletRecords.findIndex(r => r.id === id);
  if (idx < 0) return;
  const [rec] = toiletRecords.splice(idx, 1); renderToiletHistory();
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "toiletLogs", id));
    lastDeleted = { record: rec, index: idx, type: "toilet" };
    const label = rec.type === "big" ? "大号" : "小号";
    showToast(`已删除 ${label} 记录`, true);
  } catch (e) { toiletRecords.splice(idx, 0, rec); renderToiletHistory(); showToast(toFriendlyError(e), false); }
}
function renderToiletHistory() {
  E.toiletRecordCount.textContent = `${toiletRecords.length} 条`;
  if (toiletRecords.length === 0) {
    E.toiletHistoryList.innerHTML = '<div class="empty-state">这一天还没有厕所记录，点击上方按钮记录吧。</div>';
    return;
  }
  E.toiletHistoryList.innerHTML = [...toiletRecords].reverse().map(r => {
    const tv = toTimeValue(r.recordedAt);
    const td = toTimeDisplay(tv);
    const icon = r.type === "big"
      ? `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" style="width:28px;height:28px;display:block"><path d="M894.357 414.095H858.728l-63.123-345.07A84.163 84.163 0 0 0 712.845 0.011H311.666a84.163 84.163 0 0 0-84.164 69.014l-62.561 345.07H129.311a42.082 42.082 0 0 0-42.081 42.082v31.421A426.989 426.989 0 0 0 286.978 847.257V981.918a42.082 42.082 0 0 0 42.081 42.082h364.709a42.082 42.082 0 0 0 42.081-42.082V847.257a426.989 426.989 0 0 0 199.748-359.659v-31.421a42.082 42.082 0 0 0-41.24-42.082zM283.611 79.125A28.054 28.054 0 0 1 311.666 56.12h401.179a28.054 28.054 0 0 1 28.054 23.005l60.879 334.97H221.891z m415.487 725.209a38.715 38.715 0 0 0-18.516 33.104v129.05H336.654v-129.05a38.996 38.996 0 0 0-18.797-33.105 371.441 371.441 0 0 1-168.327-220.228H867.144a371.722 371.722 0 0 1-168.046 220.228z m181.232-316.735a380.699 380.699 0 0 1-2.525 40.398H145.864A318.699 318.699 0 0 1 143.339 487.598v-17.394h736.991z" fill="#040000"/></svg>`
      : `<svg viewBox="-245 0 1314 1314" xmlns="http://www.w3.org/2000/svg" style="width:28px;height:28px;display:block"><g fill="none" stroke="#040000" stroke-linecap="round" stroke-linejoin="round" stroke-width="14"><circle cx="412" cy="85" r="58"/><circle cx="412" cy="85" r="26"/><path d="M412 143L412 225"/><rect x="377" y="225" width="70" height="36" rx="2"/><path d="M262 260H562C672 260 735 332 738 448L738 768C738 1080 599 1260 412 1260C225 1260 86 1080 86 768L86 448C89 332 152 260 262 260Z"/><path d="M282 405C305 355 519 355 542 405C566 458 565 740 540 890C514 1045 469 1148 412 1148C355 1148 310 1045 284 890C259 740 258 458 282 405Z"/><circle cx="412" cy="503" r="22"/><ellipse cx="412" cy="1037" rx="76" ry="23"/></g></svg>`;
    const label = r.type === "big" ? "大号" : "小号";
    return `<article class="history-item toilet-history-item">
      <span class="history-dot toilet-dot">${icon}</span>
      <div class="history-info"><strong>${label}</strong><span class="time-editable" data-id="${r.id}" data-coll="toiletLogs" data-time="${tv}" title="点击修改时间">${td}</span></div>
      <button class="delete-record" type="button" data-id="${r.id}" aria-label="删除">×</button>
    </article>`;
  }).join("");
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

// ---- 计数操作 ----
async function incrementItem(type, name) {
  if (!currentUser) return;
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
      await setDoc(doc(db, "users", currentUser.uid, cfg.coll, rec.id), { count: newCount, recordedAt: now }, { merge: true });
      cfg.recs[idx] = { ...rec, count: newCount, recordedAt: now };
      renderItemList(type);
      if (newCount === 0) showToast(`${name} 已归零`, false);
      else if (newCount >= target) showToast(`${name} ✓ 已完成 ${newCount}/${target}`, false);
      else showToast(`${name} ${newCount}/${target}`, false);
    } catch (e) { showToast(toFriendlyError(e), false); }
  } else {
    try {
      const ref = await addDoc(collection(db, "users", currentUser.uid, cfg.coll), { name, dosage, count: 1, logDate: selectedDate, recordedAt: now });
      cfg.recs.push({ id: ref.id, name, dosage, count: 1, logDate: selectedDate, recordedAt: now });
      renderItemList(type);
      showToast(`${name} 1/${target}`, false);
    } catch (e) { showToast(toFriendlyError(e), false); }
  }
}

async function decrementItem(type, name) {
  if (!currentUser) return;
  const cfg = getCfg(type);
  const idx = cfg.recs.findIndex(r => r.name === name);
  if (idx < 0) return;
  const rec = cfg.recs[idx];
  const newCount = Math.max(0, (rec.count || 0) - 1);
  try {
    await setDoc(doc(db, "users", currentUser.uid, cfg.coll, rec.id), { count: newCount, recordedAt: new Date() }, { merge: true });
    cfg.recs[idx] = { ...rec, count: newCount, recordedAt: new Date() };
    renderItemList(type);
    const target = (getFullList(type).find(s => s.name === name) || {}).targetCount || 1;
    showToast(`${name} ${newCount}/${target}`, false);
  } catch (e) { showToast(toFriendlyError(e), false); }
}

async function resetItemCount(type, name) {
  if (!currentUser) return;
  const cfg = getCfg(type);
  const idx = cfg.recs.findIndex(r => r.name === name);
  if (idx < 0) return;
  const rec = cfg.recs[idx];
  try {
    await setDoc(doc(db, "users", currentUser.uid, cfg.coll, rec.id), { count: 0, recordedAt: new Date() }, { merge: true });
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

// ---- 对话框 ----
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
  // 隐藏删除按钮
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
  // 显示删除按钮
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
  if (!currentUser) return;
  if (getFullList(type).some(s => s.name === name)) { showToast(`"${name}" 已存在`, false); return; }
  const arr = type === "medicine" ? userMedicines : userSupplements;
  const field = type === "medicine" ? "medicines" : "supplements";
  const newList = [...arr, { name, dosage, targetCount, schedule, emoji: "💊" }];
  try {
    await setDoc(doc(db, "users", currentUser.uid), { [field]: newList, updatedAt: serverTimestamp() }, { merge: true });
    if (type === "medicine") userMedicines = newList; else userSupplements = newList;
    renderItemList(type);
    showToast(`已添加${type === "medicine" ? "药物" : "补剂"} "${name}"`, false);
  } catch (e) { showToast(toFriendlyError(e), false); }
}

async function editItem(type, oldName, newName, newDosage, newTarget, newSchedule) {
  if (!currentUser) return;
  if (oldName !== newName && getFullList(type).some(s => s.name === newName)) { showToast(`"${newName}" 已存在`, false); return; }
  const arr = type === "medicine" ? userMedicines : userSupplements;
  const field = type === "medicine" ? "medicines" : "supplements";
  const defs = type === "medicine" ? DEFAULT_MEDICINES : DEFAULT_SUPPLEMENTS;
  const isDef = defs.some(d => d.name === oldName);
  let newList;
  if (isDef) {
    newList = [...arr.filter(s => s.name !== oldName), { name: newName, dosage: newDosage, targetCount: newTarget, schedule: newSchedule, emoji: "💊" }];
  } else {
    newList = arr.map(s => s.name === oldName ? { ...s, name: newName, dosage: newDosage, targetCount: newTarget, schedule: newSchedule } : s);
  }
  try {
    await setDoc(doc(db, "users", currentUser.uid), { [field]: newList, updatedAt: serverTimestamp() }, { merge: true });
    if (type === "medicine") userMedicines = newList; else userSupplements = newList;
    renderItemList(type);
    showToast(`已更新${type === "medicine" ? "药物" : "补剂"} "${newName}"`, false);
  } catch (e) { showToast(toFriendlyError(e), false); }
}

async function deleteCustomItem(type, name) {
  if (!currentUser) return;
  const arr = type === "medicine" ? userMedicines : userSupplements;
  const field = type === "medicine" ? "medicines" : "supplements";
  const label = type === "medicine" ? "药物" : "补剂";
  const defs = type === "medicine" ? DEFAULT_MEDICINES : DEFAULT_SUPPLEMENTS;

  // 预设项目不可删除，只能移除用户自定义的覆盖
  const isDef = defs.some(d => d.name === name);
  let newList;
  if (isDef) {
    // 预设项目：将其从用户列表中移除（恢复默认）
    newList = arr.filter(s => s.name !== name);
  } else {
    newList = arr.filter(s => s.name !== name);
  }

  // 确认删除
  const dlg = type === "medicine" ? E.customMedicineDialog : E.customSupplementDialog;
  dlg.close();
  currentEditItem = null;

  try {
    await setDoc(doc(db, "users", currentUser.uid), { [field]: newList, updatedAt: serverTimestamp() }, { merge: true });
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
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, cfg.coll, id));
    lastDeleted = { record: rec, index: idx, type };
    showToast(`已删除 ${rec.name} 记录`, true);
  } catch (e) { cfg.recs.splice(idx, 0, rec); renderItemList(type); showToast(toFriendlyError(e), false); }
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

// ========== 药物/补剂渲染 ==========
function renderItemList(type) {
  const isMed = type === "medicine";
  const fullList = getFullList(type);

  // 只统计今天需要服用的项目
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

  // 健身日开关可见性
  const workoutRow = isMed ? document.querySelector("#medicineWorkoutRow") : document.querySelector("#supplementWorkoutRow");
  const hasWorkoutItems = fullList.some(s => (s.schedule || "everyday") === "workout");
  if (workoutRow) workoutRow.style.display = hasWorkoutItems ? "" : "none";

  // 卡片
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
    // 进度点
    let dots = "";
    for (let i = 1; i <= target; i++) dots += `<span class="count-dot ${i <= count ? "filled" : ""}">${i <= count ? "●" : "○"}</span>`;
    // 跳过标签
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

  // 提示
  const hint = isMed ? E.medicineHint : E.supplementHint;
  const weekdayLabel = isWeekday(selectedDate) ? "工作日" : "周末";
  hint.textContent = `点击卡片 +1 · ${weekdayLabel}${isWorkoutDay ? " · 健身日" : ""} · 灰色=今日跳过`;

  // 历史
  const recs = isMed ? medicineRecords : supplementRecords;
  const countEl = isMed ? E.medicineRecordCount : E.supplementRecordCount;
  const listEl = isMed ? E.medicineHistoryList : E.supplementHistoryList;
  const label = isMed ? "药物" : "补剂";
  countEl.textContent = `${recs.length} 条`;
  if (recs.length === 0) {
    listEl.innerHTML = `<div class="empty-state">这一天还没有${label}记录，点击上方卡片开始记录吧。</div>`;
  } else {
    listEl.innerHTML = [...recs].reverse().map(r => {
      const tv = toTimeValue(r.recordedAt);
      const td = toTimeDisplay(tv);
      const coll = isMed ? "medicineLogs" : "supplementLogs";
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
}

function toiletItems(toiletRecs) {
  if (!toiletRecs || toiletRecs.length === 0) return "";
  const big = toiletRecs.filter(r => r.type === "big").length;
  const small = toiletRecs.filter(r => r.type === "small").length;
  const parts = [];
  if (big > 0) parts.push(`<span class="hist-dot" style="background:#fff0ef;padding:4px" title="大号 ×${big}"><svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" style="width:12px;height:12px;display:block"><path d="M894.357 414.095H858.728l-63.123-345.07A84.163 84.163 0 0 0 712.845 0.011H311.666a84.163 84.163 0 0 0-84.164 69.014l-62.561 345.07H129.311a42.082 42.082 0 0 0-42.081 42.082v31.421A426.989 426.989 0 0 0 286.978 847.257V981.918a42.082 42.082 0 0 0 42.081 42.082h364.709a42.082 42.082 0 0 0 42.081-42.082V847.257a426.989 426.989 0 0 0 199.748-359.659v-31.421a42.082 42.082 0 0 0-41.24-42.082zM283.611 79.125A28.054 28.054 0 0 1 311.666 56.12h401.179a28.054 28.054 0 0 1 28.054 23.005l60.879 334.97H221.891z m415.487 725.209a38.715 38.715 0 0 0-18.516 33.104v129.05H336.654v-129.05a38.996 38.996 0 0 0-18.797-33.105 371.441 371.441 0 0 1-168.327-220.228H867.144a371.722 371.722 0 0 1-168.046 220.228z m181.232-316.735a380.699 380.699 0 0 1-2.525 40.398H145.864A318.699 318.699 0 0 1 143.339 487.598v-17.394h736.991z" fill="#040000"/></svg></span>`);
  if (small > 0) parts.push(`<span class="hist-dot" style="background:#e3f0fb;padding:4px" title="小号 ×${small}"><svg viewBox="-245 0 1314 1314" xmlns="http://www.w3.org/2000/svg" style="width:12px;height:12px;display:block"><g fill="none" stroke="#040000" stroke-linecap="round" stroke-linejoin="round" stroke-width="18"><circle cx="412" cy="85" r="58"/><circle cx="412" cy="85" r="26"/><path d="M412 143L412 225"/><rect x="377" y="225" width="70" height="36" rx="2"/><path d="M262 260H562C672 260 735 332 738 448L738 768C738 1080 599 1260 412 1260C225 1260 86 1080 86 768L86 448C89 332 152 260 262 260Z"/><path d="M282 405C305 355 519 355 542 405C566 458 565 740 540 890C514 1045 469 1148 412 1148C355 1148 310 1045 284 890C259 740 258 458 282 405Z"/><circle cx="412" cy="503" r="22"/><ellipse cx="412" cy="1037" rx="76" ry="23"/></g></svg></span>`);
  return parts.join("");
}

// ========== 历史记录弹窗 ==========
async function loadHistory() {
  if (!currentUser) return;
  E.historyContent.innerHTML = '<div class="empty-state">正在加载历史记录...</div>';

  try {
    // 生成近14天日期列表
    const dates = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(toDateKey(d));
    }

    // 并行查询所有天的饮水、药物、补剂、厕所 + 健身日
    const allQueries = dates.flatMap(dk => [
      getDocs(query(collection(db, "users", currentUser.uid, "waterLogs"), where("logDate", "==", dk))),
      getDocs(query(collection(db, "users", currentUser.uid, "medicineLogs"), where("logDate", "==", dk))),
      getDocs(query(collection(db, "users", currentUser.uid, "supplementLogs"), where("logDate", "==", dk))),
      getDocs(query(collection(db, "users", currentUser.uid, "toiletLogs"), where("logDate", "==", dk))),
      getDoc(doc(db, "users", currentUser.uid, "workoutLogs", dk)),
    ]);

    const results = await Promise.all(allQueries);

    // 解析结果
    const dayData = dates.map((dk, i) => {
      const offset = i * 5;
      const waterSnap = results[offset];
      const medSnap = results[offset + 1];
      const suppSnap = results[offset + 2];
      const toiletSnap = results[offset + 3];
      const workoutSnap = results[offset + 4];

      const waterRecs = waterSnap.docs.map(d => d.data());
      const waterTotal = waterSnap.docs.reduce((s, doc) => s + (doc.data().amount || 0), 0);
      const medRecs = medSnap.docs.map(d => ({ ...d.data(), count: d.data().count ?? (d.data().taken ? 1 : 0) }));
      const suppRecs = suppSnap.docs.map(d => ({ ...d.data(), count: d.data().count ?? (d.data().taken ? 1 : 0) }));
      const toiletRecs = toiletSnap.docs.map(d => d.data());
      const isWorkout = workoutSnap.exists() && workoutSnap.data().isWorkout === true;

      return { dateKey: dk, waterTotal, waterRecs, medRecs, suppRecs, toiletRecs, isWorkout };
    });

    // 缓存数据
    historyDayData = dayData;
    historyViewMode = "overview";

    // 渲染
    const now = new Date();
    E.historyContent.innerHTML = dayData.map((day, i) => {
      const d = fromDateKey(day.dateKey);
      const isToday = day.dateKey === toDateKey(now);
      const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
      const isYesterday = day.dateKey === toDateKey(yesterday);
      let dateLabel;
      if (isToday) dateLabel = "今天";
      else if (isYesterday) dateLabel = "昨天";
      else dateLabel = d.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
      const fullDate = d.toLocaleDateString("zh-CN", { weekday: "short", month: "short", day: "numeric" });
      const isWeekday = d.getDay() >= 1 && d.getDay() <= 5;

      // 饮水
      const waterPct = dailyGoal > 0 ? Math.min(Math.round((day.waterTotal / dailyGoal) * 100), 100) : 0;
      const waterBar = `<div class="hist-bar"><div class="hist-fill" style="width:${waterPct}%"></div></div>`;

      // 药物
      const medItems = getFullList("medicine").map(item => {
        const rec = day.medRecs.find(r => r.name === item.name);
        const cnt = rec ? rec.count : 0;
        const tgt = item.targetCount || 1;
        const sch = item.schedule || "everyday";
        const active = sch === "everyday" || (sch === "weekday" && isWeekday) || (sch === "workout" && isWeekday && day.isWorkout);
        if (!active) return `<span class="hist-dot gray" title="${item.name}: 跳过">—</span>`;
        if (cnt >= tgt) return `<span class="hist-dot green" title="${item.name}: ✓ ${cnt}/${tgt}">✓</span>`;
        if (cnt > 0) return `<span class="hist-dot yellow" title="${item.name}: ${cnt}/${tgt}">◐</span>`;
        return `<span class="hist-dot red" title="${item.name}: 未服">✗</span>`;
      }).join("");

      // 补剂
      const suppItems = getFullList("supplement").map(item => {
        const rec = day.suppRecs.find(r => r.name === item.name);
        const cnt = rec ? rec.count : 0;
        const tgt = item.targetCount || 1;
        const sch = item.schedule || "everyday";
        const active = sch === "everyday" || (sch === "weekday" && isWeekday) || (sch === "workout" && isWeekday && day.isWorkout);
        if (!active) return `<span class="hist-dot gray" title="${item.name}: 跳过">—</span>`;
        if (cnt >= tgt) return `<span class="hist-dot green" title="${item.name}: ✓ ${cnt}/${tgt}">✓</span>`;
        if (cnt > 0) return `<span class="hist-dot yellow" title="${item.name}: ${cnt}/${tgt}">◐</span>`;
        return `<span class="hist-dot red" title="${item.name}: 未服">✗</span>`;
      }).join("");

      return `<div class="hist-row" data-day-index="${i}" title="点击查看详情">
        <div class="hist-date">
          <strong>${dateLabel}</strong>
          <span>${fullDate}${day.isWorkout ? " 🏋️" : ""}</span>
        </div>
        <div class="hist-col">
          <span class="hist-label">💧</span>
          <span class="hist-val">${day.waterTotal}ml</span>
          ${waterBar}
          <span class="hist-pct">${waterPct}%</span>
        </div>
        <div class="hist-col"><span class="hist-label">💚</span>${medItems || '<span class="hist-empty">—</span>'}</div>
        <div class="hist-col"><span class="hist-label">💊</span>${suppItems || '<span class="hist-empty">—</span>'}</div>
        <div class="hist-col"><span class="hist-label">🧻</span>${toiletItems(day.toiletRecs) || '<span class="hist-empty">—</span>'}</div>
      </div>`;
    }).join("");

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

  // 饮水详情
  let waterItems = "";
  if (day.waterRecs && day.waterRecs.length > 0) {
    waterItems = [...day.waterRecs].sort((a, b) => {
      const ta = a.recordedAt?.toDate?.() ?? new Date(0);
      const tb = b.recordedAt?.toDate?.() ?? new Date(0);
      return tb - ta;
    }).map(r => {
      const t = r.recordedAt?.toDate?.() ?? new Date();
      const td = t.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
      return `<div class="detail-item">
        <span class="detail-dot">◒</span>
        <span class="detail-name">${esc(r.source || "饮水")}</span>
        <span class="detail-time">${td}</span>
        <strong class="detail-val">+${r.amount} ml</strong>
      </div>`;
    }).join("");
  } else {
    waterItems = '<div class="detail-empty">这一天没有饮水记录</div>';
  }

  // 药物详情
  let medItems = "";
  if (day.medRecs && day.medRecs.length > 0) {
    medItems = [...day.medRecs].sort((a, b) => {
      const ta = a.recordedAt?.toDate?.() ?? new Date(0);
      const tb = b.recordedAt?.toDate?.() ?? new Date(0);
      return tb - ta;
    }).map(r => {
      const t = r.recordedAt?.toDate?.() ?? new Date();
      const td = t.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
      const cnt = r.count || 0;
      const full = getFullList("medicine");
      const item = full.find(s => s.name === r.name);
      const target = item?.targetCount || 1;
      const done = cnt >= target;
      const cls = done ? "taken" : (cnt > 0 ? "partial" : "missed");
      const txt = done ? `✓ ${cnt}/${target}` : (cnt > 0 ? `${cnt}/${target}` : "未服");
      return `<div class="detail-item">
        <span class="detail-dot ${cls}">💊</span>
        <span class="detail-name">${esc(r.name)}</span>
        <span class="detail-dosage">${esc(r.dosage || "")}</span>
        <span class="detail-time">${td}</span>
        <strong class="detail-val detail-status-${cls}">${txt}</strong>
      </div>`;
    }).join("");
  } else {
    medItems = '<div class="detail-empty">这一天没有药物记录</div>';
  }

  // 补剂详情
  let suppItems = "";
  if (day.suppRecs && day.suppRecs.length > 0) {
    suppItems = [...day.suppRecs].sort((a, b) => {
      const ta = a.recordedAt?.toDate?.() ?? new Date(0);
      const tb = b.recordedAt?.toDate?.() ?? new Date(0);
      return tb - ta;
    }).map(r => {
      const t = r.recordedAt?.toDate?.() ?? new Date();
      const td = t.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
      const cnt = r.count || 0;
      const full = getFullList("supplement");
      const item = full.find(s => s.name === r.name);
      const target = item?.targetCount || 1;
      const done = cnt >= target;
      const cls = done ? "taken" : (cnt > 0 ? "partial" : "missed");
      const txt = done ? `✓ ${cnt}/${target}` : (cnt > 0 ? `${cnt}/${target}` : "未服");
      return `<div class="detail-item">
        <span class="detail-dot ${cls}">💊</span>
        <span class="detail-name">${esc(r.name)}</span>
        <span class="detail-dosage">${esc(r.dosage || "")}</span>
        <span class="detail-time">${td}</span>
        <strong class="detail-val detail-status-${cls}">${txt}</strong>
      </div>`;
    }).join("");
  } else {
    suppItems = '<div class="detail-empty">这一天没有补剂记录</div>';
  }

  // 厕所详情
  let toiletItems = "";
  if (day.toiletRecs && day.toiletRecs.length > 0) {
    toiletItems = [...day.toiletRecs].sort((a, b) => {
      const ta = a.recordedAt?.toDate?.() ?? new Date(0);
      const tb = b.recordedAt?.toDate?.() ?? new Date(0);
      return tb - ta;
    }).map(r => {
      const t = r.recordedAt?.toDate?.() ?? new Date();
      const td = t.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
      const icon = r.type === "big"
        ? `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" style="width:16px;height:16px;display:block"><path d="M894.357 414.095H858.728l-63.123-345.07A84.163 84.163 0 0 0 712.845 0.011H311.666a84.163 84.163 0 0 0-84.164 69.014l-62.561 345.07H129.311a42.082 42.082 0 0 0-42.081 42.082v31.421A426.989 426.989 0 0 0 286.978 847.257V981.918a42.082 42.082 0 0 0 42.081 42.082h364.709a42.082 42.082 0 0 0 42.081-42.082V847.257a426.989 426.989 0 0 0 199.748-359.659v-31.421a42.082 42.082 0 0 0-41.24-42.082zM283.611 79.125A28.054 28.054 0 0 1 311.666 56.12h401.179a28.054 28.054 0 0 1 28.054 23.005l60.879 334.97H221.891z m415.487 725.209a38.715 38.715 0 0 0-18.516 33.104v129.05H336.654v-129.05a38.996 38.996 0 0 0-18.797-33.105 371.441 371.441 0 0 1-168.327-220.228H867.144a371.722 371.722 0 0 1-168.046 220.228z m181.232-316.735a380.699 380.699 0 0 1-2.525 40.398H145.864A318.699 318.699 0 0 1 143.339 487.598v-17.394h736.991z" fill="#040000"/></svg>`
        : `<svg viewBox="-245 0 1314 1314" xmlns="http://www.w3.org/2000/svg" style="width:16px;height:16px;display:block"><g fill="none" stroke="#040000" stroke-linecap="round" stroke-linejoin="round" stroke-width="14"><circle cx="412" cy="85" r="58"/><circle cx="412" cy="85" r="26"/><path d="M412 143L412 225"/><rect x="377" y="225" width="70" height="36" rx="2"/><path d="M262 260H562C672 260 735 332 738 448L738 768C738 1080 599 1260 412 1260C225 1260 86 1080 86 768L86 448C89 332 152 260 262 260Z"/><path d="M282 405C305 355 519 355 542 405C566 458 565 740 540 890C514 1045 469 1148 412 1148C355 1148 310 1045 284 890C259 740 258 458 282 405Z"/><circle cx="412" cy="503" r="22"/><ellipse cx="412" cy="1037" rx="76" ry="23"/></g></svg>`;
      const label = r.type === "big" ? "大号" : "小号";
      return `<div class="detail-item">
        <span class="detail-dot">${icon}</span>
        <span class="detail-name">${label}</span>
        <span class="detail-time">${td}</span>
      </div>`;
    }).join("");
  } else {
    toiletItems = '<div class="detail-empty">这一天没有厕所记录</div>';
  }

  E.historyContent.innerHTML = `
    <div class="detail-header">
      <button class="history-back-btn text-button" type="button">← 返回历史列表</button>
      <div>
        <strong class="detail-date-label">${dateLabel}</strong>
        <span class="detail-full-date">${fullDate}${day.isWorkout ? " 🏋️ 健身日" : ""}</span>
      </div>
    </div>
    <div class="detail-section">
      <h3>💧 饮水记录</h3>
      <div class="detail-water-total">当日饮水：<strong>${day.waterTotal} ml</strong></div>
      ${waterItems}
    </div>
    <div class="detail-section">
      <h3>💚 药物记录</h3>
      ${medItems}
    </div>
    <div class="detail-section">
      <h3>💊 补剂记录</h3>
      ${suppItems}
    </div>
    <div class="detail-section">
      <h3>🧻 厕所记录</h3>
      ${toiletItems}
    </div>`;
}

// ========== 工具 ==========
function getProgressMessage(total, goal) {
  if (total === 0) return "喝下第一杯水，开启清爽的一天";
  if (total >= goal) return `今日目标已完成，多喝了 ${total - goal} ml`;
  const rem = goal - total;
  if (rem <= 550) return `就差 ${rem} ml，下一瓶就能完成目标`;
  if (total / goal >= 0.5) return `已经过半，还差 ${rem} ml`;
  return `保持节奏，距离目标还有 ${rem} ml`;
}
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
function toDateKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function fromDateKey(dk) { const [y,m,d] = dk.split("-").map(Number); return new Date(y,m-1,d); }
function esc(v) { const d = document.createElement("div"); d.textContent = v; return d.innerHTML; }
function toFriendlyError(e) {
  const m = { "auth/email-already-in-use": "该邮箱已经注册", "auth/invalid-credential": "邮箱或密码不正确", "auth/invalid-email": "邮箱格式不正确", "auth/network-request-failed": "网络连接失败，请稍后重试", "auth/too-many-requests": "尝试次数过多，请稍后再试", "auth/weak-password": "密码至少需要 6 位", "permission-denied": "数据库权限配置不正确" };
  return m[e?.code] || e?.message || "操作失败，请稍后重试";
}
initialize();
