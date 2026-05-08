// 醫囑管理工具 · Cloudflare Worker 後端
// 提供：LINE OAuth 登入 + Gemini AI 中繼 + JWT Session

const COOKIE_NAME = 'iltc_sess';
const COOKIE_MAX_AGE = 30 * 24 * 3600; // 30 天
const RATE_LIMIT_PER_DAY = 100; // 每使用者每天 AI 呼叫上限

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0] || '*';
    const cors = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      // ── 簡易 IP-based rate limit：每 IP 每分鐘 60 次（DDoS 防護）
      // Cloudflare 本身已有平台層 DDoS 防護，這層只擋一般濫用
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (env.KV && ip !== 'unknown') {
        const minute = Math.floor(Date.now() / 60000);
        const ipKey = `rl:${ip}:${minute}`;
        const count = parseInt((await env.KV.get(ipKey)) || '0', 10);
        if (count >= 60) {
          return safeError(null, cors, 429, '請求過於頻繁，請稍後再試');
        }
        // 不 await，讓計數寫入背景進行
        request.ctx?.waitUntil?.(env.KV.put(ipKey, String(count + 1), { expirationTtl: 120 }));
      }

      const p = url.pathname;
      if (p === '/api/auth/line/start') return lineStart(request, env, cors);
      if (p === '/api/auth/line/callback') return lineCallback(request, env, cors);
      if (p === '/api/auth/google/start') return googleStart(request, env, cors);
      if (p === '/api/auth/google/callback') return googleCallback(request, env, cors);
      if (p === '/api/auth/me') return me(request, env, cors);
      if (p === '/api/auth/logout') return logout(request, env, cors);
      if (p === '/api/ai/chat') return aiChat(request, env, cors);
      if (p === '/api/ai/vision') return aiVision(request, env, cors);
      if (p === '/api/ai/transcribe') return aiTranscribe(request, env, cors);
      if (p === '/api/quota') return quota(request, env, cors);
      if (p === '/api/data') {
        if (request.method === 'GET') return getData(request, env, cors);
        if (request.method === 'PUT') return putData(request, env, cors);
      }
      // === 多照顧者共享：邀請碼相關 ===
      if (p === '/api/share/invite/create' && request.method === 'POST') return shareInviteCreate(request, env, cors);
      if (p === '/api/share/invite/regenerate' && request.method === 'POST') return shareInviteRegenerate(request, env, cors);
      if (p === '/api/share/redeem' && request.method === 'POST') return shareRedeem(request, env, cors);
      if (p === '/api/share/list' && request.method === 'GET') return shareList(request, env, cors);
      if (p === '/api/share/remove' && request.method === 'DELETE') return shareRemove(request, env, cors);
      if (p === '/' || p === '/health') return json({ ok: true, service: 'iltc-backend', version: 'v3.4-sharing-20260509', model: 'gemini-2.5-flash' }, cors);
      return new Response('Not Found', { status: 404, headers: cors });
    } catch (e) {
      return safeError(e, cors, 500);
    }
  }
};

// ==================== 工具 ====================
const json = (obj, cors, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });

// 統一錯誤回應（不暴露內部訊息給使用者，僅在 Worker logs 留下完整錯誤）
const safeError = (e, cors, status = 500, publicMsg = null) => {
  const reqId = crypto.randomUUID().slice(0, 8);
  const msg = e?.message || String(e || 'unknown');
  console.error(`[${reqId}] ${status}`, msg, e?.stack || '');
  const userMsg = publicMsg || (status === 400 ? '請求格式不正確' : status === 401 ? '請重新登入' : status === 413 ? '資料超過大小上限' : status === 429 ? '請稍後再試' : '伺服器發生錯誤，請稍後再試');
  return json({ error: userMsg, request_id: reqId }, cors, status);
};

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const b64urlEncode = (str) => b64url(new TextEncoder().encode(str));
// 回傳「二進位字串」（每 char 一 byte，0-255 範圍）— 用於簽章 bytes
const b64urlDecodeBin = (s) => {
  const pad = s.length % 4; if (pad) s += '='.repeat(4 - pad);
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
};
// 回傳「UTF-8 文字字串」— 用於 JSON payload（修正中文亂碼）
const b64urlDecodeText = (s) => {
  const bin = b64urlDecodeBin(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
};

async function signJWT(payload, secret, expSec = COOKIE_MAX_AGE) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expSec };
  const data = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(body))}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${b64url(sig)}`;
}
async function verifyJWT(token, secret) {
  const [h, p, s] = token.split('.'); if (!h || !p || !s) throw new Error('bad jwt');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sigBytes = Uint8Array.from(b64urlDecodeBin(s), c => c.charCodeAt(0));
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('bad signature');
  const payload = JSON.parse(b64urlDecodeText(p));
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) throw new Error('expired');
  return payload;
}

function getCookie(req, name) {
  const c = req.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function setCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  parts.push('Path=/');
  parts.push('HttpOnly');
  parts.push('Secure');
  parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  return parts.join('; ');
}

async function getUser(req, env) {
  // 優先從 Authorization header 取 token
  const auth = req.headers.get('Authorization') || '';
  let tok = '';
  if (auth.startsWith('Bearer ')) tok = auth.slice(7).trim();
  // 後備：從 cookie 取（相容舊流程）
  if (!tok) tok = getCookie(req, COOKIE_NAME) || '';
  if (!tok) return null;
  try { return await verifyJWT(tok, env.JWT_SECRET); } catch { return null; }
}

// ==================== LINE OAuth ====================
async function lineStart(req, env, cors) {
  // 產生 state（CSRF 保護）
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.LINE_CHANNEL_ID,
    redirect_uri: env.LINE_REDIRECT_URI,
    state,
    scope: 'profile' // 只要 profile 就夠了，不需要 openid / email
  });
  const loginUrl = `https://access.line.me/oauth2/v2.1/authorize?${params}`;
  // state 存在短期 cookie 中用來驗證
  return new Response(null, {
    status: 302,
    headers: {
      'Location': loginUrl,
      'Set-Cookie': setCookie('iltc_oauth_state', state, { maxAge: 600 }),
      ...cors
    }
  });
}

async function lineCallback(req, env, cors) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const savedState = getCookie(req, 'iltc_oauth_state');
  if (!code) throw new Error('缺少 code');
  if (!state || state !== savedState) throw new Error('state 不符，可能是 CSRF 攻擊');

  // 交換 access token
  const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.LINE_REDIRECT_URI,
      client_id: env.LINE_CHANNEL_ID,
      client_secret: env.LINE_CHANNEL_SECRET
    })
  });
  if (!tokenRes.ok) throw new Error('換 token 失敗：' + await tokenRes.text());
  const tokens = await tokenRes.json();

  // 取用戶資料
  const profileRes = await fetch('https://api.line.me/v2/profile', {
    headers: { 'Authorization': `Bearer ${tokens.access_token}` }
  });
  if (!profileRes.ok) throw new Error('取資料失敗');
  const profile = await profileRes.json();

  // 簽發 session JWT
  const sess = await signJWT({
    sub: 'line_' + profile.userId,
    name: profile.displayName,
    pic: profile.pictureUrl || null,
    provider: 'line'
  }, env.JWT_SECRET);

  // 把 token 放在 URL fragment（#t=...）傳給前端，前端存到 localStorage
  // fragment 不會被傳到伺服器 log、不會被跨網域看到
  const frontUrl = (env.FRONTEND_URL || '') + '#t=' + encodeURIComponent(sess);
  return new Response(null, {
    status: 302,
    headers: [
      ['Set-Cookie', setCookie('iltc_oauth_state', '', { maxAge: 0 })],
      ['Location', frontUrl]
    ]
  });
}

// ==================== Google OAuth ====================
async function googleStart(req, env, cors) {
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account'
  });
  const loginUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  return new Response(null, {
    status: 302,
    headers: {
      'Location': loginUrl,
      'Set-Cookie': setCookie('iltc_oauth_state', state, { maxAge: 600 }),
      ...cors
    }
  });
}

async function googleCallback(req, env, cors) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const savedState = getCookie(req, 'iltc_oauth_state');
  if (!code) throw new Error('缺少 code');
  if (!state || state !== savedState) throw new Error('state 不符');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET
    })
  });
  if (!tokenRes.ok) throw new Error('換 token 失敗：' + await tokenRes.text());
  const tokens = await tokenRes.json();

  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { 'Authorization': `Bearer ${tokens.access_token}` }
  });
  if (!profileRes.ok) throw new Error('取資料失敗');
  const profile = await profileRes.json();

  const sess = await signJWT({
    sub: 'google_' + profile.id,
    name: profile.name || profile.email,
    pic: profile.picture || null,
    email: profile.email,
    provider: 'google'
  }, env.JWT_SECRET);

  const frontUrl = (env.FRONTEND_URL || '') + '#t=' + encodeURIComponent(sess);
  return new Response(null, {
    status: 302,
    headers: [
      ['Set-Cookie', setCookie('iltc_oauth_state', '', { maxAge: 0 })],
      ['Location', frontUrl]
    ]
  });
}

async function me(req, env, cors) {
  const u = await getUser(req, env);
  if (!u) return json({ user: null }, cors);
  return json({ user: { id: u.sub, name: u.name, pic: u.pic, provider: u.provider } }, cors);
}

async function logout(req, env, cors) {
  return new Response('{"ok":true}', {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': setCookie(COOKIE_NAME, '', { maxAge: 0 }),
      ...cors
    }
  });
}

// ==================== Rate Limit（用 KV 儲存每日用量） ====================
async function checkAndIncrementQuota(env, userId) {
  if (!env.KV) return { ok: true, used: 0, limit: RATE_LIMIT_PER_DAY }; // 無 KV 就不限制
  const today = new Date().toISOString().slice(0, 10);
  const key = `quota:${userId}:${today}`;
  const used = parseInt((await env.KV.get(key)) || '0', 10);
  if (used >= RATE_LIMIT_PER_DAY) return { ok: false, used, limit: RATE_LIMIT_PER_DAY };
  await env.KV.put(key, String(used + 1), { expirationTtl: 86400 * 2 });
  return { ok: true, used: used + 1, limit: RATE_LIMIT_PER_DAY };
}

// ==================== 資料存取層（Repository）====================
// 所有 D1 SQL 操作集中在此，handler 只呼叫這些函式
// 未來若從 D1 遷移到 Supabase / RDS，只需改寫此區塊
const repo = {
  async ensureSchema(env) {
    if (!env.DB) return;
    try {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_data (user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)`).run();
      // 邀請碼表（一個 patient 同時只有一張 active 的碼，永久有效直到主照顧者「重新產生」）
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS share_invites (
        code TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        patient_name TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      )`).run();
      await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_invites_patient ON share_invites(patient_id, owner_user_id)`).run();
      // 共享關係表（同一 patient 可被分享給最多 5 位）
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS patient_shares (
        patient_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        shared_with_user_id TEXT NOT NULL,
        shared_with_name TEXT,
        owner_name TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (patient_id, shared_with_user_id)
      )`).run();
      await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_shares_user ON patient_shares(shared_with_user_id)`).run();
      await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_shares_owner ON patient_shares(owner_user_id)`).run();
    } catch(e) { console.warn('schema init', e?.message); }
  },
  async getUserData(env, userId) {
    if (!env.DB) throw new Error('DB_NOT_BOUND');
    await repo.ensureSchema(env);
    const row = await env.DB.prepare(`SELECT data, updated_at FROM user_data WHERE user_id = ?`).bind(userId).first();
    if (!row) return null;
    return { data: JSON.parse(row.data), updated_at: row.updated_at };
  },
  async saveUserData(env, userId, data) {
    if (!env.DB) throw new Error('DB_NOT_BOUND');
    await repo.ensureSchema(env);
    const dataStr = JSON.stringify(data || {});
    if (dataStr.length > 5 * 1024 * 1024) throw new Error('DATA_TOO_LARGE');
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO user_data (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
      .bind(userId, dataStr, now).run();
    return now;
  },
  // ===== 邀請碼 =====
  async getActiveInvite(env, patientId, ownerUserId) {
    if (!env.DB) throw new Error('DB_NOT_BOUND');
    return await env.DB.prepare(`SELECT code, patient_id, owner_user_id, patient_name, created_at FROM share_invites WHERE patient_id = ? AND owner_user_id = ? AND active = 1 LIMIT 1`).bind(patientId, ownerUserId).first();
  },
  async createInvite(env, code, patientId, ownerUserId, patientName) {
    if (!env.DB) throw new Error('DB_NOT_BOUND');
    await env.DB.prepare(`INSERT INTO share_invites (code, patient_id, owner_user_id, patient_name, active, created_at) VALUES (?, ?, ?, ?, 1, ?)`)
      .bind(code, patientId, ownerUserId, patientName || '', Date.now()).run();
  },
  async deactivateInvitesForPatient(env, patientId, ownerUserId) {
    if (!env.DB) throw new Error('DB_NOT_BOUND');
    await env.DB.prepare(`UPDATE share_invites SET active = 0 WHERE patient_id = ? AND owner_user_id = ? AND active = 1`).bind(patientId, ownerUserId).run();
  },
  async lookupInvite(env, code) {
    if (!env.DB) throw new Error('DB_NOT_BOUND');
    return await env.DB.prepare(`SELECT code, patient_id, owner_user_id, patient_name, created_at FROM share_invites WHERE code = ? AND active = 1 LIMIT 1`).bind(code).first();
  },
  async codeExists(env, code) {
    if (!env.DB) throw new Error('DB_NOT_BOUND');
    const r = await env.DB.prepare(`SELECT code FROM share_invites WHERE code = ? LIMIT 1`).bind(code).first();
    return !!r;
  },
  // ===== 共享關係 =====
  async addShare(env, patientId, ownerUserId, sharedWithUserId, sharedWithName, ownerName) {
    if (!env.DB) throw new Error('DB_NOT_BOUND');
    await env.DB.prepare(`INSERT OR IGNORE INTO patient_shares (patient_id, owner_user_id, shared_with_user_id, shared_with_name, owner_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(patientId, ownerUserId, sharedWithUserId, sharedWithName || '', ownerName || '', Date.now()).run();
  },
  async removeShare(env, patientId, ownerUserId, sharedWithUserId) {
    if (!env.DB) throw new Error('DB_NOT_BOUND');
    await env.DB.prepare(`DELETE FROM patient_shares WHERE patient_id = ? AND owner_user_id = ? AND shared_with_user_id = ?`)
      .bind(patientId, ownerUserId, sharedWithUserId).run();
  },
  async countSharesForPatient(env, patientId, ownerUserId) {
    if (!env.DB) throw new Error('DB_NOT_BOUND');
    const row = await env.DB.prepare(`SELECT COUNT(*) AS c FROM patient_shares WHERE patient_id = ? AND owner_user_id = ?`).bind(patientId, ownerUserId).first();
    return row?.c || 0;
  },
  async getSharesByOwner(env, ownerUserId) {
    if (!env.DB) throw new Error('DB_NOT_BOUND');
    const rows = await env.DB.prepare(`SELECT patient_id, shared_with_user_id, shared_with_name, created_at FROM patient_shares WHERE owner_user_id = ?`).bind(ownerUserId).all();
    return rows.results || [];
  },
  async getSharesToUser(env, sharedWithUserId) {
    if (!env.DB) throw new Error('DB_NOT_BOUND');
    const rows = await env.DB.prepare(`SELECT patient_id, owner_user_id, owner_name, created_at FROM patient_shares WHERE shared_with_user_id = ?`).bind(sharedWithUserId).all();
    return rows.results || [];
  },
  async getSharesForPatient(env, patientId, ownerUserId) {
    if (!env.DB) throw new Error('DB_NOT_BOUND');
    const rows = await env.DB.prepare(`SELECT shared_with_user_id, shared_with_name, created_at FROM patient_shares WHERE patient_id = ? AND owner_user_id = ?`).bind(patientId, ownerUserId).all();
    return rows.results || [];
  },
  async findShareToUser(env, patientId, sharedWithUserId) {
    if (!env.DB) throw new Error('DB_NOT_BOUND');
    return await env.DB.prepare(`SELECT patient_id, owner_user_id, shared_with_name, owner_name FROM patient_shares WHERE patient_id = ? AND shared_with_user_id = ? LIMIT 1`).bind(patientId, sharedWithUserId).first();
  }
};

// ==================== 共享相關工具 ====================
const SHARE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 32 字元，避開 0/O/1/I 等易混淆
const SHARE_PATIENT_COLLECTION_KEYS = ['vitals', 'medications', 'consultations', 'careLogs', 'preVisitQuestions', 'aiReminders'];
const MAX_CAREGIVERS_PER_PATIENT = 5;

async function genUniqueShareCode(env, len = 6) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const buf = new Uint8Array(len);
    crypto.getRandomValues(buf);
    let code = '';
    for (let i = 0; i < len; i++) code += SHARE_ALPHABET[buf[i] % SHARE_ALPHABET.length];
    if (!(await repo.codeExists(env, code))) return code;
  }
  throw new Error('CODE_GEN_FAILED');
}

// ==================== 雲端資料同步 endpoints ====================
// 把使用者本人 user_data 與「被分享給他」的 patients 資料合併回傳
async function getData(req, env, cors) {
  const u = await getUser(req, env);
  if (!u) return safeError(null, cors, 401);
  try {
    await repo.ensureSchema(env);
    const own = await repo.getUserData(env, u.sub);
    const myData = own?.data || { patients: [], vitals: {}, medications: {}, consultations: {}, careLogs: {}, preVisitQuestions: {}, aiReminders: {} };
    if (!Array.isArray(myData.patients)) myData.patients = [];
    for (const k of SHARE_PATIENT_COLLECTION_KEYS) {
      if (!myData[k] || typeof myData[k] !== 'object') myData[k] = {};
    }

    // 我擁有的患者：標註已被分享給誰
    const sharesByMe = await repo.getSharesByOwner(env, u.sub);
    const sharesByPatient = {};
    for (const s of sharesByMe) {
      (sharesByPatient[s.patient_id] = sharesByPatient[s.patient_id] || []).push({
        userId: s.shared_with_user_id,
        name: s.shared_with_name || ''
      });
    }
    myData.patients = myData.patients.map(p => {
      const list = sharesByPatient[p.id];
      return list ? { ...p, _sharedWith: list } : p;
    });

    // 被分享給我的患者：從 owner 的 user_data 取出該 patient 相關資料注入
    const sharesToMe = await repo.getSharesToUser(env, u.sub);
    const ownerCache = {};
    for (const share of sharesToMe) {
      let ownerObj = ownerCache[share.owner_user_id];
      if (!ownerObj) {
        const r = await repo.getUserData(env, share.owner_user_id);
        ownerObj = r?.data || {};
        ownerCache[share.owner_user_id] = ownerObj;
      }
      const ownerPatient = (ownerObj.patients || []).find(p => p.id === share.patient_id);
      if (!ownerPatient) continue; // owner 已刪除這位患者，跳過

      // 避免重複（極少數情況）
      if (!myData.patients.find(p => p.id === share.patient_id)) {
        myData.patients.push({
          ...ownerPatient,
          _sharedFrom: share.owner_user_id,
          _ownerName: share.owner_name || ''
        });
      }
      // 注入子集合
      for (const k of SHARE_PATIENT_COLLECTION_KEYS) {
        if (ownerObj[k] && ownerObj[k][share.patient_id] !== undefined) {
          myData[k][share.patient_id] = ownerObj[k][share.patient_id];
        }
      }
    }

    return json({ data: myData, updated_at: own?.updated_at || null }, cors);
  } catch (e) {
    if (e?.message === 'DB_NOT_BOUND') return safeError(e, cors, 503, '雲端服務暫不可用');
    return safeError(e, cors, 500);
  }
}

// 寫入時：拆解資料 → 自己擁有的寫到自己 user_data；被分享的 patient 寫回 owner 的 user_data
async function putData(req, env, cors) {
  const u = await getUser(req, env);
  if (!u) return safeError(null, cors, 401);
  let body;
  try { body = await req.json(); } catch { return safeError(null, cors, 400); }
  if (!body || typeof body !== 'object') return safeError(null, cors, 400);
  try {
    await repo.ensureSchema(env);
    const incoming = body.data || {};
    const sharesToMe = await repo.getSharesToUser(env, u.sub);
    const sharedPatientToOwner = {};
    for (const s of sharesToMe) sharedPatientToOwner[s.patient_id] = s.owner_user_id;

    const incomingPatients = Array.isArray(incoming.patients) ? incoming.patients : [];

    // 1) 拆出我自己擁有的部分（過濾掉「被分享」的 patient 與其相關資料）
    const myData = { ...incoming };
    myData.patients = incomingPatients
      .filter(p => !sharedPatientToOwner[p.id])
      .map(p => {
        // 移除前端注入的 metadata（避免存進 DB）
        const { _sharedFrom, _ownerName, _sharedWith, ...rest } = p || {};
        return rest;
      });
    for (const k of SHARE_PATIENT_COLLECTION_KEYS) {
      const sub = {};
      const orig = (incoming[k] && typeof incoming[k] === 'object') ? incoming[k] : {};
      for (const pid of Object.keys(orig)) {
        if (!sharedPatientToOwner[pid]) sub[pid] = orig[pid];
      }
      myData[k] = sub;
    }
    const updated_at = await repo.saveUserData(env, u.sub, myData);

    // 2) 把每個「被分享給我的 patient」寫回 owner 的 user_data
    //    依 owner 分組，每個 owner 讀一次、改一次、存一次
    const groupByOwner = {};
    for (const p of incomingPatients) {
      const ownerId = sharedPatientToOwner[p.id];
      if (!ownerId) continue;
      (groupByOwner[ownerId] = groupByOwner[ownerId] || new Set()).add(p.id);
    }
    // 子集合 keys 也可能含被分享的 patient（即使 patients[] 沒這筆，例如只更新 vitals）
    for (const k of SHARE_PATIENT_COLLECTION_KEYS) {
      const orig = (incoming[k] && typeof incoming[k] === 'object') ? incoming[k] : {};
      for (const pid of Object.keys(orig)) {
        const ownerId = sharedPatientToOwner[pid];
        if (ownerId) (groupByOwner[ownerId] = groupByOwner[ownerId] || new Set()).add(pid);
      }
    }

    for (const [ownerId, pidSet] of Object.entries(groupByOwner)) {
      const r = await repo.getUserData(env, ownerId);
      const ownerObj = r?.data || {};
      if (!Array.isArray(ownerObj.patients)) ownerObj.patients = [];
      for (const k of SHARE_PATIENT_COLLECTION_KEYS) {
        if (!ownerObj[k] || typeof ownerObj[k] !== 'object') ownerObj[k] = {};
      }
      for (const pid of pidSet) {
        const inP = incomingPatients.find(p => p.id === pid);
        if (inP) {
          const { _sharedFrom, _ownerName, _sharedWith, ...clean } = inP;
          const idx = ownerObj.patients.findIndex(p => p.id === pid);
          if (idx >= 0) ownerObj.patients[idx] = clean;
          else ownerObj.patients.push(clean);
        }
        for (const k of SHARE_PATIENT_COLLECTION_KEYS) {
          if (incoming[k] && incoming[k][pid] !== undefined) {
            ownerObj[k][pid] = incoming[k][pid];
          }
        }
      }
      await repo.saveUserData(env, ownerId, ownerObj);
    }

    return json({ ok: true, updated_at }, cors);
  } catch (e) {
    if (e?.message === 'DATA_TOO_LARGE') return safeError(e, cors, 413);
    if (e?.message === 'DB_NOT_BOUND') return safeError(e, cors, 503, '雲端服務暫不可用');
    return safeError(e, cors, 500);
  }
}

// ==================== 共享 API（邀請碼、加入、列表、移除）====================
async function shareInviteCreate(req, env, cors) {
  const u = await getUser(req, env);
  if (!u) return safeError(null, cors, 401);
  let body;
  try { body = await req.json(); } catch { return safeError(null, cors, 400); }
  const patientId = body?.patientId;
  if (!patientId || typeof patientId !== 'string') return safeError(null, cors, 400, 'patientId 必填');
  try {
    await repo.ensureSchema(env);
    const own = await repo.getUserData(env, u.sub);
    const owns = (own?.data?.patients || []).find(p => p.id === patientId);
    if (!owns) return safeError(null, cors, 403, '不是你建立的被照顧者');

    const existing = await repo.getActiveInvite(env, patientId, u.sub);
    if (existing) {
      return json({ code: existing.code, patient_id: patientId, patient_name: existing.patient_name || owns.name || '', reused: true, max_caregivers: MAX_CAREGIVERS_PER_PATIENT }, cors);
    }
    const code = await genUniqueShareCode(env);
    await repo.createInvite(env, code, patientId, u.sub, owns.name || '');
    return json({ code, patient_id: patientId, patient_name: owns.name || '', reused: false, max_caregivers: MAX_CAREGIVERS_PER_PATIENT }, cors);
  } catch (e) {
    if (e?.message === 'DB_NOT_BOUND') return safeError(e, cors, 503, '雲端服務暫不可用');
    return safeError(e, cors, 500);
  }
}

async function shareInviteRegenerate(req, env, cors) {
  const u = await getUser(req, env);
  if (!u) return safeError(null, cors, 401);
  let body;
  try { body = await req.json(); } catch { return safeError(null, cors, 400); }
  const patientId = body?.patientId;
  if (!patientId) return safeError(null, cors, 400);
  try {
    await repo.ensureSchema(env);
    const own = await repo.getUserData(env, u.sub);
    const owns = (own?.data?.patients || []).find(p => p.id === patientId);
    if (!owns) return safeError(null, cors, 403);

    await repo.deactivateInvitesForPatient(env, patientId, u.sub);
    const code = await genUniqueShareCode(env);
    await repo.createInvite(env, code, patientId, u.sub, owns.name || '');
    return json({ code, patient_id: patientId, patient_name: owns.name || '' }, cors);
  } catch (e) {
    if (e?.message === 'DB_NOT_BOUND') return safeError(e, cors, 503, '雲端服務暫不可用');
    return safeError(e, cors, 500);
  }
}

async function shareRedeem(req, env, cors) {
  const u = await getUser(req, env);
  if (!u) return safeError(null, cors, 401);
  let body;
  try { body = await req.json(); } catch { return safeError(null, cors, 400); }
  let code = (body?.code || '').toString().trim().toUpperCase();
  // 過濾非預期字元（只留 alphabet）
  code = code.split('').filter(c => SHARE_ALPHABET.includes(c)).join('');
  if (!code || code.length < 4) return safeError(null, cors, 400, '邀請碼格式錯誤');
  const myName = (body?.myName || u.name || '').toString().slice(0, 50);
  try {
    await repo.ensureSchema(env);
    const inv = await repo.lookupInvite(env, code);
    if (!inv) return safeError(null, cors, 404, '邀請碼無效或已被廢除');
    if (inv.owner_user_id === u.sub) return safeError(null, cors, 400, '不能加入自己建立的被照顧者');

    // 已存在共享關係 → 視為成功（idempotent）
    const existing = await repo.findShareToUser(env, inv.patient_id, u.sub);
    if (existing) {
      return json({ ok: true, patient_id: inv.patient_id, patient_name: inv.patient_name || '', already: true }, cors);
    }

    // 確認上限
    const count = await repo.countSharesForPatient(env, inv.patient_id, inv.owner_user_id);
    if (count >= MAX_CAREGIVERS_PER_PATIENT) {
      return safeError(null, cors, 409, `這位被照顧者已達 ${MAX_CAREGIVERS_PER_PATIENT} 位照顧者上限`);
    }

    // 取得 owner 名字（從 owner user_data 找不到，先放空字串）
    let ownerName = '';
    try {
      const ownerData = await repo.getUserData(env, inv.owner_user_id);
      // user_data JSON 裡通常沒有 owner 顯示名稱，這裡保留空字串，前端用 _ownerName 顯示給被分享者看
    } catch {}
    await repo.addShare(env, inv.patient_id, inv.owner_user_id, u.sub, myName, ownerName);

    return json({ ok: true, patient_id: inv.patient_id, patient_name: inv.patient_name || '', already: false }, cors);
  } catch (e) {
    if (e?.message === 'DB_NOT_BOUND') return safeError(e, cors, 503, '雲端服務暫不可用');
    return safeError(e, cors, 500);
  }
}

async function shareList(req, env, cors) {
  const u = await getUser(req, env);
  if (!u) return safeError(null, cors, 401);
  const url = new URL(req.url);
  const patientId = url.searchParams.get('patientId');
  try {
    await repo.ensureSchema(env);
    if (patientId) {
      // 必須是 owner 才能看共享名單與邀請碼
      const own = await repo.getUserData(env, u.sub);
      const owns = (own?.data?.patients || []).find(p => p.id === patientId);
      if (!owns) return safeError(null, cors, 403);
      const shares = await repo.getSharesForPatient(env, patientId, u.sub);
      const invite = await repo.getActiveInvite(env, patientId, u.sub);
      return json({
        shares,
        invite_code: invite?.code || null,
        max_caregivers: MAX_CAREGIVERS_PER_PATIENT,
        used: shares.length
      }, cors);
    }
    const shared_by_me = await repo.getSharesByOwner(env, u.sub);
    const shared_to_me = await repo.getSharesToUser(env, u.sub);
    return json({ shared_by_me, shared_to_me }, cors);
  } catch (e) {
    if (e?.message === 'DB_NOT_BOUND') return safeError(e, cors, 503, '雲端服務暫不可用');
    return safeError(e, cors, 500);
  }
}

async function shareRemove(req, env, cors) {
  const u = await getUser(req, env);
  if (!u) return safeError(null, cors, 401);
  let body;
  try { body = await req.json(); } catch { return safeError(null, cors, 400); }
  const patientId = body?.patientId;
  let sharedWithUserId = body?.sharedWithUserId;
  if (!patientId) return safeError(null, cors, 400);
  // 沒帶 sharedWithUserId 或是「self」→ 視為被分享者自願退出
  if (!sharedWithUserId || sharedWithUserId === 'self') sharedWithUserId = u.sub;
  try {
    await repo.ensureSchema(env);
    if (sharedWithUserId === u.sub) {
      const target = await repo.findShareToUser(env, patientId, u.sub);
      if (!target) return safeError(null, cors, 404);
      await repo.removeShare(env, patientId, target.owner_user_id, u.sub);
      return json({ ok: true }, cors);
    }
    // 主照顧者移除某位被分享者
    const own = await repo.getUserData(env, u.sub);
    const owns = (own?.data?.patients || []).find(p => p.id === patientId);
    if (!owns) return safeError(null, cors, 403);
    await repo.removeShare(env, patientId, u.sub, sharedWithUserId);
    return json({ ok: true }, cors);
  } catch (e) {
    if (e?.message === 'DB_NOT_BOUND') return safeError(e, cors, 503, '雲端服務暫不可用');
    return safeError(e, cors, 500);
  }
}

async function quota(req, env, cors) {
  const u = await getUser(req, env); if (!u) return safeError(null, cors, 401);
  if (!env.KV) return json({ used: 0, limit: RATE_LIMIT_PER_DAY, unlimited: true }, cors);
  const today = new Date().toISOString().slice(0, 10);
  const used = parseInt((await env.KV.get(`quota:${u.sub}:${today}`)) || '0', 10);
  return json({ used, limit: RATE_LIMIT_PER_DAY }, cors);
}

// ==================== AI Proxy ====================
async function aiChat(req, env, cors) {
  const u = await getUser(req, env);
  if (!u) return safeError(null, cors, 401);
  const q = await checkAndIncrementQuota(env, u.sub);
  if (!q.ok) return json({ error: `今日使用已達 ${q.limit} 次上限，明日重置` }, cors, 429);

  const { system, user } = await req.json();
  if (!user) return json({ error: 'user 欄位必填' }, cors, 400);

  const model = 'gemini-2.5-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: [{ text: user }] }]
    })
  });
  if (!res.ok) { const err = await res.text(); console.error('Gemini API error:', err); return safeError(new Error('AI service error'), cors, 502, 'AI 服務暫時無法使用'); }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return json({ text, quota: q }, cors);
}

async function aiVision(req, env, cors) {
  const u = await getUser(req, env); if (!u) return safeError(null, cors, 401);
  const q = await checkAndIncrementQuota(env, u.sub);
  if (!q.ok) return json({ error: `今日額度已用完（${q.limit} 次）` }, cors, 429);

  const { system, user, imageBase64, mimeType } = await req.json();
  if (!imageBase64) return json({ error: 'imageBase64 欄位必填' }, cors, 400);

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: [{ text: user || '請描述此圖片' }, { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } }] }]
    })
  });
  if (!res.ok) { const err = await res.text(); console.error('Gemini API error:', err); return safeError(new Error('AI service error'), cors, 502, 'AI 服務暫時無法使用'); }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return json({ text, quota: q }, cors);
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const CHUNK = 32768;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function aiTranscribe(req, env, cors) {
  const u = await getUser(req, env); if (!u) return safeError(null, cors, 401);
  const q = await checkAndIncrementQuota(env, u.sub);
  if (!q.ok) return json({ error: `今日額度已用完（${q.limit} 次）` }, cors, 429);

  const ctype = req.headers.get('Content-Type') || '';
  if (!ctype.startsWith('multipart/form-data')) return json({ error: '請用 multipart/form-data 上傳音檔' }, cors, 400);
  const form = await req.formData();
  const file = form.get('audio');
  const mode = form.get('mode') || 'medical';
  const context = (form.get('context') || '').toString().slice(0, 2000); // 可選：被照顧者資訊（病史、用藥）
  const hiQuality = form.get('hi_quality') === '1'; // 切換 Pro 模型
  if (!file || !file.arrayBuffer) return json({ error: '缺少 audio 欄位' }, cors, 400);
  if (file.size > 20 * 1024 * 1024) return json({ error: '音檔超過 20 MB' }, cors, 413);

  const buf = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(buf);

  const ctxBlock = context ? `\n\n【背景資訊，用來提升辨識準確度】\n${context}\n\n特別注意：若聽到的藥名、病名與以上清單相近（例如讀音相似但寫法不同），請優先採用上面列出的正確寫法。` : '';

  const prompt = mode === 'short'
    ? `請將此段語音轉寫為繁體中文。只輸出純文字內容，不加解釋、不要引號。若聽不清楚或沒有聲音請回覆空字串。${ctxBlock}`
    : `你是台灣長照醫療逐字稿專家。請將此段醫療對話完整轉寫為繁體中文逐字稿。
規則：
1. 只輸出純文字逐字稿，不加註解、不加引號、不做摘要
2. 多位說話者以換行分段
3. 台灣醫院常見用語、西藥學名（如 Norvasc、Amlodipine、Metformin）、中文藥名（如 脈莎平、冠達悅、糖思樂）請用常用寫法
4. 常見科別：心臟內科、腎臟內科、新陳代謝科、神經內科、骨科、家醫科
5. 常見檢查：心電圖 EKG、超音波、X 光、抽血、尿液檢查、核磁共振 MRI
6. 數值請用阿拉伯數字（例：血壓 140/90、血糖 120、一天三次）
7. 若聽不清楚的地方，用「[不清楚]」標記，不要猜${ctxBlock}`;

  const model = hiQuality ? 'gemini-2.5-pro' : 'gemini-2.5-flash';

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [
        { text: prompt },
        { inline_data: { mime_type: file.type || 'audio/webm', data: base64 } }
      ]}]
    })
  });
  if (!res.ok) { const err = await res.text(); console.error('Gemini API error:', err); return safeError(new Error('AI service error'), cors, 502, 'AI 服務暫時無法使用'); }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  return json({ text, quota: q, model }, cors);
}
