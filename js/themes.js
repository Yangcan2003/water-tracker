export const DEFAULT_THEME = "coral";
export const THEME_CACHE_KEY = "health_tracker_appearance";

// Background, right heart, left heart: each pair contains gradient start/end colors.
export const THEMES = [
  { id: "coral", name: "珊瑚红", nativeIcon: null, colors: ["#fffef9", "#fff7ed", "#ff586f", "#ed254b", "#ff9279", "#ff5065"], accent: "#cc3654", secondary: "#df6876", bg: "#faf6f3", soft: "#fce9ed" },
  { id: "cherry", name: "樱桃红", nativeIcon: "AppIconCherry", colors: ["#fffefe", "#fff8fa", "#f84365", "#c81e47", "#ff6a84", "#e83a60"], accent: "#c5234b", secondary: "#e35b7a", bg: "#faf5f7", soft: "#fbe8ee" },
  { id: "iris", name: "鸢尾蓝", nativeIcon: "AppIconIris", colors: ["#fdfdff", "#f2f5ff", "#5260e8", "#3941c3", "#78adff", "#4b73ef"], accent: "#4655ce", secondary: "#6990e8", bg: "#f5f6fb", soft: "#eaeefd" },
  { id: "jade", name: "翡翠绿", nativeIcon: "AppIconJade", colors: ["#fcfefc", "#f0f7f3", "#159b8c", "#087967", "#66d6b5", "#31b396"], accent: "#087e6d", secondary: "#3aae94", bg: "#f3f8f5", soft: "#e2f3ec" },
  { id: "lilac", name: "雾紫", nativeIcon: "AppIconLilac", colors: ["#fefcff", "#f5f0fa", "#9379c9", "#7056a8", "#c4a9e9", "#a184d4"], accent: "#7956b2", secondary: "#a58acd", bg: "#f7f4fa", soft: "#eee7f8" },
  { id: "midnight", name: "深夜蓝", nativeIcon: "AppIconMidnight", colors: ["#192b47", "#0d1930", "#77aee2", "#527fc7", "#c0e9f7", "#8fc5ed"], accent: "#a6d6fa", secondary: "#7eafe1", bg: "#101c30", soft: "#273b56", dark: true },
  { id: "graphite", name: "石墨灰", nativeIcon: "AppIconGraphite", colors: ["#fdfcf9", "#efede8", "#343842", "#20242d", "#73777e", "#4d5159"], accent: "#4b505b", secondary: "#747a86", bg: "#f5f4f1", soft: "#e8e7e4" },
];

export function getTheme(id) {
  return THEMES.find(theme => theme.id === id) || THEMES[0];
}

export function themeVariables(theme) {
  const dark = !!theme.dark;
  return {
    "--theme-accent": theme.accent, "--theme-secondary": theme.secondary,
    "--theme-soft": theme.soft, "--theme-bg": theme.bg,
    "--theme-surface": dark ? "#1b2a41" : "#ffffff",
    "--theme-text": dark ? "#edf3fc" : "#20232b",
    "--theme-muted": dark ? "#a7b6cb" : "#717681",
    "--theme-line": dark ? "#34445c" : "#e6e7eb",
    "--theme-subtle": dark ? "#24354d" : "#f1f2f5",
    "--theme-hero-start": dark ? "#355d89" : theme.accent,
    "--theme-hero-end": dark ? "#223d65" : theme.secondary,
    "--theme-on-accent": dark ? "#101c30" : "#ffffff",
    "--theme-scheme": dark ? "dark" : "light",
  };
}

export async function commitThemeChange(id, { currentId, setIcon, save, apply }) {
  const theme = THEMES.find(item => item.id === id);
  if (!theme) throw new Error("未知配色");
  if (theme.id === currentId) return false;
  await setIcon(theme);
  try {
    await save(theme.id);
  } catch (error) {
    try { await setIcon(getTheme(currentId)); } catch {
      apply(theme);
      throw new Error("图标已更新，但配色未能保存，请重试。");
    }
    throw error;
  }
  apply(theme);
  return true;
}
