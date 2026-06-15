// ========== GET /api/admin/users — 用户列表（搜索 + 分页）==========
import { initializeApp } from "@ljoukov/firebase-admin-cloudflare/app";
import { getFirestore } from "@ljoukov/firebase-admin-cloudflare/firestore";

export async function onRequestGet(context) {
  const { env, request } = context;

  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return Response.json({ error: "未配置服务账号密钥" }, { status: 500 });
  }

  const app = initializeApp({ serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON });
  const db = getFirestore(app);

  try {
    const url = new URL(request.url);
    const search = (url.searchParams.get("search") || "").toLowerCase().trim();
    const pageSize = Math.min(parseInt(url.searchParams.get("pageSize")) || 20, 100);

    // 获取所有用户文档
    const usersSnap = await db.collection("users").get();
    let users = usersSnap.docs.map(doc => {
      const data = doc.data();
      return {
        uid: doc.id,
        email: data.email || "",
        dailyGoal: data.dailyGoal || 2000,
        createdAt: data.createdAt ? new Date(data.createdAt._seconds * 1000).toISOString() : null,
        updatedAt: data.updatedAt ? new Date(data.updatedAt._seconds * 1000).toISOString() : null,
        avatarType: data.avatarType || "default",
      };
    });

    // 客户端搜索过滤（Firestore REST API 不支持模糊搜索）
    if (search) {
      users = users.filter(u => u.email.toLowerCase().includes(search) || u.uid.includes(search));
    }

    const totalCount = users.length;

    // 简单分页（客户端分页，数据量小时足够）
    const page = parseInt(url.searchParams.get("page")) || 0;
    const start = page * pageSize;
    const paged = users.slice(start, start + pageSize);

    // 为每个用户附加简要统计
    const enriched = await Promise.allSettled(
      paged.map(async (u) => {
        try {
          // 获取最近活跃日期和各类型记录总数
          const subCollections = ["waterLogs", "medicineLogs", "supplementLogs", "toiletLogs"];
          const counts = { water: 0, medicine: 0, supplement: 0, toilet: 0 };
          let lastActive = null;

          for (const coll of subCollections) {
            try {
              const snap = await db.collection("users").doc(u.uid).collection(coll)
                .orderBy("recordedAt", "desc").limit(1).get();
              if (snap.docs.length > 0) {
                const ts = snap.docs[0].data().recordedAt;
                if (ts) {
                  const d = new Date(ts._seconds * 1000);
                  if (!lastActive || d > lastActive) lastActive = d;
                }
              }
              // 获取总数
              const allSnap = await db.collection("users").doc(u.uid).collection(coll).get();
              counts[coll.replace("Logs", "")] = allSnap.docs.length;
            } catch (e2) { /* 跳过 */ }
          }

          return {
            ...u,
            lastActive: lastActive ? lastActive.toISOString().slice(0, 10) : null,
            totalRecords: counts.water + counts.medicine + counts.supplement + counts.toilet,
            recordCounts: counts,
          };
        } catch (e) {
          return { ...u, lastActive: null, totalRecords: 0, recordCounts: {} };
        }
      })
    );

    const enrichedUsers = enriched.map(r => r.status === "fulfilled" ? r.value : { ...paged[0], lastActive: null, totalRecords: 0 });

    return Response.json({
      users: enrichedUsers,
      totalCount,
      page,
      pageSize,
      hasMore: start + pageSize < totalCount,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("[admin/users]", e);
    return Response.json({ error: "获取用户列表失败", detail: e.message }, { status: 500 });
  }
}
