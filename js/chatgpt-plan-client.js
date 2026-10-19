import { Capacitor, registerPlugin } from "@capacitor/core";

// Native credentials never cross the bridge. Only state and finished replies do.
export const usesChatGPTPlan = Capacitor.getPlatform() === "ios";
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
  return {
    // The native layer owns its network deadlines, background lease and retry.
    // A WebView wall-clock timer cannot safely govern a suspended native call.
    managesRequestLifetime: true,
    getState: () => plugin.getState(),
    analyzeMeal: (body, signal) => run("analyzeMeal", { body }, signal),
    connect: () => run("connect"),
    disconnect: () => run("disconnect"),
    request: (_, { method = "GET", body, signal } = {}) => method === "GET"
      ? plugin.getState().then(state => ({ providers: [{ id: "openai", configured: state.connected }], ...state }))
      : run("chat", { body }, signal),
  };
}
export const chatGPTPlan = usesChatGPTPlan ? createPlanClient(registerPlugin("ChatGPTPlan")) : null;
