import { initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword, getAuth, onAuthStateChanged,
  signInWithEmailAndPassword, signOut, sendEmailVerification,
} from "firebase/auth";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  serverTimestamp, setDoc, doc,
} from "firebase/firestore";
import Chart from "chart.js/auto";
import { getFirebaseConfig, AVATAR_COLORS, DEFAULT_MEDICINES, DEFAULT_SUPPLEMENTS, DEFAULT_CUPS, DEFAULT_REMINDER, DEFAULT_SETTINGS } from "./js/config.js";
import { toDateKey, fromDateKey, isWeekday, esc, toFriendlyError, toTimeValue, toTimeDisplay, getProgressMessage, genAvatarSVG, TOILET_SVG, t, setLang, getLang, playWaterSound, vibrate, playCompleteSound } from "./js/utils.js";
import { storage } from "./js/storage.js";
import { loadDaySnapshot } from "./js/day-loader.js";
import { createBodyMeasurementsPage } from "./js/body-measurements-page.js";
import { createNutritionGoalsPage } from "./js/nutrition-goals-page.js";
import { createFoodCatalogPage } from "./js/food-catalog-page.js";
import { createFridgePage } from "./js/fridge-page.js";
import { createAssistantPage } from "./js/assistant-page.js";
import { createHistoryPage } from "./js/history-page.js";
import { historyDetailHTML } from "./js/history-detail.js";
import { prepareAvatar } from "./js/avatar.js";
import { MealTimeDraft, MAX_MEAL_PHOTOS, prepareMealPhoto, isMealPhoto } from "./js/meals.js";
import { mealIcon, mealEntryHTML, mealRecordDate } from "./js/meal-diary.js";
import { EXTRA_NUTRIENTS } from "./js/food-catalog.js";
import { NUTRITION_FIELDS, normalizeMealNutrition, dailyMealNutrition } from "./js/meal-nutrition.js";
import { analyzeMeal } from "./js/meal-nutrition-client.js";
import { createMealEditorKeyboard } from "./js/meal-editor-keyboard.js";
import { createWaterDialog } from "./js/water-dialog.js";
import { createEdgeSwipeBack } from "./js/edge-swipe-back.js";
import { chatGPTPlan } from "./js/chatgpt-plan-client.js";
import { intakeSummary, intakeCard, intakeIcon } from "./js/intake-ui.js";
import { enabledPlans, enabledSupplements, SCHEDULE_LABELS, normalizePlans, planMatchesRecord, planRecordCount } from "./js/supplement-plan.js";
import { generateLocalId } from "./js/utils.js";
import { validWaterAmount } from "./js/water-values.js";
import { createBackupPage } from "./js/backup-page.js";
import { createHistoryRecordEditor } from "./js/history-record-editor.js";
import { dashboardNutritionText } from "./js/dashboard-nutrition.js";
import { initializeNativePlatform, isNativeApp, nativeHaptic, shareDataBackup, syncNativeReminders } from "./js/native.js";
import { initializeAppearance, currentTheme } from "./js/appearance.js";

// ========== 全局状态 ==========
let auth = null, db = null, currentUser = null;
let appliedUserId;
let navigationRevision = 0;
// 启动时从缓存读到的上次登录身份，仅用于首屏渲染；真实登录态返回后即失效
let bootUser = null;
const LAST_USER_KEY = "watertracker:lastUser";
let selectedDate = toDateKey(new Date());
let lastCalendarDay = selectedDate;
let historyDetailDay = null;
let records = [], dailyGoal = 2000, authMode = "login";
let lastRecordAction = null, toastTimer = null, requestVersion = 0;

let medicineRecords = [], supplementRecords = [], toiletRecords = [], mealRecords = [];
let userMedicines = [], userSupplements = [];
let currentEditItem = null, itemPlanReturn = null;
const intakeBusy = new Set();
let isWorkoutDay = false;
let workoutDetail = {};
let workoutDaysCache = {};
let historyDayData = [];
let historyViewMode = "overview";
let syncRetryInProgress = false;
let mealDraft = null, mealSelectionVersion = 0, mealSaving = false;
let mealDayLoading = false, mealActionId = null, mealActionBusy = false;
let recordTimeDraft = null;

let avatarType = "default";
let avatarColor = "#168d84";
let avatarUrl = "";
let avatarDraft = null, avatarSelectionVersion = 0, avatarSaving = false;
// 新增状态
let userCups = [...DEFAULT_CUPS];
let reminderSettings = { ...DEFAULT_REMINDER };
let appSettings = { ...DEFAULT_SETTINGS };
let reminderInterval = null;
let statsChart = null, complianceChart = null;
let fabOpen = false;
let currentEditCupIdx = -1;

// ========== DOM 元素 ==========
const E = {};
function $(sel) { return document.querySelector(sel); }
[
  "authShell","appShell","authForm","loginTab","registerTab","authEyebrow","authTitle",
  "emailInput","passwordInput","authMessage","authSubmit",
  "currentAmount","goalAmount","progressPercent","progressBar","progressMessage",
  "waterFill","waterWave","historyList","recordCount",
  "goalDialog","goalForm","goalInput",
  "recordDateBar","recordDateInput","recordDateLabel","recordPreviousDay","recordNextDay","recordToday","dashboardNutritionRemaining",
  "recordTimeDialog","recordTimeForm","recordTimeInput","recordTimeSaveButton",
  "customButton","customDialog","customForm","customName","customAmount",
  "toast","toastText","undoButton",
  "overviewTab","assistantTab","historyTab","accountTab",
  "dashboardPanel","assistantPanel","timelinePanel","accountPanel","detailBackBar","detailBackButton",
  "waterPanel","toiletPanel","mealPanel","workoutPanel","medicinePanel","supplementPanel",
  "historyDialog","historyContent",
  "profileDialog","profileEmail","profileLogoutButton",
  "avatarDialog","avatarPreview","avatarColors","avatarSaveButton","avatarChooseButton","avatarFileInput","avatarResetButton","avatarMessage",
  "medicinePlanDialog","medicinePlanList","medicinePlanSummary","medicinePlanAdd","accountMedicineButton","accountMedicineValue",
  "supplementPlanDialog","supplementPlanList","supplementPlanSummary","supplementPlanAdd","accountSupplementButton","accountSupplementValue","accountStatsButton",
  "medicineGrid","medicinePercent",
  "medicineHint",
  "customMedicineDialog","customMedicineForm",
  "customMedicineName","customMedicineDosage","customMedicineTarget","customMedicineSchedule",
  "medicineWorkoutToggle",
  "supplementGrid","supplementPercent",
  "supplementHint",
  "customSupplementDialog","customSupplementForm",
  "customSupplementName","customSupplementDosage","customSupplementTarget","customSupplementSchedule",
  "deleteSupplementBtn","deleteMedicineBtn",
  "toiletRecordCount","toiletHistoryList","toiletBigCount","toiletSmallCount",
  "authDialog","authDialogClose","accountSyncDetail","accountSyncState","accountSyncRetry",
  // 新增 DOM
  "cupDialog","cupList","newCupName","newCupAmount","addCupBtn",
  "statsDialog","statsWeekTab","statsMonthTab","waterChart","complianceChart",
  "reminderDialog","reminderEnabled","reminderTimesList","addReminderTimeBtn","saveReminderBtn",
  "settingsDialog","soundEnabled","vibrationEnabled","languageSelect",
  "editCupsBtn","smartWeight","smartActivity","smartResult","smartApplyBtn",
  "fabMain","fabMenu",
  "overviewMedicineCard","overviewSupplementCard","overviewToiletCard",
  "overviewMedicineValue","overviewSupplementValue","overviewToiletValue",
  "overviewMealCard","overviewMealValue","overviewWorkoutCard","overviewWorkoutValue",
  "mealDayList",
  "mealDialog","mealForm","mealNameInput",
  "mealQuickAdd","mealDialogTitle","mealTimeInput","mealTimeHint","mealSaveButton",
  "mealPhotoPreview","mealPhotoCount","mealPhotoButton","mealCameraButton","mealPhotoInput","mealCameraInput","mealPhotoMessage",
  "mealPhotoViewer","mealPhotoLarge","mealEmptyState",
  "mealAnalyzeButton","mealAnalyzeLabel","mealNutritionStatus","mealNutritionResult","mealNutritionAssumption","mealNutritionClear","mealAIConnect",
  "mealKcalInput","mealCarbsInput","mealProteinInput","mealFatInput",
  "mealListCount","mealDayStatus",
  "mealDailyKcal","mealDailyCarbs","mealDailyProtein","mealDailyFat","mealDailyCoverage","mealDailyNote",
  "mealQuickCamera","mealQuickText","mealActionsDialog","mealActionsTitle","mealActionsSummary","mealActionEdit","mealActionRepeat","mealActionDelete","mealDeleteLabel",
  "workoutDateLabel","workoutCurrentStatus","workoutClear",
  "dashboardWaterValue","dashboardWaterSub","dashboardWaterRing",
  "dashboardQuickWater","dashboardCustomWater","dashboardToiletSub",
  "dashboardMedicineSub","dashboardMedicineUnit","dashboardSupplementSub","dashboardSupplementUnit",
  "dashboardMealValue","dashboardWorkoutValue","dashboardMedicineValue","dashboardSupplementValue","dashboardToiletValue",
  "dashboardMealProtein","dashboardMealCarbs","dashboardMealFat","dashboardMealCoverage",
  "accountAvatarButton","accountAvatar","accountLoginButton",
  "accountGoalButton","accountGoalValue","accountReminderButton","accountReminderValue","accountSettingsButton","accountExportButton",
  "accountReminderDetail","accountCupButton","accountCupValue","accountSettingsValue",
].forEach(id => { const el = $("#"+id); if (el) E[id] = el; });

const mealEditorKeyboard = createMealEditorKeyboard(E.mealDialog);
const customWaterDialog = createWaterDialog(E.customDialog, E.customAmount);
const edgeSwipeBack = createEdgeSwipeBack({
  surface: E.appShell,
  isEnabled: () => document.body.dataset.section === "detail" && !E.appShell.hidden,
  createPreview: () => {
    renderDashboard();
    const preview = E.appShell.cloneNode(false);
    const header = E.appShell.querySelector(".topbar").cloneNode(true);
    header.querySelector("h1").textContent = "今日健康";
    header.querySelector(".detail-back-bar").hidden = true;
    header.querySelector(".account-avatar").hidden = true;
    const dashboard = E.dashboardPanel.cloneNode(true);
    dashboard.hidden = false;
    preview.append(header, dashboard);
    [preview, ...preview.querySelectorAll("[id]")].forEach(element => element.removeAttribute("id"));
    return preview;
  },
  onBack: () => switchMain("overview"),
});
const historyPage = createHistoryPage(E.timelinePanel, {
  storage,
  openDay: day => { renderDayDetail(day); E.historyDialog.showModal(); },
});
const bodyMeasurementsPage = createBodyMeasurementsPage({ storage, showToast });
const nutritionGoalsPage = createNutritionGoalsPage({ storage, showToast });
const foodCatalogPage = createFoodCatalogPage({ storage, showToast });
const fridgePage = createFridgePage({ storage, showToast, onAskAssistant: prompt => {
  if (!assistantPage.compose(prompt)) { showToast("请先完成或清空助手中当前的输入，再试一次", false); return false; }
  switchMain("assistant"); return true;
} });
const assistantPage = createAssistantPage(E.assistantPanel, {
  storage,
  getUser: () => currentUser,
  verifyEmail: user => { if (auth) auth.languageCode = getLang() === "zh" ? "zh-CN" : "en"; return sendEmailVerification(user); },
  login: () => { setAuthMode("login"); E.authDialog.showModal(); },
  onPreviewPhoto: photo => openPhotoPreview(photo, "对话图片预览"),
  onRecordsChanged: () => {
    dailyGoal = storage.getCachedProfile().dailyGoal || 2000;
    foodCatalogPage.render();
    fridgePage.render();
    historyPage.reset();
    void loadDay();
  },
});
const backupPage = createBackupPage({ storage, showToast, onRestored: async () => {
  historyPage.reset();
  await loadProfile();
  await loadDay();
  appSettings = await storage.getSettings(); reminderSettings = await storage.getReminder();
  setLang(appSettings.language || "zh"); updatePageLanguage(); startReminderCheck();
  renderAccountPage();
} });
const historyRecordEditor = createHistoryRecordEditor({ storage, showToast,
  onChanged: async () => { E.historyDialog.close(); await loadDay(); await historyPage.load(); },
  onMeal: async (record, date) => {
    E.historyDialog.close(); openDetail("meal", { date });
    openMealDialog("meal", record);
  },
  onWorkout: date => { E.historyDialog.close(); openDetail("workout", { date }); },
});

// ========== 事件绑定 ==========
// Dialog autofocus can inherit a visible focus ring on iOS after touch input.
// Show a close-button focus ring only when the user is navigating by keyboard.
document.documentElement.dataset.focusInput = "pointer";
document.addEventListener("pointerdown", () => { document.documentElement.dataset.focusInput = "pointer"; }, { capture: true, passive: true });
document.addEventListener("keydown", event => {
  if (["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) document.documentElement.dataset.focusInput = "keyboard";
}, true);

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

// 账户只负责登录/退出；健康设置统一放在“我的”。
E.profileLogoutButton.addEventListener("click", () => { E.profileDialog.close(); if (currentUser) { signOut(auth); } else { setAuthMode("login"); E.authDialog.showModal(); } });
E.avatarSaveButton.addEventListener("click", saveAvatar);
E.avatarChooseButton.addEventListener("click", () => E.avatarFileInput.click());
E.avatarFileInput.addEventListener("change", selectAvatarFile);
E.avatarResetButton.addEventListener("click", () => {
  avatarSelectionVersion++;
  avatarDraft.url = "";
  E.avatarMessage.textContent = "已恢复默认头像，保存后生效";
  E.avatarSaveButton.disabled = false;
  updateAvatarPreview();
});
E.avatarDialog.addEventListener("close", () => { avatarSelectionVersion++; });
E.goalButton = E.accountGoalButton;
E.goalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const goal = Number(E.goalInput.value);
  if (!E.goalForm.reportValidity() || goal < 500 || goal > 10000) return;
  try {
    await storage.updateProfile({ dailyGoal: goal });
    dailyGoal = goal; E.goalDialog.close(); render();
    renderAccountPage();
    showToast(`每日目标已设为 ${goal} ml`, false);
  } catch (e) { showToast(toFriendlyError(e), false); }
});
E.customButton.addEventListener("click", () => customWaterDialog.open());
E.customForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!E.customForm.reportValidity()) return;
  addRecord(E.customName.value.trim(), Number(E.customAmount.value));
  E.customDialog.close();
});
E.undoButton.addEventListener("click", undoRecordAction);
E.recordTimeForm.addEventListener("submit", handleRecordTimeSubmit);
E.recordTimeDialog.addEventListener("close", () => { recordTimeDraft = null; });
E.historyList.addEventListener("click", (event) => {
  const delBtn = event.target.closest(".delete-record");
  if (delBtn) { deleteRecord(delBtn.dataset.id); return; }
  handleTimeEditClick(event);
});

E.historyContent.addEventListener("click", (event) => {
  const edit = event.target.closest("[data-history-edit]");
  if (edit && historyDetailDay) { void historyRecordEditor.open(edit.dataset.historyEdit, edit.dataset.recordId, historyDetailDay.dateKey); return; }
  const add = event.target.closest("[data-history-add]");
  if (add && historyDetailDay) { E.historyDialog.close(); openDetail(add.dataset.historyAdd, { date: historyDetailDay.dateKey }); return; }
  // 优先检查返回按钮（避免行点击冲突）
  const backBtn = event.target.closest(".history-back-btn");
  if (backBtn) { E.historyDialog.close(); return; }
  // 检查历史行点击 → 进入日详情
  const row = event.target.closest(".hist-row");
  if (!row) return;
  const idx = parseInt(row.dataset.dayIndex);
  if (!isNaN(idx) && historyDayData[idx]) renderDayDetail(historyDayData[idx]);
});

[E.goalDialog, E.recordTimeDialog, E.customDialog, E.customSupplementDialog, E.customMedicineDialog, E.historyDialog, E.authDialog, E.mealDialog, E.mealPhotoViewer, E.mealActionsDialog, E.supplementPlanDialog, E.medicinePlanDialog].forEach(dlg => {
  if (!dlg) return;
  dlg.addEventListener("click", (event) => {
    const b = dlg.getBoundingClientRect();
    if (event.target === dlg && (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom)) dlg.close();
  });
});

E.overviewTab.addEventListener("click", () => switchMain("overview"));
E.assistantTab.addEventListener("click", () => switchMain("assistant"));
E.historyTab.addEventListener("click", () => switchMain("history"));
E.accountTab.addEventListener("click", () => switchMain("account"));
E.detailBackButton.addEventListener("click", () => switchMain("overview"));
E.recordDateInput.addEventListener("change", () => changeRecordDate(E.recordDateInput.value));
E.recordToday.addEventListener("click", () => changeRecordDate(toDateKey(new Date())));
for (const [button, offset] of [[E.recordPreviousDay, -1], [E.recordNextDay, 1]]) button.addEventListener("click", () => {
  const date = fromDateKey(selectedDate); date.setDate(date.getDate() + offset); changeRecordDate(toDateKey(date));
});
document.querySelectorAll("[data-detail]").forEach(button => {
  button.addEventListener("click", () => openDetail(button.dataset.detail));
});
E.dashboardQuickWater.addEventListener("click", async () => {
  const cup = userCups[0] || DEFAULT_CUPS[0];
  E.dashboardQuickWater.disabled = true;
  try { await addRecord(cup.name, Number(cup.amount)); }
  finally { E.dashboardQuickWater.disabled = false; }
});
E.dashboardCustomWater.addEventListener("click", () => customWaterDialog.open());
document.querySelectorAll("[data-home-toilet]").forEach(button => {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try { await addToiletRecord(button.dataset.homeToilet); }
    finally { button.disabled = false; }
  });
});
if (E.overviewMealCard) E.overviewMealCard.addEventListener("click", () => switchTab("meal"));
if (E.overviewWorkoutCard) E.overviewWorkoutCard.addEventListener("click", () => switchTab("workout"));
if (E.overviewMedicineCard) E.overviewMedicineCard.addEventListener("click", () => switchTab("medicine"));
if (E.overviewSupplementCard) E.overviewSupplementCard.addEventListener("click", () => switchTab("supplement"));
if (E.overviewToiletCard) E.overviewToiletCard.addEventListener("click", () => openDetail("toilet"));

if (E.accountAvatarButton) E.accountAvatarButton.addEventListener("click", openAvatarEditor);
if (E.accountLoginButton) E.accountLoginButton.addEventListener("click", () => currentUser ? openProfile() : (setAuthMode("login"), E.authDialog.showModal()));
if (E.accountGoalButton) E.accountGoalButton.addEventListener("click", () => {
  E.goalInput.value = dailyGoal;
  E.goalDialog.showModal();
  setTimeout(() => E.goalInput.select(), 50);
});
if (E.accountReminderButton) E.accountReminderButton.addEventListener("click", openReminderDialog);
if (E.accountSettingsButton) E.accountSettingsButton.addEventListener("click", openSettingsDialog);
if (E.accountExportButton) E.accountExportButton.addEventListener("click", exportData);
E.accountCupButton.addEventListener("click", openCupEditor);
[E.cupDialog, E.settingsDialog].forEach(dialog => dialog.addEventListener("close", renderAccountPage));
for (const type of ["medicine", "supplement"]) {
  const planDialog = E[`${type}PlanDialog`];
  E[type === "medicine" ? "accountMedicineButton" : "accountSupplementButton"].addEventListener("click", () => {
    renderItemPlan(type);
    planDialog.showModal();
  });
  E[`${type}PlanAdd`].addEventListener("click", () => openAddDialog(type));
  E[`${type}PlanList`].addEventListener("click", event => {
    const edit = event.target.closest("[data-plan-edit]");
    if (edit) openEditDialog(type, edit.dataset.planEdit);
  });
  E[`${type}PlanList`].addEventListener("change", async event => {
    const toggle = event.target.closest("[data-plan-toggle]");
    if (!toggle) return;
    const items = type === "medicine" ? userMedicines : userSupplements;
    const next = items.map(item => item.name === toggle.dataset.planToggle ? { ...item, enabled: toggle.checked } : item);
    if (type === "medicine") userMedicines = next; else userSupplements = next;
    refreshItemPlan(type);
    await storage.saveItems(type, next);
  });
  getDlg(type).dialog.addEventListener("close", () => {
    renderItemPlan(type);
    if (itemPlanReturn === type) {
      itemPlanReturn = null;
      if (!planDialog.open) planDialog.showModal();
    }
  });
}

document.querySelectorAll("[data-intake-nav]").forEach(button => button.addEventListener("click", () => switchTab(button.dataset.intakeNav)));

E.medicineWorkoutToggle.addEventListener("click", () => toggleWorkoutDay());

if (E.mealForm) E.mealForm.addEventListener("submit", handleMealSubmit);
document.querySelectorAll("[data-meal-icon]").forEach(element => { element.innerHTML = mealIcon(element.dataset.mealIcon); });
E.mealQuickAdd?.addEventListener("click", () => openMealDialog());
E.mealQuickCamera?.addEventListener("click", () => openMealDialog("meal", null, { mode: "camera" }));
E.mealQuickText?.addEventListener("click", () => openMealDialog("meal", null, { mode: "text" }));
E.mealAnalyzeButton?.addEventListener("click", handleMealAnalysis);
E.mealNutritionClear?.addEventListener("click", invalidateMealNutrition);
E.mealAIConnect?.addEventListener("click", async () => {
  if (!mealDraft || mealDraft.connecting) return;
  if (!chatGPTPlan) { setAuthMode("login"); E.authDialog.showModal(); return; }
  const draft = mealDraft;
  draft.connecting = true;
  E.mealAIConnect.disabled = true;
  E.mealNutritionStatus.textContent = "正在连接 ChatGPT…";
  renderMealPhotoDraft();
  try { await chatGPTPlan.connect(); if (draft === mealDraft) { E.mealAIConnect.hidden = true; await handleMealAnalysis(); } }
  catch (error) { if (draft === mealDraft) E.mealNutritionStatus.textContent = toFriendlyError(error); }
  finally { draft.connecting = false; E.mealAIConnect.disabled = false; renderMealPhotoDraft(); }
});
[...["Kcal", "Carbs", "Protein", "Fat"].map(name => `meal${name}Input`), ...EXTRA_NUTRIENTS.map(field => `mealExtra${field.key}`)].forEach(id => document.getElementById(id)?.addEventListener("input", () => {
  if (mealDraft?.nutrition) mealDraft.nutrition.source = "manual";
}));
document.addEventListener("visibilitychange", () => { if (!document.hidden) ensureMealsToday(); });
setInterval(ensureMealsToday, 60000);
E.mealDayList?.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button || mealDayLoading) return;
  if (button.hasAttribute("data-meal-actions")) openMealActions(button.dataset.mealActions);
  else if (button.hasAttribute("data-empty-meal")) openMealDialog();
  else if (button.hasAttribute("data-meal-photo")) {
    const record = mealRecords.find(record => record.id === button.dataset.id);
    const photo = record?.photos?.[Number(button.dataset.mealPhoto)];
    openPhotoPreview(photo, "食物照片预览");
  }
});
function openPhotoPreview(photo, label) {
  if (!isMealPhoto(photo)) return;
  E.mealPhotoViewer.setAttribute("aria-label", label);
  E.mealPhotoLarge.alt = label;
  E.mealPhotoLarge.src = photo;
  if (!E.mealPhotoViewer.open) E.mealPhotoViewer.showModal();
  return () => { if (E.mealPhotoViewer.open) E.mealPhotoViewer.close(); };
}
E.mealPhotoViewer.addEventListener("close", () => { if (!E.mealPhotoViewer.open) E.mealPhotoLarge.removeAttribute("src"); });
E.mealActionEdit?.addEventListener("click", () => {
  const record = mealRecords.find(record => record.id === mealActionId);
  if (!record || mealActionBusy) return;
  E.mealActionsDialog.close();
  openMealDialog("meal", record);
});
E.mealActionRepeat?.addEventListener("click", () => {
  const record = mealRecords.find(record => record.id === mealActionId);
  if (!record || mealActionBusy) return;
  E.mealActionsDialog.close();
  openMealDialog("meal", record, { repeat: true });
});
E.mealActionDelete?.addEventListener("click", async () => {
  if (mealActionBusy) return;
  if (E.mealActionDelete.dataset.confirm !== "true") {
    E.mealActionDelete.dataset.confirm = "true";
    E.mealDeleteLabel.textContent = "确认删除这条记录";
    return;
  }
  mealActionBusy = true;
  E.mealActionDelete.disabled = E.mealActionEdit.disabled = E.mealActionRepeat.disabled = true;
  try { await deleteMealRecord(mealActionId); E.mealActionsDialog.close(); }
  finally { mealActionBusy = false; E.mealActionDelete.disabled = E.mealActionEdit.disabled = E.mealActionRepeat.disabled = false; }
});
E.mealPhotoButton?.addEventListener("click", () => E.mealPhotoInput.click());
E.mealCameraButton?.addEventListener("click", () => E.mealCameraInput.click());
[E.mealPhotoInput, E.mealCameraInput].forEach(input => input?.addEventListener("change", handleMealPhotos));
E.mealNameInput?.addEventListener("input", () => {
  if (E.mealNameInput.value.trim()) captureMealTime();
  if (mealDraft?.nutrition || mealDraft?.analyzing) invalidateMealNutrition();
  else renderMealPhotoDraft();
});
E.mealTimeInput?.addEventListener("input", () => {
  if (!mealDraft) return;
  mealDraft.clock.setTime(E.mealTimeInput.value);
  E.mealTimeHint.textContent = "已手动设置吃饭时间。";
});
E.mealPhotoPreview?.addEventListener("click", event => {
  const button = event.target.closest("[data-remove-photo]");
  if (!button || !mealDraft || mealSaving) return;
  mealDraft.photos.splice(Number(button.dataset.removePhoto), 1);
  invalidateMealNutrition();
  renderMealPhotoDraft();
});
E.mealDialog?.addEventListener("close", () => { mealEditorKeyboard.close(); mealSelectionVersion++; mealDraft?.analysisController?.abort(); mealDraft = null; });
document.querySelectorAll("[data-workout-preset]").forEach(button => {
  button.addEventListener("click", () => markWorkoutDay(button.dataset.workoutPreset));
});
E.workoutClear.addEventListener("click", async () => {
  if (E.workoutClear.dataset.confirm !== "true") { E.workoutClear.dataset.confirm = "true"; E.workoutClear.textContent = "再点一次确认清除"; return; }
  const date = selectedDate, generation = storage.sync.generation;
  E.workoutClear.disabled = true;
  try {
    await storage.writeAssistantRecord("workout", date, {}, true, date);
    if (generation !== storage.sync.generation || date !== selectedDate) return;
    workoutDetail = {}; isWorkoutDay = false; workoutDaysCache[date] = false;
    renderWorkout(); renderItemList("medicine"); renderItemList("supplement"); updateDailyOverview();
    showToast("当日训练标记已清除", false);
  } catch (error) { showToast(toFriendlyError(error), false); }
  finally { E.workoutClear.disabled = false; }
});

E.deleteSupplementBtn.addEventListener("click", () => {
  if (currentEditItem?.type === "supplement") deleteCustomItem("supplement", currentEditItem.name);
});
E.deleteMedicineBtn.addEventListener("click", () => {
  if (currentEditItem?.type === "medicine") deleteCustomItem("medicine", currentEditItem.name);
});

E.customSupplementForm.addEventListener("submit", (e) => handleItemFormSubmit(e, "supplement"));
E.supplementGrid.addEventListener("click", (e) => handleGridClick(e, "supplement"));

document.querySelectorAll(".toilet-btn").forEach(btn => {
  btn.addEventListener("click", () => addToiletRecord(btn.dataset.type));
});
E.toiletHistoryList.addEventListener("click", (e) => {
  const delBtn = e.target.closest(".delete-record");
  if (delBtn) { deleteToiletRecord(delBtn.dataset.id); return; }
  handleTimeEditClick(e);
});

E.customMedicineForm.addEventListener("submit", (e) => handleItemFormSubmit(e, "medicine"));
E.medicineGrid.addEventListener("click", (e) => handleGridClick(e, "medicine"));

// 水杯编辑
if (E.addCupBtn) E.addCupBtn.addEventListener("click", addCustomCup);
if (E.editCupsBtn) E.editCupsBtn.addEventListener("click", openCupEditor);
// 统计
E.accountStatsButton.addEventListener("click", openStats);
if (E.statsWeekTab) E.statsWeekTab.addEventListener("click", () => { E.statsWeekTab.classList.add("active"); E.statsMonthTab.classList.remove("active"); renderStatsChart("week"); });
if (E.statsMonthTab) E.statsMonthTab.addEventListener("click", () => { E.statsMonthTab.classList.add("active"); E.statsWeekTab.classList.remove("active"); renderStatsChart("month"); });
// 提醒
if (E.addReminderTimeBtn) E.addReminderTimeBtn.addEventListener("click", () => {
  reminderSettings.times.push("12:00");
  renderReminderTimes();
});
if (E.saveReminderBtn) E.saveReminderBtn.addEventListener("click", saveReminderSettings);
// 设置
if (E.soundEnabled) E.soundEnabled.addEventListener("change", () => { appSettings.soundEnabled = E.soundEnabled.checked; storage.updateSettings({ soundEnabled: appSettings.soundEnabled }); });
if (E.vibrationEnabled) E.vibrationEnabled.addEventListener("change", () => { appSettings.vibrationEnabled = E.vibrationEnabled.checked; storage.updateSettings({ vibrationEnabled: appSettings.vibrationEnabled }); });
if (E.languageSelect) E.languageSelect.addEventListener("change", () => {
  const lang = E.languageSelect.value;
  setLang(lang); appSettings.language = lang;
  storage.updateSettings({ language: lang });
  updatePageLanguage();
});
window.addEventListener("appearance-changed", () => {
  if (document.body.dataset.section === "account") renderAccountPage();
  if (E.statsDialog.open) void renderStatsChart(E.statsMonthTab.classList.contains("active") ? "month" : "week");
});
// 智能推荐
if (E.smartWeight) E.smartWeight.addEventListener("input", updateSmartGoal);
if (E.smartActivity) E.smartActivity.addEventListener("change", updateSmartGoal);
if (E.smartApplyBtn) E.smartApplyBtn.addEventListener("click", () => {
  const weight = parseFloat(E.smartWeight.value) || 65;
  const activity = E.smartActivity.value || "mid";
  const rates = { low: 30, mid: 35, high: 42 };
  const goal = Math.round(weight * (rates[activity] || 35) / 50) * 50;
  E.goalInput.value = goal;
  showToast(`已应用推荐值 ${goal} ml`, false);
});
// FAB
if (E.fabMain) {
  E.fabMain.addEventListener("click", () => {
    fabOpen = !fabOpen;
    E.fabMain.classList.toggle("open", fabOpen);
    E.fabMenu.classList.toggle("open", fabOpen);
  });
  document.querySelectorAll(".fab-item").forEach(item => {
    item.addEventListener("click", () => {
      const action = item.dataset.fab;
      fabOpen = false; E.fabMain.classList.remove("open"); E.fabMenu.classList.remove("open");
      if (action === "water") customWaterDialog.open();
      else if (action === "medicine") { switchTab("medicine"); }
      else if (action === "supplement") { switchTab("supplement"); }
    });
  });
}
// 点击页面其他地方关闭 FAB
document.addEventListener("click", (e) => {
  if (fabOpen && !e.target.closest(".fab-container")) {
    fabOpen = false; E.fabMain.classList.remove("open"); E.fabMenu.classList.remove("open");
  }
});

// 离线检测

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

// ========== 健身日 ==========
async function toggleWorkoutDay() {
  if (isWorkoutDay) await markWorkoutDay("休息日");
  else switchTab("workout");
}

function updateWorkoutToggleUI() {
  [E.medicineWorkoutToggle].forEach(btn => {
    if (!btn) return;
    btn.classList.toggle("active", isWorkoutDay);
    btn.setAttribute("aria-pressed", String(isWorkoutDay));
    const indicator = btn.querySelector(".workout-indicator");
    if (indicator) indicator.textContent = isWorkoutDay ? "✓" : "";
    const label = btn.querySelector(".workout-label");
    if (label) label.textContent = isWorkoutDay ? "今天是健身日" : "今天不是健身日";
  });
}

// ========== 主导航与详情 ==========
const DETAIL_TITLES = {
  water: "饮水记录",
  toilet: "如厕记录",
  meal: "饮食日记",
  workout: "训练日志",
  medicine: "药物计划",
  supplement: "每日补剂",
};

function hideAllContent() {
  E.recordDateBar.hidden = true;
  assistantPage.close();
  [E.dashboardPanel, E.assistantPanel, E.timelinePanel, E.accountPanel, E.waterPanel, E.toiletPanel, E.mealPanel, E.workoutPanel, E.medicinePanel, E.supplementPanel]
    .forEach(panel => { if (panel) panel.hidden = true; });
}

function setPrimaryTab(activeId) {
  [["overview", E.overviewTab], ["assistant", E.assistantTab], ["history", E.historyTab], ["account", E.accountTab]].forEach(([id, button]) => {
    const active = id === activeId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function switchMain(section) {
  edgeSwipeBack.cancel();
  navigationRevision++;
  hideAllContent();
  E.detailBackBar.hidden = true;
  document.body.dataset.section = section;
  const title = document.querySelector(".topbar h1");
  if (section === "assistant") {
    E.assistantPanel.hidden = false;
    title.textContent = "健康助手";
    assistantPage.open();
  } else if (section === "history") {
    E.timelinePanel.hidden = false;
    title.textContent = "历史";
    loadHistoryPage();
  } else if (section === "account") {
    E.accountPanel.hidden = false;
    title.textContent = "我的";
    renderAccountPage();
  } else {
    E.dashboardPanel.hidden = false;
    title.textContent = "今日健康";
    const today = toDateKey(new Date());
    if (selectedDate !== today) {
      selectedDate = today;
      loadDay();
    } else {
      renderDashboard();
    }
    section = "overview";
  }
  setPrimaryTab(section);
  if (E.appShell) E.appShell.scrollTo({ top: 0, behavior: "auto" });
  window.scrollTo({ top: 0, behavior: "auto" });
}

function openDetail(type, options = {}) {
  const resolvedType = type;
  const panel = E[`${resolvedType}Panel`];
  if (!panel) return;
  edgeSwipeBack.cancel();
  navigationRevision++;
  const date = options.date || toDateKey(new Date());
  if (selectedDate !== date) { selectedDate = date; void loadDay(); }
  hideAllContent();
  panel.hidden = false;
  E.recordDateBar.hidden = false;
  renderRecordDate();
  E.detailBackBar.hidden = false;
  document.body.dataset.section = "detail";
  document.querySelector(".topbar h1").textContent = DETAIL_TITLES[resolvedType];
  setPrimaryTab("overview");
  if (resolvedType === "water") render();
  else if (resolvedType === "toilet") renderToiletHistory();
  else if (resolvedType === "meal") renderMeals();
  else if (resolvedType === "workout") renderWorkout();
  else renderItemList(resolvedType);
  if (E.appShell) E.appShell.scrollTo({ top: 0, behavior: "auto" });
  window.scrollTo({ top: 0, behavior: "auto" });
}

function switchTab(tab) { openDetail(tab); }

// ========== 初始化 ==========
async function initialize() {
  try {
    void initializeNativePlatform().catch(() => {});
    void initializeAppearance(storage).catch(() => {});
    // 先用本地缓存渲染首屏（含上次同步的云端数据），登录态返回后 applyUser 会刷新
    await bootFromCache();
    const fbConfig = await getFirebaseConfig();
    const app = initializeApp(fbConfig);
    auth = getAuth(app);
    try {
      // 开启持久化缓存：写入先本地落盘立即返回，后台再同步；读取也有缓存兜底
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
      });
    } catch {
      db = getFirestore(app);
    }
    onAuthStateChanged(auth, applyUser);
  } catch (e) {
    showAuthMessage(`初始化失败：${e.message}`);
    if (E.authSubmit) E.authSubmit.disabled = true;
    await applyUser(null);
  }
}

// 启动时立即用 localStorage 缓存渲染界面，避免等待登录态期间显示空白/默认数据。
// 未走云端路径（storage 尚无用户），所有读取都命中本地缓存。
async function bootFromCache() {
  const navigationAtStart = navigationRevision;
  try { bootUser = JSON.parse(localStorage.getItem(LAST_USER_KEY) || "null"); } catch { bootUser = null; }
  storage.setUser(bootUser?.uid ? bootUser : null, null);
  const profile = await storage.getProfile();
  dailyGoal = profile.dailyGoal || 2000;
  userMedicines = normalizePlans((profile.medicines || [...DEFAULT_MEDICINES]).map(s => ({ targetCount: 1, schedule: "everyday", ...s })), "medicine");
  userSupplements = normalizePlans((profile.supplements || [...DEFAULT_SUPPLEMENTS]).map(s => ({ targetCount: 1, schedule: "everyday", ...s })), "supplement");
  avatarType = profile.avatarType || "default";
  avatarColor = profile.avatarColor || "#168d84";
  avatarUrl = profile.avatarUrl || "";
  userCups = await storage.getCups();
  reminderSettings = await storage.getReminder();
  appSettings = await storage.getSettings();
  setLang(appSettings.language || "zh");
  if (E.languageSelect) E.languageSelect.value = appSettings.language || "zh";
  renderAvatar();
  renderCups();
  void loadDay();
  if (navigationRevision === navigationAtStart) switchMain("overview");
  updatePageLanguage();
}

async function applyUser(user) {
  const userId = user?.uid ?? null;
  const sameAccount = appliedUserId === userId;
  const accountChanged = appliedUserId !== undefined && !sameAccount;
  appliedUserId = userId;
  bootUser = null;
  currentUser = user;
  // Identity callbacks refresh account metadata, never navigate. A repeated
  // callback for the same account must also preserve caches and screen filters.
  if (sameAccount) {
    E.profileEmail.textContent = user?.email || "本地模式（未登录）";
    renderAvatar();
    renderSyncStatus();
    return;
  }
  // Invalidate old day requests before switching the storage account.
  requestVersion++;
  if (accountChanged) {
    backupPage.reset();
    hideToast();
    historyPage.reset();
    historyDayData = [];
    for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  }
  records = []; medicineRecords = []; supplementRecords = []; toiletRecords = []; mealRecords = [];
  userMedicines = []; userSupplements = [];
  isWorkoutDay = false; workoutDetail = {}; workoutDaysCache = {};
  assistantPage.resetUser();
  if (!user) {
    // 未登录 → 本地模式，应用仍然可用
    storage.setUser(null, null);
    localStorage.removeItem(LAST_USER_KEY);
    const generation = storage.sync.generation;
    records = []; medicineRecords = []; supplementRecords = []; toiletRecords = []; mealRecords = [];
    userMedicines = []; userSupplements = [];
    isWorkoutDay = false; workoutDetail = {}; workoutDaysCache = {};
    // 从 localStorage 加载 profile
    const profile = await storage.getProfile();
    if (generation !== storage.sync.generation) return;
    dailyGoal = profile.dailyGoal || 2000;
    userMedicines = normalizePlans(profile.medicines || [...DEFAULT_MEDICINES], "medicine");
    userSupplements = normalizePlans(profile.supplements || [...DEFAULT_SUPPLEMENTS], "supplement");
    avatarType = profile.avatarType || "default";
    avatarColor = profile.avatarColor || "#168d84";
    avatarUrl = profile.avatarUrl || "";
    userCups = await storage.getCups();
    reminderSettings = await storage.getReminder();
    appSettings = await storage.getSettings();
    if (generation !== storage.sync.generation) return;
    setLang(appSettings.language || "zh");
    if (E.languageSelect) E.languageSelect.value = appSettings.language || "zh";
    renderAvatar();
    renderCups();
    void loadDay();
    if (!E.timelinePanel.hidden) void loadHistoryPage();
    updatePageLanguage();
    startReminderCheck();
    return;
  }
  // 已登录 → 云端模式
  storage.setUser(user, db);
  const generation = storage.sync.generation;
  E.profileEmail.textContent = user.email || "已登录";
  // 记住登录身份，下次启动时首屏直接显示云端账户
  try {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify({ uid: user.uid, email: user.email || "", displayName: user.displayName || "" }));
  } catch { /* 存储不可用时仅影响首屏展示 */ }

  // 同步状态只在“我的”页面展示，不弹出同步通知。
  if (storage.hasLocalData()) {
    try {
      void storage.mergeLocalToCloud().catch(() => {});
    } catch (e) { /* 存储层保留本地数据并更新同步状态。 */ }
  }

  // 先用本地缓存渲染头像，避免等待云端 profile 期间闪现默认头像；
  // 云端数据返回后 loadProfile 会再次渲染覆盖。
  const cachedProfile = storage.getCachedProfile();
  avatarType = cachedProfile.avatarType || "default";
  avatarColor = cachedProfile.avatarColor || "#168d84";
  avatarUrl = cachedProfile.avatarUrl || "";
  renderAvatar();

  userCups = await storage.getCups();
  reminderSettings = await storage.getReminder();
  appSettings = await storage.getSettings();
  if (generation !== storage.sync.generation) return;
  setLang(appSettings.language || "zh");
  if (E.languageSelect) E.languageSelect.value = appSettings.language || "zh";
  // Uploads and server reads refresh in the background; keep the cached day usable.
  void loadProfile();
  void loadDay();
  if (!E.timelinePanel.hidden) void loadHistoryPage();
  updatePageLanguage();
  startReminderCheck();
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!auth || !E.authForm.reportValidity() || E.authSubmit.disabled) return;
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
  const generation = storage.sync.generation;
  try {
    const profile = await storage.getProfile();
    if (generation !== storage.sync.generation) return;
    dailyGoal = Number(profile.dailyGoal) || 2000;
    userMedicines = normalizePlans((Array.isArray(profile.medicines) ? profile.medicines : [...DEFAULT_MEDICINES]).map(s => ({ targetCount: 1, schedule: "everyday", ...s })), "medicine");
    userSupplements = normalizePlans((Array.isArray(profile.supplements) ? profile.supplements : [...DEFAULT_SUPPLEMENTS]).map(s => ({ targetCount: 1, schedule: "everyday", ...s })), "supplement");
    // Preserve the chosen schedule, including training on weekends.
    avatarType = profile.avatarType || "default";
    avatarColor = profile.avatarColor || AVATAR_COLORS[0];
    avatarUrl = profile.avatarUrl || "";
    userCups = await storage.getCups();
    if (generation !== storage.sync.generation) return;
    renderAvatar();
    renderCups();
    render();
    renderItemList("medicine"); renderItemList("supplement");
  } catch (e) { showToast(toFriendlyError(e), false); }
}

function loadDay() {
  renderRecordDate();
  const version = ++requestVersion;
  const dateKey = selectedDate;
  mealDayLoading = false;
  return loadDaySnapshot(storage, dateKey, partial => {
    if (partial.water) records = partial.water;
    if (partial.medicine) medicineRecords = partial.medicine;
    if (partial.supplement) supplementRecords = partial.supplement;
    if (partial.toilet) toiletRecords = partial.toilet;
    if (partial.meal) mealRecords = partial.meal;
    if (partial.workout) {
      workoutDetail = partial.workout;
      isWorkoutDay = partial.workout.isWorkout === true;
      workoutDaysCache[dateKey] = isWorkoutDay;
    }
    updateWorkoutToggleUI();
    render();
    renderMeals();
    renderWorkout();
    renderItemList("medicine"); renderItemList("supplement");
  }, () => version === requestVersion && dateKey === selectedDate);
}

// ========== 头像 & 个人主页 ==========
function renderAvatar() {
  renderAccountPage();
}

function openProfile() {
  E.profileEmail.textContent = currentUser?.email || "本地模式（未登录）";
  // 账户弹窗仅保留登录信息与登录/退出操作。
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
  avatarDraft = { color: avatarColor, url: avatarType === "custom" ? avatarUrl : "" };
  avatarSelectionVersion++;
  E.avatarFileInput.value = "";
  E.avatarMessage.textContent = "";
  E.avatarSaveButton.disabled = false;
  E.avatarColors.innerHTML = AVATAR_COLORS.map(c =>
    `<button type="button" class="avatar-color-dot${c === avatarDraft.color ? " selected" : ""}" data-color="${c}" style="background:${c}" aria-label="头像颜色 ${c}" aria-pressed="${c === avatarDraft.color}"></button>`
  ).join("");
  E.avatarColors.querySelectorAll(".avatar-color-dot").forEach(dot => {
    dot.addEventListener("click", () => {
      E.avatarColors.querySelectorAll(".avatar-color-dot").forEach(d => { d.classList.remove("selected"); d.setAttribute("aria-pressed", "false"); });
      dot.classList.add("selected");
      dot.setAttribute("aria-pressed", "true");
      avatarSelectionVersion++;
      avatarDraft.color = dot.dataset.color;
      avatarDraft.url = "";
      E.avatarSaveButton.disabled = false;
      E.avatarMessage.textContent = "已选用默认头像，保存后生效";
      updateAvatarPreview();
    });
  });
  updateAvatarPreview();
  E.profileDialog.close();
  E.avatarDialog.showModal();
}

function updateAvatarPreview() {
  E.avatarPreview.innerHTML = avatarDraft.url
    ? `<img src="${esc(avatarDraft.url)}" alt="头像预览">`
    : genAvatarSVG(avatarDraft.color, 88);
}

async function selectAvatarFile() {
  const file = E.avatarFileInput.files?.[0];
  E.avatarFileInput.value = "";
  if (!file) return; // Cancelling the system picker leaves the draft untouched.
  const version = ++avatarSelectionVersion;
  E.avatarSaveButton.disabled = true;
  E.avatarMessage.textContent = "正在处理照片…";
  try {
    const url = await prepareAvatar(file);
    if (version !== avatarSelectionVersion || !E.avatarDialog.open) return;
    avatarDraft.url = url;
    updateAvatarPreview();
    E.avatarMessage.textContent = "照片已就绪，保存后生效";
  } catch (error) {
    if (version === avatarSelectionVersion) E.avatarMessage.textContent = error.message;
  } finally {
    if (version === avatarSelectionVersion) E.avatarSaveButton.disabled = false;
  }
}

function saveAvatar() {
  if (avatarSaving || E.avatarSaveButton.disabled) return;
  avatarSaving = true;
  avatarColor = avatarDraft.color;
  avatarUrl = avatarDraft.url;
  avatarType = avatarUrl ? "custom" : "default";
  // updateProfile saves locally before starting the cloud request.
  void storage.updateProfile({ avatarType, avatarColor, avatarUrl });
  renderAccountPage();
  E.avatarDialog.close();
  avatarSaving = false;
}

[E.profileDialog, E.avatarDialog].forEach(dlg => {
  dlg.addEventListener("click", (event) => {
    const b = dlg.getBoundingClientRect();
    if (event.target === dlg && (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom)) dlg.close();
  });
});

// ========== 饮水 ==========
async function addRecord(source, amount) {
  if (!validWaterAmount(amount)) { showToast("饮水容量须为 10～5000 ml 的整数", false); return; }
  const generation = storage.sync.generation;
  const logDate = selectedDate;
  try {
    const now = recordTimeForDate(logDate);
    const rec = await storage.addWaterLog({ source, amount, logDate, recordedAt: now });
    if (generation !== storage.sync.generation) return;
    if (logDate === selectedDate) records.push(rec);
    // 音效与震动反馈
    if (appSettings.soundEnabled) playWaterSound();
    // 检查是否完成目标
    const total = records.reduce((s, r) => s + Number(r.amount), 0);
    if (appSettings.vibrationEnabled) {
      nativeHaptic(total >= dailyGoal ? "success" : "light").then(handled => {
        if (!handled) vibrate(30);
      });
    }
    if (total >= dailyGoal && appSettings.soundEnabled) playCompleteSound();
    render();
    lastRecordAction = { action: "add", type: "water", record: rec, generation };
    showToast(`已记录 ${amount} ml`, true);
  } catch (e) { showToast(toFriendlyError(e), false); }
}

async function deleteRecord(id) {
  const idx = records.findIndex(r => r.id === id);
  if (idx < 0) return;
  const [rec] = records.splice(idx, 1); render();
  const action = lastRecordAction = { action: "delete", record: rec, index: idx, type: "water", generation: storage.sync.generation };
  showToast(`已删除 ${rec.amount} ml 记录`, true);
  try {
    await storage.deleteWaterLog(id);
  } catch (e) {
    if (action.generation !== storage.sync.generation || rec.logDate !== selectedDate) return;
    records.splice(idx, 0, rec); render();
    if (lastRecordAction === action) showToast(toFriendlyError(e), false);
  }
}

async function undoRecordAction() {
  const action = lastRecordAction;
  if (!action) return;
  hideToast();
  if (action.generation !== storage.sync.generation) return;
  const { type, record } = action;
  try {
    let restored;
    if (action.action === "add") {
      if (type === "water") await storage.deleteWaterLog(record.id);
      else await storage.deleteLog(type, record.id);
    } else {
      const { id, ...data } = record;
      const payload = { ...data, recordedAt: new Date(record.recordedAt) };
      restored = type === "water" ? await storage.addWaterLog(payload) : await storage.addLog(type, payload);
    }
    if (action.generation !== storage.sync.generation) return;
    if (record.logDate === selectedDate) {
      const rows = type === "water" ? records : type === "toilet" ? toiletRecords : type === "medicine" ? medicineRecords : supplementRecords;
      if (action.action === "add") {
        const index = rows.findIndex(row => row.id === record.id);
        if (index >= 0) rows.splice(index, 1);
      } else rows.splice(Math.min(action.index, rows.length), 0, restored);
      if (type === "water") render();
      else if (type === "toilet") renderToiletHistory();
      else renderItemList(type);
    }
    if (!lastRecordAction) showToast(action.action === "add" ? "已撤销本次记录" : "已恢复记录", false);
  } catch (error) {
    if (action.generation === storage.sync.generation && !lastRecordAction) {
      lastRecordAction = action;
      showToast(`撤销失败：${toFriendlyError(error)}`, true);
    }
  }
}

// ========== 修改记录时间 ==========
async function updateRecordTime(coll, id, newTime) {
  const generation = storage.sync.generation, date = selectedDate;
  const current = () => generation === storage.sync.generation && date === selectedDate;
  try {
    if (coll === "waterLogs") {
      await storage.updateWaterLogTime(id, newTime);
      if (!current()) return false;
      const idx = records.findIndex(r => r.id === id);
      if (idx >= 0) records[idx].recordedAt = newTime;
      records.sort((a, b) => a.recordedAt - b.recordedAt);
      render();
    } else if (coll === "toiletLogs") {
      await storage.updateLogTime("toilet", id, newTime);
      if (!current()) return false;
      const idx = toiletRecords.findIndex(r => r.id === id);
      if (idx >= 0) toiletRecords[idx].recordedAt = newTime;
      toiletRecords.sort((a, b) => a.recordedAt - b.recordedAt);
      renderToiletHistory();
    } else if (coll === "medicineLogs") {
      await storage.updateLogTime("medicine", id, newTime);
      if (!current()) return false;
      const idx = medicineRecords.findIndex(r => r.id === id);
      if (idx >= 0) medicineRecords[idx].recordedAt = newTime;
      medicineRecords.sort((a, b) => a.recordedAt - b.recordedAt);
      renderItemList("medicine");
    } else if (coll === "supplementLogs") {
      await storage.updateLogTime("supplement", id, newTime);
      if (!current()) return false;
      const idx = supplementRecords.findIndex(r => r.id === id);
      if (idx >= 0) supplementRecords[idx].recordedAt = newTime;
      supplementRecords.sort((a, b) => a.recordedAt - b.recordedAt);
      renderItemList("supplement");
    }
    showToast("时间已更新", false);
    return true;
  } catch (e) { showToast(toFriendlyError(e), false); return false; }
}

function handleTimeEditClick(event) {
  const timeEl = event.target.closest(".time-editable");
  if (!timeEl || E.recordTimeDialog.open) return;
  recordTimeDraft = {
    id: timeEl.dataset.id, coll: timeEl.dataset.coll, time: timeEl.dataset.time,
    date: selectedDate, generation: storage.sync.generation, saving: false,
  };
  E.recordTimeInput.value = recordTimeDraft.time;
  E.recordTimeSaveButton.disabled = false;
  E.recordTimeDialog.showModal();
}

async function handleRecordTimeSubmit(event) {
  event.preventDefault();
  const draft = recordTimeDraft;
  if (!draft || draft.saving || !E.recordTimeForm.reportValidity()) return;
  if (draft.generation !== storage.sync.generation) {
    E.recordTimeDialog.close();
    return;
  }
  const time = E.recordTimeInput.value;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return;
  if (time === draft.time) { E.recordTimeDialog.close(); return; }
  const [h, m] = time.split(":").map(Number);
  const date = fromDateKey(draft.date);
  date.setHours(h, m, 0, 0);
  draft.saving = true;
  E.recordTimeSaveButton.disabled = true;
  const saved = await updateRecordTime(draft.coll, draft.id, date);
  if (recordTimeDraft !== draft) return;
  draft.saving = false;
  E.recordTimeSaveButton.disabled = false;
  if (saved) E.recordTimeDialog.close();
}

// ========== 厕所记录 ==========
async function addToiletRecord(type) {
  const generation = storage.sync.generation;
  const logDate = selectedDate;
  try {
    const now = recordTimeForDate(logDate);
    const rec = await storage.addLog("toilet", { type, logDate, recordedAt: now });
    if (generation !== storage.sync.generation) return;
    if (logDate === selectedDate) toiletRecords.push(rec);
    renderToiletHistory();
    const label = type === "big" ? "大号" : "小号";
    lastRecordAction = { action: "add", type: "toilet", record: rec, generation };
    showToast(`已记录 ${label}`, true);
  } catch (e) { showToast(toFriendlyError(e), false); }
}

async function deleteToiletRecord(id) {
  const idx = toiletRecords.findIndex(r => r.id === id);
  if (idx < 0) return;
  const [rec] = toiletRecords.splice(idx, 1); renderToiletHistory();
  const action = lastRecordAction = { action: "delete", record: rec, index: idx, type: "toilet", generation: storage.sync.generation };
  const label = rec.type === "big" ? "大号" : "小号";
  showToast(`已删除 ${label} 记录`, true);
  try {
    await storage.deleteLog("toilet", id);
  } catch (e) {
    if (action.generation !== storage.sync.generation || rec.logDate !== selectedDate) return;
    toiletRecords.splice(idx, 0, rec); renderToiletHistory();
    if (lastRecordAction === action) showToast(toFriendlyError(e), false);
  }
}

// ========== 饮食日记 ==========
function ensureMealsToday() {
  const today = toDateKey(new Date());
  if (today === lastCalendarDay || document.querySelector("dialog[open]")) return;
  if (selectedDate === lastCalendarDay) { selectedDate = today; void loadDay(); }
  lastCalendarDay = today;
}
function renderRecordDate() {
  E.recordDateInput.max = toDateKey(new Date());
  E.recordDateInput.value = selectedDate;
  E.recordDateLabel.textContent = selectedDate === toDateKey(new Date()) ? "今天" : fromDateKey(selectedDate).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" });
  E.recordNextDay.disabled = selectedDate >= toDateKey(new Date());
  E.recordToday.hidden = selectedDate === toDateKey(new Date());
}
function recordTimeForDate(dateKey) {
  const now = new Date(), date = fromDateKey(dateKey);
  date.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  return date;
}
function changeRecordDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || toDateKey(fromDateKey(dateKey)) !== dateKey || dateKey > toDateKey(new Date())) return;
  if (dateKey === selectedDate || intakeBusy.size) return;
  selectedDate = dateKey;
  void loadDay();
}

function openMealActions(id) {
  const record = mealRecords.find(record => record.id === id);
  if (!record || mealActionBusy) return;
  mealActionId = id;
  E.mealActionsTitle.textContent = record.name || "饮食记录";
  const date = mealRecordDate(record);
  E.mealActionsSummary.textContent = `${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  E.mealActionDelete.dataset.confirm = "false";
  E.mealDeleteLabel.textContent = "删除记录";
  E.mealActionsDialog.showModal();
}

function openMealDialog(type = "meal", record = null, options = {}) {
  if (mealSaving || mealDayLoading) return;
  mealSelectionVersion++;
  const editing = Boolean(record && !options.repeat);
  const date = editing ? record.logDate || selectedDate : selectedDate;
  mealDraft = { id: editing ? record.id : null, photos: [...(record?.photos || [])], processing: false,
    nutrition: normalizeMealNutrition(record?.nutrition), nutritionVersion: 0, analyzing: false,
    generation: storage.sync.generation, clock: new MealTimeDraft(date, editing ? toJSDate(record.recordedAt) : null) };
  if (options.repeat) mealDraft.clock.capture();
  // Keep older notes editable after consolidating the two text fields.
  E.mealNameInput.value = [record?.name, record?.note].filter(value => value?.trim()).join("\n");
  E.mealTimeInput.value = mealDraft.clock.time;
  E.mealTimeHint.textContent = editing ? "已保留原吃饭时间，点击即可修改。" : "默认使用添加照片或文字的时间，可手动修改。";
  E.mealDialogTitle.textContent = editing ? "编辑这一餐" : options.repeat ? "再记一餐" : "记录一餐";
  E.mealPhotoMessage.textContent = "最多 3 张，照片和文字都可以单独保存。";
  E.mealPhotoInput.value = E.mealCameraInput.value = "";
  E.mealAIConnect.hidden = true;
  renderMealNutrition();
  renderMealPhotoDraft();
  const body = E.mealDialog.querySelector(".diary-editor-body");
  E.mealDialog.showModal();
  body.scrollTop = 0;
  mealEditorKeyboard.open();
  if (options.mode === "camera") E.mealCameraInput.click();
  else if (options.mode === "text") E.mealNameInput.focus({ preventScroll: true });
}

function captureMealTime(now = new Date()) {
  if (!mealDraft) return;
  mealDraft.clock.capture(now);
  E.mealTimeInput.value = mealDraft.clock.time;
  if (!mealDraft.clock.manual) E.mealTimeHint.textContent = "已使用本次添加照片或文字的时间，可手动修改。";
}

function renderMealPhotoDraft() {
  if (!mealDraft) return;
  E.mealPhotoCount.textContent = `${mealDraft.photos.length} / ${MAX_MEAL_PHOTOS}`;
  E.mealPhotoPreview.innerHTML = mealDraft.photos.map((photo, index) => `<figure><img src="${photo}" alt="食物照片 ${index + 1}" /><button type="button" data-remove-photo="${index}" aria-label="移除第 ${index + 1} 张照片">×</button></figure>`).join("");
  E.mealPhotoPreview.hidden = !mealDraft.photos.length;
  const busy = mealDraft.processing || mealDraft.analyzing || mealDraft.connecting || mealSaving;
  E.mealCameraButton.disabled = E.mealPhotoButton.disabled = busy || mealDraft.photos.length >= MAX_MEAL_PHOTOS;
  E.mealSaveButton.disabled = busy;
  [E.mealNameInput, E.mealTimeInput].forEach(input => { input.disabled = mealSaving; });
  E.mealAnalyzeButton.disabled = busy || !(mealDraft.photos.length || E.mealNameInput.value.trim());
  E.mealAnalyzeLabel.textContent = mealDraft.analyzing ? "正在识别…" : mealDraft.nutrition ? "重新识别热量与营养" : "识别热量与营养";
  for (const id of MEAL_NUTRITION_INPUTS) document.getElementById(id).disabled = busy || !mealDraft.nutrition;
  E.mealNutritionClear.disabled = busy;
  E.mealSaveButton.textContent = mealSaving ? "正在保存…" : mealDraft.processing ? "正在处理图片…" : mealDraft.id ? "保存修改" : "保存饮食记录";
}

async function handleMealPhotos(event) {
  const files = [...(event.target.files || [])];
  event.target.value = "";
  if (!mealDraft || !files.length || mealSaving || mealDraft.processing) return;
  const draft = mealDraft, version = mealSelectionVersion, addedAt = new Date();
  invalidateMealNutrition();
  const remaining = MAX_MEAL_PHOTOS - draft.photos.length;
  draft.processing = true;
  renderMealPhotoDraft();
  E.mealPhotoMessage.textContent = "正在处理图片…";
  const errors = [];
  let added = 0;
  for (const file of files.slice(0, remaining)) {
    try {
      const photo = await prepareMealPhoto(file);
      if (version !== mealSelectionVersion || draft !== mealDraft) return;
      draft.photos.push(photo);
      added++;
      captureMealTime(addedAt);
    } catch (error) { errors.push(error.message); }
  }
  if (version !== mealSelectionVersion || draft !== mealDraft) return;
  draft.processing = false;
  renderMealPhotoDraft();
  E.mealPhotoMessage.textContent = errors.length ? errors.join("；") : files.length > remaining ? "每餐最多 3 张照片，已添加前面的照片。" : `已添加 ${added} 张照片，可继续填写文字或直接保存。`;
}

async function handleMealSubmit(event) {
  event.preventDefault();
  if (!mealDraft || mealSaving || mealDraft.processing || mealDraft.analyzing || mealDraft.connecting || !E.mealForm.reportValidity()) return;
  const draft = mealDraft;
  if (draft.generation !== storage.sync.generation) { E.mealDialog.close(); return; }
  const name = E.mealNameInput.value.trim();
  if (!name && !draft.photos.length) { showToast("请添加食物照片或填写文字记录", false); return; }
  captureMealTime();
  const nutrition = readMealNutrition();
  if (draft.nutrition && !nutrition) { showToast("请填写有效的热量和营养数值", false); return; }
  const meal = { mealType: "meal", name, note: "", nutrition, photos: [...draft.photos],
    logDate: draft.clock.dateKey, recordedAt: draft.clock.recordedAt };
  mealSaving = true;
  renderMealPhotoDraft();
  try {
    const saved = await storage.saveMealRecord(meal, draft.id);
    if (draft.generation !== storage.sync.generation) return;
    if (selectedDate === meal.logDate) {
      const index = mealRecords.findIndex(record => record.id === saved.id);
      if (index < 0) mealRecords.push(saved); else mealRecords[index] = saved;
      renderMeals();
      updateDailyOverview();
    }
    E.mealDialog.close();
    nativeHaptic("light");
    showToast(draft.id ? "饮食记录已修改" : "饮食记录已保存", false);
  } catch (e) { showToast(toFriendlyError(e), false); }
  finally { mealSaving = false; renderMealPhotoDraft(); }
}

async function deleteMealRecord(id) {
  const generation = storage.sync.generation;
  const dateKey = selectedDate;
  const index = mealRecords.findIndex(record => record.id === id);
  if (index < 0) return;
  const [record] = mealRecords.splice(index, 1);
  renderMeals();
  updateDailyOverview();
  try {
    await storage.deleteLog("meal", id);
    if (generation !== storage.sync.generation) return;
    showToast("饮食记录已删除", false);
  } catch (e) {
    if (generation !== storage.sync.generation) return;
    if (selectedDate === dateKey) {
      mealRecords.splice(index, 0, record);
      renderMeals();
      updateDailyOverview();
    }
    showToast(toFriendlyError(e), false);
  }
}

function renderMeals() {
  if (!E.mealDayList) return;
  const rows = mealRecords.filter(record => !record.logDate || record.logDate === selectedDate)
    .sort((a, b) => mealRecordDate(b) - mealRecordDate(a));
  const totals = dailyMealNutrition(rows);
  nutritionGoalsPage.render(totals, mealDayLoading);
  [["mealDailyKcal", "kcal"], ["mealDailyCarbs", "carbsG"], ["mealDailyProtein", "proteinG"], ["mealDailyFat", "fatG"]].forEach(([id, key]) => {
    E[id].textContent = mealDayLoading || totals[key] === null ? "—" : totals[key].toLocaleString("zh-CN", { maximumFractionDigits: 1 });
  });
  document.getElementById("mealDailyMore").hidden = mealDayLoading || !totals.entries;
  document.getElementById("mealDailyExtra").innerHTML = EXTRA_NUTRIENTS.filter(field => !["fiberG", "sodiumMg"].includes(field.key)).map(field => `<div><dt>${field.label}</dt><dd>${totals[field.key] == null ? "—" : totals[field.key]} <small>${field.unit}</small><small> · ${totals.nutrientCoverage[field.key]} / ${totals.entries} 条</small></dd></div>`).join("");
  E.mealDailyCoverage.textContent = mealDayLoading ? "正在读取…" : !totals.entries ? "尚无记录" : `已计入 ${totals.counted} / ${totals.entries} 条`;
  E.mealDailyNote.textContent = mealDayLoading ? "正在读取已保存的营养记录…" : !totals.entries ? "添加饮食并识别营养后，显示当天的摄入合计。"
    : !totals.counted ? "目前记录尚无营养数据；可在编辑记录中 AI 识别。"
    : totals.missing ? `还有 ${totals.missing} 条记录缺少营养数据，当前仅汇总已知数值。` : "按已保存的营养估算合计，可在每餐中调整。";
  E.mealDayStatus.hidden = !mealDayLoading;
  E.mealDayList.hidden = mealDayLoading;
  E.mealEmptyState.hidden = mealDayLoading || rows.length > 0;
  E.mealDayList.setAttribute("aria-busy", String(mealDayLoading));
  [E.mealQuickAdd, E.mealQuickCamera, E.mealQuickText].forEach(button => { button.disabled = mealDayLoading; });
  E.mealListCount.textContent = mealDayLoading ? "正在读取…" : `${rows.length} 条记录`;
  E.mealDayList.innerHTML = rows.map(mealEntryHTML).join("");
}

const MEAL_NUTRITION_INPUTS = ["mealKcalInput", "mealCarbsInput", "mealProteinInput", "mealFatInput", ...EXTRA_NUTRIENTS.map(field => `mealExtra${field.key}`)];
function renderMealNutrition() {
  if (!mealDraft) return;
  const nutrition = mealDraft.nutrition;
  E.mealNutritionResult.hidden = !nutrition;
  MEAL_NUTRITION_INPUTS.forEach((id, index) => {
    const input = document.getElementById(id);
    input.value = nutrition?.[NUTRITION_FIELDS[index].key] ?? "";
    input.required = Boolean(nutrition) && !NUTRITION_FIELDS[index].optional;
    input.disabled = !nutrition;
  });
  document.getElementById("mealExtraNutrition").open = EXTRA_NUTRIENTS.filter(field => !["fiberG", "sodiumMg"].includes(field.key)).some(field => nutrition?.[field.key] != null);
  E.mealNutritionAssumption.textContent = nutrition ? [nutrition.portion, nutrition.note].filter(Boolean).join("；") : "";
  E.mealNutritionStatus.textContent = nutrition ? "已估算这一餐的营养；无法判断的项目留空，可修改后保存。" : "图片或文字均可识别，估算热量、三大营养素、膳食纤维和钠等。";
}
function readMealNutrition() {
  if (!mealDraft?.nutrition) return null;
  const value = { ...mealDraft.nutrition };
  MEAL_NUTRITION_INPUTS.forEach((id, index) => { const input = document.getElementById(id); value[NUTRITION_FIELDS[index].key] = input.value.trim() ? Number(input.value) : null; });
  return normalizeMealNutrition(value);
}
function invalidateMealNutrition() {
  if (!mealDraft) return;
  mealDraft.nutritionVersion++;
  mealDraft.analysisController?.abort();
  mealDraft.analysisController = null;
  mealDraft.analyzing = false;
  mealDraft.nutrition = null;
  renderMealNutrition();
  renderMealPhotoDraft();
}
async function handleMealAnalysis() {
  if (!mealDraft || mealDraft.processing || mealDraft.analyzing || mealSaving) return;
  const draft = mealDraft, version = draft.nutritionVersion, generation = storage.sync.generation;
  const description = E.mealNameInput.value.trim();
  if (!draft.photos.length && !description) return;
  if (E.mealDialog.contains(document.activeElement)) document.activeElement.blur();
  const controller = new AbortController();
  draft.analysisController = controller;
  draft.analyzing = true;
  E.mealAIConnect.hidden = true;
  E.mealNutritionStatus.textContent = "正在识别食物与份量，估算这一餐的营养…";
  renderMealPhotoDraft();
  const timeout = setTimeout(() => controller.abort(), 65000);
  try {
    const result = await analyzeMeal({ photos: [...draft.photos], description, foodReferences: foodCatalogPage.references() }, { user: currentUser, signal: controller.signal });
    if (draft !== mealDraft || version !== draft.nutritionVersion || generation !== storage.sync.generation) return;
    const currentDescription = E.mealNameInput.value.trim();
    if (currentDescription !== description) throw new Error("食物说明已变化，请重新识别");
    draft.nutrition = result.nutrition;
    if (!E.mealNameInput.value.trim() && result.name) E.mealNameInput.value = result.name;
    renderMealNutrition();
  } catch (error) {
    if (draft !== mealDraft || version !== draft.nutritionVersion) return;
    E.mealNutritionStatus.textContent = error.name === "AbortError" ? "识别超时，请检查网络后重试；记录内容已保留。" : toFriendlyError(error);
    if (["PLAN_AUTH_REQUIRED", "MEAL_LOGIN_REQUIRED"].includes(error.code)) {
      E.mealAIConnect.hidden = false;
      E.mealAIConnect.textContent = chatGPTPlan ? "连接 ChatGPT" : "登录 App";
    }
  } finally {
    clearTimeout(timeout);
    if (draft === mealDraft && version === draft.nutritionVersion) {
      draft.analyzing = false;
      draft.analysisController = null;
      renderMealPhotoDraft();
    }
  }
}

// ========== 每日训练标记 ==========
async function markWorkoutDay(activity) {
  if (workoutDetail.activity === activity) return;
  const date = selectedDate, generation = storage.sync.generation;
  try {
    const saved = await storage.saveWorkoutMark(date, activity);
    if (generation !== storage.sync.generation || date !== selectedDate) return;
    workoutDetail = saved;
    isWorkoutDay = workoutDetail.isWorkout;
    workoutDaysCache[selectedDate] = isWorkoutDay;
    updateWorkoutToggleUI();
    renderWorkout();
    renderItemList("medicine");
    renderItemList("supplement");
    updateDailyOverview();
    nativeHaptic("success");
    showToast(`${date === toDateKey(new Date()) ? "今天" : date}已标记为${activity}`, false);
  } catch (e) { showToast(toFriendlyError(e), false); }
}

function renderWorkout() {
  if (!E.workoutPanel) return;
  updateWorkoutToggleUI();
  const rest = workoutDetail.activity === "休息日";
  const marked = isWorkoutDay || rest;
  E.workoutClear.hidden = !marked;
  E.workoutClear.dataset.confirm = "false"; E.workoutClear.textContent = "清除当日标记";
  E.workoutDateLabel.textContent = fromDateKey(selectedDate).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" });
  E.workoutCurrentStatus.textContent = marked ? "已记录" : "未标记";
  E.workoutCurrentStatus.dataset.marked = String(marked);
  E.workoutPanel.querySelectorAll("[data-workout-preset]").forEach(button => {
    const active = marked && workoutDetail.activity === button.dataset.workoutPreset;
    button.setAttribute("aria-pressed", String(active));
  });
}

// ========== 药物/补剂 通用 ==========
function getCfg(type) {
  if (type === "medicine") return { defs: DEFAULT_MEDICINES, userList: userMedicines, recs: medicineRecords, coll: "medicineLogs" };
  return { defs: DEFAULT_SUPPLEMENTS, userList: userSupplements, recs: supplementRecords, coll: "supplementLogs" };
}
function getFullList(type) {
  return enabledPlans(type === "medicine" ? userMedicines : userSupplements);
}
function getCount(type, name) {
  const item = getFullList(type).find(item => item.name === name);
  return item ? planRecordCount(item, getCfg(type).recs) : 0;
}

async function adjustIntake(type, name, delta) {
  if (mealDayLoading) return;
  const dateKey = selectedDate;
  const key = `${type}:${dateKey}:${name}`;
  if (intakeBusy.has(key)) return;
  const item = getFullList(type).find(item => item.name === name);
  if (!item || (delta > 0 && !isItemActiveToday(type, item))) return;
  const cfg = getCfg(type);
  const generation = storage.sync.generation;
  const index = cfg.recs.findIndex(record => planMatchesRecord(item, record) && (delta > 0 || record.count > 0));
  const previous = index < 0 ? null : cfg.recs[index];
  const count = getCount(type, name);
  const target = item.targetCount || 1;
  if ((delta > 0 && count >= target) || (delta < 0 && !count)) return;
  const next = Math.max(0, count + delta);
  const now = recordTimeForDate(dateKey);
  intakeBusy.add(key);
  renderItemList(type);
  try {
    if (previous) {
      const recordCount = Math.max(0, (previous.count || 0) + delta);
      await storage.updateLogCount(type, previous.id, recordCount, now);
      if (generation !== storage.sync.generation) return;
      if (selectedDate === dateKey) cfg.recs[index] = { ...previous, count: recordCount, recordedAt: now };
    } else {
      const payload = { name, planId: item.id, dosage: item.dosage || "1份/次", targetCount: target, count: next, logDate: dateKey, recordedAt: now };
      const record = await storage.addLog(type, payload);
      if (generation !== storage.sync.generation) return;
      if (selectedDate === dateKey) cfg.recs.push({ ...payload, id: record.id });
    }
    if (appSettings.vibrationEnabled) nativeHaptic(next >= target ? "success" : "light");
    showToast(delta < 0 ? `${name} 已减去一次` : `${name} 已记录 ${next}/${target} 次`, false);
  } catch (error) { showToast(toFriendlyError(error), false); }
  finally {
    intakeBusy.delete(key);
    if (selectedDate === dateKey) { renderItemList(type); updateDailyOverview(); }
  }
}

function handleGridClick(event, type) {
  const button = event.target.closest("[data-intake-action]");
  if (!button || button.disabled) return;
  const { intakeAction, name } = button.dataset;
  if (intakeAction === "edit") openEditDialog(type, name);
  else void adjustIntake(type, name, intakeAction === "minus" ? -1 : 1);
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
  itemPlanReturn = E[`${type}PlanDialog`].open ? type : null;
  if (itemPlanReturn) E[`${type}PlanDialog`].close();
  d.dialog.showModal();
  setTimeout(() => d.name.focus(), 50);
}

function openEditDialog(type, name) {
  const full = type === "medicine" ? userMedicines : userSupplements;
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
  itemPlanReturn = E[`${type}PlanDialog`].open ? type : null;
  if (itemPlanReturn) E[`${type}PlanDialog`].close();
  d.dialog.showModal();
  setTimeout(() => d.name.select(), 50);
}

async function handleItemFormSubmit(event, type) {
  event.preventDefault();
  const d = getDlg(type);
  if (!d.dialog.querySelector("form").reportValidity()) return;
  const name = d.name.value.trim();
  if (!name) { showToast("请填写名称", false); d.name.focus(); return; }
  const dosage = d.dosage.value.trim() || "1份/次";
  const targetCount = parseInt(d.target.value) || 1;
  const schedule = d.schedule.value || "everyday";
  const saved = currentEditItem
    ? await editItem(type, currentEditItem.name, name, dosage, targetCount, schedule)
    : await addCustomItem(type, name, dosage, targetCount, schedule);
  if (!saved) return;
  currentEditItem = null; d.dialog.close();
}

async function addCustomItem(type, name, dosage, targetCount, schedule) {
  const arr = type === "medicine" ? userMedicines : userSupplements;
  if (arr.some(s => s.name === name)) { showToast(`"${name}" 已存在`, false); return false; }
  const newList = [...arr, { id: generateLocalId(), legacyNames: [], name, dosage, targetCount, schedule, emoji: "💊" }];
  try {
    if (type === "medicine") userMedicines = newList; else userSupplements = newList;
    refreshItemPlan(type);
    await storage.saveItems(type, newList);
    showToast(`已添加${type === "medicine" ? "药物" : "补剂"} "${name}"`, false);
    return true;
  } catch (e) { showToast(toFriendlyError(e), false); }
}

async function editItem(type, oldName, newName, newDosage, newTarget, newSchedule) {
  const arr = type === "medicine" ? userMedicines : userSupplements;
  if (oldName !== newName && arr.some(s => s.name === newName)) { showToast(`"${newName}" 已存在`, false); return false; }
  const newList = normalizePlans(arr, type).map(s => s.name === oldName ? { ...s, name: newName, dosage: newDosage, targetCount: newTarget, schedule: newSchedule } : s);
  try {
    if (type === "medicine") userMedicines = newList; else userSupplements = newList;
    refreshItemPlan(type);
    await storage.saveItems(type, newList);
    showToast(`已更新${type === "medicine" ? "药物" : "补剂"} "${newName}"`, false);
    return true;
  } catch (e) { showToast(toFriendlyError(e), false); }
}

async function deleteCustomItem(type, name) {
  const arr = type === "medicine" ? userMedicines : userSupplements;
  const label = type === "medicine" ? "药物" : "补剂";
  const newList = arr.filter(s => s.name !== name);
  const dlg = type === "medicine" ? E.customMedicineDialog : E.customSupplementDialog;
  dlg.close();
  currentEditItem = null;
  try {
    if (type === "medicine") userMedicines = newList; else userSupplements = newList;
    refreshItemPlan(type);
    await storage.saveItems(type, newList);
    showToast(`已删除${label}计划 "${name}"，历史记录保留`, false);
  } catch (e) { showToast(toFriendlyError(e), false); }
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
  renderHistory(); renderToiletHistory(); updateDailyOverview();
}

function updateDailyOverview() {
  const progressFor = (type) => {
    const items = getFullList(type).filter(item => isItemActiveToday(type, item));
    const completed = items.filter(item => getCount(type, item.name) >= (item.targetCount || 1)).length;
    return `${completed}/${items.length}`;
  };
  if (E.overviewMedicineValue) E.overviewMedicineValue.textContent = progressFor("medicine");
  if (E.overviewSupplementValue) E.overviewSupplementValue.textContent = progressFor("supplement");
  if (E.overviewToiletValue) E.overviewToiletValue.textContent = `${toiletRecords.length} 次`;
  if (E.overviewMealValue) {
    E.overviewMealValue.textContent = `${mealRecords.length} 条`;
  }
  if (E.overviewWorkoutValue) E.overviewWorkoutValue.textContent = workoutDetail.activity || (isWorkoutDay ? "训练日" : "未标记");
  if (E.dashboardPanel && !E.dashboardPanel.hidden) renderDashboard();
}

function getPlanProgress(type) {
  const items = getFullList(type).filter(item => isItemActiveToday(type, item));
  const completed = items.filter(item => getCount(type, item.name) >= (item.targetCount || 1)).length;
  return { completed, total: items.length };
}

function renderDashboard() {
  if (!E.dashboardPanel) return;
  const waterTotal = records.reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const waterPercent = dailyGoal > 0 ? Math.min(100, Math.round((waterTotal / dailyGoal) * 100)) : 0;
  const medicine = getPlanProgress("medicine");
  const supplement = getPlanProgress("supplement");
  E.dashboardWaterValue.textContent = `${waterTotal} ml`;
  E.dashboardWaterSub.textContent = `目标 ${dailyGoal} ml`;
  E.dashboardWaterRing.textContent = `${waterPercent}%`;
  E.dashboardWaterRing.style.setProperty("--progress", `${waterPercent * 3.6}deg`);
  const quickCup = userCups[0] || DEFAULT_CUPS[0];
  E.dashboardQuickWater.textContent = `＋ ${quickCup.amount} ml`;
  E.dashboardQuickWater.setAttribute("aria-label", `记录${quickCup.name} ${quickCup.amount} ml`);
  const nutrition = dailyMealNutrition(mealRecords, selectedDate);
  [["dashboardMealValue", "kcal"], ["dashboardMealProtein", "proteinG"], ["dashboardMealCarbs", "carbsG"], ["dashboardMealFat", "fatG"]].forEach(([id, key]) => {
    E[id].textContent = mealDayLoading || nutrition[key] === null ? "—" : nutrition[key].toLocaleString("zh-CN", { maximumFractionDigits: 1 });
  });
  E.dashboardMealCoverage.textContent = nutrition.missing && nutrition.counted ? "已知摄入" : "摄入合计";
  E.dashboardNutritionRemaining.textContent = dashboardNutritionText(nutrition, storage.getCachedProfile().nutritionGoal, mealDayLoading);
  E.dashboardWorkoutValue.textContent = workoutDetail.activity || (isWorkoutDay ? "训练日" : "未标记");
  [["Medicine", medicine], ["Supplement", supplement]].forEach(([key, progress]) => {
    const complete = progress.total > 0 && progress.completed >= progress.total;
    E[`dashboard${key}Value`].textContent = progress.total ? `${progress.completed} / ${progress.total}` : "—";
    E[`dashboard${key}Unit`].textContent = progress.total ? "项已完成" : "无计划";
    E[`dashboard${key}Sub`].textContent = !progress.total ? "今日暂无服用计划"
      : complete ? "今日计划已完成" : "";
    E[`dashboard${key}Sub`].hidden = progress.total > 0 && !complete;
    document.querySelector(`.summary-plan[data-detail="${key.toLowerCase()}"]`).dataset.complete = String(complete);
  });
  E.dashboardToiletValue.textContent = `${toiletRecords.length} 次`;
  const smallCount = toiletRecords.filter(record => record.type === "small").length;
  const bigCount = toiletRecords.filter(record => record.type === "big").length;
  E.dashboardToiletSub.textContent = toiletRecords.length ? `小号 ${smallCount} · 大号 ${bigCount}` : "身体状态记录";
}

function renderAccountPage() {
  if (!E.accountAvatar) return;
  bodyMeasurementsPage.render();
  nutritionGoalsPage.render();
  foodCatalogPage.render();
  fridgePage.render();
  E.accountAvatar.innerHTML = avatarType === "custom" && avatarUrl
    ? `<img src="${esc(avatarUrl)}" alt="">`
    : genAvatarSVG(avatarColor, 72);
  E.accountGoalValue.innerHTML = `${Number(dailyGoal).toLocaleString("en-US")} <small>ml</small>`;
  const medicines = enabledPlans(userMedicines);
  E.accountMedicineValue.textContent = medicines.length ? `${medicines.length} 项已启用 · 剂量与服用频率` : "添加与管理服用计划";
  const planned = enabledSupplements(userSupplements);
  E.accountSupplementValue.textContent = planned.length ? `${planned.length} 项已启用 · 剂量与服用频率` : "添加与管理补剂计划";
  const remindersEnabled = !!reminderSettings?.enabled;
  E.accountReminderValue.textContent = remindersEnabled ? "已开启" : "未开启";
  E.accountReminderButton.classList.toggle("is-enabled", remindersEnabled);
  const reminderTimes = [...new Set(reminderSettings?.times || [])].sort();
  E.accountReminderDetail.textContent = remindersEnabled
    ? (reminderTimes.length ? `每天 ${reminderTimes.length} 次 · ${reminderTimes[0]} 起` : "尚未设置提醒时间")
    : "设置每日提醒时间";
  E.accountCupValue.textContent = userCups.length ? `${userCups.length} 个常用杯型` : "添加常用杯型与容量";
  E.accountSettingsValue.textContent = `${currentTheme().name} · 外观、声音与触感`;
  renderSyncStatus();
}

function renderItemPlan(type) {
  const items = type === "medicine" ? userMedicines : userSupplements;
  const label = type === "medicine" ? "药物" : "补剂";
  const active = enabledPlans(items).length;
  E[`${type}PlanSummary`].textContent = `已启用 ${active} / ${items.length} 项 · 修改自动保存`;
  E[`${type}PlanList`].innerHTML = items.length ? items.map(item => `
    <div class="supplement-plan-row${item.enabled === false ? " is-disabled" : ""}">
      <button class="plan-item-edit" type="button" data-plan-edit="${esc(item.name)}" aria-label="编辑 ${esc(item.name)}"><span class="plan-item-symbol" aria-hidden="true">${esc(item.emoji || "💊")}</span><span><strong>${esc(item.name)}</strong><small>${esc(item.dosage || "1份/次")} · ${item.targetCount || 1} 次/日</small><small>${SCHEDULE_LABELS[item.schedule] || "每天"}${item.enabled === false ? " · 已停用" : ""}</small></span><span class="plan-item-arrow" aria-hidden="true">›</span></button>
      <label class="plan-switch"><input type="checkbox" role="switch" aria-label="启用 ${esc(item.name)}" data-plan-toggle="${esc(item.name)}" ${item.enabled !== false ? "checked" : ""}><span aria-hidden="true"></span></label>
    </div>`).join("") : `<p class="plan-empty">还没有${label}计划，点击下方添加。已有服用记录仍保留在历史中。</p>`;
}

function refreshItemPlan(type) {
  renderItemPlan(type);
  renderItemList(type);
  renderAccountPage();
  updateDailyOverview();
}

function renderSyncStatus() {
  if (!E.accountSyncState) return;
  const { state, lastSyncedAt, failures, hasPendingWrites } = storage.syncStatus;
  const failedLabels = [...new Set(failures.map(failure => failure.label))].join("、");
  const hasWriteFailure = hasPendingWrites || failures.some(failure => failure.kind === "write");
  const permissionFailure = failures.some(failure => failure.code.endsWith("permission-denied"));
  const authFailure = failures.some(failure => failure.code.endsWith("unauthenticated"));
  const timedOut = failures.some(failure => failure.code.endsWith("deadline-exceeded"));
  const reason = permissionFailure ? "暂时无法访问云端记录" : authFailure ? "登录已失效，请重新登录" : timedOut ? "云端连接超时，可稍后重试" : "暂时无法连接云端，可稍后重试";
  const labels = {
    local: ["本机保存", "登录后可跨设备同步"],
    ready: ["等待同步", "云端账户已连接"],
    syncing: ["同步中", "正在同步记录，你可以继续使用"],
    pending: ["待同步", "记录已保存在本机，可点击重试继续上传"],
    synced: ["已同步", lastSyncedAt ? `最近同步 ${lastSyncedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "记录已同步"],
    offline: ["离线", "网络恢复后，云端请求将继续处理"],
    error: [hasWriteFailure ? "部分未同步" : "读取未完成", `${failedLabels}：${reason}。本地记录仍保留。`],
  };
  const [label, detail] = labels[state === "local" && bootUser ? "ready" : state];
  E.accountSyncState.textContent = label;
  E.accountSyncState.dataset.state = state;
  E.accountSyncDetail.textContent = detail;
  E.accountSyncRetry.hidden = !failures.length && state !== "pending";
  E.accountSyncRetry.disabled = state === "syncing" || state === "offline" || syncRetryInProgress;
}

async function retryCloudSync() {
  if (syncRetryInProgress || !storage.isCloud || !navigator.onLine) return;
  syncRetryInProgress = true;
  renderSyncStatus();
  try {
    await Promise.allSettled([
      storage.retryFailedRequests(),
      loadProfile(), loadDay(),
    ]);
    if (!E.timelinePanel.hidden) await loadHistoryPage();
  } catch { /* Failures stay visible in 我的; no sync popups. */ }
  finally {
    syncRetryInProgress = false;
    renderSyncStatus();
  }
}
E.accountSyncRetry?.addEventListener("click", retryCloudSync);
window.addEventListener("storage-sync-change", renderSyncStatus);
window.addEventListener("meal-cache-change", () => {
  const date = selectedDate, generation = storage.sync.generation, revision = storage.dayRevisions.get(date), version = requestVersion;
  void storage.getCachedMealLogs(date).then(rows => {
    if (generation !== storage.sync.generation || date !== selectedDate || revision !== storage.dayRevisions.get(date) || version !== requestVersion) return;
    mealRecords = rows; renderMeals(); updateDailyOverview();
  }).catch(() => {});
});
window.addEventListener("online", () => {
  renderSyncStatus();
  if (storage.isCloud) void retryCloudSync();
});
window.addEventListener("offline", renderSyncStatus);

async function loadHistoryPage() {
  return historyPage.load();
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
  E.toiletBigCount.textContent = String(toiletRecords.filter(record => record.type === "big").length);
  E.toiletSmallCount.textContent = String(toiletRecords.filter(record => record.type === "small").length);
  E.toiletRecordCount.textContent = `${toiletRecords.length} 条`;
  updateDailyOverview();
  if (toiletRecords.length === 0) {
    E.toiletHistoryList.innerHTML = '<div class="empty-state"><strong>还没有如厕记录</strong><p>点击上方卡片，记录一次。</p></div>';
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
  const isMed = type === "medicine", label = isMed ? "药物" : "补剂";
  const panel = E[`${type}Panel`];
  const fullList = getFullList(type);
  const items = fullList.map(item => ({ ...item, target: item.targetCount || 1, count: mealDayLoading ? 0 : getCount(type, item.name), active: isItemActiveToday(type, item), reason: getSkipReason(type, item) }));
  const summary = intakeSummary(items);
  E[`${type}Percent`].textContent = `${summary.percent}%`;
  const progress = panel.querySelector(`#${type}Ring`);
  progress.style.setProperty("--intake-progress", `${summary.percent}%`);
  progress.setAttribute("aria-valuenow", String(summary.percent));
  progress.setAttribute("aria-valuetext", mealDayLoading ? "正在读取服用进度" : `${summary.percent}%`);
  progress.setAttribute("aria-busy", String(mealDayLoading));
  const workoutRow = panel.querySelector(`#${type}WorkoutRow`);
  if (workoutRow) workoutRow.hidden = !fullList.some(item => ["workout", "workout_weekday"].includes(item.schedule));
  const workoutToggle = E[`${type}WorkoutToggle`];
  if (workoutToggle) workoutToggle.disabled = mealDayLoading || intakeBusy.size > 0;
  const pending = items.filter(item => item.active && item.count < item.target);
  const done = items.filter(item => item.active && item.count >= item.target);
  const skipped = items.filter(item => !item.active);
  const visible = [...pending, ...done, ...skipped];
  const grid = E[`${type}Grid`];
  grid.setAttribute("aria-busy", String(mealDayLoading));
  grid.innerHTML = mealDayLoading ? '<div class="intake-empty">正在读取服用记录…</div>' : visible.length ? visible.map(item => intakeCard(item, type, intakeBusy.has(`${type}:${selectedDate}:${item.name}`))).join("") : `<div class="intake-empty"><span class="intake-empty-symbol">${intakeIcon(type)}</span><strong>还没有启用的${label}计划</strong><p>可在“我的”中设置服用计划。</p></div>`;
  E[`${type}Hint`].textContent = isMed ? "按你的用药计划服用；每次服用后记录，误记可减去一次。" : "每次服用后记录，误记可减去一次。";
  const overview = isMed ? E.overviewMedicineValue : E.overviewSupplementValue;
  if (overview) overview.textContent = `${summary.done}/${summary.total}`;
}

// ========== 药物/补剂渲染辅助 ==========
/** 将 Firestore Timestamp / Date / ISO 字符串统一转为 Date */
function toJSDate(v) {
  if (!v) return new Date();
  if (v?.toDate) return v.toDate();       // Firestore Timestamp
  if (v instanceof Date) return v;         // 已是 Date
  return new Date(v);                      // ISO 字符串
}

function renderDayDetailItemHTML(type, recs) {
  if (!recs || recs.length === 0) return "";
  const isToilet = type === "toilet";
  const isMed = type === "medicine";
  const isSupp = type === "supplement";
  const fullList = isMed ? getFullList("medicine") : isSupp ? getFullList("supplement") : null;
  return [...recs].sort((a, b) => {
    const ta = toJSDate(a.recordedAt);
    const tb = toJSDate(b.recordedAt);
    return tb - ta;
  }).map(r => {
    const t = toJSDate(r.recordedAt);
    const td = t.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    if (isToilet) {
      const icon = r.type === "big" ? TOILET_SVG.bigSmall : TOILET_SVG.smallSmall;
      const label = r.type === "big" ? "大号" : "小号";
      return `<div class="detail-item"><span class="detail-dot">${icon}</span><span class="detail-name">${label}</span><span class="detail-time">${td}</span></div>`;
    }
    const cnt = r.count || 0;
    const item = getCfg(type).userList.find(s => s.name === r.name);
    const target = r.targetCount || item?.targetCount;
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
async function loadHistory() {
  historyDayData = [];
  E.historyContent.innerHTML = '<div class="empty-state">正在加载全部历史记录...</div>';
  try {
    const dayData = await storage.getAllHistory();
    historyDayData = dayData;
    historyViewMode = "overview";

    const now = new Date();
    const html = dayData.map((day, i) => {
      const d = fromDateKey(day.dateKey);
      const isToday = day.dateKey === toDateKey(now);
      const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
      const isYesterday = day.dateKey === toDateKey(yesterday);
      let dateLabel;
      if (isToday) dateLabel = "今天";
      else if (isYesterday) dateLabel = "昨天";
      else dateLabel = d.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
      const fullDate = d.toLocaleDateString("zh-CN", { year: "numeric", weekday: "short", month: "short", day: "numeric" });
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

      const idx = i;
      return `<div class="hist-row" data-day-index="${idx}" title="点击查看详情">
        <div class="hist-date"><strong>${dateLabel}</strong><span>${fullDate}${day.isWorkout ? " 🏋️" : ""}</span></div>
        <div class="hist-col"><span class="hist-label">💧</span><span class="hist-val">${day.waterTotal}ml</span>${waterBar}<span class="hist-pct">${waterPct}%</span></div>
        <div class="hist-col"><span class="hist-label">💚</span>${medItems || '<span class="hist-empty">—</span>'}</div>
        <div class="hist-col"><span class="hist-label">💊</span>${suppItems || '<span class="hist-empty">—</span>'}</div>
        <div class="hist-col"><span class="hist-label">🧻</span>${toiletItems(day.toiletRecs) || '<span class="hist-empty">—</span>'}</div>
        <div class="hist-col hist-journal"><span class="hist-label">餐</span><span class="hist-val">${day.mealRecs?.length || 0} 份</span></div>
        <div class="hist-col hist-journal"><span class="hist-label">练</span><span class="hist-val">${day.isWorkout ? esc(day.workoutDetail?.activity || "已训练") : "休息"}</span></div>
      </div>`;
    }).join("");

    E.historyContent.innerHTML = dayData.length
      ? html + '<div class="hist-end">已显示全部记录</div>'
      : '<div class="empty-state">还没有历史记录</div>';
  } catch (e) {
    E.historyContent.innerHTML = `<div class="empty-state">加载失败：${toFriendlyError(e)}</div>`;
  }
}

// ========== 日详情视图 ==========
function renderDayDetail(day) {
  if (!day) return;
  historyDetailDay = day;
  historyViewMode = "detail";
  E.historyContent.innerHTML = historyDetailHTML(day);
}

// ========== 返回按钮辅助 ==========
function addBackButton(dialog, targetFn) {
  const heading = dialog.querySelector(".dialog-heading");
  if (!heading) return;
  // 避免重复添加
  if (heading.querySelector(".back-btn")) return;
  const btn = document.createElement("button");
  btn.className = "text-button back-btn";
  btn.type = "button";
  btn.textContent = "← 返回";
  btn.addEventListener("click", () => {
    dialog.close();
    if (targetFn) targetFn();
  });
  heading.insertBefore(btn, heading.firstChild);
  // 给 heading 加点 flex 适配
  heading.style.gap = "10px";
}

// ========== 工具 ==========
function showToast(m, undo) {
  clearTimeout(toastTimer); E.toastText.textContent = m;
  if (!undo) lastRecordAction = null;
  const canUndo = Boolean(undo && lastRecordAction);
  E.undoButton.hidden = !canUndo; E.toast.classList.add("show");
  // Leave a brief opportunity to undo; longer messages get enough reading time.
  const duration = Math.min(5000, Math.max(canUndo ? 3000 : 1800, m.length * 100));
  toastTimer = setTimeout(hideToast, duration);
}

function hideToast() {
  clearTimeout(toastTimer);
  lastRecordAction = null;
  E.undoButton.hidden = true;
  E.toast.classList.remove("show");
}

async function exportData() {
  if (E.accountExportButton?.disabled) return;
  if (E.accountExportButton) E.accountExportButton.disabled = true;
  try {
    const data = await storage.createBackup();
    const json = JSON.stringify(data, null, 2);
    const filename = `健康追踪_数据备份_${toDateKey(new Date())}.json`;
    const shareResult = await shareDataBackup(json, filename);
    if (shareResult === "cancelled") return;
    if (shareResult === "completed") {
      showToast("数据已导出", false);
      E.profileDialog.close();
      return;
    }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast("已发起下载，请确认文件已保存", false);
    E.profileDialog.close();
  } catch (e) {
    showToast(`导出失败：${toFriendlyError(e)}`, false);
  } finally { if (E.accountExportButton) E.accountExportButton.disabled = false; }
}

// ========== i18n（多语言）==========
function updatePageLanguage() {
  const lang = getLang();
  // 更新带 data-i18n 属性的元素
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    const text = t(key, lang);
    if (text) el.textContent = text;
  });
  // 更新特定元素
  if (E.profileReminderStatus && reminderSettings) {
    E.profileReminderStatus.textContent = reminderSettings.enabled ? (lang === "zh" ? "已开启" : "On") : (lang === "zh" ? "已关闭" : "Off");
  }
  if (E.profileLogoutButton) {
    if (currentUser) {
      E.profileLogoutButton.textContent = lang === "zh" ? "🚪 退出登录" : "🚪 Sign Out";
    } else {
      E.profileLogoutButton.textContent = lang === "zh" ? "🔐 登录以同步数据" : "🔐 Sign in to sync";
    }
  }
  // 更新标题
  document.title = t("appTitle", lang);
  // 更新各区域标题
  const tabLabels = {
    water: t("waterTab", lang),
    toilet: lang === "zh" ? "如厕记录" : "Restroom Log",
    meal: lang === "zh" ? "饮食日记" : "Food Diary",
    workout: lang === "zh" ? "训练日志" : "Training Log",
    medicine: t("medicineTab", lang),
    supplement: t("supplementTab", lang),
  };
  const topbarH1 = document.querySelector(".topbar h1");
  const section = document.body.dataset.section;
  if (topbarH1) {
    if (section === "assistant") topbarH1.textContent = lang === "zh" ? "健康助手" : "Health Assistant";
    else if (section === "history") topbarH1.textContent = lang === "zh" ? "历史" : "History";
    else if (section === "account") topbarH1.textContent = lang === "zh" ? "我的" : "Me";
    else if (section === "overview") topbarH1.textContent = lang === "zh" ? "今日健康" : "Today";
    else {
      const activeDetail = ["water", "toilet", "meal", "workout", "medicine", "supplement"].find(id => !E[`${id}Panel`]?.hidden) || "water";
      topbarH1.textContent = tabLabels[activeDetail];
    }
  }
}

// ========== 水杯管理 ==========
function renderCups() {
  const grid = document.querySelector(".source-grid");
  if (!grid) return;
  const cups = userCups.length > 0 ? userCups : DEFAULT_CUPS;
  grid.innerHTML = cups.map((cup, i) => {
    const isDefault = i < 3;
    const iconHtml = i === 0
      ? `<span class="source-icon glass-icon" aria-hidden="true"><span class="glass-water"></span></span>`
      : `<span class="source-icon bottle-icon ${i === 2 ? 'purified' : 'natural'}" aria-hidden="true"><span class="bottle-cap"></span><span class="bottle-label">${i === 1 ? '天然水' : '纯净水'}</span></span>`;
    return `<button class="source-card ${i === 0 ? 'cup-card' : 'bottle-card'} ${i === 2 ? 'purified' : (i === 1 ? 'natural' : '')}" type="button" data-amount="${cup.amount}" data-source="${esc(cup.name)}" data-cup-index="${i}">
      ${iconHtml}
      <span class="source-name">${esc(cup.name)}</span>
      <strong>${cup.amount} ml</strong>
      <span class="add-mark">+</span>
    </button>`;
  }).join("");

  // 重新绑定事件
  grid.querySelectorAll(".source-card").forEach(btn => {
    btn.addEventListener("click", () => addRecord(btn.dataset.source, Number(btn.dataset.amount)));
  });
}

function openCupEditor() {
  E.profileDialog.close();
  E.cupList.innerHTML = userCups.map((cup, i) => `
    <div class="cup-edit-item">
      <span>${esc(cup.name)}</span>
      <span class="cup-amount">${cup.amount} ml</span>
      <button class="cup-delete-btn" data-cup-idx="${i}" type="button" ${userCups.length <= 1 ? 'disabled' : ''}>×</button>
    </div>
  `).join("");
  E.cupList.querySelectorAll(".cup-delete-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteCup(parseInt(btn.dataset.cupIdx)));
  });
  E.newCupName.value = "";
  E.newCupAmount.value = 300;
  E.cupDialog.showModal();
}

async function addCustomCup() {
  const name = E.newCupName.value.trim();
  const amount = Number(E.newCupAmount.value);
  if (!name) { showToast("请输入水杯名称", false); return; }
  if (!validWaterAmount(amount)) { E.newCupAmount.reportValidity(); showToast("水杯容量须为 10～5000 ml 的整数", false); return; }
  const next = [...userCups, { name, amount }];
  try { await storage.saveCups(next); }
  catch (error) { showToast(toFriendlyError(error), false); return; }
  userCups = next;
  renderCups();
  E.newCupName.value = "";
  E.newCupAmount.value = 300;
  openCupEditor();
  showToast(`已添加 "${name}"`, false);
}

async function deleteCup(idx) {
  if (userCups.length <= 1) return;
  const cup = userCups[idx];
  const next = userCups.filter((_, index) => index !== idx);
  try { await storage.saveCups(next); }
  catch (error) { showToast(toFriendlyError(error), false); return; }
  userCups = next;
  renderCups();
  openCupEditor();
  showToast(`已删除 "${cup.name}"`, false);
}

// ========== 智能推荐 ==========
function updateSmartGoal() {
  const weight = parseFloat(E.smartWeight.value) || 65;
  const activity = E.smartActivity.value || "mid";
  const rates = { low: 30, mid: 35, high: 42 };
  const goal = Math.round(weight * (rates[activity] || 35) / 50) * 50;
  E.smartResult.innerHTML = `推荐目标：<strong>${goal} ml</strong>`;
}

// ========== 提醒 ==========
function openReminderDialog() {
  E.reminderEnabled.checked = reminderSettings.enabled;
  renderReminderTimes();
  E.reminderDialog.showModal();
}

function renderReminderTimes() {
  E.reminderTimesList.innerHTML = reminderSettings.times.map((time, i) => `
    <div class="reminder-time-item">
      <input type="time" value="${time}" data-rem-idx="${i}" />
      <button class="reminder-delete-btn" data-rem-idx="${i}" type="button" ${reminderSettings.times.length <= 1 ? 'disabled' : ''}>×</button>
    </div>
  `).join("");
  // 绑定时间变更
  E.reminderTimesList.querySelectorAll("input[type='time']").forEach(input => {
    input.addEventListener("change", () => {
      const idx = parseInt(input.dataset.remIdx);
      if (!isNaN(idx)) reminderSettings.times[idx] = input.value;
    });
  });
  // 绑定删除
  E.reminderTimesList.querySelectorAll(".reminder-delete-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (reminderSettings.times.length <= 1) return;
      const idx = parseInt(btn.dataset.remIdx);
      reminderSettings.times.splice(idx, 1);
      renderReminderTimes();
    });
  });
}

async function saveReminderSettings() {
  // 收集所有时间输入
  E.reminderTimesList.querySelectorAll("input[type='time']").forEach(input => {
    const idx = parseInt(input.dataset.remIdx);
    if (!isNaN(idx)) reminderSettings.times[idx] = input.value;
  });
  reminderSettings.enabled = E.reminderEnabled.checked;
  // 去重排序
  reminderSettings.times = [...new Set(reminderSettings.times)].sort();
  await storage.updateReminder(reminderSettings);
  E.reminderDialog.close();
  // 更新状态显示
  if (E.profileReminderStatus) {
    E.profileReminderStatus.textContent = reminderSettings.enabled ? (getLang() === "zh" ? "已开启" : "On") : (getLang() === "zh" ? "已关闭" : "Off");
  }
  renderAccountPage();
  if (reminderSettings.enabled) {
    const nativeResult = await syncNativeReminders(reminderSettings);
    if (nativeResult.native) {
      if (!nativeResult.granted) showToast(t("remindPermission"), false);
      else showToast(t("remindersSaved"), false);
      return;
    }
    if (Notification.permission === "default") {
      const result = await Notification.requestPermission();
      if (result !== "granted") showToast(t("remindPermission"), false);
    }
    startReminderCheck();
    showToast(t("remindersSaved"), false);
  } else {
    await syncNativeReminders(reminderSettings);
    stopReminderCheck();
    showToast(t("remindersSaved"), false);
  }
}

function startReminderCheck() {
  stopReminderCheck();
  if (isNativeApp()) {
    syncNativeReminders(reminderSettings).catch(() => {});
    return;
  }
  if (!reminderSettings.enabled || reminderSettings.times.length === 0) return;
  // 每 60 秒检查一次
  reminderInterval = setInterval(checkReminders, 60000);
  // 启动时立即检查一次
  checkReminders();
}

function stopReminderCheck() {
  if (reminderInterval) { clearInterval(reminderInterval); reminderInterval = null; }
}

function checkReminders() {
  if (!reminderSettings.enabled) return;
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  // 检查是否匹配任意提醒时间（允许 ±1 分钟误差）
  for (const rt of reminderSettings.times) {
    const [rh, rm] = rt.split(":").map(Number);
    const diff = Math.abs((now.getHours() * 60 + now.getMinutes()) - (rh * 60 + rm));
    if (diff <= 1) {
      // 避免同一分钟重复通知
      const lastKey = `last_reminder_${rt}`;
      const lastDate = localStorage.getItem(lastKey);
      const today = toDateKey(now);
      if (lastDate === today) continue;
      localStorage.setItem(lastKey, today);
      new Notification(t("appTitle"), {
        body: `💧 ${t("waterTab")} — ${t("reminder")}`,
        icon: `icons/themes/${currentTheme().id}/icon-192.png`,
        silent: false,
      });
      break;
    }
  }
}

// ========== 统计 ==========
function openStats() {
  E.statsDialog.showModal();
  E.statsWeekTab.classList.add("active");
  E.statsMonthTab.classList.remove("active");
  // 延迟渲染，确保 canvas 已显示
  setTimeout(() => renderStatsChart("week"), 150);
}

async function renderStatsChart(period) {
  const days = period === "week" ? 7 : 30;
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dates.push(toDateKey(d));
  }
  const dayData = await storage.getHistory(dates);

  const labels = dates.map(dk => {
    const d = fromDateKey(dk);
    const weekdays = t("weekdays", getLang());
    return `${d.getMonth() + 1}/${d.getDate()} ${weekdays[d.getDay()]}`;
  });
  const waterData = dayData.map(d => d.waterTotal);

  // 饮水图表
  if (statsChart) statsChart.destroy();
  const ctx1 = E.waterChart.getContext("2d");
  statsChart = new Chart(ctx1, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: t("waterIntake", getLang()) + " (ml)",
        data: waterData,
        backgroundColor: waterData.map(v => v >= dailyGoal ? currentTheme().accent : currentTheme().secondary),
        borderColor: currentTheme().accent,
        borderWidth: 1,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: getComputedStyle(document.body).getPropertyValue("--ink").trim() || "#173d3a" } },
      },
      scales: {
        x: { ticks: { maxRotation: 45, font: { size: 10 } }, grid: { display: false } },
        y: { beginAtZero: true, grid: { color: "rgba(23,61,58,0.06)" } },
      },
    },
  });

  // 达标率图表
  if (complianceChart) complianceChart.destroy();
  const ctx2 = E.complianceChart.getContext("2d");
  const medRates = dayData.map(d => {
    const items = getFullList("medicine").filter(s => isItemActiveOnDay(s.schedule || "everyday", isWeekday(d.dateKey), d.isWorkout));
    if (items.length === 0) return 100;
    const done = items.filter(s => planRecordCount(s, d.medRecs) >= (s.targetCount || 1)).length;
    return Math.round((done / items.length) * 100);
  });
  const suppRates = dayData.map(d => {
    const items = getFullList("supplement").filter(s => isItemActiveOnDay(s.schedule || "everyday", isWeekday(d.dateKey), d.isWorkout));
    if (items.length === 0) return 100;
    const done = items.filter(s => planRecordCount(s, d.suppRecs) >= (s.targetCount || 1)).length;
    return Math.round((done / items.length) * 100);
  });

  complianceChart = new Chart(ctx2, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: `💚 ${t("medicineTab", getLang())} %`, data: medRates, borderColor: "#1a8a65", backgroundColor: "rgba(26,138,101,0.1)", fill: true, tension: 0.3, pointRadius: 3 },
        { label: `💊 ${t("supplementTab", getLang())} %`, data: suppRates, borderColor: currentTheme().accent, backgroundColor: currentTheme().soft, fill: true, tension: 0.3, pointRadius: 3 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: getComputedStyle(document.body).getPropertyValue("--ink").trim() || "#173d3a" } },
      },
      scales: {
        x: { ticks: { maxRotation: 45, font: { size: 10 } }, grid: { display: false } },
        y: { min: 0, max: 100, grid: { color: "rgba(23,61,58,0.06)" }, ticks: { callback: v => v + "%" } },
      },
    },
  });
}

// ========== 设置 ==========
function openSettingsDialog() {
  E.soundEnabled.checked = appSettings.soundEnabled;
  E.vibrationEnabled.checked = appSettings.vibrationEnabled;
  E.languageSelect.value = appSettings.language || "zh";
  E.settingsDialog.showModal();
}

initialize();
