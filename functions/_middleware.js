// ========== 全局中间件：CORS + Admin API Key 鉴权 ==========
export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  // 处理 CORS 预检请求
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Requested-With",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // Admin API 鉴权检查
  if (url.pathname.startsWith("/api/admin/")) {
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : url.searchParams.get("key") || "";

    if (!token || token !== env.ADMIN_API_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized", message: "无效的管理员密钥" }), {
        status: 401,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  }

  // 继续执行目标 Function
  const response = await next();

  // 为所有 API 响应添加 CORS 头
  const newHeaders = new Headers(response.headers);
  newHeaders.set("Access-Control-Allow-Origin", "*");
  newHeaders.set("X-Content-Type-Options", "nosniff");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
