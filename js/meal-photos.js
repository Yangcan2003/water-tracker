// Food photos live in IndexedDB so they do not exhaust the small localStorage quota.
export class MealPhotoStore {
  async open() {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open("health-tracker-meal-photos", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("photos");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error("无法保存食物图片，请检查设备存储空间后重试"));
      }).catch(error => { this.database = null; throw error; });
    }
    return this.database;
  }

  async put(photos) {
    if (!photos.length) return [];
    const ids = await Promise.all(photos.map(async photo => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(photo));
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    }));
    const db = await this.open();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("photos", "readwrite");
      photos.forEach((photo, index) => transaction.objectStore("photos").put(photo, ids[index]));
      transaction.oncomplete = resolve;
      transaction.onabort = transaction.onerror = () => reject(new Error("食物图片未保存，请释放设备空间后重试"));
    });
    return ids;
  }

  async get(ids = []) {
    if (!ids.length) return [];
    const db = await this.open();
    return Promise.all(ids.map(id => new Promise((resolve, reject) => {
      const request = db.transaction("photos").objectStore("photos").get(id);
      request.onsuccess = () => request.result ? resolve(request.result) : reject(new Error("食物图片暂时无法读取，请联网同步后重试"));
      request.onerror = () => reject(request.error);
    })));
  }
}
