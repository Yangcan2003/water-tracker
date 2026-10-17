import { handleAI } from "../../server/ai-service.js";
export const onRequest = ({ request, env }) => handleAI(request, env);
