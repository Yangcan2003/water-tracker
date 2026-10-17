import { handleAI } from "./ai-service.js";

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/api/ai") return new Response("Not found", { status: 404 });
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-AI-Task", "Access-Control-Max-Age": "86400" };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const response = await handleAI(request, env);
    const result = new Response(response.body, response);
    for (const [key, value] of Object.entries(headers)) result.headers.set(key, value);
    return result;
  },
};
