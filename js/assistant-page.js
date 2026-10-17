import { esc } from "./utils.js";
import { ASSISTANT_CATEGORIES, assistantHistoryRange, buildHealthContext } from "./assistant-context.js";
import { assistantRequest, checkAborted, DEFAULT_AI_BACKEND } from "./assistant-client.js";
import { chatGPTPlan } from "./chatgpt-plan-client.js";
import { formatAssistantText, awaitAssistantOperation } from "./assistant-ui.js";
import { createAssistantKeyboard } from "./assistant-keyboard.js";
import { createAssistantHistory } from "./assistant-history.js";

const icons = {
  chat: '<path d="M20 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 18 0Z"/><path d="M7 11h.01M11 11h.01M15 11h.01"/>',
  edit: '<path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M16 3l5 5M10 14l1-5 7-7 5 5-7 7-6 1Z"/>',
  arrow: '<path d="M12 19V5m-6 6 6-6 6 6"/>', stop: '<rect x="7" y="7" width="10" height="10" rx="1"/>',
  down: '<path d="m8 10 4 4 4-4"/>', health: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  food: '<path d="M5 3v6m3-6v6M3 3v5a3 3 0 0 0 6 0V3M6 11v10M17 3v18m0-18c-4 2-4 9 0 9h3V3Z"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2"/>',
};
const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const CATEGORIES = ASSISTANT_CATEGORIES.map(item => item.key);
const PROMPTS = [
  ["health", "回顾状态", "请结合我的健康记录，回顾近期状态，区分观察、推测与缺失数据，给出值得关注的变化和两个可以采取的小行动。"],
  ["food", "今天怎么吃", "请结合饮食和身体记录，帮我安排今天的饮食思路。不要臆测热量，信息不足时先问我必要的问题。"],
];

export function createAssistantPage(root, { storage, getUser, login, verifyEmail, plan = chatGPTPlan, request = plan?.request ?? assistantRequest, historyStore = createAssistantHistory() }) {
  const backend = DEFAULT_AI_BACKEND;
  let messages = [], pending = null, busy = false, generation = 0, controller = null;
  let connection = "checking", statusCheck = null, identityGeneration = 0, checkedAt = 0, lastConnectionError = "";
  let planBusy = false, verificationVisible = false, verificationBusy = false, verificationSentAt = 0, progress = "", copyTimer;
  let conversations = [], activeId = null, historyOwner = null, historyReadable = true;
  root.innerHTML = `
    <header class="assistant-toolbar"><button class="assistant-title" id="assistantAccountToggle" type="button" aria-expanded="false" aria-controls="assistantAccountMenu"><strong>健康助手</strong>${svg("down")}</button><div class="assistant-toolbar-actions"><button class="assistant-icon-button" id="assistantHistoryToggle" type="button" aria-label="历史对话" aria-expanded="false" aria-controls="assistantHistoryPanel">${svg("history")}</button><button class="assistant-icon-button" id="assistantNewChat" type="button" aria-label="开始新对话" title="新对话">${svg("edit")}</button></div>
      <section class="assistant-account-menu" id="assistantAccountMenu" aria-label="助手账号" hidden><div class="assistant-menu-heading"><strong>ChatGPT</strong><button class="assistant-icon-button" id="assistantCloseAccount" type="button" aria-label="关闭账号菜单">${svg("close")}</button></div><p id="assistantConnection" role="status">正在检查连接</p><p id="assistantPlanLabel">由 OpenAI 提供</p><button id="assistantConnectPlan" type="button">连接 ChatGPT</button><div id="assistantPlanAccount" hidden><a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">在 ChatGPT 中管理会员</a><button id="assistantDisconnectPlan" type="button">断开连接</button></div><button id="assistantLogin" type="button" hidden>登录 App</button></section>
    </header>
    <section class="assistant-history-panel" id="assistantHistoryPanel" aria-label="历史对话列表" hidden><div class="assistant-menu-heading"><strong>历史对话</strong><button class="assistant-icon-button" id="assistantCloseHistory" type="button" aria-label="关闭历史对话">${svg("close")}</button></div><p class="assistant-history-note">保存在此设备</p><div id="assistantHistoryList"></div></section>
    <div class="assistant-scroll" id="assistantScroll"><section class="assistant-intro" id="assistantIntro" aria-labelledby="assistantHeading"><div class="ai-welcome"><span class="ai-welcome-icon" aria-hidden="true">${svg("chat")}</span><h1 id="assistantHeading">今天感觉怎么样？</h1></div><div class="assistant-suggestions" aria-label="快捷提问">${PROMPTS.map(([icon, label, prompt]) => `<button type="button" data-ai-prompt="${esc(prompt)}">${svg(icon)}<span>${label}</span></button>`).join("")}</div></section><div class="assistant-messages" role="log" aria-label="与助手的对话" aria-live="polite" aria-relevant="additions text"></div><span class="assistant-copy-status" id="assistantCopyStatus" role="status"></span></div>
    <div class="assistant-dock"><div class="assistant-connect-notice" id="assistantConnectNotice" hidden><button type="button" id="assistantConnectInline">连接 ChatGPT <span aria-hidden="true">↗</span></button></div>
      <p class="assistant-history-warning" id="assistantHistoryWarning" role="status" hidden></p><div class="assistant-error" id="assistantError" role="alert" hidden><p id="assistantErrorText"></p><button id="assistantRetry" type="button">重试发送</button></div><div class="assistant-verification" id="assistantVerification" hidden><button type="button" id="assistantVerify">发送验证邮件</button><button type="button" id="assistantCheckEmail">我已验证，重试</button><p id="assistantVerificationStatus" role="status"></p></div>
      <div class="assistant-records-panel" id="assistantRecordsPanel" hidden><strong>健康记录</strong><p>饮水、饮食、训练、身体测量、药物、补剂和如厕记录，会在提问时发送至 OpenAI。</p><div><label for="assistantRange">记录范围</label><select id="assistantRange"><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="all" selected>全部历史</option></select></div><label class="assistant-share"><input type="checkbox" id="assistantShare" checked><span>提问时结合我的健康记录</span></label><p class="assistant-records-note" id="assistantPrivacy">全部历史健康记录将交给 OpenAI</p></div>
      <form class="assistant-composer" novalidate><label class="assistant-sr-only" for="assistantInput">向健康助手提问</label><textarea id="assistantInput" rows="1" maxlength="2000" placeholder="发消息…"></textarea><div class="assistant-composer-bottom"><button class="assistant-records-toggle" id="assistantRecordsToggle" type="button" aria-expanded="false" aria-controls="assistantRecordsPanel">${svg("health")}<span id="assistantRecordsLabel">全部记录</span>${svg("down")}</button><button class="assistant-send" type="button" id="assistantSend" aria-label="发送问题">${svg("arrow")}</button></div></form><div class="assistant-caption"><span id="assistantProgress" role="status">AI 建议仅供参考</span></div>
    </div>`;
  const find = selector => root.querySelector(selector);
  const input = find("#assistantInput"), share = find("#assistantShare"), range = find("#assistantRange"), scroll = find("#assistantScroll"), conversation = find(".assistant-messages");
  function showError(message = "", retry = false) { find("#assistantErrorText").textContent = message; find("#assistantError").hidden = !message; find("#assistantRetry").hidden = !retry; }
  function setProgress(value) { progress = value; find("#assistantProgress").textContent = value || "AI 建议仅供参考"; }
  function resizeInput() { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 144)}px`; }
  function updateControls() {
    const connected = connection === "connected";
    find("#assistantConnection").textContent = connection === "checking" ? "正在检查连接" : connected ? (plan ? "ChatGPT 会员已连接" : "GPT 已连接") : connection === "error" ? "连接暂不可用" : "GPT · 待连接";
    root.dataset.connection = connection; root.dataset.busy = String(busy);
    find("#assistantSend").disabled = planBusy || verificationBusy;
    find("#assistantSend").setAttribute("aria-label", busy ? "停止回答" : "发送问题"); find("#assistantSend").innerHTML = svg(busy ? "stop" : "arrow");
    input.readOnly = busy; share.disabled = busy; range.disabled = busy;
    find("#assistantConnectNotice").hidden = !plan || connected || planBusy || busy;
    find("#assistantConnectPlan").hidden = !plan || connected; find("#assistantPlanAccount").hidden = !plan || !connected; find("#assistantLogin").hidden = !!getUser();
    for (const id of ["assistantConnectPlan", "assistantConnectInline", "assistantDisconnectPlan"]) find(`#${id}`).disabled = busy || planBusy;
    find("#assistantConnectPlan").textContent = planBusy ? "正在连接…" : "连接 ChatGPT";
    find("#assistantVerification").hidden = !verificationVisible;
    find("#assistantVerify").disabled = busy || verificationBusy; find("#assistantCheckEmail").disabled = busy || verificationBusy; find("#assistantNewChat").disabled = planBusy;
    find("#assistantHistoryToggle").disabled = busy || planBusy;
    root.querySelectorAll("[data-ai-prompt]").forEach(button => { button.disabled = busy || planBusy; });
  }
  function renderMessages() {
    const content = [...messages, ...(pending ? [{ role: "user", content: pending.question, state: pending.state }] : [])];
    conversation.innerHTML = content.map((message, index) => `<article class="assistant-message" data-role="${message.role}"><span class="assistant-message-author">${message.role === "user" ? "你" : "健康助手"}</span><div class="assistant-message-content">${message.role === "user" ? esc(message.content) : formatAssistantText(message.content)}</div>${message.state === "failed" ? '<small class="assistant-message-status">未发送完成 · 问题已保留</small>' : ""}${message.source ? `<small class="assistant-message-source">${esc(message.source)}</small>` : ""}${message.role === "assistant" ? `<button class="assistant-copy" type="button" data-copy-answer="${index}" aria-label="复制这条回答">${svg("copy")}<span>复制</span></button>` : ""}</article>`).join("") + (busy && pending ? `<div class="assistant-thinking" role="status"><span class="assistant-thinking-dot"></span><span>${esc(progress || "正在思考")}</span></div>` : "");
    find("#assistantIntro").hidden = content.length > 0;
    keyboard.contentChanged();
  }
  function scrollToEnd() { requestAnimationFrame(() => scroll.scrollTo({ top: scroll.scrollHeight, behavior: "smooth" })); }
  function closePanel(panelID, buttonID) {
    find(`#${panelID}`).hidden = true; find(`#${buttonID}`).setAttribute("aria-expanded", "false");
    if (panelID === "assistantHistoryPanel") { scroll.inert = false; find(".assistant-dock").inert = false; }
  }
  function closePanels() {
    closePanel("assistantRecordsPanel", "assistantRecordsToggle"); closePanel("assistantAccountMenu", "assistantAccountToggle"); closePanel("assistantHistoryPanel", "assistantHistoryToggle");
  }
  function historyWarning(message = "") { find("#assistantHistoryWarning").textContent = message; find("#assistantHistoryWarning").hidden = !message; }
  function renderHistory() {
    find("#assistantHistoryList").innerHTML = conversations.length ? conversations.map(item => {
      const title = item.messages.find(message => message.role === "user")?.content || "健康对话";
      const date = new Date(item.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
      return `<button class="assistant-history-item" type="button" data-conversation="${esc(item.id)}" ${item.id === activeId ? 'aria-current="true"' : ""}><span>${esc(title.slice(0, 60))}</span><small>${esc(date)}</small></button>`;
    }).join("") : '<p class="assistant-history-empty">还没有对话</p>';
  }
  function persistHistory() {
    if (!historyReadable || historyOwner !== getUser()?.uid) return;
    try { historyStore.save(historyOwner, { conversations, activeId }); historyWarning(); }
    catch { historyWarning("对话暂未保存，请保留此页面后重试。"); }
    renderHistory();
  }
  function saveConversation() {
    const content = [...messages, ...(pending ? [{ role: "user", content: pending.question, state: "failed" }] : [])];
    if (!content.length) return;
    const previous = conversations.find(item => item.id === activeId), now = Date.now();
    activeId ||= globalThis.crypto?.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2)}`;
    const current = { id: activeId, createdAt: previous?.createdAt || now, updatedAt: now, shareRecords: share.checked, range: range.value, messages: content };
    conversations = [current, ...conversations.filter(item => item.id !== activeId)]; persistHistory();
  }
  function restoreConversation(item) {
    clearConversation(); activeId = item.id; share.checked = item.shareRecords; range.value = item.range;
    messages = item.messages.map(message => ({ ...message }));
    if (messages.at(-1)?.role === "user") { const last = messages.pop(); pending = { question: last.content, state: "failed" }; showError("上次回答未完成，可以重试。", true); }
    input.value = ""; resizeInput(); updatePrivacy(); renderMessages(); closePanels(); scrollToEnd();
  }
  function clearConversation() {
    generation++; controller?.abort("reset"); controller = null; busy = false; messages = []; pending = null; verificationVisible = false; verificationBusy = false;
    find("#assistantVerificationStatus").textContent = ""; setProgress(""); renderMessages(); updateControls(); showError();
  }
  function updatePrivacy() {
    const label = range.value === "all" ? "全部历史" : `${range.value} 天`;
    find("#assistantRecordsLabel").textContent = share.checked ? (range.value === "all" ? "全部记录" : `近 ${range.value} 天`) : "不带记录";
    find("#assistantRecordsToggle").dataset.enabled = String(share.checked);
    find("#assistantRecordsToggle").setAttribute("aria-label", share.checked ? `健康数据：${label}，点击调整` : "健康数据已关闭，点击调整");
    find("#assistantPrivacy").textContent = share.checked ? `${label}健康记录将交给 OpenAI` : "仅发送对话";
  }
  async function checkConnection({ force = false } = {}) {
    if (statusCheck) return statusCheck.promise;
    if (!force && checkedAt && Date.now() - checkedAt < 30000) return connection === "connected";
    const active = new AbortController(), version = identityGeneration; connection = "checking"; updateControls();
    const timer = setTimeout(() => active.abort("timeout"), 10000);
    const check = { controller: active, promise: null }; statusCheck = check;
    check.promise = (async () => {
      try {
        const result = await awaitAssistantOperation(request(backend, { signal: active.signal }), active.signal);
        if (version !== identityGeneration) return false;
        connection = result.providers?.some(item => item.id === "openai" && item.configured) ? "connected" : "disconnected";
        find("#assistantPlanLabel").textContent = result.account || "由 OpenAI 提供"; lastConnectionError = ""; checkedAt = Date.now(); return connection === "connected";
      } catch (error) { if (version === identityGeneration) { connection = "error"; lastConnectionError = active.signal.aborted ? "连接状态检查超时，请稍后重试。" : error.message || "无法检查助手连接。"; checkedAt = 0; } return false; }
      finally { clearTimeout(timer); if (statusCheck === check) statusCheck = null; updateControls(); }
    })();
    return check.promise;
  }
  async function send(retryQuestion) {
    if (busy) { controller?.abort("user"); return; }
    closePanels();
    if (planBusy || verificationBusy) { showError("请先完成当前连接操作，再发送问题。"); return; }
    const question = (typeof retryQuestion === "string" ? retryQuestion : input.value).trim();
    if (!question) { showError("写下你想问的问题，再点击发送。"); input.focus(); return; }
    if (!getUser()) { showError("请先登录 App，再使用健康助手。"); find("#assistantAccountMenu").hidden = false; updateControls(); return; }
    showError(); const user = getUser(), refreshToken = verificationVisible, version = generation;
    verificationVisible = false; busy = true; controller = new AbortController(); const active = controller, wait = promise => awaitAssistantOperation(promise, active.signal);
    if (pending && pending.question !== question) messages.push({ role: "user", content: pending.question, state: "failed" });
    pending = { question, state: "sending" }; input.value = ""; resizeInput(); saveConversation(); setProgress("正在准备回答…"); updateControls(); renderMessages(); scrollToEnd();
    const timer = setTimeout(() => active.abort("timeout"), 65000);
    try {
      if (!await wait(checkConnection())) throw new Error(lastConnectionError || (plan ? "请先连接 ChatGPT 会员账号。" : "助手尚未接通，请稍后重试。"));
      checkAborted(active.signal); if (version !== generation || getUser()?.uid !== user.uid) return;
      let context = null;
      if (share.checked) {
        setProgress("正在读取健康记录…"); renderMessages();
        const snapshotAt = new Date();
        const [days, profile] = await wait(Promise.all([
          storage.getHistoryRange(assistantHistoryRange(range.value, snapshotAt), { force: true }),
          storage.getProfile({ force: true }),
        ]));
        if (storage.syncStatus.failures.some(item => item.kind === "read")) throw new Error("部分健康记录尚未同步。请稍后重试，或关闭健康记录后提问。");
        checkAborted(active.signal); if (version !== generation || getUser()?.uid !== user.uid) return;
        context = buildHealthContext(days, { rangeDays: range.value === "all" ? "all" : Number(range.value), categories: CATEGORIES, bodyMeasurements: storage.getCachedBodyMeasurements(), profile, compact: true, now: snapshotAt });
      }
      const token = plan ? undefined : await wait(user.getIdToken(refreshToken));
      checkAborted(active.signal); if (version !== generation || getUser()?.uid !== user.uid) return;
      const history = messages.filter(message => message.state !== "failed").slice(-10).map(({ role, content }) => ({ role, content }));
      while (history.reduce((sum, item) => sum + item.content.length, question.length) > 20000) history.splice(0, 2);
      setProgress("正在思考…"); renderMessages();
      const result = await wait(request(backend, { method: "POST", token, signal: active.signal, body: { provider: "openai", messages: [...history, { role: "user", content: question }], shareRecords: share.checked, context } }));
      if (version !== generation || getUser()?.uid !== user.uid) return;
      if (typeof result.reply !== "string" || !result.reply.trim()) throw new Error("暂未收到回答，请重试。");
      const source = context ? `${new Date(context.snapshot.generatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 读取 · ${context.range.startDate} — ${context.range.endDate} · ${context.summarized ? "健康记录摘要" : "健康记录"}` : "";
      messages.push({ role: "user", content: question }, { role: "assistant", content: result.reply.slice(0, 6000), source: [source, result.incomplete || result.reply.length > 6000 ? "回答未完整，可缩小问题继续提问" : ""].filter(Boolean).join(" · ") }); pending = null;
    } catch (error) {
      if (version !== generation) return;
      if (pending) pending.state = "failed";
      if (!input.value) { input.value = question; resizeInput(); }
      verificationVisible = error.code === "EMAIL_VERIFICATION_REQUIRED" && typeof verifyEmail === "function";
      if (plan && error.code === "PLAN_AUTH_REQUIRED") { connection = "disconnected"; checkedAt = 0; }
      showError(active.signal.aborted ? active.signal.reason === "user" ? "已停止回答，问题仍保留在输入框中。" : "等待超时，问题已保留，请重试。" : verificationVisible ? "请先验证 App 登录邮箱，再使用助手。" : error.message || "发送失败，请稍后重试。", !verificationVisible);
    } finally { clearTimeout(timer); if (version === generation) { busy = false; controller = null; saveConversation(); setProgress(""); renderMessages(); updateControls(); scrollToEnd(); } }
  }
  async function connectPlan() {
    if (!plan || busy || planBusy) return;
    if (!getUser()) { login(); return; }
    planBusy = true; showError(); setProgress("请在登录页完成 ChatGPT 授权"); updateControls();
    try { await plan.connect(); checkedAt = 0; await checkConnection({ force: true }); if (connection === "connected") { find("#assistantAccountMenu").hidden = true; find("#assistantAccountToggle").setAttribute("aria-expanded", "false"); } }
    catch (error) { showError(error.message || "ChatGPT 连接未完成，请重试。"); }
    finally { planBusy = false; setProgress(""); updateControls(); }
  }
  async function disconnectPlan() {
    if (!plan || busy || planBusy) return; planBusy = true; updateControls();
    try { const result = await plan.disconnect(); clearConversation(); activeId = null; persistHistory(); connection = "disconnected"; checkedAt = 0; if (result.revoked === false) showError("已在此手机断开。请在 ChatGPT 设置中确认撤销此应用的授权。"); }
    catch (error) { showError(error.message || "暂时无法断开，请重试。"); }
    finally { planBusy = false; updateControls(); }
  }
  async function sendVerification() {
    const user = getUser(), version = generation;
    if (!user || busy || verificationBusy || !verificationVisible) return;
    if (Date.now() - verificationSentAt < 60000) { find("#assistantVerificationStatus").textContent = "验证邮件已发送，请稍后再重发。"; return; }
    verificationBusy = true; updateControls();
    try { await verifyEmail(user); if (version !== generation || getUser()?.uid !== user.uid) return; verificationSentAt = Date.now(); find("#assistantVerificationStatus").textContent = "打开邮件中的验证链接，再点“我已验证，重试”。"; }
    catch { if (version === generation) find("#assistantVerificationStatus").textContent = "邮件发送失败，请稍后重试。"; }
    finally { if (version === generation) { verificationBusy = false; updateControls(); } }
  }
  function togglePanel(panelID, buttonID) {
    const open = find(`#${panelID}`).hidden; closePanels(); find(`#${panelID}`).hidden = !open; find(`#${buttonID}`).setAttribute("aria-expanded", String(open));
    if (panelID === "assistantHistoryPanel") { scroll.inert = open; find(".assistant-dock").inert = open; }
  }
  find("#assistantAccountToggle").addEventListener("click", () => togglePanel("assistantAccountMenu", "assistantAccountToggle"));
  find("#assistantCloseAccount").addEventListener("click", () => { find("#assistantAccountMenu").hidden = true; find("#assistantAccountToggle").setAttribute("aria-expanded", "false"); });
  find("#assistantRecordsToggle").addEventListener("click", () => togglePanel("assistantRecordsPanel", "assistantRecordsToggle"));
  find("#assistantSend").addEventListener("click", () => { void send(); });
  for (const id of ["assistantRetry", "assistantCheckEmail"]) find(`#${id}`).addEventListener("click", () => { void send(pending?.question || input.value); });
  find(".assistant-composer").addEventListener("submit", event => { event.preventDefault(); void send(); });
  input.addEventListener("focus", () => closePanel("assistantRecordsPanel", "assistantRecordsToggle"));
  input.addEventListener("input", () => { resizeInput(); if (!busy) showError(); });
  input.addEventListener("keydown", event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) { event.preventDefault(); void send(); } });
  find("#assistantLogin").addEventListener("click", login);
  for (const id of ["assistantConnectPlan", "assistantConnectInline"]) find(`#${id}`).addEventListener("click", () => { void connectPlan(); });
  find("#assistantDisconnectPlan").addEventListener("click", () => { void disconnectPlan(); });
  find("#assistantVerify").addEventListener("click", () => { void sendVerification(); });
  find("#assistantNewChat").addEventListener("click", () => { saveConversation(); clearConversation(); activeId = null; persistHistory(); closePanels(); input.value = ""; resizeInput(); });
  find("#assistantHistoryToggle").addEventListener("click", () => { input.blur(); renderHistory(); togglePanel("assistantHistoryPanel", "assistantHistoryToggle"); });
  find("#assistantCloseHistory").addEventListener("click", () => closePanel("assistantHistoryPanel", "assistantHistoryToggle"));
  find("#assistantHistoryList").addEventListener("click", event => {
    const button = event.target.closest("[data-conversation]"); if (!button || busy || planBusy) return;
    const item = conversations.find(item => item.id === button.dataset.conversation); if (!item) return;
    restoreConversation(item); persistHistory();
  });
  for (const control of [share, range]) control.addEventListener("change", () => { clearConversation(); activeId = null; persistHistory(); updatePrivacy(); });
  root.addEventListener("click", event => { if (!event.target.closest("#assistantRecordsPanel, #assistantRecordsToggle")) closePanel("assistantRecordsPanel", "assistantRecordsToggle"); });
  root.addEventListener("keydown", event => { if (event.key === "Escape") closePanels(); });
  root.querySelectorAll("[data-ai-prompt]").forEach(button => button.addEventListener("click", () => { input.value = button.dataset.aiPrompt; resizeInput(); input.focus(); }));
  conversation.addEventListener("click", async event => {
    const button = event.target.closest("[data-copy-answer]"); if (!button) return;
    const message = messages[Number(button.dataset.copyAnswer)]; if (!message || message.role !== "assistant") return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(message.content);
      else { const temporary = document.createElement("textarea"); temporary.value = message.content; temporary.className = "assistant-sr-only"; root.append(temporary); temporary.select(); try { if (!document.execCommand("copy")) throw new Error(); } finally { temporary.remove(); } }
      find("#assistantCopyStatus").textContent = "回答已复制";
    } catch { find("#assistantCopyStatus").textContent = "复制失败，可长按回答选择文字"; }
    clearTimeout(copyTimer); copyTimer = setTimeout(() => { find("#assistantCopyStatus").textContent = ""; }, 2500);
  });
  const keyboard = createAssistantKeyboard(root, input, scroll);
  updateControls(); updatePrivacy(); renderMessages();
  return {
    open() { keyboard.open(); resizeInput(); updateControls(); void checkConnection(); },
    close() { keyboard.close(); },
    resetUser() {
      identityGeneration++; statusCheck?.controller.abort(); statusCheck = null; clearConversation(); closePanels(); connection = "checking"; checkedAt = 0; verificationSentAt = 0; input.value = ""; share.checked = true; range.value = "all";
      historyOwner = getUser()?.uid || null; conversations = []; activeId = null; historyReadable = true; historyWarning();
      try { const saved = historyStore.load(historyOwner); conversations = saved.conversations; activeId = saved.activeId; const active = conversations.find(item => item.id === activeId); if (active) restoreConversation(active); }
      catch { historyReadable = false; historyWarning("历史对话暂时无法读取，现有记录已保留。"); }
      resizeInput(); updatePrivacy(); renderHistory(); updateControls();
    },
  };
}
