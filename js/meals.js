import { fromDateKey, toTimeValue } from "./utils.js";

export const MAX_MEAL_PHOTOS = 3;
export const MAX_MEAL_PHOTO_LENGTH = 180000;

// Lock the default at the first actual photo/text entry, not when Save is pressed.
export class MealTimeDraft {
  constructor(dateKey, existingDate = null, now = new Date()) {
    this.dateKey = dateKey;
    this.time = toTimeValue(existingDate || now);
    this.captured = Boolean(existingDate);
    this.manual = false;
  }
  capture(now = new Date()) {
    if (this.captured || this.manual) return;
    this.time = toTimeValue(now);
    this.captured = true;
  }
  setTime(time) { this.time = time; this.manual = true; }
  get recordedAt() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(this.time)) throw new Error("请选择有效的吃饭时间");
    const date = fromDateKey(this.dateKey);
    const [hours, minutes] = this.time.split(":").map(Number);
    date.setHours(hours, minutes, 0, 0);
    return date;
  }
}

export function mealImageSize(width, height, maxSide = 1200) {
  if (!(width > 0 && height > 0)) throw new Error("图片尺寸无效");
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function isMealPhoto(value) {
  return typeof value === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= MAX_MEAL_PHOTO_LENGTH;
}

export async function prepareMealPhoto(file) {
  if (!file?.size || (file.type && !file.type.startsWith("image/"))) throw new Error("请选择食物图片");
  if (file.size > 30 * 1024 * 1024) throw new Error("图片超过 30 MB，请选择较小的图片");
  const url = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("无法读取图片"));
    reader.readAsDataURL(file);
  });
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    const size = mealImageSize(image.naturalWidth, image.naturalHeight);
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理图片");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let photo;
    for (const quality of [.82, .68, .52, .38]) {
      photo = canvas.toDataURL("image/jpeg", quality);
      if (isMealPhoto(photo)) return photo;
    }
    // Preserve the whole frame while reducing unusually detailed photos further.
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.round(canvas.width / 2));
    small.height = Math.max(1, Math.round(canvas.height / 2));
    small.getContext("2d").drawImage(canvas, 0, 0, small.width, small.height);
    photo = small.toDataURL("image/jpeg", .55);
    if (!isMealPhoto(photo)) throw new Error("图片太大");
    return photo;
  } catch {
    throw new Error("无法处理这张图片，请尝试 JPG 或 PNG 格式");
  }
}
