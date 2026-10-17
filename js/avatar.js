export const AVATAR_SIZE = 384;
export const MAX_AVATAR_FILE_BYTES = 20 * 1024 * 1024;

// Center-crop and store a small JPEG, not the original full-resolution photo.
export function avatarCrop(width, height) {
  const side = Math.min(width, height);
  if (!Number.isFinite(side) || side <= 0) throw new Error("图片尺寸无效");
  return { x: (width - side) / 2, y: (height - side) / 2, side };
}

export async function prepareAvatar(file) {
  if (!file || !file.size) throw new Error("请选择一张图片");
  if (file.size > MAX_AVATAR_FILE_BYTES) throw new Error("图片超过 20 MB，请选择较小的图片");
  if (file.type && !file.type.startsWith("image/")) throw new Error("请选择图片文件");
  try {
    // data: images are already permitted by the app's content security policy.
    // Read only the selected file; no library-wide permission is needed here.
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = url;
    await image.decode();
    const crop = avatarCrop(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = AVATAR_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理这张图片");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
    context.drawImage(image, crop.x, crop.y, crop.side, crop.side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    return canvas.toDataURL("image/jpeg", .82);
  } catch {
    throw new Error("无法读取这张图片，请尝试 JPG 或 PNG 格式");
  }
}
