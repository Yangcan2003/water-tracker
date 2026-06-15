// ========== Firestore REST API 管理端 Helper ==========
// 使用服务账号 + Web Crypto API 签名 JWT，通过 REST API 访问 Firestore
// 零外部依赖，兼容 Cloudflare Workers / Pages Functions

const PROJECT_ID = "water-e08be";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let cachedToken = null;
let tokenExpiry = 0;

// ── 获取 OAuth2 Access Token ──
async function getAccessToken(sa) {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;

  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/datastore",
  };

  const jwt = await signJWT(header, payload, sa.private_key);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OAuth2 token exchange failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

// ── JWT 签名 (RS256 via Web Crypto API) ──
async function signJWT(header, payload, privateKey) {
  const encoder = new TextEncoder();
  const pemContent = privateKey
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binaryKey = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const encodeSegment = (obj) =>
    btoa(String.fromCharCode(...new Uint8Array(encoder.encode(JSON.stringify(obj)))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    encoder.encode(signingInput)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${signingInput}.${sig}`;
}

// ── 解析服务账号 ──
function parseSA(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error("未配置服务账号密钥 (GOOGLE_SERVICE_ACCOUNT_JSON)");
  }
  return typeof env.GOOGLE_SERVICE_ACCOUNT_JSON === "string"
    ? JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON)
    : env.GOOGLE_SERVICE_ACCOUNT_JSON;
}

// ── Firestore REST API 请求 ──
async function apiRequest(env, path, options = {}) {
  const sa = parseSA(env);
  const token = await getAccessToken(sa);
  const url = path.startsWith("http") ? path : `${FIRESTORE_BASE}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Firestore API error: ${res.status} ${errText.slice(0, 200)}`);
  }

  return res.json();
}

// ── 公共 API ──
// 导出便捷方法和原始请求函数

/** 获取集合下的所有文档 */
export async function listDocuments(env, collectionPath) {
  return apiRequest(env, `/${collectionPath}?pageSize=300`);
}

/** 获取集合下指定文档 */
export async function getDocument(env, collectionPath, docId) {
  return apiRequest(env, `/${collectionPath}/${docId}`);
}

/** 分页列出集合文档 */
export async function listCollection(env, collectionPath, pageSize = 300, pageToken = null) {
  let url = `/${collectionPath}?pageSize=${pageSize}`;
  if (pageToken) url += `&pageToken=${pageToken}`;
  return apiRequest(env, url);
}

/** 列出子集合文档 */
export async function listSubCollection(env, parentPath, subCollection, pageSize = 300) {
  return apiRequest(env, `/${parentPath}/${subCollection}?pageSize=${pageSize}`);
}

/** 结构化查询 (带 where 条件) */
export async function runQuery(env, collectionPath, structuredQuery) {
  const parent = `${FIRESTORE_BASE}/${collectionPath}`;
  const url = `${parent}:runQuery`;
  const sa = parseSA(env);
  const token = await getAccessToken(sa);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ structuredQuery }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Firestore query error: ${res.status} ${errText.slice(0, 200)}`);
  }

  // runQuery 返回 [{document: ...}, {document: ...}, ...]
  const results = await res.json();
  return (results || []).filter((r) => r.document).map((r) => r.document);
}

/** 获取所有用户 */
export async function getAllUsers(env) {
  const data = await listDocuments(env, "users");
  if (!data || !data.documents) return [];
  return data.documents.map((doc) => {
    const fields = doc.fields || {};
    return {
      name: doc.name, // full path: projects/.../documents/users/UID
      uid: doc.name.split("/").pop(),
      fields: decodeFields(fields),
      raw: doc,
    };
  });
}

/** 获取单个用户 */
export async function getUserDoc(env, uid) {
  const doc = await getDocument(env, "users", uid);
  if (!doc) return null;
  return {
    name: doc.name,
    uid: doc.name.split("/").pop(),
    fields: decodeFields(doc.fields || {}),
  };
}

/** 查询子集合记录（带日期过滤） */
export async function queryLogs(env, uid, logType, startDate, endDate, limit = 200) {
  const collectionPath = `users/${uid}/${logType}`;
  const filters = [];

  if (startDate) {
    filters.push({
      fieldFilter: {
        field: { fieldPath: "logDate" },
        op: "GREATER_THAN_OR_EQUAL",
        value: { stringValue: startDate },
      },
    });
  }
  if (endDate) {
    filters.push({
      fieldFilter: {
        field: { fieldPath: "logDate" },
        op: "LESS_THAN_OR_EQUAL",
        value: { stringValue: endDate },
      },
    });
  }

  const orderBy = logType === "workoutLogs"
    ? []
    : [{ field: { fieldPath: "logDate" }, direction: "DESCENDING" }];

  const structuredQuery = {
    from: [{ collectionId: logType }],
    where: filters.length > 0
      ? (filters.length === 1 ? filters[0] : { compositeFilter: { op: "AND", filters } })
      : undefined,
    orderBy: orderBy.length > 0 ? orderBy : undefined,
    limit,
  };

  // Remove undefined fields
  Object.keys(structuredQuery).forEach((k) => {
    if (structuredQuery[k] === undefined) delete structuredQuery[k];
  });

  return runQuery(env, collectionPath, structuredQuery);
}

/** 解析 Firestore REST API 字段值 → 普通 JS 对象 */
export function decodeFields(fields) {
  const obj = {};
  for (const [key, val] of Object.entries(fields)) {
    if (val.stringValue !== undefined) obj[key] = val.stringValue;
    else if (val.integerValue !== undefined) obj[key] = parseInt(val.integerValue, 10);
    else if (val.doubleValue !== undefined) obj[key] = val.doubleValue;
    else if (val.booleanValue !== undefined) obj[key] = val.booleanValue;
    else if (val.timestampValue !== undefined) obj[key] = val.timestampValue; // ISO string
    else if (val.arrayValue) obj[key] = (val.arrayValue.values || []).map((v) => decodeFieldsValue(v));
    else if (val.mapValue) obj[key] = decodeFields(val.mapValue.fields || {});
    else if (val.nullValue !== undefined) obj[key] = null;
    else obj[key] = null;
  }
  return obj;
}

function decodeFieldsValue(val) {
  if (val.stringValue !== undefined) return val.stringValue;
  if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
  if (val.doubleValue !== undefined) return val.doubleValue;
  if (val.booleanValue !== undefined) return val.booleanValue;
  if (val.mapValue) return decodeFields(val.mapValue.fields || {});
  if (val.nullValue !== undefined) return null;
  return null;
}
