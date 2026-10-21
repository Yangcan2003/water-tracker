import { serializeAssistantProposal } from "./assistant-proposals.js";
// Store only the visible conversation and review cards, never provider credentials or the health
// context payload. Accounts have separate histories on this device.
const prefix = "health_tracker_assistant_history:";
export function normalizeAssistantHistory(value) {
  const conversations = (Array.isArray(value?.conversations) ? value.conversations : []).filter(item =>
    item && typeof item.id === "string" && Number.isFinite(item.updatedAt) && Array.isArray(item.messages)
  ).map(item => ({
    id: item.id, createdAt: Number.isFinite(item.createdAt) ? item.createdAt : item.updatedAt,
    updatedAt: item.updatedAt, shareRecords: item.shareRecords !== false,
    range: ["7", "30", "all"].includes(item.range) ? item.range : "all",
    messages: item.messages.filter(message => ["user", "assistant"].includes(message?.role) && typeof message.content === "string" && message.content.trim()).map(message => ({
      role: message.role, content: message.content.slice(0, message.role === "user" ? 2000 : 6000),
      ...(message.role === "assistant" && typeof message.source === "string" ? { source: message.source.slice(0, 300) } : {}),
      ...(message.role === "assistant" && typeof message.reasoningSummary === "string" && message.reasoningSummary ? { reasoningSummary: message.reasoningSummary.slice(0, 4000) } : {}),
      ...(message.role === "user" && message.state === "failed" ? { state: "failed" } : {}),
      ...(message.role === "user" && Array.isArray(message.photoIds) ? { photoIds: message.photoIds.filter(id => typeof id === "string" && /^[a-f0-9]{64}$/.test(id)).slice(0, 3) } : {}),
      ...(message.role === "assistant" && typeof message.actionNotice === "string" ? { actionNotice: message.actionNotice.slice(0, 1200) } : {}),
      ...(message.role === "assistant" && Array.isArray(message.proposals) && message.proposals.length ? { proposals: message.proposals.slice(0, 8).map(serializeAssistantProposal) } : {}),
    })),
  })).filter(item => item.messages.length).sort((a, b) => b.updatedAt - a.updatedAt);
  return { conversations, activeId: conversations.some(item => item.id === value?.activeId) ? value.activeId : null };
}

export function createAssistantHistory(persistence = globalThis.localStorage) {
  const key = uid => `${prefix}${encodeURIComponent(uid)}`;
  return {
    load(uid) {
      if (!uid) return normalizeAssistantHistory(null);
      const raw = persistence.getItem(key(uid));
      return normalizeAssistantHistory(raw ? JSON.parse(raw) : null);
    },
    save(uid, state) {
      if (!uid) return;
      persistence.setItem(key(uid), JSON.stringify(normalizeAssistantHistory(state)));
    },
  };
}
