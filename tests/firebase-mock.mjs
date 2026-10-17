// In-memory Firebase substitute. Used only by tests, never by the iOS build.
let nextId = 0;
export const mock = { denied: new Set(), cachedReads: new Set(), writes: [], reads: [], queries: [], documents: new Map(), failMealOnce: false };
export const initializeApp = () => ({});
export const getAuth = () => ({});
export const getFirestore = () => ({});
export const initializeFirestore = () => ({});
export const persistentLocalCache = () => ({});
export const persistentSingleTabManager = () => ({});
export const sendEmailVerification = async () => { mock.verificationEmails = (mock.verificationEmails || 0) + 1; };
export const onAuthStateChanged = (_auth, callback) => {
  const notify = () => callback(mock.localMode ? null : { uid: "sync-test", email: "同步测试账户（非真实数据）", getIdToken: async () => "test-auth-token" });
  if (mock.authDelay) setTimeout(notify, mock.authDelay);
  else queueMicrotask(notify);
  if (mock.repeatAuthDelay) setTimeout(notify, mock.repeatAuthDelay);
};
export const createUserWithEmailAndPassword = async () => {};
export const signInWithEmailAndPassword = async () => {};
export const signOut = async () => {};
export const serverTimestamp = () => new Date();
export const collection = (_db, ...parts) => ({ path: parts.join("/") });
export const doc = (db, ...parts) => {
  let path = parts.length ? parts.join("/") : "";
  if (!parts.length) do { path = `${db.path}/test-${++nextId}`; } while (mock.documents.has(path));
  return { path, id: path.split("/").at(-1) };
};
export const where = (...args) => args;
export const documentId = () => "__name__";
export const query = (ref, ...constraints) => ({ ...ref, constraints });
export const queryEqual = (a, b) => a.path === b.path && JSON.stringify(a.constraints || []) === JSON.stringify(b.constraints || []);
const check = (ref, kind) => {
  if (mock.denied.has(ref.path.split("/")[2]) || (kind === "read" && mock.failMealOnce && ref.path.endsWith("/mealLogs"))) {
    mock.failMealOnce = false;
    throw Object.assign(new Error("test permission denied"), { code: "permission-denied" });
  }
};
const snapshot = (path, data) => ({ id: path.split("/").at(-1), data: () => data, exists: () => !!data });
export const getDoc = async ref => {
  mock.reads.push(ref.path);
  const gate = mock.readGate?.(ref);
  if (gate) await gate;
  if (mock.readDelay) await new Promise(resolve => setTimeout(resolve, mock.readDelay));
  check(ref, "read");
  return snapshot(ref.path, mock.documents.get(ref.path));
};
export const getDocs = async ref => {
  mock.reads.push(ref.path);
  const gate = mock.readGate?.(ref);
  if (gate) await gate;
  if (mock.readDelay) await new Promise(resolve => setTimeout(resolve, mock.readDelay));
  check(ref, "read");
  mock.queries.push(ref);
  const entries = [...mock.documents].filter(([path, data]) => path.startsWith(`${ref.path}/`) && (ref.constraints || []).every(([field, op, value]) => {
    const actual = field === "__name__" ? path.split("/").at(-1) : data[field];
    return op === ">=" ? actual >= value : op === "<=" ? actual <= value : actual === value;
  }));
  return { docs: entries.map(([path, data]) => snapshot(path, data)), metadata: { fromCache: mock.cachedReads.has(ref.path.split("/")[2]) } };
};
const mergeDocument = (previous, next) => {
  const result = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    result[key] = value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)
      ? mergeDocument(previous?.[key], value) : value;
  }
  return result;
};
export const setDoc = async (ref, data, options) => {
  if (mock.writeGate) await mock.writeGate;
  if (mock.writeDelay) await new Promise(resolve => setTimeout(resolve, mock.writeDelay));
  check(ref, "write");
  mock.writes.push(ref.path);
  mock.documents.set(ref.path, options?.merge ? mergeDocument(mock.documents.get(ref.path), data) : data);
};
export const deleteDoc = async ref => {
  if (mock.writeGate) await mock.writeGate;
  if (mock.writeDelay) await new Promise(resolve => setTimeout(resolve, mock.writeDelay));
  check(ref, "write");
  mock.writes.push(ref.path);
  mock.documents.delete(ref.path);
};
