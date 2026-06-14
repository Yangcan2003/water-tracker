import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

let auth = null;
let db = null;
let currentUser = null;
let selectedDate = toDateKey(new Date());
let records = [];
let dailyGoal = 2000;
let authMode = "login";
let lastDeleted = null;
let toastTimer = null;
let requestVersion = 0;

const elements = {
  authShell: document.querySelector("#authShell"),
  appShell: document.querySelector("#appShell"),
  authForm: document.querySelector("#authForm"),
  loginTab: document.querySelector("#loginTab"),
  registerTab: document.querySelector("#registerTab"),
  authEyebrow: document.querySelector("#authEyebrow"),
  authTitle: document.querySelector("#authTitle"),
  emailInput: document.querySelector("#emailInput"),
  passwordInput: document.querySelector("#passwordInput"),
  authMessage: document.querySelector("#authMessage"),
  authSubmit: document.querySelector("#authSubmit"),
  userEmail: document.querySelector("#userEmail"),
  logoutButton: document.querySelector("#logoutButton"),
  currentAmount: document.querySelector("#currentAmount"),
  goalAmount: document.querySelector("#goalAmount"),
  progressPercent: document.querySelector("#progressPercent"),
  progressBar: document.querySelector("#progressBar"),
  progressMessage: document.querySelector("#progressMessage"),
  waterFill: document.querySelector("#waterFill"),
  waterWave: document.querySelector("#waterWave"),
  dateLabel: document.querySelector("#dateLabel"),
  fullDate: document.querySelector("#fullDate"),
  datePicker: document.querySelector("#datePicker"),
  datePickerButton: document.querySelector("#datePickerButton"),
  previousDay: document.querySelector("#previousDay"),
  nextDay: document.querySelector("#nextDay"),
  historyList: document.querySelector("#historyList"),
  recordCount: document.querySelector("#recordCount"),
  goalButton: document.querySelector("#goalButton"),
  goalDialog: document.querySelector("#goalDialog"),
  goalForm: document.querySelector("#goalForm"),
  goalInput: document.querySelector("#goalInput"),
  customButton: document.querySelector("#customButton"),
  customDialog: document.querySelector("#customDialog"),
  customForm: document.querySelector("#customForm"),
  customName: document.querySelector("#customName"),
  customAmount: document.querySelector("#customAmount"),
  toast: document.querySelector("#toast"),
  toastText: document.querySelector("#toastText"),
  undoButton: document.querySelector("#undoButton"),
};

document.querySelectorAll(".source-card").forEach((button) => {
  button.addEventListener("click", () => {
    addRecord(button.dataset.source, Number(button.dataset.amount));
  });
});

document.querySelectorAll("[data-goal]").forEach((button) => {
  button.addEventListener("click", () => {
    elements.goalInput.value = button.dataset.goal;
  });
});

elements.loginTab.addEventListener("click", () => setAuthMode("login"));
elements.registerTab.addEventListener("click", () => setAuthMode("register"));
elements.authForm.addEventListener("submit", handleAuthSubmit);
elements.logoutButton.addEventListener("click", () => auth && signOut(auth));

elements.goalButton.addEventListener("click", () => {
  elements.goalInput.value = dailyGoal;
  elements.goalDialog.showModal();
  setTimeout(() => elements.goalInput.select(), 50);
});

elements.goalForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const goal = Number(elements.goalInput.value);
  if (!elements.goalForm.reportValidity() || goal < 500 || goal > 10000) return;

  try {
    await setDoc(
      doc(db, "users", currentUser.uid),
      { dailyGoal: goal, updatedAt: serverTimestamp() },
      { merge: true },
    );
    dailyGoal = goal;
    elements.goalDialog.close();
    render();
    showToast(`每日目标已设为 ${goal} ml`, false);
  } catch (error) {
    showToast(toFriendlyError(error), false);
  }
});

elements.customButton.addEventListener("click", () => {
  elements.customDialog.showModal();
  setTimeout(() => elements.customAmount.select(), 50);
});

elements.customForm.addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  if (!elements.customForm.reportValidity()) return;
  addRecord(elements.customName.value.trim(), Number(elements.customAmount.value));
  elements.customDialog.close();
});

elements.previousDay.addEventListener("click", () => changeDay(-1));
elements.nextDay.addEventListener("click", () => changeDay(1));

elements.datePickerButton.addEventListener("click", () => {
  elements.datePicker.value = selectedDate;
  if (typeof elements.datePicker.showPicker === "function") {
    elements.datePicker.showPicker();
  } else {
    elements.datePicker.click();
  }
});

elements.datePicker.addEventListener("change", () => {
  if (!elements.datePicker.value) return;
  const today = toDateKey(new Date());
  selectedDate = elements.datePicker.value > today ? today : elements.datePicker.value;
  loadDay();
});

elements.undoButton.addEventListener("click", undoDelete);

elements.historyList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest(".delete-record");
  if (deleteButton) deleteRecord(deleteButton.dataset.id);
});

[elements.goalDialog, elements.customDialog].forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    const bounds = dialog.getBoundingClientRect();
    const outside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;
    if (outside) dialog.close();
  });
});

async function initialize() {
  try {
    const firebaseConfig = {
      apiKey: "AIzaSyBkOLTe2i-uBAea4TD_nMYvIQuXkBw2LOE",
      authDomain: "water-e08be.firebaseapp.com",
      projectId: "water-e08be",
      storageBucket: "water-e08be.firebasestorage.app",
      messagingSenderId: "176629809438",
      appId: "1:176629809438:web:475d4b652c6a2b607d090f",
    };

    const firebaseApp = initializeApp(firebaseConfig);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
    onAuthStateChanged(auth, applyUser);
  } catch (error) {
    showAuthMessage(`初始化失败：${error.message}`);
    elements.authSubmit.disabled = true;
  }
}

async function applyUser(user) {
  currentUser = user;
  if (!currentUser) {
    records = [];
    elements.appShell.hidden = true;
    elements.authShell.hidden = false;
    elements.passwordInput.value = "";
    return;
  }

  elements.userEmail.textContent = currentUser.email || "已登录";
  elements.authShell.hidden = true;
  elements.appShell.hidden = false;
  await Promise.all([loadProfile(), loadDay()]);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!auth || !elements.authForm.reportValidity()) return;

  setAuthBusy(true);
  showAuthMessage("");
  const email = elements.emailInput.value.trim();
  const password = elements.passwordInput.value;

  try {
    if (authMode === "register") {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "users", credential.user.uid), {
        dailyGoal: 2000,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    showAuthMessage(toFriendlyError(error));
  } finally {
    setAuthBusy(false);
  }
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  elements.loginTab.classList.toggle("active", isLogin);
  elements.registerTab.classList.toggle("active", !isLogin);
  elements.authEyebrow.textContent = isLogin ? "WELCOME BACK" : "CREATE ACCOUNT";
  elements.authTitle.textContent = isLogin ? "登录你的账户" : "创建云端账户";
  elements.authSubmit.textContent = isLogin ? "登录" : "注册";
  elements.passwordInput.autocomplete = isLogin ? "current-password" : "new-password";
  showAuthMessage("");
}

function setAuthBusy(isBusy) {
  elements.authSubmit.disabled = isBusy;
  elements.authSubmit.textContent = isBusy
    ? "请稍候..."
    : authMode === "login"
      ? "登录"
      : "注册";
}

function showAuthMessage(message, success = false) {
  elements.authMessage.textContent = message;
  elements.authMessage.classList.toggle("success", success);
}

async function loadProfile() {
  try {
    const snapshot = await getDoc(doc(db, "users", currentUser.uid));
    dailyGoal = Number(snapshot.data()?.dailyGoal) || 2000;
    render();
  } catch (error) {
    showToast(toFriendlyError(error), false);
  }
}

async function loadDay() {
  if (!currentUser) return;
  const version = ++requestVersion;
  renderDate();
  elements.historyList.innerHTML = '<div class="empty-state">正在读取云端记录...</div>';

  try {
    const logsQuery = query(
      collection(db, "users", currentUser.uid, "waterLogs"),
      where("logDate", "==", selectedDate),
    );
    const snapshot = await getDocs(logsQuery);
    if (version !== requestVersion) return;
    records = snapshot.docs
      .map((item) => ({
        id: item.id,
        ...item.data(),
        recordedAt: item.data().recordedAt?.toDate?.() ?? new Date(),
      }))
      .sort((left, right) => left.recordedAt - right.recordedAt);
  } catch (error) {
    if (version !== requestVersion) return;
    records = [];
    showToast(toFriendlyError(error), false);
  }
  render();
}

async function addRecord(source, amount) {
  if (!currentUser) return;
  try {
    const now = new Date();
    const reference = await addDoc(
      collection(db, "users", currentUser.uid, "waterLogs"),
      {
        source,
        amount,
        logDate: selectedDate,
        recordedAt: now,
      },
    );
    records.push({
      id: reference.id,
      source,
      amount,
      logDate: selectedDate,
      recordedAt: now,
    });
    render();
    showToast(`已同步 ${amount} ml`, false);
  } catch (error) {
    showToast(toFriendlyError(error), false);
  }
}

async function deleteRecord(id) {
  const index = records.findIndex((record) => record.id === id);
  if (index < 0) return;
  const [record] = records.splice(index, 1);
  render();

  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "waterLogs", id));
    lastDeleted = { record, index };
    showToast(`已删除 ${record.amount} ml 记录`, true);
  } catch (error) {
    records.splice(index, 0, record);
    render();
    showToast(toFriendlyError(error), false);
  }
}

async function undoDelete() {
  if (!lastDeleted) return;
  const pending = lastDeleted;
  lastDeleted = null;
  hideToast();

  try {
    const reference = await addDoc(
      collection(db, "users", currentUser.uid, "waterLogs"),
      {
        source: pending.record.source,
        amount: pending.record.amount,
        logDate: pending.record.logDate,
        recordedAt: pending.record.recordedAt,
      },
    );
    records.splice(pending.index, 0, {
      ...pending.record,
      id: reference.id,
    });
    render();
  } catch (error) {
    showToast(toFriendlyError(error), false);
  }
}

function render() {
  const total = records.reduce((sum, record) => sum + Number(record.amount), 0);
  const ratio = dailyGoal > 0 ? total / dailyGoal : 0;
  const displayPercent = Math.round(ratio * 100);
  const cappedPercent = Math.min(ratio * 100, 100);

  elements.currentAmount.textContent = total;
  elements.goalAmount.textContent = dailyGoal;
  elements.progressPercent.textContent = `${displayPercent}%`;
  elements.progressBar.style.width = `${cappedPercent}%`;

  const waterY = 190 - cappedPercent * 1.9;
  elements.waterFill.setAttribute("y", waterY);
  elements.waterWave.setAttribute("transform", `translate(0 ${waterY})`);
  elements.progressMessage.textContent = getProgressMessage(total, dailyGoal);

  renderDate();
  renderHistory();
}

function renderDate() {
  const selected = fromDateKey(selectedDate);
  const todayKey = toDateKey(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (selectedDate === todayKey) {
    elements.dateLabel.textContent = "今天";
  } else if (selectedDate === toDateKey(yesterday)) {
    elements.dateLabel.textContent = "昨天";
  } else {
    elements.dateLabel.textContent = selected.toLocaleDateString("zh-CN", {
      month: "long",
      day: "numeric",
    });
  }

  elements.fullDate.textContent = selected.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  elements.nextDay.disabled = selectedDate >= todayKey;
  elements.datePicker.max = todayKey;
}

function renderHistory() {
  elements.recordCount.textContent = `${records.length} 条`;
  if (records.length === 0) {
    elements.historyList.innerHTML = `
      <div class="empty-state">
        这一天还没有饮水记录，点击上方卡片添加一杯吧。
      </div>
    `;
    return;
  }

  elements.historyList.innerHTML = [...records]
    .reverse()
    .map((record) => {
      const time = new Date(record.recordedAt).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      return `
        <article class="history-item">
          <span class="history-dot" aria-hidden="true">◒</span>
          <div class="history-info">
            <strong>${escapeHtml(record.source)}</strong>
            <span>${time}</span>
          </div>
          <strong class="history-amount">+${record.amount} ml</strong>
          <button class="delete-record" type="button" data-id="${record.id}" aria-label="删除这条记录">×</button>
        </article>
      `;
    })
    .join("");
}

function getProgressMessage(total, goal) {
  if (total === 0) return "喝下第一杯水，开启清爽的一天";
  if (total >= goal) return `今日目标已完成，多喝了 ${total - goal} ml`;
  const remaining = goal - total;
  if (remaining <= 550) return `就差 ${remaining} ml，下一瓶就能完成目标`;
  if (total / goal >= 0.5) return `已经过半，还差 ${remaining} ml`;
  return `保持节奏，距离目标还有 ${remaining} ml`;
}

async function changeDay(offset) {
  const date = fromDateKey(selectedDate);
  date.setDate(date.getDate() + offset);
  const nextKey = toDateKey(date);
  if (nextKey > toDateKey(new Date())) return;
  selectedDate = nextKey;
  await loadDay();
}

function showToast(message, canUndo) {
  clearTimeout(toastTimer);
  elements.toastText.textContent = message;
  elements.undoButton.hidden = !canUndo;
  elements.toast.classList.add("show");
  toastTimer = setTimeout(hideToast, canUndo ? 5000 : 2600);
}

function hideToast() {
  elements.toast.classList.remove("show");
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function toFriendlyError(error) {
  const code = error?.code || "";
  const translations = {
    "auth/email-already-in-use": "该邮箱已经注册",
    "auth/invalid-credential": "邮箱或密码不正确",
    "auth/invalid-email": "邮箱格式不正确",
    "auth/network-request-failed": "网络连接失败，请稍后重试",
    "auth/too-many-requests": "尝试次数过多，请稍后再试",
    "auth/weak-password": "密码至少需要 6 位",
    "permission-denied": "数据库权限配置不正确",
  };
  return translations[code] || error?.message || "操作失败，请稍后重试";
}

initialize();
