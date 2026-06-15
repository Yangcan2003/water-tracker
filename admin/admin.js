// ========== Admin Panel Logic ==========
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ========== 状态 ==========
let apiKey = sessionStorage.getItem("admin_key") || "";
let currentView = "dashboard";
let usersData = [];
let userPage = 0;
let userSearchTerm = "";
const PAGE_SIZE = 20;

let selectedUser = null;
let recordsData = null;
let activeRecordType = "water";
let activityChart = null;
let recordsChart = null;

// ========== DOM 引用 ==========
const E = {};
[
  "loginGate","appShell","loginForm","apiKeyInput","loginError","loginBtn",
  "navDashboard","navUsers","logoutBtn",
  "viewDashboard","viewUsers","viewUserDetail",
  "statTotalUsers","statActiveUsers","statWater","statMedicine","statSupplement","statToilet",
  "userSearch","userCount","userTableBody","userPagination","userPrevPage","userNextPage","userPageInfo",
  "detailTitle","detailProfile","recordsTabs","recordsTableHead","recordsTableBody",
  "recordStartDate","recordEndDate","refreshRecords","backToUsers",
].forEach(id => {
  const el = $("#"+id); if (el) E[id] = el;
});

// ========== 初始化 ==========
function init() {
  // 设置默认日期范围
  const today = new Date();
  const d30 = new Date(today); d30.setDate(d30.getDate() - 30);
  if (E.recordStartDate) E.recordStartDate.value = toDateInput(d30);
  if (E.recordEndDate) E.recordEndDate.value = toDateInput(today);

  // 如果已有密钥，直接进入
  if (apiKey) {
    enterApp();
  }

  // 登录表单
  if (E.loginForm) E.loginForm.addEventListener("submit", handleLogin);

  // 导航
  if (E.navDashboard) E.navDashboard.addEventListener("click", () => showView("dashboard"));
  if (E.navUsers) E.navUsers.addEventListener("click", () => showView("users"));
  if (E.logoutBtn) E.logoutBtn.addEventListener("click", logout);

  // 用户搜索
  if (E.userSearch) E.userSearch.addEventListener("input", debounce(handleUserSearch, 300));

  // 分页
  if (E.userPrevPage) E.userPrevPage.addEventListener("click", () => { userPage--; loadUsers(); });
  if (E.userNextPage) E.userNextPage.addEventListener("click", () => { userPage++; loadUsers(); });

  // 返回用户列表
  if (E.backToUsers) E.backToUsers.addEventListener("click", () => showView("users"));

  // 记录刷新
  if (E.refreshRecords) E.refreshRecords.addEventListener("click", loadUserRecords);

  // 记录类型标签
  if (E.recordsTabs) {
    E.recordsTabs.addEventListener("click", (e) => {
      const tab = e.target.closest(".rec-tab");
      if (!tab) return;
      activeRecordType = tab.dataset.type;
      $$(".rec-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      renderRecordsTable();
    });
  }
}

// ========== 登录 ==========
async function handleLogin(e) {
  e.preventDefault();
  const key = E.apiKeyInput.value.trim();
  if (!key) return;

  E.loginBtn.disabled = true;
  E.loginBtn.textContent = "验证中...";
  E.loginError.hidden = true;

  // 10 秒超时
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(`/api/admin/dashboard?key=${encodeURIComponent(key)}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 401) {
      E.loginError.textContent = "密钥无效，请重试";
      E.loginError.hidden = false;
      E.loginBtn.disabled = false;
      E.loginBtn.textContent = "进入管理面板";
      return;
    }
    if (!res.ok) throw new Error("服务器错误: " + res.status);
    // 密钥有效
    apiKey = key;
    sessionStorage.setItem("admin_key", key);
    enterApp();
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") {
      E.loginError.textContent = "连接超时，请检查网络后重试";
    } else {
      E.loginError.textContent = "连接失败: " + e.message;
    }
    E.loginError.hidden = false;
    E.loginBtn.disabled = false;
    E.loginBtn.textContent = "进入管理面板";
  }
}

function enterApp() {
  E.loginGate.hidden = true;
  E.appShell.hidden = false;
  showView("dashboard");
}

function logout() {
  sessionStorage.removeItem("admin_key");
  apiKey = "";
  E.loginGate.hidden = false;
  E.appShell.hidden = true;
  E.apiKeyInput.value = "";
  E.apiKeyInput.focus();
  // 清理图表
  if (activityChart) { activityChart.destroy(); activityChart = null; }
  if (recordsChart) { recordsChart.destroy(); recordsChart = null; }
}

// ========== API 调用 ==========
async function adminFetch(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(path, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.status === 401) {
      logout();
      throw new Error("未授权");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") {
      throw new Error("请求超时");
    }
    throw e;
  }
}

// ========== 视图切换 ==========
async function showView(view) {
  currentView = view;
  E.viewDashboard.hidden = view !== "dashboard";
  E.viewUsers.hidden = view !== "users";
  E.viewUserDetail.hidden = view !== "userDetail";
  E.navDashboard.classList.toggle("active", view === "dashboard");
  E.navUsers.classList.toggle("active", view === "users" || view === "userDetail");

  if (view === "dashboard") await loadDashboard();
  if (view === "users") await loadUsers();
}

// ========== Dashboard ==========
async function loadDashboard() {
  try {
    const data = await adminFetch("/api/admin/dashboard");

    // 填充统计卡片
    E.statTotalUsers.textContent = data.totalUsers ?? "-";
    E.statActiveUsers.textContent = data.activeUsers7d ?? "-";
    E.statWater.textContent = data.totalWaterLogs7d ?? "-";
    E.statMedicine.textContent = data.totalMedicineLogs7d ?? "-";
    E.statSupplement.textContent = data.totalSupplementLogs7d ?? "-";
    E.statToilet.textContent = data.totalToiletLogs7d ?? "-";

    // 渲染图表
    const activity = data.recentActivity || [];
    const last7 = activity.slice(-7);

    renderActivityChart(last7);
    renderRecordsChart(last7);
  } catch (e) {
    console.error("loadDashboard", e);
  }
}

function renderActivityChart(data) {
  if (activityChart) activityChart.destroy();
  const ctx = document.getElementById("activityChart");
  if (!ctx) return;

  const labels = data.map(d => d.date.slice(5)); // MM-DD
  const activeUsers = data.map(d => d.activeUsers || 0);

  activityChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "活跃用户数",
        data: activeUsers,
        borderColor: "#168d84",
        backgroundColor: "rgba(22, 141, 132, 0.08)",
        fill: true,
        tension: 0.4,
        pointRadius: 5,
        pointBackgroundColor: "#168d84",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } },
      },
    },
  });
}

function renderRecordsChart(data) {
  if (recordsChart) recordsChart.destroy();
  const ctx = document.getElementById("recordsChart");
  if (!ctx) return;

  const labels = data.map(d => d.date.slice(5));
  const water = data.map(d => d.waterCount || 0);
  const medicine = data.map(d => d.medicineCount || 0);
  const supplement = data.map(d => d.supplementCount || 0);

  recordsChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "饮水", data: water, backgroundColor: "rgba(22, 141, 132, 0.7)" },
        { label: "药物", data: medicine, backgroundColor: "rgba(66, 143, 203, 0.7)" },
        { label: "补剂", data: supplement, backgroundColor: "rgba(216, 79, 70, 0.5)" },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

// ========== 用户列表 ==========
async function loadUsers() {
  if (!E.userTableBody) return;
  E.userTableBody.innerHTML = `<tr><td colspan="5" class="empty-cell">加载中...</td></tr>`;

  try {
    const searchParam = userSearchTerm ? `&search=${encodeURIComponent(userSearchTerm)}` : "";
    const data = await adminFetch(`/api/admin/users?page=${userPage}&pageSize=${PAGE_SIZE}${searchParam}`);

    usersData = data.users || [];
    const totalCount = data.totalCount || 0;

    E.userCount.textContent = `共 ${totalCount} 位用户`;
    E.userPagination.hidden = totalCount <= PAGE_SIZE;

    // 更新分页
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    E.userPageInfo.textContent = `第 ${userPage + 1} / ${Math.max(totalPages, 1)} 页`;
    E.userPrevPage.disabled = userPage <= 0;
    E.userNextPage.disabled = !data.hasMore;

    if (usersData.length === 0) {
      E.userTableBody.innerHTML = `<tr><td colspan="5" class="empty-cell">暂无用户${searchParam ? '（尝试其他搜索词）' : ''}</td></tr>`;
      return;
    }

    E.userTableBody.innerHTML = usersData.map(u => `
      <tr data-uid="${escHtml(u.uid)}" class="user-row">
        <td>
          <div class="user-email">${escHtml(u.email || "无邮箱")}</div>
          <div class="user-uid">${escHtml(u.uid)}</div>
        </td>
        <td>${u.dailyGoal || 2000} ml</td>
        <td>${u.lastActive || "-"}</td>
        <td>${u.totalRecords ?? "-"}</td>
        <td>${u.createdAt ? u.createdAt.slice(0, 10) : "-"}</td>
      </tr>
    `).join("");

    // 绑定点击事件
    E.userTableBody.querySelectorAll(".user-row").forEach(row => {
      row.addEventListener("click", () => {
        const uid = row.dataset.uid;
        if (uid) openUserDetail(uid);
      });
    });
  } catch (e) {
    E.userTableBody.innerHTML = `<tr><td colspan="5" class="empty-cell" style="color:var(--red)">加载失败: ${escHtml(e.message)}</td></tr>`;
  }
}

function handleUserSearch() {
  userSearchTerm = E.userSearch.value.trim();
  userPage = 0;
  loadUsers();
}

// ========== 用户详情 ==========
async function openUserDetail(uid) {
  showView("userDetail");
  E.detailTitle.textContent = "加载中...";
  E.detailProfile.innerHTML = '<div class="loading">加载中...</div>';
  E.recordsTableHead.innerHTML = "";
  E.recordsTableBody.innerHTML = '<tr><td colspan="5" class="empty-cell">加载中...</td></tr>';

  try {
    const data = await adminFetch(`/api/admin/users/${uid}`);
    selectedUser = data;
    E.detailTitle.textContent = data.profile?.email || uid;
    renderProfile(data);
    loadUserRecords();
  } catch (e) {
    E.detailProfile.innerHTML = `<div class="error-banner">加载失败: ${escHtml(e.message)}</div>`;
  }
}

function renderProfile(data) {
  const p = data.profile || {};
  const s = data.stats || {};
  const medicines = p.medicines || [];
  const supplements = p.supplements || [];

  E.detailProfile.innerHTML = `
    <div class="profile-field"><span class="pf-label">邮箱</span><span class="pf-value">${escHtml(p.email || "-")}</span></div>
    <div class="profile-field"><span class="pf-label">UID</span><span class="pf-value" style="font-family:monospace;font-size:12px;">${escHtml(data.uid)}</span></div>
    <div class="profile-field"><span class="pf-label">每日饮水目标</span><span class="pf-value">${p.dailyGoal || 2000} ml</span></div>
    <div class="profile-field"><span class="pf-label">总记录数</span><span class="pf-value">${s.totalRecords ?? "-"}</span></div>
    <div class="profile-field"><span class="pf-label">最后活跃</span><span class="pf-value">${s.lastActive ? s.lastActive.slice(0, 10) : "-"}</span></div>
    <div class="profile-field"><span class="pf-label">注册时间</span><span class="pf-value">${s.createdAt ? s.createdAt.slice(0, 10) : "-"}</span></div>
    <div class="profile-field"><span class="pf-label">头像类型</span><span class="pf-value">${p.avatarType || "default"}</span></div>
    <div class="profile-field"><span class="pf-label">头像颜色</span><span class="pf-value"><span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:${escHtml(p.avatarColor || '#168d84')};vertical-align:middle;margin-right:6px;"></span>${escHtml(p.avatarColor || "#168d84")}</span></div>
    ${medicines.length > 0 ? `
    <div class="profile-section">
      <h4>药物列表 (${medicines.length})</h4>
      <div class="tag-list">${medicines.map(m => `<span class="tag">${escHtml(m.emoji || '')} ${escHtml(m.name)} ${escHtml(m.dosage || '')}</span>`).join("")}</div>
    </div>` : ""}
    ${supplements.length > 0 ? `
    <div class="profile-section">
      <h4>补剂列表 (${supplements.length})</h4>
      <div class="tag-list">${supplements.map(s => `<span class="tag">${escHtml(s.emoji || '')} ${escHtml(s.name)} ${escHtml(s.dosage || '')}</span>`).join("")}</div>
    </div>` : ""}
    <div class="profile-section">
      <h4>记录分布</h4>
      <div class="tag-list">
        <span class="tag">💧 饮水: ${s.recordCounts?.water ?? 0}</span>
        <span class="tag">💚 药物: ${s.recordCounts?.medicine ?? 0}</span>
        <span class="tag">💊 补剂: ${s.recordCounts?.supplement ?? 0}</span>
        <span class="tag">🚽 如厕: ${s.recordCounts?.toilet ?? 0}</span>
      </div>
    </div>
  `;
}

// ========== 用户记录 ==========
async function loadUserRecords() {
  if (!selectedUser) return;
  const startDate = E.recordStartDate.value;
  const endDate = E.recordEndDate.value;

  E.recordsTableHead.innerHTML = "";
  E.recordsTableBody.innerHTML = '<tr><td colspan="5" class="empty-cell">加载中...</td></tr>';

  try {
    recordsData = await adminFetch(
      `/api/admin/users/${selectedUser.uid}/records?startDate=${startDate}&endDate=${endDate}`
    );
    activeRecordType = "water";
    $$(".rec-tab").forEach(t => t.classList.remove("active"));
    const waterTab = E.recordsTabs.querySelector('[data-type="water"]');
    if (waterTab) waterTab.classList.add("active");
    renderRecordsTable();
  } catch (e) {
    E.recordsTableBody.innerHTML = `<tr><td colspan="5" class="empty-cell" style="color:var(--red)">加载失败: ${escHtml(e.message)}</td></tr>`;
  }
}

function renderRecordsTable() {
  if (!recordsData) {
    E.recordsTableHead.innerHTML = "";
    E.recordsTableBody.innerHTML = '<tr><td colspan="5" class="empty-cell">请选择日期范围后查询</td></tr>';
    return;
  }

  const records = recordsData.records?.[activeRecordType] || [];

  // 根据类型定义表头
  const headers = {
    water: ["日期", "来源", "水量 (ml)", "记录时间"],
    medicine: ["日期", "名称", "剂量", "次数", "记录时间"],
    supplement: ["日期", "名称", "剂量", "次数", "记录时间"],
    toilet: ["日期", "类型", "记录时间"],
    workout: ["日期", "状态"],
  };

  const cols = headers[activeRecordType] || ["日期", "数据"];
  E.recordsTableHead.innerHTML = `<tr>${cols.map(h => `<th>${h}</th>`).join("")}</tr>`;

  if (records.length === 0) {
    E.recordsTableBody.innerHTML = `<tr><td colspan="${cols.length}" class="empty-cell">暂无 ${activeRecordType} 记录</td></tr>`;
    return;
  }

  // 按日期倒序排列
  const sorted = [...records].sort((a, b) => {
    const da = a.logDate || a.dateKey || "";
    const db = b.logDate || b.dateKey || "";
    return db.localeCompare(da);
  });

  E.recordsTableBody.innerHTML = sorted.map(r => {
    if (activeRecordType === "water") {
      return `<tr>
        <td>${escHtml(r.logDate || "")}</td>
        <td>${escHtml(r.source || "")}</td>
        <td>${r.amount || 0}</td>
        <td>${formatTime(r.recordedAt)}</td>
      </tr>`;
    }
    if (activeRecordType === "medicine" || activeRecordType === "supplement") {
      return `<tr>
        <td>${escHtml(r.logDate || "")}</td>
        <td>${escHtml(r.name || "")}</td>
        <td>${escHtml(r.dosage || "")}</td>
        <td>${r.count ?? "-"}</td>
        <td>${formatTime(r.recordedAt)}</td>
      </tr>`;
    }
    if (activeRecordType === "toilet") {
      const typeLabels = { big: "💩 大号", small: "💦 小号" };
      return `<tr>
        <td>${escHtml(r.logDate || "")}</td>
        <td>${typeLabels[r.type] || r.type || "-"}</td>
        <td>${formatTime(r.recordedAt)}</td>
      </tr>`;
    }
    if (activeRecordType === "workout") {
      return `<tr>
        <td>${escHtml(r.dateKey || "")}</td>
        <td>${r.isWorkout ? "🏋️ 健身日" : "—"}</td>
      </tr>`;
    }
    return "";
  }).join("");
}

// ========== 工具函数 ==========
function toDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTime(isoStr) {
  if (!isoStr) return "-";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  } catch (e) {
    return isoStr;
  }
}

function escHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ========== 启动 ==========
init();
