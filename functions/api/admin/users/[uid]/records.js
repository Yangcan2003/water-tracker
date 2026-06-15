// ========== GET /api/admin/users/:uid/records — 用户所有记录聚合 ==========
import { getUserDoc, queryLogs } from "../../_firestore.js";

export async function onRequestGet(context) {
  const { env, params, request } = context;
  const uid = params.uid;

  try {
    const url = new URL(request.url);
    const today = new Date();
    const defaultEnd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const d30 = new Date(today);
    d30.setDate(d30.getDate() - 30);
    const defaultStart = `${d30.getFullYear()}-${String(d30.getMonth() + 1).padStart(2, "0")}-${String(d30.getDate()).padStart(2, "0")}`;

    const startDate = url.searchParams.get("startDate") || defaultStart;
    const endDate = url.searchParams.get("endDate") || defaultEnd;

    // 验证用户存在
    const user = await getUserDoc(env, uid);
    if (!user) {
      return Response.json({ error: "用户不存在" }, { status: 404 });
    }

    // 并行查询所有子集合
    const logTypes = ["waterLogs", "medicineLogs", "supplementLogs", "toiletLogs", "workoutLogs"];
    const records = {};

    const results = await Promise.allSettled(
      logTypes.map(async (type) => {
        const key = type.replace("Logs", "");
        try {
          const docs = await queryLogs(env, uid, type, startDate, endDate, 500);
          records[key] = (docs || []).map((doc) => {
            const fields = doc.fields || {};
            const obj = {
              id: doc.name ? doc.name.split("/").pop() : "",
            };

            for (const [k, v] of Object.entries(fields)) {
              if (v.stringValue !== undefined) obj[k] = v.stringValue;
              else if (v.integerValue !== undefined) obj[k] = parseInt(v.integerValue, 10);
              else if (v.doubleValue !== undefined) obj[k] = v.doubleValue;
              else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
              else if (v.timestampValue !== undefined) obj[k] = v.timestampValue;
              else if (v.nullValue !== undefined) obj[k] = null;
              else obj[k] = v;
            }

            return obj;
          });
        } catch (e) {
          records[key] = [];
        }
      })
    );

    // 确保所有 key 都有值
    ["water", "medicine", "supplement", "toilet", "workout"].forEach((key) => {
      if (!records[key]) records[key] = [];
    });

    // 按日期分组
    const grouped = {};
    for (const [type, recs] of Object.entries(records)) {
      for (const rec of recs) {
        const dk = rec.logDate || rec.dateKey;
        if (!dk) continue;
        if (!grouped[dk]) grouped[dk] = { water: [], medicine: [], supplement: [], toilet: [], workout: [] };
        if (grouped[dk][type]) grouped[dk][type].push(rec);
      }
    }

    return Response.json(
      {
        uid,
        dateRange: { start: startDate, end: endDate },
        records,
        grouped,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[admin/users/uid/records]", e);
    return Response.json({ error: "获取用户记录失败", detail: e.message }, { status: 500 });
  }
}
