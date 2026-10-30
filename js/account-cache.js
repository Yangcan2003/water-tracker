import { LS_KEY } from "./config.js";

export const accountCacheKey = uid => `${LS_KEY}:account:${encodeURIComponent(uid || "__local__")}`;
const parse = (persistence, key) => {
  const raw = persistence.getItem(key);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
};
const save = (persistence, key, value) => {
  try { persistence.setItem(key, JSON.stringify(value)); }
  catch { throw new Error("设备存储空间不足，账户数据未切换，请释放空间后重试"); }
};

// Keep legacy ownership separate from the mutable current-login hint. A failed
// login or sign-out must not turn a signed-in user's recovery copy into guest data.
export function prepareAccountCache(persistence, user, emptyData) {
  const migratedKey = `${LS_KEY}:scoped-migration`;
  if (!persistence.getItem(migratedKey)) {
    const legacy = parse(persistence, LS_KEY);
    const ownerKey = `${LS_KEY}:legacy-owner`;
    let owner = parse(persistence, ownerKey);
    if (legacy?.profile && legacy?.records && !persistence.getItem(ownerKey)) {
      const lastUser = parse(persistence, "watertracker:lastUser");
      const uid = typeof lastUser?.uid === "string" && lastUser.uid ? lastUser.uid : null;
      const email = typeof lastUser?.email === "string" && lastUser.email ? lastUser.email.toLowerCase() : null;
      owner = { uid, email, guest: !uid && !email };
      save(persistence, ownerKey, owner);
    }
    const ownsLegacy = !!user?.uid && (owner?.uid ? owner.uid === user.uid
      : typeof owner?.email === "string" && owner.email === user.email?.toLowerCase());
    if (legacy?.profile && legacy?.records && (ownsLegacy || owner?.guest === true)) {
      const key = accountCacheKey(ownsLegacy ? user.uid : null);
      if (!persistence.getItem(key)) save(persistence, key, legacy);
      save(persistence, migratedKey, { owner: ownsLegacy ? user.uid : "__local__" });
    }
  }
  if (!user?.uid) return;
  const guestKey = accountCacheKey(null), targetKey = accountCacheKey(user.uid);
  const guest = parse(persistence, guestKey);
  if (!guest) return;
  const hasRows = Object.values(guest.records || {}).some(day => Object.values(day).some(rows => Array.isArray(rows) && rows.length));
  const hasScopedData = ["bodyMeasurements", "fridgeInventories"].some(field => Object.values(guest[field] || {}).some(rows => Object.keys(rows).length));
  const defaults = emptyData();
  const changedPreferences = ["cups", "settings", "reminder"].some(field => guest[field] && JSON.stringify(guest[field]) !== JSON.stringify(defaults[field]));
  if (!hasRows && !hasScopedData && !Object.keys(guest.workoutDetails || {}).length && !Object.keys(guest.pendingUpload || {}).length && !changedPreferences) return;
  const claimKey = `${LS_KEY}:guest-claim`;
  const claim = persistence.getItem(claimKey);
  if (claim && claim !== user.uid) return;
  // Claim first, so interruption between the two writes cannot transfer guest
  // records to a second account. A repeat for this identity is idempotent.
  try { persistence.setItem(claimKey, user.uid); }
  catch { throw new Error("无法保存账户归属，请释放存储空间后重试"); }
  const account = parse(persistence, targetKey);
  const merged = account || emptyData();
  merged.records ||= {};
  for (const [date, day] of Object.entries(guest.records || {})) {
    merged.records[date] ||= {};
    for (const type of ["water", "medicine", "supplement", "toilet", "meal"]) {
      const rows = new Map((day[type] || []).map(row => [row.id, row]));
      for (const row of merged.records[date][type] || []) rows.set(row.id, row);
      merged.records[date][type] = [...rows.values()];
    }
  }
  for (const field of ["workoutDays", "workoutDetails", "pendingUpload"]) merged[field] = { ...guest[field], ...merged[field] };
  for (const field of ["bodyMeasurements", "bodyMeasurementPending", "fridgeInventories", "fridgePending", "recordWrites"]) {
    merged[field] ||= {};
    for (const [scope, values] of Object.entries(guest[field] || {})) merged[field][scope] = { ...values, ...merged[field][scope] };
  }
  if (!account || guest.pendingUpload?.profile) merged.profile = { ...merged.profile, ...guest.profile };
  if (!account) for (const field of ["cups", "settings", "reminder"]) if (guest[field]) merged[field] = guest[field];
  save(persistence, targetKey, merged);
  // Leave a valid empty guest cache; old account data stays in its own key.
  save(persistence, guestKey, emptyData());
  // A later guest session may contain new records for a different login.
  try { persistence.removeItem?.(claimKey); }
  catch { /* Keeping the old claim safely defers the next guest transfer. */ }
}
