// ========== GET /api/admin/users — 用户列表（搜索 + 分页）==========
import { getAllUsers, queryLogs } from "./_firestore.js";

export async function onRequestGet(context) {
  const { env, request } = context;

  try {
    const url = new URL(request.url);
    const search = (url.searchParams.get("search") || "").toLowerCase().trim();
    const pageSize = Math.min(parseInt(url.searchParams.get("pageSize")) || 20, 100);

    // 获取所有用户
    const users = await getAllUsers(env);

    let userList = users.map((u) => ({
      uid: u.uid,
      email: u.fields.email || "",
      dailyGoal: u.fields.dailyGoal || 2000,
      createdAt: u.fields.createdAt || null,
      updatedAt: u.fields.updatedAt || null,
      avatarType: u.fields.avatarType || "default",
    }));

    // 搜索过滤
    if (search) {
      userList = userList.filter(
        (u) => u.email.toLowerCase().includes(search) || u.uid.includes(search)
      );
    }

    const totalCount = userList.length;
    const page = parseInt(url.searchParams.get("page")) || 0;
    const start = page * pageSize;
    const paged = userList.slice(start, start + pageSize);

    // 为每个用户附加简要统计
    const enriched = await Promise.allSettled(
      paged.map(async (u) => {
        try {
          const logTypes = ["waterLogs", "medicineLogs", "supplementLogs", "toiletLogs"];
          const counts = { water: 0, medicine: 0, supplement: 0, toilet: 0 };
          let lastActive = null;

          // 获取每种类型的最近记录和总数
          for (const type of logTypes) {
            try {
              // 获取最近的记录来找 lastActive
              const recentDocs = await queryLogs(env, u.uid, type, null, null, 1);
              if (recentDocs && recentDocs.length > 0) {
                const doc = recentDocs[0];
                const ts = parseFirestoreTimestamp(doc.fields?.recordedAt);
                if (ts && (!lastActive || ts > lastActive)) lastActive = ts;
              }

              // 获取总数（这会很慢，改用 estimate）
              const allDocs = await queryLogs(env, u.uid, type, null, null, 1000);
              const key = type.replace("Logs", "");
              counts[key] = allDocs ? allDocs.length : 0;
            } catch (e2) { /* skip */ }
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

    const enrichedUsers = enriched.map((r) =>
      r.status === "fulfilled"
        ? r.value
        : { email: "", uid: "", dailyGoal: 2000, lastActive: null, totalRecords: 0 }
    );

    return Response.json(
      {
        users: enrichedUsers,
        totalCount,
        page,
        pageSize,
        hasMore: start + pageSize < totalCount,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[admin/users]", e);
    return Response.json({ error: "获取用户列表失败", detail: e.message }, { status: 500 });
  }
}

function parseFirestoreTimestamp(ts) {
  if (!ts) return null;
  if (typeof ts === "string") return new Date(ts);
  if (ts.timestampValue) return new Date(ts.timestampValue);
  return null;
}
