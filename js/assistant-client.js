import { Capacitor, CapacitorHttp } from "@capacitor/core";

export const DEFAULT_AI_BACKEND = typeof __AI_BACKEND_URL__ === "string" ? __AI_BACKEND_URL__ : "";
export function checkAborted(signal) { if (signal?.aborted) throw new DOMException("请求已取消", "AbortError"); }
export function normalizeBackend(value) {
  if (!String(value || "").trim()) return "";
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error("请输入完整的 HTTPS 服务地址"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["/", "/api/ai", "/api/ai/"].includes(url.pathname)) throw new Error("请填写你信任的 HTTPS 后端域名，不要填写密钥或模型厂商地址");
  return url.origin;
}

export async function assistantRequest(backend, { method = "GET", token, body, signal } = {}) {
  const origin = normalizeBackend(backend);
  if (!origin && Capacitor.isNativePlatform()) throw new Error("助手暂时无法使用，请稍后重试。");
  const url = `${origin}/api/ai`;
  const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body?.task === "meal-nutrition" ? { "X-AI-Task": "meal-nutrition" } : {}) };
  let status, data;
  if (Capacitor.isNativePlatform()) {
    checkAborted(signal);
    const response = await CapacitorHttp.request({ url, method, headers, ...(body ? { data: body } : {}), responseType: "json", connectTimeout: 10000, readTimeout: method === "GET" ? 10000 : 60000, disableRedirects: true });
    checkAborted(signal);
    status = response.status; data = response.data;
  } else {
    const response = await fetch(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal, cache: "no-store", credentials: "omit", redirect: "error" });
    status = response.status;
    try { data = await response.json(); } catch { throw new Error("助手暂时无法使用，请稍后重试。"); }
  }
  if (status < 200 || status >= 300) throw Object.assign(new Error(typeof data?.error === "string" ? data.error : "助手服务暂不可用，请稍后重试"), { status, code: data?.code === "EMAIL_VERIFICATION_REQUIRED" ? data.code : undefined });
  if (!data || typeof data !== "object") throw new Error("助手接口返回格式无效");
  return data;
}
