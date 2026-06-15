// ========== GET /api/admin/dashboard — 聚合统计 ==========
import { initializeApp } from "@ljoukov/firebase-admin-cloudflare/app";
import { getFirestore } from "@ljoukov/firebase-admin-cloudflare/firestore";

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return Response.json({ error: "未配置服务账号密钥" }, { status: 500 });
  }

  const app = initializeApp({ serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON });
  const db = getFirestore(app);

  try {
    // 1. 获取所有用户
    const usersSnap = await db.collection("users").get();
    const totalUsers = usersSnap.docs.length;
    const userDocs = usersSnap.docs;

    // 2. 构建最近 14 天的日期键
    const today = new Date();
    const dateKeys = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dateKeys.push(dk);
    }

    // 初始化统计
    const dailyStats = {};
    for (const dk of dateKeys) {
      dailyStats[dk] = { water: 0, medicine: 0, supplement: 0, toilet: 0, workout: 0, users: new Set() };
    }

    // 3. 遍历每个用户，统计近 14 天的记录
    // 限制最多查询前 50 个用户以保证性能
    const usersToQuery = userDocs.slice(0, 50);
    const subCollections = ["waterLogs", "medicineLogs", "supplementLogs", "toiletLogs"];

    await Promise.allSettled(
      usersToQuery.map(async (userDoc) => {
        const uid = userDoc.id;
        for (const dk of dateKeys) {
          try {
            const results = await Promise.allSettled([
              db.collection("users").doc(uid).collection("waterLogs").where("logDate", "==", dk).get(),
              db.collection("users").doc(uid).collection("medicineLogs").where("logDate", "==", dk).get(),
              db.collection("users").doc(uid).collection("supplementLogs").where("logDate", "==", dk).get(),
              db.collection("users").doc(uid).collection("toiletLogs").where("logDate", "==", dk).get(),
              db.collection("users").doc(uid).collection("workoutLogs").doc(dk).get(),
            ]);

            const [waterSnap, medSnap, suppSnap, toiletSnap, workoutSnap] = results;

            if (waterSnap.status === "fulfilled") dailyStats[dk].water += waterSnap.value.docs.length;
            if (medSnap.status === "fulfilled") dailyStats[dk].medicine += medSnap.value.docs.length;
            if (suppSnap.status === "fulfilled") dailyStats[dk].supplement += suppSnap.value.docs.length;
            if (toiletSnap.status === "fulfilled") dailyStats[dk].toilet += toiletSnap.value.docs.length;
            if (workoutSnap.status === "fulfilled" && workoutSnap.value.exists) dailyStats[dk].workout += 1;

            // 如果当天有任何记录，标记用户活跃
            const hasActivity = [
              waterSnap, medSnap, suppSnap, toiletSnap,
            ].some(r => r.status === "fulfilled" && r.value.docs.length > 0) ||
            (workoutSnap.status === "fulfilled" && workoutSnap.value.exists);

            if (hasActivity) dailyStats[dk].users.add(uid);
          } catch (e) { /* 跳过单个用户/日期的错误 */ }
        }
      })
    );

    // 4. 汇总
    const last7Keys = dateKeys.slice(-7);
    const recentActivity = last7Keys.map(dk => ({
      date: dk,
      waterCount: dailyStats[dk].water,
      medicineCount: dailyStats[dk].medicine,
      supplementCount: dailyStats[dk].supplement,
      toiletCount: dailyStats[dk].toilet,
      workoutCount: dailyStats[dk].workout,
      activeUsers: dailyStats[dk].users.size,
    }));

    const totalWater7d = last7Keys.reduce((s, dk) => s + dailyStats[dk].water, 0);
    const totalMedicine7d = last7Keys.reduce((s, dk) => s + dailyStats[dk].medicine, 0);
    const totalSupplement7d = last7Keys.reduce((s, dk) => s + dailyStats[dk].supplement, 0);
    const totalToilet7d = last7Keys.reduce((s, dk) => s + dailyStats[dk].toilet, 0);
    const totalWorkout7d = last7Keys.reduce((s, dk) => s + dailyStats[dk].workout, 0);

    // 计算 7 天活跃用户
    const activeUsers7d = new Set();
    last7Keys.forEach(dk => dailyStats[dk].users.forEach(u => activeUsers7d.add(u)));

    return Response.json({
      totalUsers,
      activeUsers7d: activeUsers7d.size,
      totalWaterLogs7d: totalWater7d,
      totalMedicineLogs7d: totalMedicine7d,
      totalSupplementLogs7d: totalSupplement7d,
      totalToiletLogs7d: totalToilet7d,
      totalWorkoutLogs7d: totalWorkout7d,
      recentActivity,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("[admin/dashboard]", e);
    return Response.json({ error: "获取统计数据失败", detail: e.message }, { status: 500 });
  }
}
