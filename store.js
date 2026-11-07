// 数据层：内容（原文/音频/讲义/闪卡）和学习记录。
// - 电脑上（本地服务 npm start）：内容走本地 /api，AI 可用；填了令牌就把学习记录同步到 GitHub。
// - 手机/其他设备（GitHub Pages）：内容用令牌从私有仓库读取（并缓存在本机），学习记录同步到 GitHub；没有 AI。

// aiBase：AI 接口的地址。本地版是同一个服务（""）；线上版在电脑上时借本机服务 http://127.0.0.1:4173
export const ENV = { local: false, ai: false, aiBase: "" };
const LOCAL_AI = "http://127.0.0.1:4173";
export const DEFAULT_REPO = "logitlong/takken-study";
const CONTENT_REF = "main", PROGRESS_REF = "progress", PROGRESS_FILE = "progress.json";
const K = { cfg: "takken.gh", state: "takken.state" };

// ---------- 设置 ----------
export function ghCfg() {
  try { const c = JSON.parse(localStorage.getItem(K.cfg)); return c?.token ? c : null; } catch { return null; }
}
export function setGhCfg(c) {
  try { c ? localStorage.setItem(K.cfg, JSON.stringify(c)) : localStorage.removeItem(K.cfg); } catch {}
  remoteSha = null;
}

export async function detectEnv() {
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
    try {
      const h = await fetch("/api/health").then((r) => r.json());
      if (h.ai) { ENV.local = true; ENV.ai = true; }
    } catch {}
  }
  return ENV;
}
// 线上版：电脑上（非触屏）在后台试一下本机服务开没开，开了就用它的 Claude。手机不试。
// 第一次 Chrome 会问「允许访问此设备上的其他应用和服务」，点允许之前请求会一直挂着，所以不阻塞页面、等久一点。
// Chrome「本地网络访问」权限：prompt（还没点）/ granted / denied；不支持时返回 ""
export async function localNetPermission() {
  for (const name of ["loopback-network", "local-network-access"]) {
    try { return (await navigator.permissions.query({ name })).state; } catch {}
  }
  return "";
}
export async function probeLocalAI() {
  if (ENV.local || ENV.ai) return ENV.ai;
  const touchOnly = matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches;
  if (touchOnly) return false;
  try {
    const h = await fetch(`${LOCAL_AI}/api/health`, { signal: AbortSignal.timeout(120_000), cache: "no-store" }).then((r) => r.json());
    if (h.ai) { ENV.ai = true; ENV.aiBase = LOCAL_AI; }
  } catch {}
  return ENV.ai;
}

// ---------- GitHub API ----------
async function gh(path, opts = {}) {
  const c = ghCfg();
  if (!c) throw new Error("没有设置令牌");
  const r = await fetch(`https://api.github.com/repos/${c.repo || DEFAULT_REPO}${path ? `/${path}` : ""}`, {
    ...opts, cache: "no-store",
    headers: { Authorization: `Bearer ${c.token}`, "X-GitHub-Api-Version": "2022-11-28",
      Accept: opts.accept || "application/vnd.github+json", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (r.status === 401) throw new Error("令牌无效或已过期（401）");
  if (r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0") throw new Error("GitHub 请求太频繁，稍后再试");
  return r;
}
export async function testToken() {
  const r = await gh("");
  if (r.status === 404) throw new Error("找不到仓库（仓库名写错，或令牌没有这个仓库的权限）");
  if (!r.ok) throw new Error(`GitHub 返回 ${r.status}`);
  const j = await r.json();
  if (!j.permissions?.push) throw new Error("令牌只有读取权限，需要 Contents: Read and write");
  return j.full_name;
}
const b64enc = (s) => { const b = new TextEncoder().encode(s); let out = ""; for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(out); };
const b64dec = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

// 私有仓库里的内容文件，带本机缓存（Cache Storage）
const CACHE = "takken-content-v1";
async function repoFile(file, as) {
  const key = `https://takken.cache/${file}`;
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(key); if (hit) return as === "blob" ? hit.blob() : hit.text(); } catch {}
  const r = await gh(`contents/${file.split("/").map(encodeURIComponent).join("/")}?ref=${CONTENT_REF}`, { accept: "application/vnd.github.raw+json" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`读取 ${file} 失败（${r.status}）`);
  const blob = await r.blob();
  try { await cache?.put(key, new Response(blob)); } catch {}
  return as === "blob" ? blob : blob.text();
}
export async function clearContentCache() { try { await caches.delete(CACHE); } catch {} }

// ---------- 内容 ----------
const audioUrls = {};
export async function loadPoint(id) {
  if (ENV.local) {
    const d = await fetch(`/api/point/${id}`).then((r) => r.json());
    return { segments: d.segments || [], audio: d.audio ? `/audio/${id}.mp3` : null };
  }
  const txt = await repoFile(`data/points/${id}.json`, "text");
  return { segments: txt ? JSON.parse(txt).segments || [] : [], audio: true }; // 音频单独懒加载
}
export async function loadAudio(id) {
  if (ENV.local) return `/audio/${id}.mp3`;
  if (audioUrls[id]) return audioUrls[id];
  const blob = await repoFile(`data/audio/${id}.mp3`, "blob");
  return blob ? (audioUrls[id] = URL.createObjectURL(new Blob([blob], { type: "audio/mpeg" }))) : null;
}
export async function loadGen(id) {
  if (ENV.local) return fetch(`/api/gen/${id}`).then((r) => r.json());
  const [explain, cards] = await Promise.all([repoFile(`data/gen/${id}.explain.md`, "text"), repoFile(`data/gen/${id}.cards.json`, "text")]);
  return { explain: explain || "", cards: cards ? JSON.parse(cards) : [] };
}

// 过去问题库（tools/kakomon.mjs 生成）
export async function loadKakomon() {
  if (ENV.local) return fetch("/api/kakomon").then((r) => (r.ok ? r.json() : null));
  const t = await repoFile("data/kakomon/kenri.json", "text");
  return t ? JSON.parse(t) : null;
}

// ---------- 学习记录 ----------
export async function loadLocalState() {
  let s = null;
  if (ENV.local) { try { s = await fetch("/api/state").then((r) => r.json()); } catch {} }
  else { try { s = JSON.parse(localStorage.getItem(K.state)); } catch {} }
  return norm(s);
}
function norm(s) {
  s ||= {};
  s.points ||= {}; s.stuck ||= []; s.days ||= {}; s.stuckDel ||= []; s.dojoLog ||= []; s.kkLog ||= [];
  return s;
}
export function writeLocalState(S) {
  if (ENV.local) { const body = JSON.stringify(S); return fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body, keepalive: body.length < 60000 }).catch(() => {}); }
  try { localStorage.setItem(K.state, JSON.stringify(S)); } catch {}
}

// 每个知识点 / 卡点 带一个修改时间 t，合并时各自取较新的那份
const snap = new Map();
const keyOf = (o) => { const { t, ...rest } = o; return JSON.stringify(rest); };
export function stampBaseline(S) {
  snap.clear();
  for (const [id, p] of Object.entries(S.points)) snap.set("p:" + id, keyOf(p));
  for (const s of S.stuck) snap.set("s:" + s.id, keyOf(s));
}
export function stamp(S) {
  const now = Date.now();
  for (const [id, p] of Object.entries(S.points)) { const k = keyOf(p); if (snap.get("p:" + id) !== k) { p.t = now; snap.set("p:" + id, k); } }
  for (const s of S.stuck) { const k = keyOf(s); if (snap.get("s:" + s.id) !== k) { s.t = now; snap.set("s:" + s.id, k); } }
}
// 「清除学习记录」：resetAt 之前的记录在合并时一律丢掉（不然别的设备会把旧记录同步回来）
function afterReset(x, R) {
  if ((x.resetAt || 0) >= R) return x;
  const keep = (o) => (o.t || 0) > R;
  return { ...x, resetAt: R, days: {}, stuckDel: x.stuckDel, dojoLog: x.dojoLog.filter((e) => e[3] * 1000 > R), kkLog: x.kkLog.filter((e) => e[2] * 1000 > R),
    points: Object.fromEntries(Object.entries(x.points).filter(([, p]) => keep(p))), stuck: x.stuck.filter(keep) };
}
export function merge(a, b) {
  a = norm(a); b = norm(b);
  const R = Math.max(a.resetAt || 0, b.resetAt || 0);
  if (R) { a = afterReset(a, R); b = afterReset(b, R); }
  const out = { ...a, ...b, points: {}, days: { ...a.days }, bmOk: a.bmOk || b.bmOk, bm2: a.bm2 || b.bm2, resetAt: R || undefined };
  // 一問一答成绩：两边合在一起，按 题号+时间 去重
  const seen = new Set();
  out.dojoLog = [...a.dojoLog, ...b.dojoLog].filter((e) => { const k = `${e[0]}@${e[3]}`; return !seen.has(k) && seen.add(k); }).sort((x, y) => x[3] - y[3]);
  // 站内过去问作答：同样合并去重（key+时间+对错）
  const seen2 = new Set();
  out.kkLog = [...a.kkLog, ...b.kkLog].filter((e) => { const k = `${e[0]}@${e[2]}@${e[1]}`; return !seen2.has(k) && seen2.add(k); }).sort((x, y) => x[2] - y[2]);
  for (const id of new Set([...Object.keys(a.points), ...Object.keys(b.points)])) {
    const x = a.points[id], y = b.points[id];
    out.points[id] = !x ? y : !y ? x : (y.t || 0) > (x.t || 0) ? y : x;
  }
  for (const [d, n] of Object.entries(b.days)) out.days[d] = Math.max(out.days[d] || 0, n);
  out.stuckDel = [...new Set([...a.stuckDel, ...b.stuckDel])].slice(-500);
  const del = new Set(out.stuckDel.map(String)), m = new Map();
  for (const s of [...a.stuck, ...b.stuck]) {
    if (del.has(String(s.id))) continue;
    const o = m.get(s.id);
    if (!o || (s.t || 0) > (o.t || 0)) m.set(s.id, s);
  }
  out.stuck = [...m.values()].sort((x, y) => y.id - x.id);
  return out;
}

// ---------- 同步到 GitHub（progress 分支的 progress.json） ----------
let remoteSha = null;
export const sync = { state: "off", at: 0, error: "", onChange: () => {} };
function setSync(state, error = "") { sync.state = state; sync.error = error; if (state === "ok") sync.at = Date.now(); sync.onChange(); }

export async function pullRemote() {
  const r = await gh(`contents/${PROGRESS_FILE}?ref=${PROGRESS_REF}`);
  if (r.status === 404) { remoteSha = null; return null; }
  if (!r.ok) throw new Error(`读取学习记录失败（${r.status}）`);
  const j = await r.json();
  remoteSha = j.sha;
  let text = j.content ? b64dec(j.content) : "";
  if (!text && j.size) { // 超过 1MB 时 contents 接口不给内容，改用 blob 接口
    const b = await gh(`git/blobs/${j.sha}`).then((x) => x.json());
    text = b64dec(b.content);
  }
  return text ? JSON.parse(text) : null;
}
async function pushRemote(S) {
  const body = { message: `学习记录 ${new Date().toLocaleString("zh-CN")}`, content: b64enc(JSON.stringify(S)), branch: PROGRESS_REF };
  if (remoteSha) body.sha = remoteSha;
  const r = await gh(`contents/${PROGRESS_FILE}`, { method: "PUT", body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) return "conflict";
  if (r.status === 404) throw new Error("仓库里没有 progress 分支");
  if (!r.ok) throw new Error(`上传学习记录失败（${r.status}）`);
  remoteSha = (await r.json()).content.sha;
  return "ok";
}

// 拉取 → 合并 → 需要的话上传。返回合并后的状态（以及是否有来自远端的变化）
let busy = null;
export function syncNow(getS, setS) {
  if (!ghCfg()) { setSync("off"); return Promise.resolve(false); }
  if (busy) return busy.then(() => syncNow(getS, setS));
  busy = (async () => {
    setSync("syncing");
    try {
      for (let i = 0; i < 3; i++) {
        const remote = await pullRemote();
        const local = getS();
        const merged = remote ? merge(local, remote) : local;
        const changedLocal = JSON.stringify(merged) !== JSON.stringify(local);
        if (changedLocal) setS(merged);
        const needPush = !remote || JSON.stringify(merged) !== JSON.stringify(norm(remote));
        if (!needPush) { setSync("ok"); return changedLocal; }
        if ((await pushRemote(merged)) === "ok") { setSync("ok"); return changedLocal; }
      }
      throw new Error("同步冲突，稍后会再试");
    } catch (e) { setSync("error", e.message); return false; }
    finally { busy = null; }
  })();
  return busy;
}
