import { Capacitor, registerPlugin } from "@capacitor/core";
import { previewAssistantReply } from "./assistant-stream.js";

// Native credentials never cross the bridge. Only state and finished replies do.
export const usesChatGPTPlan = Capacitor.getPlatform() === "ios";
// Keep JS's bounded JSON text intact across WKWebView. Re-encoding NSNumber
// values in Foundation can expand decimals and incorrectly exceed the budget.
function nativeChatBody(body) {
  if (!body) return body;
  const result = { ...body };
  for (const key of ["context", "actionCatalog"]) {
    if (result[key] != null && typeof result[key] === "object") result[key] = JSON.stringify(result[key]);
  }
  return result;
}
export function createPlanClient(plugin) {
  const run = async (method, options = {}, signal) => {
    if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");
    const cancel = () => { void plugin.cancel().catch(() => {}); };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const result = await plugin[method](options);
      if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");
      return result;
    } finally { signal?.removeEventListener("abort", cancel); }
  };
  const chat = async (body, signal, onProgress) => {
    let listener, listening = true;
    const requestID = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");
      if (onProgress && plugin.addListener) {
        listener = await plugin.addListener("chatProgress", event => {
          if (!listening || signal?.aborted || event.requestID !== requestID) return;
          onProgress({ reply: body?.interactive ? previewAssistantReply(event.text) : String(event.text || "").slice(0, 6000),
            reasoningSummary: typeof event.reasoningSummary === "string" ? event.reasoningSummary.slice(0, 4000) : "" });
        });
      }
      return await run("chat", { body: nativeChatBody(body), ...(listener ? { requestID } : {}) }, signal);
    } finally {
      listening = false;
      if (listener) { try { await listener.remove(); } catch {} }
    }
  };
  return {
    // The native layer owns its network deadlines, background lease and retry.
    // A WebView wall-clock timer cannot safely govern a suspended native call.
    managesRequestLifetime: true,
    getState: () => plugin.getState(),
    analyzeMeal: (body, signal) => run("analyzeMeal", { body }, signal),
    connect: () => run("connect"),
    disconnect: () => run("disconnect"),
    request: (_, { method = "GET", body, signal, onProgress } = {}) => method === "GET"
      ? plugin.getState().then(state => ({ providers: [{ id: "openai", configured: state.connected }], ...state }))
      : chat(body, signal, onProgress),
  };
}
export const chatGPTPlan = usesChatGPTPlan ? createPlanClient(registerPlugin("ChatGPTPlan")) : null;
