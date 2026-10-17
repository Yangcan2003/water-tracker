import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Share } from "@capacitor/share";

const REMINDER_ID_BASE = 8100;

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

export async function initializeNativePlatform() {
  if (!isNativeApp()) return;
  document.documentElement.classList.add("native-app", `native-${Capacitor.getPlatform()}`);

  await LocalNotifications.addListener("localNotificationActionPerformed", () => {
    window.dispatchEvent(new CustomEvent("water-reminder-opened"));
  });
}

export async function nativeHaptic(kind = "light") {
  if (!isNativeApp()) return false;
  try {
    if (kind === "success") {
      await Haptics.notification({ type: NotificationType.Success });
    } else {
      const style = kind === "medium" ? ImpactStyle.Medium : ImpactStyle.Light;
      await Haptics.impact({ style });
    }
    return true;
  } catch {
    return false;
  }
}

export async function syncNativeReminders(settings) {
  if (!isNativeApp()) return { native: false, granted: false };

  const pending = await LocalNotifications.getPending();
  const managed = pending.notifications.filter(({ id }) => id >= REMINDER_ID_BASE && id < REMINDER_ID_BASE + 100);
  if (managed.length) await LocalNotifications.cancel({ notifications: managed.map(({ id }) => ({ id })) });
  if (!settings.enabled || !settings.times?.length) return { native: true, granted: true };

  let permission = await LocalNotifications.checkPermissions();
  if (permission.display === "prompt") permission = await LocalNotifications.requestPermissions();
  if (permission.display !== "granted") return { native: true, granted: false };

  const notifications = settings.times.map((time, index) => {
    const [hour, minute] = time.split(":").map(Number);
    return {
      id: REMINDER_ID_BASE + index,
      title: "该喝水啦 💧",
      body: "喝一杯水，顺手记录今天的饮水进度。",
      schedule: { on: { hour, minute }, repeats: true },
      extra: { destination: "water" },
    };
  });
  await LocalNotifications.schedule({ notifications });
  return { native: true, granted: true };
}

export async function shareDataBackup(json, filename) {
  if (!isNativeApp()) return "unsupported";
  const file = await Filesystem.writeFile({
    path: filename,
    data: json,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  try {
    await Share.share({
      title: "健康追踪数据备份",
      files: [file.uri],
      dialogTitle: filename,
    });
    return "completed";
  } catch (error) {
    // Capacitor iOS rejects when the user dismisses the share sheet.
    if (error?.message === "Share canceled") return "cancelled";
    throw error;
  }
}
