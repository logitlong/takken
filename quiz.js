// 过去问（站内题库）：四科总览 / 科目页 / 四选一 / 一問一答（○×）/ 模考 / 错题本 / 弱点 / 高频
// 题库来自 RETIO 官方过去问，tools/kakomon.mjs 生成，每科一个文件 data/kakomon/<科目id>.json（没有的科目显示「待导入」）。
import { BOOKS, BOOK_BY_ID, POINT_BY_ID, EXAM_TOTAL, PASS_HINT } from "./toc.js?v=f963d86b65";
import { loadKakomon } from "./store.js?v=f963d86b65";

let C; // 由 app.js 注入：{ S, save, touchDay, $, esc, md, addDays, today, lawHtml, linkLaws, ai, askAI }
export function initKK(ctx) { C = ctx; }

// ---------- 重要度筛选（和目录页共用 localStorage 里的选择）----------
const IMPF = [["all", "全部"], ["A", "A"], ["B", "B"], ["C", "C"], ["none", "未标"]];
const impOfId = (id) => POINT_BY_ID[id]?.imp || C.S().points[id]?.imp || null;
const getImpF = () => { try { return localStorage.getItem("takken.impf") || "all"; } catch { return "all"; } };
const setImpF = (f) => { try { localStorage.setItem("takken.impf", f); } catch {} };
// 题目挂着的ポイント里有一个符合就算
const ptsMatch = (pts, f) => f === "all" || (pts || []).some((p) => (f === "none" ? !impOfId(p) : impOfId(p) === f));

// ---------- 数据 ----------
let DB = null, loading = null;
export async function kkDB() {
  if (DB) return DB;
  loading ||= Promise.all(BOOKS.map((b) => loadKakomon(b.id).catch(() => null))).then((files) => {
    const exams = {}, qs = [];
    files.forEach((d, i) => {
      if (!d) return;
      Object.assign(exams, d.exams || {});
      for (const q of d.questions || []) { q.book = BOOKS[i].id; qs.push(q); }
    });
    const stmts = [];
    for (const q of qs) q.statements.forEach((s, i) => stmts.push({ key: `${q.id}#${s.key}`, q, s, i, pts: s.points?.length ? s.points : q.points }));
    const byBook = Object.fromEntries(BOOKS.map((b) => [b.id, { qs: qs.filter((q) => q.book === b.id), st: stmts.filter((x) => x.q.book === b.id) }]));
    DB = { exams, qs, stmts, byBook, byId: Object.fromEntries(qs.map((q) => [q.id, q])), stById: Object.fromEntries(stmts.map((x) => [x.key, x])) };
    return DB;
  }).catch((e) => { loading = null; throw e; });
  return loading;
}
const courseKey = (pid) => { const p = POINT_BY_ID[pid]; return p ? `${p.book}:${p.course}` : ""; };
// 只数真正有题的考试（exams 里可能列了还没生成题目的年度）
const nExamsOf = (D) => new Set(D.qs.map((q) => q.exam)).size;

// ---------- 作答记录 S.kkLog = [[key, 1 对/0 错, 时间(秒)], …]；key = "R05-03"（四选一）或 "R05-03#2"（○× 一肢） ----------
const log = () => (C.S().kkLog ||= []);
const mocks = () => (C.S().mocks ||= []);
function tally() {
  const m = new Map();
  for (const [k, ok, t] of log()) { const a = m.get(k) || { n: 0, ok: 0, seq: [], ts: [] }; a.n++; a.ok += ok; a.seq.push(ok); a.ts.push(t); m.set(k, a); }
  return m;
}
// 错题按间隔重复：做错 → 第 1 天再做；到期那天答对 → 3 天后 → 7 天后 → 再对就「毕业」移出错题本。
// 没到期就做也可以，但答对不算进度；任何时候答错都从头开始。
const WRONG_INT = [1, 3, 7];
const dayOfSec = (t) => new Date(t * 1000).toLocaleDateString("sv-SE");
const plusDays = (d, n) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return x.toLocaleDateString("sv-SE"); };
function wrongState(a) {
  let st = null;
  a.seq.forEach((ok, i) => {
    const d = dayOfSec(a.ts[i]);
    if (!ok) st = { step: 0, due: plusDays(d, WRONG_INT[0]), miss: (st?.miss || 0) + 1 };
    else if (st && !st.grad && d >= st.due) { st.step++; if (st.step >= WRONG_INT.length) st.grad = true; else st.due = plusDays(d, WRONG_INT[st.step]); }
  });
  return st && !st.grad ? st : null;
}
export function wrongMap(T = tally()) { const m = new Map(); for (const [k, a] of T) { const st = wrongState(a); if (st) m.set(k, st); } return m; }
export function wrongKeys() { return [...wrongMap().keys()]; }
export function dueWrongKeys() { const t = C.today(); return [...wrongMap()].filter(([, st]) => st.due <= t).map(([k]) => k); }
export function kkTotals() { let ok = 0, n = 0; for (const e of log()) { n++; ok += e[1]; } return { ok, n }; }
// 今天做了多少（给学习计划用）
export function kkToday() {
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const since = t0.getTime() / 1000;
  let ox = 0, q = 0;
  for (const [k, , t] of log()) if (t >= since) { if (k.includes("#")) ox++; else q++; }
  return { ox, q };
}
export const lastMock = () => mocks().at(-1) || null;

function record(key, ok, pts) {
  log().push([key, ok ? 1 : 0, Math.floor(Date.now() / 1000)]);
  C.touchDay();
  // 做错 → 已掌握的相关ポイント明天回炉复习
  if (!ok) for (const id of pts || []) { const p = C.S().points[id]; if (p?.status === "mastered") p.review = { step: 0, due: C.addDays(1) }; }
}
const pct = (ok, n) => (n ? Math.round((ok / n) * 100) + "%" : "—");
function statFor(keys, T = tally()) { let ok = 0, n = 0, done = 0; for (const k of keys) { const a = T.get(k); if (a) { ok += a.ok; n += a.n; done++; } } return { ok, n, done }; }
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const isQ = (k) => !k.includes("#");
const fmtS = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ---------- 每个ポイント：考了几场（高频）+ 我的正确率（弱点） ----------
export async function pointInfo() {
  const D = await kkDB(), T = tally();
  const m = new Map();
  const get = (id) => { if (!m.has(id)) m.set(id, { id, exams: new Set(), q: 0, st: 0, keys: [] }); return m.get(id); };
  for (const q of D.qs) for (const id of q.points) { const x = get(id); x.exams.add(q.exam); x.q++; x.keys.push(q.id); }
  for (const s of D.stmts) for (const id of s.pts) { const x = get(id); x.exams.add(s.q.exam); x.st++; x.keys.push(s.key); }
  for (const x of m.values()) Object.assign(x, statFor(x.keys, T), { nEx: x.exams.size });
  return { m, nExams: nExamsOf(D) };
}
// 近 N 场考试里出现的场数：≥75% 高频，≥50% 常考
export function heat(x, nExams) {
  if (!x || !nExams) return null;
  const r = x.nEx / nExams;
  return r >= 0.75 ? { cls: "hot", label: `${x.nEx}/${nExams}场`, tip: `近 ${nExams} 场考试里有 ${x.nEx} 场考到（高频）` }
    : r >= 0.5 ? { cls: "warm", label: `${x.nEx}/${nExams}场`, tip: `近 ${nExams} 场考试里有 ${x.nEx} 场考到（常考）` }
    : { cls: "", label: `${x.nEx}/${nExams}场`, tip: `近 ${nExams} 场考试里有 ${x.nEx} 场考到` };
}
const WEAK = (x) => x.n >= 3 && x.ok / x.n < 0.7; // 至少答 3 次、正确率 < 70%

// ---------- 练习会话 ----------
let run = null; // { kind: "q"|"ox", keys, i, title, res: [], picked, t0, preset?(模考复盘) }
function start(kind, keys, title, extra = {}) {
  if (!keys.length) return alert("没有可做的题。");
  run = { kind, keys, i: 0, title, res: [], picked: null, t0: Date.now(), ...extra };
  if (run.preset) run.picked = run.preset[keys[0]] ?? 0;
  if (location.hash === "#/kk/run") viewRun(); else location.hash = "#/kk/run";
}

// ---------- 过去问 总览（四科） ----------
export async function viewKK() {
  const { $, esc } = C;
  $("#app").innerHTML = `<h1>过去问</h1><div class="empty">加载题库…</div>`;
  let D;
  try { D = await kkDB(); } catch (e) { $("#app").innerHTML = `<h1>过去问</h1><div class="card">题库读取失败：${esc(e.message)}</div>`; return; }
  const T = tally(), wrong = wrongKeys();
  const all = statFor([...D.qs.map((q) => q.id), ...D.stmts.map((x) => x.key)], T);
  const ready = BOOKS.filter((b) => D.byBook[b.id].qs.length);
  const { m, nExams } = await pointInfo();
  const weak = [...m.values()].filter(WEAK).sort((a, b) => a.ok / a.n - b.ok / b.n).slice(0, 6);
  $("#app").innerHTML = `<h1>过去问</h1>
  <p class="muted small" style="margin-top:0">官方真题（RETIO）。本试共 ${EXAM_TOTAL} 题、2 小时；${PASS_HINT}。目前已导入 ${ready.map((b) => b.title).join("、") || "—"}，其他科目陆续补充。</p>
  <div class="stats">
    <div class="stat"><div class="v">${D.qs.length}<span class="muted small"> 题</span></div><div class="k">已导入（${D.stmts.length} 个 ○× 肢）</div></div>
    <div class="stat"><div class="v">${all.n}</div><div class="k">累计作答</div></div>
    <div class="stat"><div class="v">${pct(all.ok, all.n)}</div><div class="k">正确率</div></div>
    <div class="stat"><div class="v">${dueWrongKeys().length}<span class="muted small"> / ${wrong.length}</span></div><div class="k">今天到期的错题 / 错题本</div></div>
  </div>
  <div class="kk-books">${BOOKS.map((b) => {
    const { qs, st } = D.byBook[b.id];
    const s = statFor([...qs.map((q) => q.id), ...st.map((x) => x.key)], T);
    return qs.length
      ? `<a class="card kk-book bk-${b.id}" href="#/kk/${b.id}"><div class="row"><b>${esc(b.title)}</b><span class="muted small">${esc(b.zh)}</span><span class="spacer"></span><span class="muted small">本试 ${b.examQ} 题</span></div>
          <div class="small" style="margin:6px 0">题库 <b>${qs.length}</b> 题 · ○× <b>${st.length}</b> 肢</div>
          <div class="small muted">${s.n ? `作答 ${s.n} 次 · 正确率 <b>${pct(s.ok, s.n)}</b>` : "还没做过"}</div>
          <div class="kk-book-go">进入 →</div></a>`
      : `<div class="card kk-book off bk-${b.id}"><div class="row"><b>${esc(b.title)}</b><span class="muted small">${esc(b.zh)}</span><span class="spacer"></span><span class="muted small">本试 ${b.examQ} 题</span></div>
          <div class="small muted" style="margin:6px 0">${esc(b.qNo)}${b.note ? ` · ${esc(b.note)}` : ""}</div>
          <div class="small muted">题库待导入</div></div>`;
  }).join("")}</div>
  <div class="card">
    <div class="row"><h2 style="margin:0">模考</h2><span class="spacer"></span><a class="small" href="#/kk/wrong">错题本（今天到期 ${dueWrongKeys().length}）</a></div>
    <p class="small muted" style="margin:8px 0">自己选科目、年份（可多选，或全部混合）和题数。模考交卷前不显示对错；也可以当练习做，每题马上看解析。</p>
    <div id="picker"></div>
    ${mockHistory()}
  </div>
  <div class="card"><h2>薄弱ポイント</h2>${weak.length ? weakRows(weak, nExams) : `<p class="small muted" style="margin:0">做题后，正确率低于 70% 的ポイント会出现在这里（每个至少答 3 次才算）。</p>`}</div>`;
  $("#app").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    weakClick(b, D);
  };
  mountPicker(D, $("#picker"));
}
function weakRows(list, nExams) {
  const { esc } = C;
  return list.map((x) => { const p = POINT_BY_ID[x.id], h = heat(x, nExams);
    return `<div class="hrow kk-row"><a class="hl" href="#/p/${x.id}" title="${esc(p.bookTitle)}">${esc(p.courseTitle)} › <b>${esc(p.title)}</b></a>
      ${h ? `<span class="freq ${h.cls}" title="${h.tip}">${h.label}</span>` : ""}
      <span class="small" style="flex:1;color:var(--bad)">正确率 ${pct(x.ok, x.n)}（${x.ok}/${x.n}）</span>
      <a class="btn sm" href="#/p/${x.id}">看讲义</a><button class="btn sm primary" data-ptox="${x.id}">练 ○×</button></div>`; }).join("");
}
function weakClick(b, D) {
  const id = b.dataset.ptox; if (!id) return;
  const keys = D.stmts.filter((x) => x.pts.includes(id)).map((x) => x.key);
  start("ox", shuffle(keys), `${POINT_BY_ID[id].title} ○×`);
}
function mockHistory() {
  const { esc } = C;
  const h = mocks().slice(-6).reverse();
  return h.length ? `<div style="margin-top:12px">${h.map((x) => `<div class="hrow kk-row small"><span class="muted" style="width:92px">${new Date(x.t * 1000).toLocaleDateString("sv-SE")}</span><span class="hl" style="flex:1">${esc(x.title)}</span><b>${x.score} / ${x.n}</b><span class="muted">${fmtS(x.secs)}</span></div>`).join("")}</div>` : "";
}

// ---------- 自选出题：科目 × 年份 × 题数 → 模考（计时、交卷才看对错）或练习（每题马上看解析） ----------
// 设置记在 localStorage（只是这台设备的偏好）：{ scope: "all" | 科目id, years: [考试id…]（空 = 全部年份）, n: "exam" | "max" | 数字 }
const PK_KEY = "takken.pick";
const getPK = () => { try { return JSON.parse(localStorage.getItem(PK_KEY)) || {}; } catch { return {}; } };
const setPK = (c) => { try { localStorage.setItem(PK_KEY, JSON.stringify(c)); } catch {} };
function pkPool(D, scope, years) {
  const ys = new Set(years);
  return D.qs.filter((q) => (scope === "all" || q.book === scope) && (!ys.size || ys.has(q.exam)));
}
// 全科：按本试各科题数的比例分（50 题 = 14 + 20 + 8 + 8），某科题不够时用别的科补
function pkPick(D, scope, years, n) {
  const pool = pkPool(D, scope, years);
  if (scope !== "all") return spreadPick(pool, n);
  const books = BOOKS.filter((b) => pool.some((q) => q.book === b.id));
  const tot = books.reduce((x, b) => x + b.examQ, 0);
  const out = books.flatMap((b) => spreadPick(pool.filter((q) => q.book === b.id), Math.round((n * b.examQ) / tot)));
  if (out.length < n) out.push(...shuffle(pool.map((q) => q.id).filter((id) => !out.includes(id))).slice(0, n - out.length));
  return out.slice(0, n).sort((a, b) => D.byId[a].no - D.byId[b].no || D.byId[a].exam.localeCompare(D.byId[b].exam));
}
function spreadPick(pool, n) {
  const sh = shuffle(pool), out = [], used = new Set();
  for (const q of sh) if (out.length < n && !used.has(q.exam)) { out.push(q); used.add(q.exam); }
  for (const q of sh) if (out.length < n && !out.includes(q)) out.push(q);
  return out.sort((a, b) => a.no - b.no).map((q) => q.id);
}
// el：放面板的容器；fixedBook：科目页里固定这一科，不显示科目选择
function mountPicker(D, el, fixedBook) {
  const { esc } = C;
  const ready = BOOKS.filter((b) => D.byBook[b.id].qs.length);
  const render = () => {
    const c = getPK();
    const scope = fixedBook || (c.scope === "all" || ready.some((b) => b.id === c.scope) ? c.scope : "all");
    const inScope = D.qs.filter((q) => scope === "all" || q.book === scope);
    const exams = Object.keys(D.exams).filter((ex) => inScope.some((q) => q.exam === ex));
    const years = (c.years || []).filter((y) => exams.includes(y));
    const pool = pkPool(D, scope, years);
    const examN = scope === "all" ? EXAM_TOTAL : BOOK_BY_ID[scope].examQ;
    const nOpt = [["exam", `本试题数 ${examN}`], [10, "10"], [20, "20"], [30, "30"], ["max", `全部 ${pool.length}`]];
    const nSel = c.n ?? "exam";
    const n = Math.max(1, Math.min(pool.length, nSel === "exam" ? examN : nSel === "max" ? pool.length : Number(nSel) || examN));
    const custom = !nOpt.some(([k]) => String(k) === String(nSel));
    el.innerHTML = `
      ${fixedBook ? "" : `<div class="pk-row"><span class="pk-k">科目</span><div class="seg">${[["all", "全科（混合）"], ...ready.map((b) => [b.id, b.title])].map(([k, v]) => `<button data-ps="${k}" class="${k === scope ? "on" : ""}">${esc(v)}</button>`).join("")}</div></div>`}
      <div class="pk-row"><span class="pk-k">年份</span><div class="pk-years">
        <button class="pk-y ${years.length ? "" : "on"}" data-py="">全部年份混合</button>
        ${exams.map((ex) => `<button class="pk-y ${years.includes(ex) ? "on" : ""}" data-py="${ex}">${esc(D.exams[ex])}</button>`).join("")}</div></div>
      <div class="pk-row"><span class="pk-k">题数</span><div class="seg">${nOpt.map(([k, v]) => `<button data-pn="${k}" class="${String(k) === String(nSel) ? "on" : ""}">${v}</button>`).join("")}</div>
        <label class="small muted">自定义 <input type="number" id="pkN" min="1" max="${pool.length}" value="${custom ? n : ""}" placeholder="题数" style="width:64px"></label></div>
      <p class="small muted" style="margin:6px 0 10px">从 <b>${pool.length}</b> 题里抽 <b>${n}</b> 题${years.length === 1 ? "（只选一个年度、题数取全部时就是原样整套卷）" : "，尽量每个年度都抽到"}${scope === "all" && ready.length < BOOKS.length ? `。目前只导入了 ${ready.map((b) => esc(b.title)).join("、")}，全科只能先从已有科目里抽` : ""}。模考时间按本试节奏，每题 2 分 24 秒：<b>${Math.round(n * 2.4)}</b> 分钟。</p>
      <div class="row">
        <button class="btn primary" data-pgo="mock" ${pool.length ? "" : "disabled"}>开始模考 ${n} 题</button>
        <button class="btn" data-pgo="q" ${pool.length ? "" : "disabled"}>当练习做（每题看解析）</button>
      </div>`;
    el.onclick = (e) => {
      const b = e.target.closest("button"); if (!b || !el.contains(b)) return;
      e.stopPropagation();
      const d = b.dataset, cfg = getPK();
      if (d.ps) { cfg.scope = d.ps; cfg.years = []; setPK(cfg); return render(); }
      if (d.py !== undefined) {
        const ys = new Set(years);
        if (!d.py) ys.clear(); else ys.has(d.py) ? ys.delete(d.py) : ys.add(d.py);
        cfg.years = [...ys]; setPK(cfg); return render();
      }
      if (d.pn) { cfg.n = /^\d+$/.test(d.pn) ? Number(d.pn) : d.pn; setPK(cfg); return render(); }
      if (d.pgo) {
        const keys = pkPick(D, scope, years, n);
        const ttl = `${scope === "all" ? "全科" : BOOK_BY_ID[scope].title} · ${!years.length ? "全年份" : years.length === 1 ? D.exams[years[0]] : `${years.length} 个年度`} · ${keys.length} 题`;
        d.pgo === "mock" ? startMock(keys, `${ttl} 模考`) : start("q", keys, ttl);
      }
    };
    const inp = el.querySelector("#pkN");
    inp.onchange = () => { const v = Math.floor(Number(inp.value)); if (v > 0) { const cfg = getPK(); cfg.n = v; setPK(cfg); render(); } };
  };
  render();
}

// ---------- 科目页 ----------
export async function viewBook(bookId) {
  const { $, esc } = C;
  const b = BOOK_BY_ID[bookId];
  const D = await kkDB();
  const { qs: qsAll, st: stAll } = D.byBook[bookId];
  const F = getImpF();
  const qs = qsAll, st = stAll; // 统计、年度、コース都看全部
  const fq = qsAll.filter((q) => ptsMatch(q.points, F)), fs = stAll.filter((x) => ptsMatch(x.pts, F)); // 「开始练习」按重要度筛
  const fl = F === "all" ? "" : F === "none" ? "未标重要度 · " : `${F} 类 · `;
  const crumbs = `<div class="crumbs"><a href="#/kk">过去问</a> › ${esc(b.title)}</div>`;
  if (!qs.length) { $("#app").innerHTML = `${crumbs}<h1>${esc(b.title)}</h1><div class="card">这一科的题库还没导入（本试 ${b.examQ} 题，${esc(b.qNo)}）。</div>`; return; }
  const T = tally();
  const { m, nExams } = await pointInfo();
  const sQ = statFor(qs.map((q) => q.id), T), sO = statFor(st.map((x) => x.key), T);
  const wrong = dueWrongKeys().filter((k) => (isQ(k) ? D.byId[k] : D.stById[k]?.q)?.book === bookId);
  const exams = [...new Set(qs.map((q) => q.exam))];
  const courses = b.courses.map((c) => {
    const k = `${bookId}:${c.n}`;
    const cq = qs.filter((q) => q.points.some((p) => courseKey(p) === k));
    const cs = st.filter((x) => x.pts.some((p) => courseKey(p) === k));
    return { c, qs: cq, st: cs, s: statFor([...cq.map((q) => q.id), ...cs.map((x) => x.key)], T) };
  });
  const pts = [...m.values()].filter((x) => POINT_BY_ID[x.id]?.book === bookId);
  const hot = pts.filter((x) => x.nEx / nExams >= 0.75 && ptsMatch([x.id], F)).sort((a, b) => b.nEx - a.nEx || b.st - a.st);
  const weak = pts.filter(WEAK).sort((a, b) => a.ok / a.n - b.ok / b.n);
  $("#app").innerHTML = `${crumbs}<h1>${esc(b.title)}<span class="muted small">　${esc(b.zh)} · 本试 ${b.examQ} 题（${esc(b.qNo)}）</span></h1>
  <div class="stats">
    <div class="stat"><div class="v">${sQ.done}<span class="muted small"> / ${qs.length}</span></div><div class="k">四选一 做过</div></div>
    <div class="stat"><div class="v">${pct(sQ.ok, sQ.n)}</div><div class="k">四选一 正确率</div></div>
    <div class="stat"><div class="v">${sO.done}<span class="muted small"> / ${st.length}</span></div><div class="k">○× 做过</div></div>
    <div class="stat"><div class="v">${pct(sO.ok, sO.n)}</div><div class="k">○× 正确率</div></div>
  </div>
  <div class="card">
    <h2>开始练习</h2>
    <div class="impf-bar"><span class="small muted">只练这些重要度</span><div class="seg" id="kkImpF">${IMPF.map(([k, v]) => `<button data-f="${k}" class="${k === F ? "on" : ""}">${v}</button>`).join("")}</div>
      <span class="small muted">${F === "all" ? `${qsAll.length} 题 · ${stAll.length} 肢` : `${fq.length} 题 · ${fs.length} 肢符合`}</span></div>
    <div class="row">
      <button class="btn primary" data-go="rq" ${fq.length ? "" : "disabled"}>随机 10 题（四选一）</button>
      <button class="btn primary" data-go="ro" ${fs.length ? "" : "disabled"}>随机 20 肢（○×）</button>
      <button class="btn" data-go="nq" ${fq.some((q) => !T.has(q.id)) ? "" : "disabled"}>没做过的 10 题</button>
      <button class="btn" data-go="hot" ${hot.length ? "" : "disabled"}>高频ポイント ○×</button>
      <button class="btn" data-go="wrong" ${wrong.length ? "" : "disabled"}>本科到期错题（${wrong.length}）</button>
    </div>
    <p class="small muted" style="margin:10px 0 0">重要度筛选对上面这几个按钮有效（按题目对应的ポイント算；教材没印重要度的ポイント，在讲义页自己标）。做错的题进错题本，按 1 → 3 → 7 天间隔再出现，到期那天答对三次才移出；相关ポイント如果已标「已掌握」，会被排到明天回炉复习。</p>
  </div>
  <div class="card"><h2>模考 / 按年份抽题</h2><div id="picker"></div></div>
  <div class="card"><h2>薄弱ポイント</h2>${weak.length ? weakRows(weak.slice(0, 8), nExams) : `<p class="small muted" style="margin:0">做题后，正确率低于 70% 的ポイント会出现在这里（每个至少答 3 次才算）。</p>`}</div>
  <div class="card"><h2>高频ポイント${F === "all" ? "" : ` <span class="small muted">（只看${fl.replace(" · ", "")}）</span>`}</h2>
    <p class="small muted" style="margin-top:-6px">近 ${nExams} 场考试里出现 ≥ 75% 的ポイント（按场数排序）。</p>
    ${hot.map((x) => { const p = POINT_BY_ID[x.id], h = heat(x, nExams);
      return `<div class="hrow kk-row"><span class="freq hot" title="${h.tip}">${h.label}</span><a class="hl" href="#/p/${x.id}">${esc(p.courseTitle)} › <b>${esc(p.title)}</b></a>
        <span class="small muted" style="flex:1">${x.q} 题 · ${x.st} 肢${x.n ? ` · 我的正确率 ${pct(x.ok, x.n)}` : ""}</span>
        <span class="small">${{ mastered: "已掌握", learning: "学习中" }[C.S().points[x.id]?.status] || "未学"}</span>
        <button class="btn sm" data-ptox="${x.id}">练 ○×</button></div>`; }).join("")}
  </div>
  <div class="card">
    <h2>按年度（整套）</h2>
    ${exams.map((ex) => {
      const ids = qs.filter((q) => q.exam === ex).map((q) => q.id);
      const s = statFor(ids, T);
      const score = ids.filter((id) => T.get(id)?.seq.at(-1) === 1).length;
      return `<div class="hrow kk-row"><span class="hl">${esc(D.exams[ex])}</span>
        <span class="small muted" style="flex:1">${s.done ? `做过 ${s.done}/${ids.length} · 最近一次 ${score} 题对` : "还没做"}</span>
        <button class="btn sm" data-exam="${ex}">练习</button><button class="btn sm" data-exmock="${ex}">模考</button></div>`;
    }).join("")}
  </div>
  <div class="card">
    <h2>按コース（跟着教材练）</h2>
    ${courses.map((x) => `<div class="hrow kk-row"><span class="hl">${x.c.n}. ${esc(x.c.title)}</span>
      <span class="small muted" style="flex:1">${x.qs.length} 题 · ${x.st.length} 肢${x.s.n ? ` · 正确率 ${pct(x.s.ok, x.s.n)}` : ""}</span>
      <button class="btn sm" data-cq="${x.c.n}" ${x.qs.length ? "" : "disabled"}>四选一</button><button class="btn sm" data-co="${x.c.n}" ${x.st.length ? "" : "disabled"}>○×</button></div>`).join("")}
  </div>`;
  $("#app").onclick = (e) => {
    const el = e.target.closest("button"); if (!el) return;
    const d = el.dataset;
    if (d.f && el.closest("#kkImpF")) { setImpF(d.f); viewBook(bookId); return; }
    if (d.go === "rq") start("q", shuffle(fq.map((q) => q.id)).slice(0, 10), `${b.title} ${fl}随机 10 题`);
    if (d.go === "ro") start("ox", shuffle(fs.map((x) => x.key)).slice(0, 20), `${b.title} ${fl}随机 20 肢`);
    if (d.go === "nq") start("q", shuffle(fq.filter((q) => !T.has(q.id)).map((q) => q.id)).slice(0, 10), `${b.title} ${fl}没做过的题`);
    if (d.go === "hot") { const ids = new Set(hot.map((x) => x.id)); start("ox", shuffle(st.filter((x) => x.pts.some((p) => ids.has(p))).map((x) => x.key)).slice(0, 30), `${b.title} ${fl}高频ポイント`); }
    if (d.go === "wrong") { const q = wrong.filter(isQ); start(q.length ? "q" : "ox", shuffle(q.length ? q : wrong), `${b.title} 错题`); }
    if (d.exam) start("q", qs.filter((q) => q.exam === d.exam).map((q) => q.id), `${D.exams[d.exam]} ${b.title}`);
    if (d.exmock) startMock(qs.filter((q) => q.exam === d.exmock).map((q) => q.id), `${D.exams[d.exmock]} ${b.title} 模考`);
    if (d.cq) { const c = courses.find((x) => x.c.n == d.cq); start("q", c.qs.map((q) => q.id), `第${c.c.n}コース ${c.c.title}`); }
    if (d.co) { const c = courses.find((x) => x.c.n == d.co); start("ox", shuffle(c.st.map((x) => x.key)), `第${c.c.n}コース ${c.c.title} ○×`); }
    weakClick(el, D);
  };
  mountPicker(D, $("#picker"), bookId);
}

// ---------- 错题本 ----------
export function startDueWrong() {
  const ks = dueWrongKeys();
  const q = ks.filter(isQ), o = ks.filter((k) => !isQ(k));
  if (q.length) start("q", shuffle(q), "到期错题（四选一）"); else start("ox", shuffle(o), "到期错题（○×）");
}
export async function viewWrong() {
  const { $, esc } = C;
  const D = await kkDB();
  const T = tally(), W = wrongMap(T), today = C.today();
  const ks = [...W.keys()].filter((k) => (isQ(k) ? D.byId[k] : D.stById[k]))
    .sort((a, b) => W.get(a).due.localeCompare(W.get(b).due));
  const due = ks.filter((k) => W.get(k).due <= today);
  const bookOf = (k) => (isQ(k) ? D.byId[k] : D.stById[k].q).book;
  const row = (k) => {
    const a = T.get(k), st = W.get(k);
    const [label, text] = isQ(k) ? [`${D.exams[D.byId[k].exam]} 問${D.byId[k].no}`, D.byId[k].takeaway || D.byId[k].stemZh]
      : [`${D.exams[D.stById[k].q.exam]} 問${D.stById[k].q.no}-${D.stById[k].s.key}`, D.stById[k].s.textZh];
    const when = st.due <= today ? `<b style="color:var(--accent)">今天到期</b>` : `${st.due.slice(5).replace("-", "/")} 再做`;
    return `<div class="hrow kk-row"><span class="hl">${isQ(k) ? "四选一" : "○×"} · ${esc(label)}</span><span class="small" style="flex:1">${esc(text)}</span>
      <span class="small muted" title="间隔 1→3→7 天，到期答对 3 次移出">${"●".repeat(st.step)}${"○".repeat(WRONG_INT.length - st.step)} ${when}</span><span class="small muted">错 ${a.n - a.ok} 次</span><button class="btn sm" data-one="${k}">做</button></div>`;
  };
  $("#app").innerHTML = `<div class="crumbs"><a href="#/kk">过去问</a> › 错题本</div><h1>错题本</h1>
  <p class="muted small" style="margin-top:0">按 1 → 3 → 7 天间隔复习：到期那天答对就进一格（●），三格满了自动移出；任何时候答错都从头开始。没到期也可以先做，但答对不算进度。</p>
  ${ks.length ? `<div class="card"><div class="row"><b>今天到期 ${due.length} 个</b><span class="muted small">　错题本共 ${ks.length} 个</span><span class="spacer"></span>${due.length ? `<button class="btn primary" id="doDue">开始做到期的 →</button>` : `<span class="small muted">今天没有到期的 </span>`}</div></div>` : `<div class="card">错题本是空的。</div>`}
  ${BOOKS.map((b) => {
    const mine = ks.filter((k) => bookOf(k) === b.id);
    if (!mine.length) return "";
    return `<div class="card"><h2>${esc(b.title)}</h2><div>${mine.map(row).join("")}</div></div>`;
  }).join("")}`;
  if ($("#doDue")) $("#doDue").onclick = startDueWrong;
  $("#app").onclick = (e) => { const b = e.target.closest("[data-one]"); if (b) start(isQ(b.dataset.one) ? "q" : "ox", [b.dataset.one], "错题重做"); };
}

// ---------- 模考：交卷前不显示对错 ----------
let mock = null; // { keys, ans: {}, i, t0, limit(秒), title, done }
let mockTimer = null;
function startMock(keys, title) {
  if (!keys.length) return alert("没有可做的题。");
  if (mock && !mock.done && !confirm("上一场模考还没交卷，放弃它重新开始？")) { location.hash = "#/kk/mock"; return; }
  mock = { keys, ans: {}, i: 0, t0: Date.now(), limit: Math.round(keys.length * 144), title, done: false };
  clearInterval(mockTimer);
  mockTimer = setInterval(() => {
    if (!mock || mock.done) return clearInterval(mockTimer);
    const left = mock.limit - (Date.now() - mock.t0) / 1000;
    const el = document.querySelector("#mockTimer");
    if (el) { el.textContent = `${fmtS(Math.max(0, left))}`; el.classList.toggle("late", left < 300); }
    if (left <= 0) { submitMock(true); }
  }, 1000);
  if (location.hash === "#/kk/mock") viewMock(); else location.hash = "#/kk/mock";
}
export async function viewMock() {
  const { $, esc } = C;
  if (!mock) { location.hash = "#/kk"; return; }
  const D = await kkDB();
  if (mock.done) return viewMockResult(D);
  const q = D.byId[mock.keys[mock.i]], a = mock.ans[q.id];
  const left = mock.limit - (Date.now() - mock.t0) / 1000;
  $("#app").innerHTML = `<div class="crumbs"><a href="#/kk">过去问</a> › ${esc(mock.title)}<span class="spacer"></span><span class="kk-timer" id="mockTimer">${fmtS(Math.max(0, left))}</span></div>
  <div class="mock-grid">${mock.keys.map((k, i) => `<button class="${i === mock.i ? "cur" : ""} ${mock.ans[k] ? "done" : ""}" data-go="${i}">${i + 1}</button>`).join("")}</div>
  <div class="card kk-q">
    <div class="row"><b>第 ${mock.i + 1} 题</b><span class="muted small">${esc(BOOK_BY_ID[q.book]?.title || "")} · ${esc(D.exams[q.exam])} 問${q.no}</span><span class="spacer"></span><button class="btn sm" id="zhBtn">中文意思</button></div>
    <div class="kk-stem" lang="ja">${nl(q.stem)}</div>
    <div class="kk-zh" id="zh" hidden>${esc(q.stemZh)}</div>
    ${q.items?.length ? `<div class="kk-items">${q.items.map((it) => `<div class="kk-item" lang="ja"><b>${esc(it.label)}</b> ${nl(it.text)}</div>`).join("")}</div>` : ""}
    <div class="kk-choices">${q.choices.map((c, i) => `<button class="kk-choice ${a === i + 1 ? "picked" : ""}" data-c="${i + 1}"><b>${i + 1}</b><span lang="ja">${nl(c)}</span></button>`).join("")}</div>
  </div>
  <div class="row">
    <button class="btn" id="mPrev" ${mock.i ? "" : "disabled"}>← 上一题</button>
    <button class="btn" id="mNext" ${mock.i < mock.keys.length - 1 ? "" : "disabled"}>下一题 →</button>
    <span class="spacer"></span><span class="small muted">已答 ${Object.keys(mock.ans).length} / ${mock.keys.length}</span>
    <button class="btn primary" id="mSubmit">交卷</button>
  </div>
  <p class="small muted">键盘：1〜4 选择，← → 换题。答案可以随时改，交卷后才看对错。</p>`;
  $("#zhBtn").onclick = () => { $("#zh").hidden = !$("#zh").hidden; };
  document.querySelectorAll("[data-c]").forEach((b) => b.onclick = () => {
    mock.ans[q.id] = Number(b.dataset.c);
    if (mock.i < mock.keys.length - 1) mock.i++;
    viewMock();
  });
  document.querySelectorAll(".mock-grid [data-go]").forEach((b) => b.onclick = () => { mock.i = Number(b.dataset.go); viewMock(); });
  $("#mPrev").onclick = () => { mock.i--; viewMock(); };
  $("#mNext").onclick = () => { mock.i++; viewMock(); };
  $("#mSubmit").onclick = () => {
    const blank = mock.keys.length - Object.keys(mock.ans).length;
    if (confirm(blank ? `还有 ${blank} 题没答，确定交卷？` : "确定交卷？")) submitMock(false);
  };
}
async function submitMock(timeout) {
  if (!mock || mock.done) return;
  const D = await kkDB();
  mock.done = true; mock.timeout = timeout;
  mock.secs = Math.min(mock.limit, Math.round((Date.now() - mock.t0) / 1000));
  let score = 0;
  for (const k of mock.keys) { const q = D.byId[k], ok = mock.ans[k] === q.answer; if (ok) score++; record(k, ok, q.points); }
  mock.score = score;
  mocks().push({ t: Math.floor(Date.now() / 1000), title: mock.title, score, n: mock.keys.length, secs: mock.secs });
  C.save();
  clearInterval(mockTimer);
  if (location.hash === "#/kk/mock") viewMock(); else location.hash = "#/kk/mock";
}
function viewMockResult(D) {
  const { $, esc } = C;
  const n = mock.keys.length;
  const byBook = BOOKS.map((b) => { const ks = mock.keys.filter((k) => D.byId[k].book === b.id); return { b, n: ks.length, ok: ks.filter((k) => mock.ans[k] === D.byId[k].answer).length }; }).filter((x) => x.n);
  $("#app").innerHTML = `<div class="crumbs"><a href="#/kk">过去问</a> › ${esc(mock.title)}</div><h1>模考结果${mock.timeout ? `<span class="muted small">　时间到，自动交卷</span>` : ""}</h1>
  <div class="stats">
    <div class="stat"><div class="v">${mock.score}<span class="muted small"> / ${n}</span></div><div class="k">得分</div></div>
    <div class="stat"><div class="v">${pct(mock.score, n)}</div><div class="k">正确率</div></div>
    <div class="stat"><div class="v">${fmtS(mock.secs)}</div><div class="k">用时（限时 ${fmtS(mock.limit)}）</div></div>
  </div>
  ${n === EXAM_TOTAL ? `<p class="small muted">${PASS_HINT}。</p>` : `<p class="small muted">参考：${PASS_HINT}，折合正确率约 66〜76%。</p>`}
  <div class="card"><h2>各科得分 vs 合格目标</h2>
    ${byBook.map((x) => { const goal = Math.round((TARGET[x.b.id] / x.b.examQ) * x.n * 10) / 10, okGoal = x.ok >= goal;
      return `<div class="hrow"><span class="hl">${esc(x.b.title)}</span><div class="hbar single"><i class="${okGoal ? "ok" : "ng"}" style="width:${(x.ok / x.n) * 100}%"></i><b class="goal" style="left:${(goal / x.n) * 100}%" title="目标 ${goal}"></b></div><span class="hv">${x.ok}/${x.n}</span><span class="small ${okGoal ? "" : "muted"}" style="width:110px">${okGoal ? "✓ 达到" : "差"} 目标 ${goal}</span></div>`; }).join("")}
    <p class="small muted" style="margin:8px 0 0">合格目标（满分 50）：権利関係 ${TARGET.kenri}/14 · 宅建業法 ${TARGET.gyoho}/20 · 法令上の制限 ${TARGET.hourei}/8 · 税・その他 ${TARGET.zei}/8，合计 ${Object.values(TARGET).reduce((a, b) => a + b)} 分，留出近年合格线的余量。竖线 = 按题数折算的目标。</p></div>
  <div class="card">${mock.keys.map((k, i) => { const q = D.byId[k], a = mock.ans[k];
    return `<div class="hrow kk-row"><span>${a === q.answer ? '<i class="rk ok">○</i>' : '<i class="rk ng">×</i>'}</span><span class="hl">第 ${i + 1} 题 · ${esc(D.exams[q.exam])} 問${q.no}</span>
      <span class="small muted" style="flex:1">你选 ${a || "—"} · 正解 ${q.answer}</span><button class="btn sm" data-rv="${i}">看解析</button></div>`; }).join("")}</div>
  <div class="row"><button class="btn primary" id="rvAll">逐题看解析</button><a class="btn" href="#/kk">回过去问</a></div>`;
  const review = (i) => { start("q", mock.keys, `${mock.title} 复盘`, { preset: { ...mock.ans } }); run.i = i; run.picked = run.preset[mock.keys[i]] ?? 0; viewRun(); };
  $("#rvAll").onclick = () => review(0);
  $("#app").onclick = (e) => { const b = e.target.closest("[data-rv]"); if (b) review(Number(b.dataset.rv)); };
}

// 各科合格目标分（合计 38，近年合格线 33〜38）：业法拿满是关键，权利关系不贪
const TARGET = { kenri: 9, gyoho: 18, hourei: 6, zei: 5 };

// ---------- 做题页 ----------
const nl = (s) => C.esc(String(s ?? "").replace(/^[【（(]?問\s*\d+[】）)]\s*/, "")).replace(/\n/g, "<br>");
const typeName = { single: "四选一", count: "个数问题", combo: "组合问题" };
const ptLinks = (ids) => ids.map((id) => { const p = POINT_BY_ID[id]; return p ? `<a class="pt-link" href="#/p/${id}">${C.esc(p.courseTitle)} › ${C.esc(p.title)}</a>` : ""; }).join(" ");

export async function viewRun() {
  const { $, esc } = C;
  if (!run) { location.hash = "#/kk"; return; }
  const D = await kkDB();
  if (run.i >= run.keys.length) return viewDone(D);
  const key = run.keys[run.i];
  const head = `<div class="crumbs"><a href="#/kk">过去问</a> › ${esc(run.title)} · 第 ${run.i + 1} / ${run.keys.length} ${run.kind === "q" ? "题" : "肢"}
    <span class="spacer"></span><a href="javascript:void 0" id="kkQuit" class="small">${run.preset ? "回到成绩" : "结束"}</a></div>
    <div class="bar" style="margin-bottom:12px"><i class="m" style="width:${(run.i / run.keys.length) * 100}%"></i></div>`;
  const shown = run.picked !== null; // 模考复盘时 picked 可能是 0（没答）
  if (run.kind === "q") {
    const q = D.byId[key], ans = run.picked;
    $("#app").innerHTML = head + `<div class="card kk-q">
      <div class="row"><b>${esc(D.exams[q.exam])} 【問${q.no}】</b><span class="muted small">${esc(BOOK_BY_ID[q.book]?.title || "")} · ${typeName[q.type]}</span><span class="spacer"></span><button class="btn sm" id="zhBtn">中文意思</button><button class="btn sm" id="sideBtn">讲义 / AI 老师</button></div>
      <div class="kk-stem" lang="ja">${nl(q.stem)}</div>
      <div class="kk-zh" id="zh" hidden>${esc(q.stemZh)}</div>
      ${q.items?.length ? `<div class="kk-items">${q.items.map((it, i) => {
        const s = q.statements[i];
        return `<div class="kk-item ${shown ? (s.ok ? "ok" : "ng") : ""}" lang="ja"><b>${esc(it.label)}</b> ${nl(it.text)}${shown ? ` <span class="mk">${s.ok ? "○" : "×"}</span>` : ""}</div>`;
      }).join("")}</div>` : ""}
      <div class="kk-choices">${q.choices.map((c, i) => {
        const n = i + 1, cls = !shown ? "" : n === q.answer ? "right" : n === ans ? "wrong" : "dim";
        const s = q.type === "single" ? q.statements[i] : null;
        return `<button class="kk-choice ${cls}" data-c="${n}" ${shown ? "disabled" : ""}><b>${n}</b><span lang="ja">${nl(c)}</span>${shown && s ? `<span class="mk">${s.ok ? "○" : "×"}</span>` : ""}</button>`;
      }).join("")}</div>
    </div>
    ${shown ? explainQ(q, ans) : `<p class="small muted">键盘：1〜4 选择。</p>`}`;
    if (!shown) document.querySelectorAll("[data-c]").forEach((b) => b.onclick = () => answerQ(q, Number(b.dataset.c)));
  } else {
    const x = D.stById[key], q = x.q;
    const text = q.type === "single" ? q.choices[x.i] : q.items[x.i]?.text;
    const ans = run.picked; // "o" | "x"
    const right = shown && ((ans === "o") === x.s.ok);
    $("#app").innerHTML = head + `<div class="card kk-q">
      <div class="row"><span class="muted small">${esc(D.exams[q.exam])} 【問${q.no}】 第 ${esc(x.s.key)} 肢 · ${esc(BOOK_BY_ID[q.book]?.title || "")}</span><span class="spacer"></span><button class="btn sm" id="zhBtn">中文意思</button><button class="btn sm" id="sideBtn">讲义 / AI 老师</button></div>
      <details class="kk-ctx"><summary class="small muted">题目前提（判决文、人物关系等在这里）</summary><div class="kk-stem small" lang="ja">${nl(q.stem)}</div></details>
      <div class="kk-ox-text" lang="ja">${nl(text)}</div>
      <div class="kk-zh" id="zh" hidden>${esc(x.s.textZh)}</div>
      <p class="small muted" style="margin:6px 0 0">判断这句话本身对不对（按出题当时的法律）。</p>
      <div class="row kk-ox">
        <button class="kk-ob ${shown ? (x.s.ok ? "right" : ans === "o" ? "wrong" : "dim") : ""}" data-ox="o" ${shown ? "disabled" : ""}>○</button>
        <button class="kk-ob ${shown ? (!x.s.ok ? "right" : ans === "x" ? "wrong" : "dim") : ""}" data-ox="x" ${shown ? "disabled" : ""}>×</button>
      </div>
    </div>
    ${shown ? `<div class="card kk-exp ${right ? "ok" : "ng"}">
      <div class="kk-verdict">${right ? '<i class="rk ok">○</i> 答对了' : '<i class="rk ng">×</i> 答错了'}　正确：<b>${x.s.ok ? "○" : "×"}</b></div>
      ${stmtHtml(x.s, x.pts, true)}
      ${q.lawChange ? `<div class="kk-law">法改正注意：${esc(q.lawChange)}</div>` : ""}
      <div class="row" style="margin-top:12px"><span class="spacer"></span>${C.ai() ? `<button class="btn" id="kkAsk">问 AI 老师</button>` : ""}<button class="btn primary" id="kkNext">下一肢 →</button></div>
    </div>` : `<p class="small muted">键盘：O / X（或 1 / 2）。</p>`}`;
    if (!shown) document.querySelectorAll("[data-ox]").forEach((b) => b.onclick = () => answerOX(x, b.dataset.ox));
  }
  // 左边题目、右边侧栏（讲义 / AI 老师），不离开做题页
  const app = $("#app"), main = document.createElement("div"), wrap = document.createElement("div"), side = document.createElement("aside");
  main.className = "kk-main"; main.append(...app.childNodes);
  side.className = "kk-side"; side.id = "kkSide";
  wrap.className = "kk-split"; wrap.append(main, side); app.append(wrap);
  const pts = isQ(key) ? D.byId[key].points : D.stById[key].pts;
  C.mountSide(side, pts);
  $("#zhBtn").onclick = () => { $("#zh").hidden = !$("#zh").hidden; };
  $("#sideBtn").onclick = () => C.openSide(pts, "explain");
  if ($("#kkNext")) $("#kkNext").onclick = next;
  if ($("#kkAsk")) $("#kkAsk").onclick = () => askAbout(D, key, pts);
  C.linkLaws(main);
  $("#kkQuit").onclick = () => {
    if (run.preset) { location.hash = "#/kk/mock"; return; }
    run.keys = run.keys.slice(0, run.i + (shown ? 1 : 0)); run.i = run.keys.length; viewRun();
  };
}
// 题目页「问 AI 老师」：带着题目、选项、正解和我的答案，在右边侧栏里直接问（对话存进相关ポイント）
function askAbout(D, key, pts) {
  const strip = (t) => String(t || "").replace(/^[【（(]?問\s*\d+[】）)]\s*/, "");
  if (isQ(key)) {
    const q = D.byId[key], a = run.picked;
    const items = q.items?.length ? q.items.map((it) => `${it.label}　${it.text}`).join("\n") + "\n" : "";
    C.askAI(pts, `我在做过去问 ${D.exams[q.exam]} 問${q.no}：\n【题目】${strip(q.stem)}\n${items}【选项】\n${q.choices.map((c, i) => `${i + 1}　${c}`).join("\n")}\n【正解】${q.answer}　【我的答案】${a || "没答"}\n请讲解这道题：每个选项为什么对或错、考的是哪条规则，以及我${a === q.answer ? "还有哪里可能没真正弄懂" : "错在哪里、下次怎么避免"}。`);
  } else {
    const x = D.stById[key], q = x.q;
    const text = q.type === "single" ? q.choices[x.i] : q.items[x.i]?.text;
    C.askAI(pts, `我在做一問一答（${D.exams[q.exam]} 問${q.no} 第 ${x.s.key} 肢）：\n【题目前提】${strip(q.stem)}\n【这一肢】${text}\n【正确】${x.s.ok ? "○" : "×"}　【我的答案】${run.picked === "o" ? "○" : "×"}\n请讲清楚为什么是${x.s.ok ? "○" : "×"}，依据是什么，容易和什么混淆。`);
  }
}
function stmtHtml(s, pts, full) {
  const { esc, md } = C;
  return `<div class="kk-st ${s.ok ? "ok" : "ng"}">
    <div class="kk-st-h"><b>${esc(s.key)}</b> <span class="mk">${s.ok ? "○" : "×"}</span> ${full ? "" : `<span class="small">${esc(s.textZh)}</span>`}</div>
    ${full ? `<div class="small muted" style="margin-bottom:4px">${esc(s.textZh)}</div>` : ""}
    <div class="kk-st-b">${md(s.explain)}</div>
    <div class="small muted">${s.law ? `依据：${C.lawHtml(s.law)}　` : ""}${ptLinks(pts || [])}</div>
  </div>`;
}
function explainQ(q, ans) {
  const { esc } = C;
  const right = ans === q.answer;
  const last = run.i >= run.keys.length - 1;
  return `<div class="card kk-exp ${right ? "ok" : "ng"}">
    <div class="kk-verdict">${right ? '<i class="rk ok">○</i> 答对了' : ans ? `<i class="rk ng">×</i> 答错了（你选 ${ans}）` : '<i class="rk ng">×</i> 没作答'}　正解：<b>${q.answer}</b></div>
    ${q.takeaway ? `<p class="kk-take">${esc(q.takeaway)}</p>` : ""}
    ${q.lawChange ? `<div class="kk-law">法改正注意：${esc(q.lawChange)}</div>` : ""}
    ${q.statements.map((s) => stmtHtml(s, s.points?.length ? s.points : q.points, false)).join("")}
    <div class="row" style="margin-top:12px"><span class="small muted">相关ポイント：${ptLinks(q.points)}</span><span class="spacer"></span>${C.ai() ? `<button class="btn" id="kkAsk">问 AI 老师</button>` : ""}<button class="btn primary" id="kkNext">${run.preset && last ? "回到成绩" : "下一题 →"}</button></div>
  </div>`;
}
function answerQ(q, n) {
  run.picked = n; run.res.push(n === q.answer);
  record(q.id, n === q.answer, q.points); C.save();
  viewRun();
  document.querySelector(".kk-exp")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function answerOX(x, v) {
  const ok = (v === "o") === x.s.ok;
  run.picked = v; run.res.push(ok);
  record(x.key, ok, x.pts); C.save();
  viewRun();
}
function next() {
  run.i++;
  if (run.preset) { // 模考复盘：不记成绩，直接看下一题解析
    if (run.i >= run.keys.length) { location.hash = "#/kk/mock"; return; }
    run.picked = run.preset[run.keys[run.i]] ?? 0;
  } else run.picked = null;
  viewRun(); window.scrollTo(0, 0);
}

function viewDone(D) {
  const { $, esc } = C;
  const n = run.res.length, ok = run.res.filter(Boolean).length;
  const secs = Math.floor((Date.now() - run.t0) / 1000);
  const wrongHere = run.keys.slice(0, n).filter((_, i) => !run.res[i]);
  const name = (k) => isQ(k) ? `${D.exams[D.byId[k].exam]} 問${D.byId[k].no}` : `${D.exams[D.stById[k].q.exam]} 問${D.stById[k].q.no}-${D.stById[k].s.key}`;
  $("#app").innerHTML = `<div class="crumbs"><a href="#/kk">过去问</a> › ${esc(run.title)}</div><h1>本轮结果</h1>
  <div class="stats">
    <div class="stat"><div class="v">${ok}<span class="muted small"> / ${n}</span></div><div class="k">答对</div></div>
    <div class="stat"><div class="v">${pct(ok, n)}</div><div class="k">正确率</div></div>
    <div class="stat"><div class="v">${fmtS(secs)}</div><div class="k">用时</div></div>
  </div>
  <div class="card">${run.keys.slice(0, n).map((k, i) => `<div class="hrow kk-row"><span>${run.res[i] ? '<i class="rk ok">○</i>' : '<i class="rk ng">×</i>'}</span><span class="hl" style="flex:1">${esc(name(k))}</span><button class="btn sm" data-one="${k}">再做</button></div>`).join("") || "没有作答。"}</div>
  <div class="row">${wrongHere.length ? `<button class="btn primary" id="again">重做这轮错的 ${wrongHere.length} ${run.kind === "q" ? "题" : "肢"}</button>` : ""}<a class="btn" href="#/kk">回过去问</a></div>`;
  const kind = run.kind;
  if ($("#again")) $("#again").onclick = () => start(kind, wrongHere, "重做错的");
  $("#app").onclick = (e) => { const b = e.target.closest("[data-one]"); if (b) start(isQ(b.dataset.one) ? "q" : "ox", [b.dataset.one], "再做一次"); };
}

// 键盘
addEventListener("keydown", (e) => {
  if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName) || e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (location.hash === "#/kk/mock" && mock && !mock.done) {
    if (/^[1-4]$/.test(k)) document.querySelector(`[data-c="${k}"]`)?.click();
    if (k === "arrowleft") document.querySelector("#mPrev:not(:disabled)")?.click();
    if (k === "arrowright") document.querySelector("#mNext:not(:disabled)")?.click();
    return;
  }
  if (location.hash !== "#/kk/run" || !run) return;
  if (run.picked === null) {
    if (run.kind === "q" && /^[1-4]$/.test(k)) document.querySelector(`[data-c="${k}"]`)?.click();
    if (run.kind === "ox" && (k === "o" || k === "1")) document.querySelector(`[data-ox="o"]`)?.click();
    if (run.kind === "ox" && (k === "x" || k === "2")) document.querySelector(`[data-ox="x"]`)?.click();
  } else if (k === "enter" || k === "arrowright" || k === " ") { e.preventDefault(); document.querySelector("#kkNext")?.click(); }
});

// ---------- 知识点页里的「本节真题」 ----------
export async function fillPointCard(id, box) {
  const { esc } = C;
  let D;
  try { D = await kkDB(); } catch { box.innerHTML = `<p class="small muted">题库读取失败。</p>`; return; }
  const qs = D.qs.filter((q) => q.points.includes(id));
  const st = D.stmts.filter((x) => x.pts.includes(id));
  const { m, nExams } = await pointInfo();
  const h = heat(m.get(id), nExams);
  if (!qs.length && !st.length) { box.innerHTML = `<p class="small muted" style="margin:8px 0 0">${D.byBook[POINT_BY_ID[id]?.book]?.qs.length ? `近 ${nExams} 场过去问里没有直接考这一节的题。` : "这一科的题库还没导入。"}</p>`; return; }
  const T = tally();
  const s = statFor([...qs.map((q) => q.id), ...st.map((x) => x.key)], T);
  const w = new Set(wrongKeys());
  const nw = [...qs.map((q) => q.id), ...st.map((x) => x.key)].filter((k) => w.has(k));
  box.innerHTML = `<p class="small" style="margin:8px 0">${h ? `<span class="freq ${h.cls}" title="${h.tip}">${h.label}</span> ${h.tip}。` : ""}本节相关：四选一 <b>${qs.length}</b> 题 · ○× <b>${st.length}</b> 肢${s.n ? ` · 正确率 <b>${pct(s.ok, s.n)}</b>（${s.ok}/${s.n}）` : " · 还没做过"}</p>
    <div class="row">
      ${st.length ? `<button class="btn primary" id="kpO">一問一答 ○×（${st.length}）</button>` : ""}
      ${qs.length ? `<button class="btn primary" id="kpQ">过去问 四选一（${qs.length}）</button>` : ""}
      ${nw.length ? `<button class="btn" id="kpW">本节错题（${nw.length}）</button>` : ""}
    </div>
    ${qs.length ? `<details style="margin-top:8px"><summary class="small muted">题目清单</summary>${qs.map((q) => {
      const a = T.get(q.id);
      return `<div class="hrow kk-row small"><span>${a ? (a.seq.at(-1) ? '<i class="rk ok">○</i>' : '<i class="rk ng">×</i>') : '<i class="rk">－</i>'}</span><span class="hl">${esc(D.exams[q.exam])} 問${q.no}</span><span style="flex:1">${esc(q.takeaway || q.stemZh)}</span><button class="btn sm" data-kq="${q.id}">做</button></div>`;
    }).join("")}</details>` : ""}`;
  const pt = POINT_BY_ID[id];
  if (box.querySelector("#kpO")) box.querySelector("#kpO").onclick = () => start("ox", shuffle(st.map((x) => x.key)), `${pt.title} ○×`);
  if (box.querySelector("#kpQ")) box.querySelector("#kpQ").onclick = () => start("q", qs.map((q) => q.id), `${pt.title} 过去问`);
  if (box.querySelector("#kpW")) box.querySelector("#kpW").onclick = () => { const q = nw.filter(isQ); start(q.length ? "q" : "ox", q.length ? q : nw, `${pt.title} 错题`); };
  box.querySelectorAll("[data-kq]").forEach((b) => b.onclick = () => start("q", [b.dataset.kq], `${pt.title} 过去问`));
}

// ---------- 统计页：按コース正确率 ----------
export async function courseAccuracy() {
  const D = await kkDB();
  const T = tally();
  return BOOKS.flatMap((b) => b.courses.map((c) => {
    const k = `${b.id}:${c.n}`;
    const keys = [...D.qs.filter((q) => q.points.some((p) => courseKey(p) === k)).map((q) => q.id), ...D.stmts.filter((x) => x.pts.some((p) => courseKey(p) === k)).map((x) => x.key)];
    return { b, c, ...statFor(keys, T) };
  }));
}

// ---------- 给其他页面用 ----------
export function startQ(keys, title) { start("q", keys, title); }
export function startOX(keys, title) { start("ox", keys, title); }
export async function lawChangeQs() {
  const D = await kkDB();
  return D.qs.filter((q) => q.lawChange).map((q) => ({ ...q, examName: D.exams[q.exam] }));
}
// 预测得分：每科用最近 30 次「四选一」（含模考）的正确率 × 本试题数。少于 10 次算「数据不足」。
export async function predictScore() {
  const D = await kkDB();
  const recent = {};
  for (const [k, ok] of log()) { if (!isQ(k)) continue; const q = D.byId[k]; if (!q) continue; (recent[q.book] ||= []).push(ok); }
  return BOOKS.map((b) => {
    const has = D.byBook[b.id].qs.length > 0;
    const r = (recent[b.id] || []).slice(-30);
    const acc = r.length ? r.reduce((x, y) => x + y, 0) / r.length : null;
    return { b, has, n: r.length, acc, est: r.length >= 10 ? acc * b.examQ : null };
  });
}
// 每科过去问累计：{ kenri: {ok, n, done, total}, ... }
export async function bookAccuracy() {
  const D = await kkDB(), T = tally();
  return Object.fromEntries(BOOKS.map((b) => {
    const keys = [...D.byBook[b.id].qs.map((q) => q.id), ...D.byBook[b.id].st.map((x) => x.key)];
    return [b.id, { ...statFor(keys, T), total: D.byBook[b.id].qs.length }];
  }));
}
