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
