// ========== GET /api/admin/users/:uid — 单个用户详情 ==========
import { getUserDoc, queryLogs, decodeFields } from "../_firestore.js";

export async function onRequestGet(context) {
  const { env, params } = context;
  const uid = params.uid;

  try {
    const user = await getUserDoc(env, uid);

    if (!user) {
      return Response.json({ error: "用户不存在" }, { status: 404 });
    }

    const data = user.fields;

    // 统计各类型记录总数
    const logTypes = ["waterLogs", "medicineLogs", "supplementLogs", "toiletLogs"];
    const counts = {};
    let lastActive = null;

    await Promise.allSettled(
      logTypes.map(async (type) => {
        const key = type.replace("Logs", "");
        try {
          const docs = await queryLogs(env, uid, type, null, null, 1000);
          counts[key] = docs ? docs.length : 0;

          // 找最新记录时间
          if (docs && docs.length > 0) {
            for (const doc of docs) {
              const ts = parseTimestamp(doc.fields?.recordedAt);
              if (ts && (!lastActive || ts > lastActive)) lastActive = ts;
            }
          }
        } catch (e) {
          counts[key] = 0;
        }
      })
    );

    // 解析药物和补剂列表
    const medicines = parseArrayField(data.medicines);
    const supplements = parseArrayField(data.supplements);

    return Response.json(
      {
        uid,
        profile: {
          email: data.email || "",
          dailyGoal: typeof data.dailyGoal === "number" ? data.dailyGoal : 2000,
          medicines,
          supplements,
          avatarType: data.avatarType || "default",
          avatarColor: data.avatarColor || "#168d84",
          avatarUrl: data.avatarUrl || "",
        },
        stats: {
          totalRecords: Object.values(counts).reduce((s, c) => s + c, 0),
          recordCounts: counts,
          lastActive: lastActive ? lastActive.toISOString() : null,
          createdAt: data.createdAt || null,
          updatedAt: data.updatedAt || null,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[admin/users/uid]", e);
    return Response.json({ error: "获取用户详情失败", detail: e.message }, { status: 500 });
  }
}

function parseTimestamp(ts) {
  if (!ts) return null;
  if (typeof ts === "string") return new Date(ts);
  return null;
}

function parseArrayField(field) {
  if (!field) return [];
  // Firestore REST API 中 arrayValue 的结构: { arrayValue: { values: [...] } }
  if (field.arrayValue) {
    return (field.arrayValue.values || []).map((v) => {
      if (v.mapValue) return decodeFields(v.mapValue.fields || {});
      if (v.stringValue !== undefined) return v.stringValue;
      return v;
    });
  }
  // 如果已经是数组
  if (Array.isArray(field)) return field;
  return [];
}
