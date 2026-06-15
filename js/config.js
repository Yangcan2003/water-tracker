// ========== Firebase 配置 ==========
// 优先从 /api/config 获取（Cloudflare Pages），失败回退到硬编码
export async function getFirebaseConfig() {
  try {
    const res = await fetch("/api/config");
    if (res.ok) return await res.json();
  } catch (e) { /* 降级到硬编码 */ }
  return {
    apiKey: "AIzaSyBkOLTe2i-uBAea4TD_nMYvIQuXkBw2LOE",
    authDomain: "water-e08be.firebaseapp.com",
    projectId: "water-e08be",
    storageBucket: "water-e08be.firebasestorage.app",
    messagingSenderId: "176629809438",
    appId: "1:176629809438:web:475d4b652c6a2b607d090f",
  };
}

// ========== 常量 ==========
export const AVATAR_COLORS = ["#168d84","#d84f46","#428fcb","#e8923f","#8b5cf6","#ec4899","#14b8a6","#6366f1","#f43f5e","#0ea5e9"];

export const DEFAULT_MEDICINES = [
  { name: "EVA", dosage: "1粒/次", targetCount: 2, schedule: "everyday", emoji: "💚" },
];

export const DEFAULT_SUPPLEMENTS = [
  { name: "维生素C", dosage: "1片/次", targetCount: 1, schedule: "weekday", emoji: "🍊" },
  { name: "维生素B2", dosage: "1片/次", targetCount: 1, schedule: "weekday", emoji: "💛" },
  { name: "维生素B6", dosage: "1片/次", targetCount: 1, schedule: "weekday", emoji: "💛" },
  { name: "鱼油", dosage: "1粒/次", targetCount: 1, schedule: "weekday", emoji: "🐟" },
  { name: "镁", dosage: "1粒/次", targetCount: 1, schedule: "everyday", emoji: "🔵" },
  { name: "锌片", dosage: "1粒/次", targetCount: 1, schedule: "workout", emoji: "🔋" },
  { name: "肌酸", dosage: "5g/次", targetCount: 1, schedule: "workout", emoji: "💪" },
];

// 本地存储键名
export const LS_KEY = "health_tracker_data";
