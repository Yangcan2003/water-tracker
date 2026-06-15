// ========== GET /api/admin/dashboard — 聚合统计 ==========
import { getAllUsers, queryLogs } from "./_firestore.js";

export async function onRequestGet(context) {
  const { env } = context;

  try {
    // 获取所有用户
    const users = await getAllUsers(env);
    const totalUsers = users.length;

    if (totalUsers === 0) {
      return Response.json({
        totalUsers: 0, activeUsers7d: 0,
        totalWaterLogs7d: 0, totalMedicineLogs7d: 0,
        totalSupplementLogs7d: 0, totalToiletLogs7d: 0,
        totalWorkoutLogs7d: 0, recentActivity: [],
      }, { headers: { "Cache-Control": "no-store" } });
    }

    // 构建最近 14 天的日期键
    const today = new Date();
    const dateKeys = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dateKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }

    // 初始化统计
    const dailyStats = {};
    for (const dk of dateKeys) {
      dailyStats[dk] = { water: 0, medicine: 0, supplement: 0, toilet: 0, workout: 0, users: new Set() };
    }

    // 遍历每个用户，查询近 14 天的记录（限制 50 个用户）
    const usersToQuery = users.slice(0, 50);
    const logTypes = ["waterLogs", "medicineLogs", "supplementLogs", "toiletLogs", "workoutLogs"];

    await Promise.allSettled(
      usersToQuery.map(async (user) => {
        const uid = user.uid;
        for (const dk of dateKeys) {
          try {
            // 并行查询所有日志类型
            const results = await Promise.allSettled(
              logTypes.map((type) => queryLogs(env, uid, type, dk, dk, 50))
            );

            const [waterDocs, medDocs, suppDocs, toiletDocs, workoutDocs] = results;

            if (waterDocs.status === "fulfilled" && Array.isArray(waterDocs.value)) {
              dailyStats[dk].water += waterDocs.value.length;
            }
            if (medDocs.status === "fulfilled" && Array.isArray(medDocs.value)) {
              dailyStats[dk].medicine += medDocs.value.length;
            }
            if (suppDocs.status === "fulfilled" && Array.isArray(suppDocs.value)) {
              dailyStats[dk].supplement += suppDocs.value.length;
            }
            if (toiletDocs.status === "fulfilled" && Array.isArray(toiletDocs.value)) {
              dailyStats[dk].toilet += toiletDocs.value.length;
            }
            if (workoutDocs.status === "fulfilled" && Array.isArray(workoutDocs.value)) {
              dailyStats[dk].workout += workoutDocs.value.length;
            }

            // 如果当天有任何记录，标记用户活跃
            const hasActivity = [
              waterDocs, medDocs, suppDocs, toiletDocs, workoutDocs,
            ].some((r) => r.status === "fulfilled" && Array.isArray(r.value) && r.value.length > 0);

            if (hasActivity) dailyStats[dk].users.add(uid);
          } catch (e) { /* skip */ }
        }
      })
    );

    // 汇总
    const last7Keys = dateKeys.slice(-7);
    const recentActivity = last7Keys.map((dk) => ({
      date: dk,
      waterCount: dailyStats[dk].water,
      medicineCount: dailyStats[dk].medicine,
      supplementCount: dailyStats[dk].supplement,
      toiletCount: dailyStats[dk].toilet,
      workoutCount: dailyStats[dk].workout,
      activeUsers: dailyStats[dk].users.size,
    }));

    const sum = (arr, key) => arr.reduce((s, dk) => s + dailyStats[dk][key], 0);
    const totalWater7d = sum(last7Keys, "water");
    const totalMedicine7d = sum(last7Keys, "medicine");
    const totalSupplement7d = sum(last7Keys, "supplement");
    const totalToilet7d = sum(last7Keys, "toilet");
    const totalWorkout7d = sum(last7Keys, "workout");

    const activeUsers7d = new Set();
    last7Keys.forEach((dk) => dailyStats[dk].users.forEach((u) => activeUsers7d.add(u)));

    return Response.json({
      totalUsers,
      activeUsers7d: activeUsers7d.size,
      totalWaterLogs7d: totalWater7d,
      totalMedicineLogs7d: totalMedicine7d,
      totalSupplementLogs7d: totalSupplement7d,
      totalToiletLogs7d: totalToilet7d,
      totalWorkoutLogs7d: totalWorkout7d,
      recentActivity,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[admin/dashboard]", e);
    return Response.json({ error: "获取统计数据失败", detail: e.message }, { status: 500 });
  }
}
