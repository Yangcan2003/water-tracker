// ========== GET /api/admin/users/:uid — 单个用户详情 ==========
import { initializeApp } from "@ljoukov/firebase-admin-cloudflare/app";
import { getFirestore } from "@ljoukov/firebase-admin-cloudflare/firestore";

export async function onRequestGet(context) {
  const { env, params } = context;
  const uid = params.uid;

  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return Response.json({ error: "未配置服务账号密钥" }, { status: 500 });
  }

  const app = initializeApp({ serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON });
  const db = getFirestore(app);

  try {
    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return Response.json({ error: "用户不存在" }, { status: 404 });
    }

    const data = userDoc.data();

    // 统计各类型记录总数
    const subCollections = ["waterLogs", "medicineLogs", "supplementLogs", "toiletLogs"];
    const counts = {};
    let lastActive = null;

    await Promise.allSettled(
      subCollections.map(async (coll) => {
        const type = coll.replace("Logs", "");
        try {
          const snap = await db.collection("users").doc(uid).collection(coll).get();
          counts[type] = snap.docs.length;
          // 找最新记录时间
          for (const d of snap.docs) {
            const ts = d.data().recordedAt;
            if (ts) {
              const dt = new Date(ts._seconds * 1000);
              if (!lastActive || dt > lastActive) lastActive = dt;
            }
          }
        } catch (e) {
          counts[type] = 0;
        }
      })
    );

    return Response.json({
      uid,
      profile: {
        email: data.email || "",
        dailyGoal: data.dailyGoal || 2000,
        medicines: data.medicines || [],
        supplements: data.supplements || [],
        avatarType: data.avatarType || "default",
        avatarColor: data.avatarColor || "#168d84",
        avatarUrl: data.avatarUrl || "",
      },
      stats: {
        totalRecords: Object.values(counts).reduce((s, c) => s + c, 0),
        recordCounts: counts,
        lastActive: lastActive ? lastActive.toISOString() : null,
        createdAt: data.createdAt ? new Date(data.createdAt._seconds * 1000).toISOString() : null,
        updatedAt: data.updatedAt ? new Date(data.updatedAt._seconds * 1000).toISOString() : null,
      },
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("[admin/users/uid]", e);
    return Response.json({ error: "获取用户详情失败", detail: e.message }, { status: 500 });
  }
}
