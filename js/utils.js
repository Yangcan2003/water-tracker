// ========== 工具函数 ==========

/** 将 Date 转为 YYYY-MM-DD 字符串 */
export function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 将 YYYY-MM-DD 字符串转为 Date */
export function fromDateKey(dk) {
  const [y, m, d] = dk.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** 判断日期是否为工作日（周一~周五） */
export function isWeekday(dateKey) {
  const d = fromDateKey(dateKey);
  return d.getDay() >= 1 && d.getDay() <= 5;
}

/** HTML 转义 */
export function esc(v) {
  const d = document.createElement("div");
  d.textContent = v;
  return d.innerHTML;
}

/** Firebase 错误消息友好化 */
export function toFriendlyError(e) {
  const m = {
    "auth/email-already-in-use": "该邮箱已经注册",
    "auth/invalid-credential": "邮箱或密码不正确",
    "auth/invalid-email": "邮箱格式不正确",
    "auth/network-request-failed": "网络连接失败，请稍后重试",
    "auth/too-many-requests": "尝试次数过多，请稍后再试",
    "auth/weak-password": "密码至少需要 6 位",
    "permission-denied": "数据库权限配置不正确",
  };
  return m[e?.code] || e?.message || "操作失败，请稍后重试";
}

/** Date → HH:MM 字符串 */
export function toTimeValue(d) {
  const dt = new Date(d);
  return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
}

/** HH:MM → 中文时间显示 */
export function toTimeDisplay(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** 生成本地记录 ID */
export function generateLocalId() {
  return `local_${crypto.randomUUID()}`;
}

/** 饮水进度提示文案 */
export function getProgressMessage(total, goal) {
  if (total === 0) return "喝下第一杯水，开启清爽的一天";
  if (total >= goal) return `今日目标已完成，多喝了 ${total - goal} ml`;
  const rem = goal - total;
  if (rem <= 550) return `就差 ${rem} ml，下一瓶就能完成目标`;
  if (total / goal >= 0.5) return `已经过半，还差 ${rem} ml`;
  return `保持节奏，距离目标还有 ${rem} ml`;
}

/** 生成默认头像 SVG */
export function genAvatarSVG(color, size) {
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="50" fill="${color}"/>
    <circle cx="50" cy="28" r="14" fill="white" opacity="0.95"/>
    <path d="M50 44 C26 44 18 82 17 98 L83 98 C82 82 74 44 50 44Z" fill="white" opacity="0.95"/>
  </svg>`;
}

/** 获取用户邮箱首字母 */
export function getInitial(email) {
  return (email || "U").charAt(0).toUpperCase();
}

/** 厕所 SVG 图标 */
export const TOILET_SVG = {
  big: `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" style="width:28px;height:28px;display:block"><path d="M894.357 414.095H858.728l-63.123-345.07A84.163 84.163 0 0 0 712.845 0.011H311.666a84.163 84.163 0 0 0-84.164 69.014l-62.561 345.07H129.311a42.082 42.082 0 0 0-42.081 42.082v31.421A426.989 426.989 0 0 0 286.978 847.257V981.918a42.082 42.082 0 0 0 42.081 42.082h364.709a42.082 42.082 0 0 0 42.081-42.082V847.257a426.989 426.989 0 0 0 199.748-359.659v-31.421a42.082 42.082 0 0 0-41.24-42.082zM283.611 79.125A28.054 28.054 0 0 1 311.666 56.12h401.179a28.054 28.054 0 0 1 28.054 23.005l60.879 334.97H221.891z m415.487 725.209a38.715 38.715 0 0 0-18.516 33.104v129.05H336.654v-129.05a38.996 38.996 0 0 0-18.797-33.105 371.441 371.441 0 0 1-168.327-220.228H867.144a371.722 371.722 0 0 1-168.046 220.228z m181.232-316.735a380.699 380.699 0 0 1-2.525 40.398H145.864A318.699 318.699 0 0 1 143.339 487.598v-17.394h736.991z" fill="#040000"/></svg>`,
  small: `<svg viewBox="-245 0 1314 1314" xmlns="http://www.w3.org/2000/svg" style="width:28px;height:28px;display:block"><g fill="none" stroke="#040000" stroke-linecap="round" stroke-linejoin="round" stroke-width="14"><circle cx="412" cy="85" r="58"/><circle cx="412" cy="85" r="26"/><path d="M412 143L412 225"/><rect x="377" y="225" width="70" height="36" rx="2"/><path d="M262 260H562C672 260 735 332 738 448L738 768C738 1080 599 1260 412 1260C225 1260 86 1080 86 768L86 448C89 332 152 260 262 260Z"/><path d="M282 405C305 355 519 355 542 405C566 458 565 740 540 890C514 1045 469 1148 412 1148C355 1148 310 1045 284 890C259 740 258 458 282 405Z"/><circle cx="412" cy="503" r="22"/><ellipse cx="412" cy="1037" rx="76" ry="23"/></g></svg>`,
  bigSmall: `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" style="width:16px;height:16px;display:block"><path d="M894.357 414.095H858.728l-63.123-345.07A84.163 84.163 0 0 0 712.845 0.011H311.666a84.163 84.163 0 0 0-84.164 69.014l-62.561 345.07H129.311a42.082 42.082 0 0 0-42.081 42.082v31.421A426.989 426.989 0 0 0 286.978 847.257V981.918a42.082 42.082 0 0 0 42.081 42.082h364.709a42.082 42.082 0 0 0 42.081-42.082V847.257a426.989 426.989 0 0 0 199.748-359.659v-31.421a42.082 42.082 0 0 0-41.24-42.082zM283.611 79.125A28.054 28.054 0 0 1 311.666 56.12h401.179a28.054 28.054 0 0 1 28.054 23.005l60.879 334.97H221.891z m415.487 725.209a38.715 38.715 0 0 0-18.516 33.104v129.05H336.654v-129.05a38.996 38.996 0 0 0-18.797-33.105 371.441 371.441 0 0 1-168.327-220.228H867.144a371.722 371.722 0 0 1-168.046 220.228z m181.232-316.735a380.699 380.699 0 0 1-2.525 40.398H145.864A318.699 318.699 0 0 1 143.339 487.598v-17.394h736.991z" fill="#040000"/></svg>`,
  smallSmall: `<svg viewBox="-245 0 1314 1314" xmlns="http://www.w3.org/2000/svg" style="width:16px;height:16px;display:block"><g fill="none" stroke="#040000" stroke-linecap="round" stroke-linejoin="round" stroke-width="14"><circle cx="412" cy="85" r="58"/><circle cx="412" cy="85" r="26"/><path d="M412 143L412 225"/><rect x="377" y="225" width="70" height="36" rx="2"/><path d="M262 260H562C672 260 735 332 738 448L738 768C738 1080 599 1260 412 1260C225 1260 86 1080 86 768L86 448C89 332 152 260 262 260Z"/><path d="M282 405C305 355 519 355 542 405C566 458 565 740 540 890C514 1045 469 1148 412 1148C355 1148 310 1045 284 890C259 740 258 458 282 405Z"/><circle cx="412" cy="503" r="22"/><ellipse cx="412" cy="1037" rx="76" ry="23"/></g></svg>`,
  histBig: `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" style="width:12px;height:12px;display:block"><path d="M894.357 414.095H858.728l-63.123-345.07A84.163 84.163 0 0 0 712.845 0.011H311.666a84.163 84.163 0 0 0-84.164 69.014l-62.561 345.07H129.311a42.082 42.082 0 0 0-42.081 42.082v31.421A426.989 426.989 0 0 0 286.978 847.257V981.918a42.082 42.082 0 0 0 42.081 42.082h364.709a42.082 42.082 0 0 0 42.081-42.082V847.257a426.989 426.989 0 0 0 199.748-359.659v-31.421a42.082 42.082 0 0 0-41.24-42.082zM283.611 79.125A28.054 28.054 0 0 1 311.666 56.12h401.179a28.054 28.054 0 0 1 28.054 23.005l60.879 334.97H221.891z m415.487 725.209a38.715 38.715 0 0 0-18.516 33.104v129.05H336.654v-129.05a38.996 38.996 0 0 0-18.797-33.105 371.441 371.441 0 0 1-168.327-220.228H867.144a371.722 371.722 0 0 1-168.046 220.228z m181.232-316.735a380.699 380.699 0 0 1-2.525 40.398H145.864A318.699 318.699 0 0 1 143.339 487.598v-17.394h736.991z" fill="#040000"/></svg>`,
  histSmall: `<svg viewBox="-245 0 1314 1314" xmlns="http://www.w3.org/2000/svg" style="width:12px;height:12px;display:block"><g fill="none" stroke="#040000" stroke-linecap="round" stroke-linejoin="round" stroke-width="18"><circle cx="412" cy="85" r="58"/><circle cx="412" cy="85" r="26"/><path d="M412 143L412 225"/><rect x="377" y="225" width="70" height="36" rx="2"/><path d="M262 260H562C672 260 735 332 738 448L738 768C738 1080 599 1260 412 1260C225 1260 86 1080 86 768L86 448C89 332 152 260 262 260Z"/><path d="M282 405C305 355 519 355 542 405C566 458 565 740 540 890C514 1045 469 1148 412 1148C355 1148 310 1045 284 890C259 740 258 458 282 405Z"/><circle cx="412" cy="503" r="22"/><ellipse cx="412" cy="1037" rx="76" ry="23"/></g></svg>`,
};

// ========== 多语言 (i18n) ==========
export const I18N = {
  zh: {
    appTitle: "每日健康追踪",
    authEyebrow: "WELCOME BACK",
    authTitle: "登录你的账户",
    authIntro: "你的数据默认保存在本地浏览器中。登录后可同步到云端，多设备共享。",
    login: "登录",
    register: "注册",
    registerTitle: "创建云端账户",
    email: "邮箱",
    password: "密码",
    loginBtn: "登录",
    registerBtn: "注册",
    syncLabel: "已同步",
    localMode: "本地模式",
    offline: "📡 离线",
    profile: "个人主页",
    editAvatar: "更换头像",
    dailyGoal: "每日饮水目标",
    history: "历史记录",
    exportData: "导出数据",
    logout: "退出登录",
    loginToSync: "🔐 登录以同步数据",
    waterTab: "今天喝水了吗？",
    medicineTab: "今天吃药了吗？",
    supplementTab: "今天吃补剂了吗？",
    today: "今天",
    yesterday: "昨天",
    quickAdd: "喝了什么？",
    customWater: "+ 自定义",
    myCup: "我的水杯",
    waterGoal: "目标",
    ml: "ml",
    editCups: "编辑水杯",
    restroomLog: "厕所记录",
    big: "大号",
    small: "小号",
    waterLog: "饮水记录",
    medicineLog: "药物记录",
    supplementLog: "补剂记录",
    stats: "数据统计",
    weeklyView: "周视图",
    monthlyView: "月视图",
    waterIntake: "饮水量",
    compliance: "达标率",
    reminder: "饮水提醒",
    reminderEnabled: "已开启",
    reminderDisabled: "已关闭",
    reminderTimes: "提醒时间",
    addReminderTime: "+ 添加时间",
    smartGoal: "智能推荐",
    weight: "体重 (kg)",
    activityLevel: "活动等级",
    activityLow: "低（久坐）",
    activityMid: "中（偶尔运动）",
    activityHigh: "高（经常运动）",
    recommendedGoal: "推荐目标",
    applyGoal: "应用推荐值",
    soundFeedback: "音效与震动",
    language: "语言",
    languageSwitch: "English",
    fabRecord: "快速记录",
    fabWater: "喝水",
    fabMedicine: "吃药",
    fabSupplement: "补剂",
    loading: "正在加载...",
    noData: "暂无数据",
    loadMore: "加载更多...",
    allLoaded: "已加载全部记录",
    cloudSync: "登录同步数据",
    cloudNote: "由 GitHub Pages 提供访问 · Firebase 认证与存储",
    pleaseWait: "请稍候...",
    createAccount: "CREATE ACCOUNT",
    dailyMedicine: "今天吃药了吗？",
    dailySupplement: "今天吃了什么？",
    taken: "已服用",
    needTake: "需服用",
    completion: "完成度",
    workoutDay: "今天是健身日",
    notWorkoutDay: "今天不是健身日",
    markWorkout: "已标记为健身日 🏋️",
    unmarkWorkout: "已取消健身日",
    records: "条",
    customSupplement: "自定义补剂",
    customMedicine: "自定义药物",
    addSupplement: "添加补剂",
    addMedicine: "添加药物",
    saveEdit: "保存修改",
    deleteItem: "删除",
    dosage: "每份剂量",
    dailyTimes: "每日次数",
    timesPerDay: "次/日",
    schedule: "服用排程",
    everyday: "每天",
    weekday: "仅工作日（周一~周五）",
    workout: "仅健身日（不限星期）",
    workoutWeekday: "仅工作日健身日",
    weekendRest: "周末休息",
    nonWorkoutDay: "非健身日",
    weekendRestNonWorkout: "周末休息 · 非健身日",
    tapToRecord: "点击卡片 +1 · 灰色=今日跳过",
    deleteConfirm: "已删除",
    undo: "撤销",
    timeUpdated: "时间已更新",
    recordAdded: "已记录",
    goalSaved: "每日目标已设为",
    dataExported: "数据已导出",
    exportFailed: "导出失败",
    cupHint: "按平时 2～3 杯计算，水杯可贡献 980～1470 ml",
    emptyWater: "这一天还没有饮水记录，点击上方卡片添加一杯吧。",
    emptyToilet: "这一天还没有厕所记录，点击上方按钮记录吧。",
    emptyMedicine: "这一天还没有药物记录，点击上方卡片开始记录吧。",
    emptySupplement: "这一天还没有补剂记录，点击上方卡片开始记录吧。",
    detailWater: "💧 饮水记录",
    detailMedicine: "💚 药物记录",
    detailSupplement: "💊 补剂记录",
    detailToilet: "🧻 厕所记录",
    dayWaterTotal: "当日饮水：",
    noWaterRecord: "这一天没有饮水记录",
    noMedicineRecord: "这一天没有药物记录",
    noSupplementRecord: "这一天没有补剂记录",
    noToiletRecord: "这一天没有厕所记录",
    backToList: "← 返回历史列表",
    copiedToClipboard: "已复制到剪贴板",
    remindPermission: "需要通知权限才能发送提醒",
    remindersSaved: "提醒设置已保存",
    cupAdded: "已添加水杯",
    cupUpdated: "已更新水杯",
    cupDeleted: "已删除水杯",
    clickToEdit: "点击修改时间",
    weekdays: ["日", "一", "二", "三", "四", "五", "六"],
  },
  en: {
    appTitle: "Daily Health Tracker",
    authEyebrow: "WELCOME BACK",
    authTitle: "Sign in to your account",
    authIntro: "Your data is saved locally in your browser. Sign in to sync across devices.",
    login: "Sign In",
    register: "Sign Up",
    registerTitle: "Create your account",
    email: "Email",
    password: "Password",
    loginBtn: "Sign In",
    registerBtn: "Sign Up",
    syncLabel: "Synced",
    localMode: "Local Mode",
    offline: "📡 Offline",
    profile: "Profile",
    editAvatar: "Change Avatar",
    dailyGoal: "Daily Water Goal",
    history: "History",
    exportData: "Export Data",
    logout: "Sign Out",
    loginToSync: "🔐 Sign in to sync",
    waterTab: "How's your water today?",
    medicineTab: "Did you take your meds?",
    supplementTab: "Have you taken supplements?",
    today: "Today",
    yesterday: "Yesterday",
    quickAdd: "What did you drink?",
    customWater: "+ Custom",
    myCup: "My Cup",
    waterGoal: "Goal",
    ml: "ml",
    editCups: "Edit Cups",
    restroomLog: "Restroom Log",
    big: "Big",
    small: "Small",
    waterLog: "Water Log",
    medicineLog: "Medicine Log",
    supplementLog: "Supplement Log",
    stats: "Statistics",
    weeklyView: "Weekly",
    monthlyView: "Monthly",
    waterIntake: "Water Intake",
    compliance: "Compliance",
    reminder: "Water Reminder",
    reminderEnabled: "Enabled",
    reminderDisabled: "Disabled",
    reminderTimes: "Reminder Times",
    addReminderTime: "+ Add Time",
    smartGoal: "Smart Goal",
    weight: "Weight (kg)",
    activityLevel: "Activity Level",
    activityLow: "Low (sedentary)",
    activityMid: "Medium (occasional exercise)",
    activityHigh: "High (regular exercise)",
    recommendedGoal: "Recommended Goal",
    applyGoal: "Apply Recommendation",
    soundFeedback: "Sound & Vibration",
    language: "Language",
    languageSwitch: "中文",
    fabRecord: "Quick Record",
    fabWater: "Drink",
    fabMedicine: "Meds",
    fabSupplement: "Supps",
    loading: "Loading...",
    noData: "No data yet",
    loadMore: "Load more...",
    allLoaded: "All records loaded",
    cloudSync: "Sign in to Sync",
    cloudNote: "Powered by GitHub Pages · Firebase Auth & Storage",
    pleaseWait: "Please wait...",
    createAccount: "CREATE ACCOUNT",
    dailyMedicine: "Did you take your meds?",
    dailySupplement: "Have you taken supplements?",
    taken: "Taken",
    needTake: "Required",
    completion: "Completion",
    workoutDay: "Workout Day",
    notWorkoutDay: "Not Workout Day",
    markWorkout: "Marked as workout day 🏋️",
    unmarkWorkout: "Workout day removed",
    records: "records",
    customSupplement: "Custom Supplement",
    customMedicine: "Custom Medicine",
    addSupplement: "Add Supplement",
    addMedicine: "Add Medicine",
    saveEdit: "Save Changes",
    deleteItem: "Delete",
    dosage: "Dosage",
    dailyTimes: "Times per Day",
    timesPerDay: "/day",
    schedule: "Schedule",
    everyday: "Every Day",
    weekday: "Weekdays Only (Mon-Fri)",
    workout: "Workout Days Only",
    workoutWeekday: "Weekday Workouts",
    weekendRest: "Weekend rest",
    nonWorkoutDay: "Non-workout day",
    weekendRestNonWorkout: "Weekend rest · Non-workout",
    tapToRecord: "Tap card +1 · Gray = skipped today",
    deleteConfirm: "Deleted",
    undo: "Undo",
    timeUpdated: "Time updated",
    recordAdded: "Recorded",
    goalSaved: "Daily goal set to",
    dataExported: "Data exported",
    exportFailed: "Export failed",
    cupHint: "With 2~3 cups, contributes about 980~1470 ml",
    emptyWater: "No water records yet. Tap a card above to add one.",
    emptyToilet: "No restroom records yet. Tap a button above.",
    emptyMedicine: "No medicine records yet. Tap a card above to start.",
    emptySupplement: "No supplement records yet. Tap a card above to start.",
    detailWater: "💧 Water",
    detailMedicine: "💚 Medicine",
    detailSupplement: "💊 Supplements",
    detailToilet: "🧻 Restroom",
    dayWaterTotal: "Daily water: ",
    noWaterRecord: "No water records this day",
    noMedicineRecord: "No medicine records this day",
    noSupplementRecord: "No supplement records this day",
    noToiletRecord: "No restroom records this day",
    backToList: "← Back to History",
    copiedToClipboard: "Copied to clipboard",
    remindPermission: "Notification permission is required for reminders",
    remindersSaved: "Reminder settings saved",
    cupAdded: "Cup added",
    cupUpdated: "Cup updated",
    cupDeleted: "Cup deleted",
    clickToEdit: "Click to edit time",
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  },
};

/** 获取 i18n 文本 */
let currentLang = "zh";
export function setLang(lang) { currentLang = lang; }
export function getLang() { return currentLang; }
export function t(key, langOverride) {
  const lang = langOverride || currentLang;
  const dict = I18N[lang] || I18N.zh;
  return dict[key] || I18N.zh[key] || key;
}

// ========== 音效（Web Audio API，无需外部文件）==========
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

/** 播放水滴音效 */
export function playWaterSound() {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    // 短促高频 → 模拟水滴
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch (e) { /* 音效播放失败不影响功能 */ }
}

/** 震动反馈（移动端） */
export function vibrate(ms = 30) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (e) { /* */ }
}

/** 播放水杯完成音效（更欢快） */
export function playCompleteSound() {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    [600, 800, 1000].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      const t = now + i * 0.1;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
      osc.start(t);
      osc.stop(t + 0.15);
    });
  } catch (e) { /* */ }
}
