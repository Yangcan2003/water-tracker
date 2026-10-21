import { actionRecordValues, actionFingerprint, prepareAssistantAction } from "./assistant-actions.js";
import { ASSISTANT_VALUE_TYPES } from "./assistant-protocol.js";
import { toTimeValue } from "./utils.js";

const idOK = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const photoIDs = value => Array.isArray(value) ? value.filter(id => typeof id === "string" && /^[a-f0-9]{64}$/.test(id)).slice(0, 3) : [];
const invalid = error => ({ state: "invalid", error: String(error?.message || error || "保存卡片无效，请重新生成").slice(0, 300) });
function recordDate(record) {
  if (!record?.recordedAt) return null;
  return record.recordedAt.toDate?.() || new Date(record.recordedAt);
}
// Persist only fields shown by the review card, not the full profile, raw
// health snapshot, tokens or image bytes. Target fingerprints remain local.
function targetSnapshot(target) {
  if (!target) return null;
  const { category, record } = target, values = actionRecordValues(category, record);
  let snapshot;
  if (category === "goals") snapshot = { dailyGoal: values.waterGoalMl, nutritionGoal: { weightKg: values.goalWeightKg, ratios: { carbsG: values.carbsRatio, proteinG: values.proteinRatio, fatG: values.fatRatio }, ...(record.nutritionGoal?.daily ? { daily: { fiberG: record.nutritionGoal.daily.fiberG, sodiumMg: record.nutritionGoal.daily.sodiumMg } } : {}) } };
  else if (category === "meal") {
    snapshot = { name: values.name, note: values.note, mealType: values.mealType,
      nutrition: record.nutrition ? Object.fromEntries(Object.entries(values).filter(([key]) => !["name", "note", "mealType"].includes(key))) : null };
  } else snapshot = { ...values };
  if (record.id != null) snapshot.id = record.id;
  if (record.logDate != null) snapshot.logDate = record.logDate;
  if (record.date != null) snapshot.date = record.date;
  if (record.recordedAt) snapshot.recordedAt = recordDate(record).toISOString();
  if (record.deleted) snapshot.deleted = true;
  return { category, date: target.date, record: snapshot, fingerprint: target.fingerprint };
}

export function serializeAssistantProposal(value) {
  try {
    const change = value?.version === 1 ? restoreAssistantProposal(value) : value;
    if (!change || change.state === "invalid") return invalid(change?.error);
    const record = change.after || change.before;
    const values = actionRecordValues(change.category, record) || {};
    const date = recordDate(change.after);
    const stored = { version: 1, state: ["pending", "applying", "applied", "cancelled"].includes(change.state) ? change.state : "pending",
      writeID: change.writeID, photoIds: photoIDs(change.photoIds),
      action: { operation: change.operation, category: change.category, date: change.date, time: date ? toTimeValue(date) : null,
        values: change.operation === "delete" ? {} : Object.fromEntries(Object.entries(values).filter(([key]) => Object.hasOwn(ASSISTANT_VALUE_TYPES, key))) },
      target: targetSnapshot(change.target) };
    const checked = restoreAssistantProposal(stored);
    return checked.state === "invalid" ? checked : stored;
  } catch (error) { return invalid(error); }
}

export function restoreAssistantProposal(value) {
  try {
    if (value?.state === "invalid") return invalid(value.error);
    if (value?.version !== 1 || !idOK(value.writeID)) throw new Error("保存卡片已失效，请重新生成");
    const { action, target } = value;
    const references = new Map();
    if (action?.operation !== "create") {
      if (!target?.record || target.category !== action.category || (action.category !== "goals" && !idOK(target.record.id)) || typeof target.fingerprint !== "string" || target.fingerprint.length > 16000) throw new Error("目标记录无效，请重新生成卡片");
      const clean = targetSnapshot(target);
      if (actionFingerprint(action.category, clean.record) !== target.fingerprint) throw new Error("原记录信息不完整，请重新生成卡片");
      references.set("saved-target", clean);
    } else if (target != null) throw new Error("新增卡片包含无效目标");
    const change = prepareAssistantAction({ ...action, ref: action.operation === "create" ? null : "saved-target" }, { references });
    change.writeID = value.writeID;
    change.restored = true;
    if (change.category === "food" && change.operation === "create") change.after.id = value.writeID;
    change.photoIds = photoIDs(value.photoIds);
    change.state = ["applied", "cancelled"].includes(value.state) ? value.state : "pending";
    return change;
  } catch (error) { return invalid(error); }
}

export function needsProposalRecovery(message) {
  if (message?.actionNotice?.startsWith("已重新生成保存卡片")) return false;
  if (message?.proposals?.length) return message.proposals.every(change => change.state === "invalid");
  return !message?.proposals?.length && /包含待确认的记录变更|未执行的变更重新打开后|未返回保存卡片/.test(message?.actionNotice || "");
}

export function proposalRecoveryQuestion(message, previousQuestion = "") {
  const originalDate = String(message.source || "").match(/—\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  return `请恢复这项记录的保存卡片，供我核对后确认保存。仅整理我已明确要求的变更，不重复新增；核对最新记录，保留原日期和份量，信息不足先问清楚。${originalDate ? `当时读取记录的日期是${originalDate}。` : ""}\n原请求：${String(previousQuestion).slice(0, 400)}\n先前整理的内容：${String(message.content).slice(0, 1200)}`;
}
