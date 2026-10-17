import { Capacitor, registerPlugin } from "@capacitor/core";
import { DEFAULT_THEME, THEME_CACHE_KEY, THEMES, getTheme, commitThemeChange } from "./themes.js";

const Appearance = registerPlugin("Appearance");
let currentId = DEFAULT_THEME;
let busy = false;
let supported = true;
export const currentTheme = () => getTheme(currentId);

function applyTheme(theme) {
  currentId = theme.id;
  document.documentElement.dataset.theme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.bg);
  document.querySelector('link[rel="icon"]')?.setAttribute("href", `icons/themes/${theme.id}/icon-192.svg`);
  document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href", `icons/themes/${theme.id}/apple-touch-icon.png`);
  document.querySelectorAll(".brand-drop").forEach(image => { image.src = `icons/themes/${theme.id}/icon-192.svg`; });
  try { localStorage.setItem(THEME_CACHE_KEY, theme.id); } catch { /* Main settings still persist the selection. */ }
  updateSelection();
  window.dispatchEvent(new CustomEvent("appearance-changed", { detail: theme }));
}

function updateSelection() {
  document.querySelectorAll("[data-theme-choice]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === currentId));
    button.disabled = busy || !supported;
  });
}

export async function initializeAppearance(storage) {
  const grid = document.getElementById("themeChoices");
  const status = document.getElementById("themeStatus");
  const help = document.getElementById("themeHelp");
  const native = Capacitor.getPlatform() === "ios";
  const settings = await storage.getSettings();
  applyTheme(getTheme(settings.theme));
  grid.innerHTML = THEMES.map(theme => `<button type="button" class="theme-choice" data-theme-choice="${theme.id}" aria-pressed="false"><img src="icons/themes/${theme.id}/icon-192.png" width="58" height="58" alt=""/><span>${theme.name}</span><b aria-hidden="true">✓</b></button>`).join("");
  help.textContent = native ? "切换后，App 主题与桌面图标会一起更新。" : "App 主题会立即更新。网页已添加到桌面的图标由系统管理。";
  if (native) {
    try {
      const state = await Appearance.getState();
      supported = state.supported;
      const actual = getTheme(state.theme);
      if (actual.id !== currentId) {
        await storage.updateSettings({ theme: actual.id });
        applyTheme(actual);
      }
      if (!supported) help.textContent = "当前设备不支持切换桌面图标。";
    } catch {
      supported = false;
      status.textContent = "配色功能暂不可用，请重新打开 App 后再试。";
    }
  }
  updateSelection();
  grid.addEventListener("click", async event => {
    const button = event.target.closest("[data-theme-choice]");
    if (!button || busy || !supported || button.dataset.themeChoice === currentId) return;
    busy = true;
    status.textContent = "正在应用配色…";
    grid.setAttribute("aria-busy", "true");
    updateSelection();
    try {
      await commitThemeChange(button.dataset.themeChoice, {
        currentId,
        setIcon: async theme => { if (native) await Appearance.setTheme({ theme: theme.id }); },
        save: async theme => {
          await storage.updateSettings({ theme });
          if ((await storage.getSettings()).theme !== theme) throw new Error("无法保存配色");
        },
        apply: applyTheme,
      });
      status.textContent = `已应用${currentTheme().name}${native ? "，桌面图标已更新" : ""}`;
    } catch (error) {
      status.textContent = `切换未完成：${error.message || "请稍后重试。"}`;
    } finally {
      busy = false;
      grid.setAttribute("aria-busy", "false");
      updateSelection();
    }
  });
}
