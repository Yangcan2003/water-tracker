// ========== GET /api/admin/users/:uid/records — 用户所有记录聚合 ==========
import { initializeApp } from "@ljoukov/firebase-admin-cloudflare/app";
import { getFirestore } from "@ljoukov/firebase-admin-cloudflare/firestore";

export async function onRequestGet(context) {
  const { env, params, request } = context;
  const uid = params.uid;

  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return Response.json({ error: "未配置服务账号密钥" }, { status: 500 });
  }

  const app = initializeApp({ serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON });
  const db = getFirestore(app);

  try {
    const url = new URL(request.url);
    const today = new Date();
    const defaultStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    // 默认 30 天前
    const d30 = new Date(today);
    d30.setDate(d30.getDate() - 30);
    const defaultEnd = `${d30.getFullYear()}-${String(d30.getMonth() + 1).padStart(2, "0")}-${String(d30.getDate()).padStart(2, "0")}`;

    const startDate = url.searchParams.get("startDate") || defaultEnd;
    const endDate = url.searchParams.get("endDate") || defaultStart;

    // 验证用户存在
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      return Response.json({ error: "用户不存在" }, { status: 404 });
    }

    // 并行查询所有子集合
    const recordTypes = [
      { key: "water", coll: "waterLogs" },
      { key: "medicine", coll: "medicineLogs" },
      { key: "supplement", coll: "supplementLogs" },
      { key: "toilet", coll: "toiletLogs" },
    ];

    const results = await Promise.allSettled(
      recordTypes.map(async ({ key, coll }) => {
        try {
          const snap = await db.collection("users").doc(uid).collection(coll)
            .where("logDate", ">=", startDate)
            .where("logDate", "<=", endDate)
            .orderBy("logDate", "desc")
            .get();

          return {
            key,
            records: snap.docs.map(d => {
              const r = d.data();
              return {
                id: d.id,
                ...r,
                recordedAt: r.recordedAt
                  ? new Date(r.recordedAt._seconds * 1000).toISOString()
                  : null,
              };
            }),
          };
        } catch (e) {
          return { key, records: [], error: e.message };
        }
      })
    );

    // 查询健身日
    let workoutRecords = [];
    try {
      const workoutSnap = await db.collection("users").doc(uid).collection("workoutLogs").get();
      workoutRecords = workoutSnap.docs
        .filter(d => d.id >= startDate && d.id <= endDate && d.data().isWorkout === true)
        .map(d => ({
          id: d.id,
          dateKey: d.id,
          isWorkout: true,
          updatedAt: d.data().updatedAt
            ? new Date(d.data().updatedAt._seconds * 1000).toISOString()
            : null,
        }));
    } catch (e) { /* 跳过 */ }

    const records = {};
    for (const r of results) {
      if (r.status === "fulfilled") {
        records[r.value.key] = r.value.records;
      } else {
        records[r.value?.key || "unknown"] = [];
      }
    }
    records.workout = workoutRecords;

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

    return Response.json({
      uid,
      dateRange: { start: startDate, end: endDate },
      records,
      grouped,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("[admin/users/uid/records]", e);
    return Response.json({ error: "获取用户记录失败", detail: e.message }, { status: 500 });
  }
}
