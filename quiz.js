// 过去问（站内题库）：四科总览 / 科目页 / 四选一 / 一問一答（○×）/ 模考 / 错题本 / 弱点 / 高频
// 题库来自 RETIO 官方过去问，tools/kakomon.mjs 生成，每科一个文件 data/kakomon/<科目id>.json（没有的科目显示「待导入」）。
import { BOOKS, BOOK_BY_ID, POINT_BY_ID, EXAM_TOTAL, PASS_HINT } from "./toc.js?v=54dc5fc89f";
import { loadKakomon } from "./store.js?v=54dc5fc89f";

let C; // 由 app.js 注入：{ S, save, touchDay, $, esc, md, addDays, today }
export function initKK(ctx) { C = ctx; }

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
const nExamsOf = (D) => Object.keys(D.exams).length;

// ---------- 作答记录 S.kkLog = [[key, 1 对/0 错, 时间(秒)], …]；key = "R05-03"（四选一）或 "R05-03#2"（○× 一肢） ----------
const log = () => (C.S().kkLog ||= []);
const mocks = () => (C.S().mocks ||= []);
function tally() {
  const m = new Map();
  for (const [k, ok] of log()) { const a = m.get(k) || { n: 0, ok: 0, seq: [] }; a.n++; a.ok += ok; a.seq.push(ok); m.set(k, a); }
  return m;
}
// 错过、而且之后还没连续答对 2 次 → 在错题本里
const inWrong = (a) => { const z = a.seq.lastIndexOf(0); return z >= 0 && a.seq.length - 1 - z < 2; };
export function wrongKeys() { return [...tally()].filter(([, a]) => inWrong(a)).map(([k]) => k); }
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
  return r >= 0.75 ? { cls: "hot", label: `🔥 ${x.nEx}/${nExams}`, tip: `近 ${nExams} 场考试里考了 ${x.nEx} 场（高频）` }
    : r >= 0.5 ? { cls: "warm", label: `⭐ ${x.nEx}/${nExams}`, tip: `近 ${nExams} 场考试里考了 ${x.nEx} 场（常考）` }
    : { cls: "", label: `${x.nEx}/${nExams}`, tip: `近 ${nExams} 场考试里考了 ${x.nEx} 场` };
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
  $("#app").innerHTML = `<h1>📝 过去问</h1><div class="empty">加载题库…</div>`;
  let D;
  try { D = await kkDB(); } catch (e) { $("#app").innerHTML = `<h1>📝 过去问</h1><div class="card">题库读取失败：${esc(e.message)}</div>`; return; }
  const T = tally(), wrong = wrongKeys();
  const all = statFor([...D.qs.map((q) => q.id), ...D.stmts.map((x) => x.key)], T);
  const ready = BOOKS.filter((b) => D.byBook[b.id].qs.length);
  const full = ready.length === BOOKS.length;
  const { m, nExams } = await pointInfo();
  const weak = [...m.values()].filter(WEAK).sort((a, b) => a.ok / a.n - b.ok / b.n).slice(0, 6);
  $("#app").innerHTML = `<h1>📝 过去问</h1>
  <p class="muted small" style="margin-top:0">官方真题（RETIO）。本试共 ${EXAM_TOTAL} 题、2 小时；${PASS_HINT}。目前已导入 ${ready.map((b) => b.title).join("、") || "—"}，其他科目陆续补充。</p>
  <div class="stats">
    <div class="stat"><div class="v">${D.qs.length}<span class="muted small"> 题</span></div><div class="k">已导入（${D.stmts.length} 个 ○× 肢）</div></div>
    <div class="stat"><div class="v">${all.n}</div><div class="k">累计作答</div></div>
    <div class="stat"><div class="v">${pct(all.ok, all.n)}</div><div class="k">正确率</div></div>
    <div class="stat"><div class="v">${wrong.length}</div><div class="k">错题本待重做</div></div>
  </div>
  <div class="kk-books">${BOOKS.map((b) => {
    const { qs, st } = D.byBook[b.id];
    const s = statFor([...qs.map((q) => q.id), ...st.map((x) => x.key)], T);
    return qs.length
      ? `<a class="card kk-book" href="#/kk/${b.id}"><div class="row"><b>${esc(b.title)}</b><span class="muted small">${esc(b.zh)}</span><span class="spacer"></span><span class="muted small">本试 ${b.examQ} 题</span></div>
          <div class="small" style="margin:6px 0">题库 <b>${qs.length}</b> 题 · ○× <b>${st.length}</b> 肢</div>
          <div class="small muted">${s.n ? `作答 ${s.n} 次 · 正确率 <b>${pct(s.ok, s.n)}</b>` : "还没做过"}</div>
          <div class="kk-book-go">进入 →</div></a>`
      : `<div class="card kk-book off"><div class="row"><b>${esc(b.title)}</b><span class="muted small">${esc(b.zh)}</span><span class="spacer"></span><span class="muted small">本试 ${b.examQ} 题</span></div>
          <div class="small muted" style="margin:6px 0">${esc(b.qNo)}${b.note ? ` · ${esc(b.note)}` : ""}</div>
          <div class="small muted">📦 题库待导入</div></div>`;
  }).join("")}</div>
  <div class="card">
    <div class="row"><h2 style="margin:0">⏱ 模考</h2><span class="spacer"></span><a class="small" href="#/kk/wrong">❌ 错题本（${wrong.length}）</a></div>
    <p class="small muted" style="margin:8px 0">交卷前不显示对错，时间按本试节奏（2 小时 / 50 题，每题约 2 分 24 秒）。</p>
    <div class="row">
      <button class="btn primary" data-mockall ${full ? "" : "disabled"} title="${full ? "" : "四科题库都导入后才能做"}">全科模考 50 题 · 120 分钟</button>
      ${ready.map((b) => `<button class="btn" data-mockbook="${b.id}">${esc(b.title)} ${b.examQ} 题 · ${Math.round(b.examQ * 2.4)} 分钟</button>`).join("")}
    </div>
    ${full ? "" : `<p class="small muted" style="margin:8px 0 0">全科模考要等四科题库都导入后开放；现在可以先做单科模考。</p>`}
    ${mockHistory()}
  </div>
  <div class="card"><h2>🎯 薄弱ポイント</h2>${weak.length ? weakRows(weak, nExams) : `<p class="small muted" style="margin:0">做题后，正确率低于 70% 的ポイント会出现在这里（每个至少答 3 次才算）。</p>`}</div>`;
  $("#app").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.mockall !== undefined) startMock(BOOKS.flatMap((x) => pickMock(D, x.id, x.examQ)), "全科模考");
    if (b.dataset.mockbook) { const x = BOOK_BY_ID[b.dataset.mockbook]; startMock(pickMock(D, x.id, x.examQ), `${x.title} 模考`); }
    weakClick(b, D);
  };
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
// 单科模考：尽量每场抽一题、分散年度；不足再随机补
function pickMock(D, book, n) {
  const pool = shuffle(D.byBook[book].qs);
  const out = [], used = new Set();
  for (const q of pool) if (out.length < n && !used.has(q.exam)) { out.push(q); used.add(q.exam); }
  for (const q of pool) if (out.length < n && !out.includes(q)) out.push(q);
  return out.sort((a, b) => a.no - b.no).map((q) => q.id);
}

// ---------- 科目页 ----------
export async function viewBook(bookId) {
  const { $, esc } = C;
  const b = BOOK_BY_ID[bookId];
  const D = await kkDB();
  const { qs, st } = D.byBook[bookId];
  const crumbs = `<div class="crumbs"><a href="#/kk">过去问</a> › ${esc(b.title)}</div>`;
  if (!qs.length) { $("#app").innerHTML = `${crumbs}<h1>${esc(b.title)}</h1><div class="card">📦 这一科的题库还没导入（本试 ${b.examQ} 题，${esc(b.qNo)}）。</div>`; return; }
  const T = tally();
  const { m, nExams } = await pointInfo();
  const sQ = statFor(qs.map((q) => q.id), T), sO = statFor(st.map((x) => x.key), T);
  const wrong = wrongKeys().filter((k) => (isQ(k) ? D.byId[k] : D.stById[k]?.q)?.book === bookId);
  const exams = [...new Set(qs.map((q) => q.exam))];
  const courses = b.courses.map((c) => {
    const k = `${bookId}:${c.n}`;
    const cq = qs.filter((q) => q.points.some((p) => courseKey(p) === k));
    const cs = st.filter((x) => x.pts.some((p) => courseKey(p) === k));
    return { c, qs: cq, st: cs, s: statFor([...cq.map((q) => q.id), ...cs.map((x) => x.key)], T) };
  });
  const pts = [...m.values()].filter((x) => POINT_BY_ID[x.id]?.book === bookId);
  const hot = pts.filter((x) => x.nEx / nExams >= 0.75).sort((a, b) => b.nEx - a.nEx || b.st - a.st);
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
    <div class="row">
      <button class="btn primary" data-go="rq">随机 10 题（四选一）</button>
      <button class="btn primary" data-go="ro">随机 20 肢（○×）</button>
      <button class="btn" data-go="nq">没做过的 10 题</button>
      <button class="btn" data-go="hot" ${hot.length ? "" : "disabled"}>🔥 高频ポイント ○×</button>
      <button class="btn" data-go="wrong" ${wrong.length ? "" : "disabled"}>❌ 本科错题（${wrong.length}）</button>
      <button class="btn" data-go="mock">⏱ 模考 ${b.examQ} 题</button>
    </div>
    <p class="small muted" style="margin:10px 0 0">做错的题进错题本，之后连续答对 2 次才移出；相关ポイント如果已标「已掌握」，会被排到明天回炉复习。</p>
  </div>
  <div class="card"><h2>🎯 薄弱ポイント</h2>${weak.length ? weakRows(weak.slice(0, 8), nExams) : `<p class="small muted" style="margin:0">做题后，正确率低于 70% 的ポイント会出现在这里（每个至少答 3 次才算）。</p>`}</div>
  <div class="card"><h2>🔥 高频ポイント</h2>
    <p class="small muted" style="margin-top:-6px">近 ${nExams} 场考试里出现 ≥ 75% 的ポイント（按场数排序）。</p>
    ${hot.map((x) => { const p = POINT_BY_ID[x.id], h = heat(x, nExams);
      return `<div class="hrow kk-row"><span class="freq hot" title="${h.tip}">${h.label}</span><a class="hl" href="#/p/${x.id}">${esc(p.courseTitle)} › <b>${esc(p.title)}</b></a>
        <span class="small muted" style="flex:1">${x.q} 题 · ${x.st} 肢${x.n ? ` · 我的正确率 ${pct(x.ok, x.n)}` : ""}</span>
        <span class="small">${{ mastered: "✅ 已掌握", learning: "🟡 学习中" }[C.S().points[x.id]?.status] || "⬜ 未学"}</span>
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
        <button class="btn sm" data-exam="${ex}">练习</button><button class="btn sm" data-exmock="${ex}">⏱ 模考</button></div>`;
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
    if (d.go === "rq") start("q", shuffle(qs.map((q) => q.id)).slice(0, 10), `${b.title} 随机 10 题`);
    if (d.go === "ro") start("ox", shuffle(st.map((x) => x.key)).slice(0, 20), `${b.title} 随机 20 肢`);
    if (d.go === "nq") start("q", shuffle(qs.filter((q) => !T.has(q.id)).map((q) => q.id)).slice(0, 10), `${b.title} 没做过的题`);
    if (d.go === "hot") { const ids = new Set(hot.map((x) => x.id)); start("ox", shuffle(st.filter((x) => x.pts.some((p) => ids.has(p))).map((x) => x.key)).slice(0, 30), `${b.title} 高频ポイント`); }
    if (d.go === "wrong") { const q = wrong.filter(isQ); start(q.length ? "q" : "ox", shuffle(q.length ? q : wrong), `${b.title} 错题`); }
    if (d.go === "mock") startMock(pickMock(D, bookId, b.examQ), `${b.title} 模考`);
    if (d.exam) start("q", qs.filter((q) => q.exam === d.exam).map((q) => q.id), `${D.exams[d.exam]} ${b.title}`);
    if (d.exmock) startMock(qs.filter((q) => q.exam === d.exmock).map((q) => q.id), `${D.exams[d.exmock]} ${b.title} 模考`);
    if (d.cq) { const c = courses.find((x) => x.c.n == d.cq); start("q", c.qs.map((q) => q.id), `第${c.c.n}コース ${c.c.title}`); }
    if (d.co) { const c = courses.find((x) => x.c.n == d.co); start("ox", shuffle(c.st.map((x) => x.key)), `第${c.c.n}コース ${c.c.title} ○×`); }
    weakClick(el, D);
  };
}

// ---------- 错题本 ----------
export async function viewWrong() {
  const { $, esc } = C;
  const D = await kkDB();
  const T = tally();
  const ks = wrongKeys().filter((k) => (isQ(k) ? D.byId[k] : D.stById[k]));
  const bookOf = (k) => (isQ(k) ? D.byId[k] : D.stById[k].q).book;
  const row = (k) => {
    const a = T.get(k);
    const [label, text] = isQ(k) ? [`${D.exams[D.byId[k].exam]} 問${D.byId[k].no}`, D.byId[k].takeaway || D.byId[k].stemZh]
      : [`${D.exams[D.stById[k].q.exam]} 問${D.stById[k].q.no}-${D.stById[k].s.key}`, D.stById[k].s.textZh];
    return `<div class="hrow kk-row"><span class="hl">${isQ(k) ? "四选一" : "○×"} · ${esc(label)}</span><span class="small" style="flex:1">${esc(text)}</span><span class="small muted">错 ${a.n - a.ok} 次</span><button class="btn sm" data-one="${k}">重做</button></div>`;
  };
  $("#app").innerHTML = `<div class="crumbs"><a href="#/kk">过去问</a> › 错题本</div><h1>❌ 错题本</h1>
  <p class="muted small" style="margin-top:0">做错后连续答对 2 次，就自动移出。</p>
  ${ks.length ? "" : `<div class="card">🎉 错题本是空的。</div>`}
  ${BOOKS.map((b) => {
    const mine = ks.filter((k) => bookOf(k) === b.id);
    if (!mine.length) return "";
    const q = mine.filter(isQ), o = mine.filter((k) => !isQ(k));
    return `<div class="card"><div class="row"><h2 style="margin:0">${esc(b.title)}</h2><span class="spacer"></span>
      ${q.length ? `<button class="btn sm primary" data-wq="${b.id}">重做四选一 ${q.length} 题</button>` : ""}${o.length ? `<button class="btn sm primary" data-wo="${b.id}">重做 ○× ${o.length} 肢</button>` : ""}</div>
      <div style="margin-top:8px">${mine.map(row).join("")}</div></div>`;
  }).join("")}`;
  $("#app").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const d = b.dataset;
    if (d.one) start(isQ(d.one) ? "q" : "ox", [d.one], "错题重做");
    if (d.wq) start("q", shuffle(ks.filter((k) => isQ(k) && bookOf(k) === d.wq)), `${BOOK_BY_ID[d.wq].title} 错题（四选一）`);
    if (d.wo) start("ox", shuffle(ks.filter((k) => !isQ(k) && bookOf(k) === d.wo)), `${BOOK_BY_ID[d.wo].title} 错题（○×）`);
  };
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
    if (el) { el.textContent = `⏱ ${fmtS(Math.max(0, left))}`; el.classList.toggle("late", left < 300); }
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
  $("#app").innerHTML = `<div class="crumbs"><a href="#/kk">过去问</a> › ${esc(mock.title)}<span class="spacer"></span><span class="kk-timer" id="mockTimer">⏱ ${fmtS(Math.max(0, left))}</span></div>
  <div class="mock-grid">${mock.keys.map((k, i) => `<button class="${i === mock.i ? "cur" : ""} ${mock.ans[k] ? "done" : ""}" data-go="${i}">${i + 1}</button>`).join("")}</div>
  <div class="card kk-q">
    <div class="row"><b>第 ${mock.i + 1} 题</b><span class="muted small">${esc(BOOK_BY_ID[q.book]?.title || "")} · ${esc(D.exams[q.exam])} 問${q.no}</span><span class="spacer"></span><button class="btn sm" id="zhBtn">中文意思</button></div>
    <div class="kk-stem">${nl(q.stem)}</div>
    <div class="kk-zh" id="zh" hidden>${esc(q.stemZh)}</div>
    ${q.items?.length ? `<div class="kk-items">${q.items.map((it) => `<div class="kk-item"><b>${esc(it.label)}</b> ${nl(it.text)}</div>`).join("")}</div>` : ""}
    <div class="kk-choices">${q.choices.map((c, i) => `<button class="kk-choice ${a === i + 1 ? "picked" : ""}" data-c="${i + 1}"><b>${i + 1}</b><span>${nl(c)}</span></button>`).join("")}</div>
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
  ${byBook.length > 1 ? `<div class="card"><h2>各科得分</h2>${byBook.map((x) => `<div class="hrow"><span class="hl">${esc(x.b.title)}</span><div class="hbar single"><i class="${x.ok / x.n >= 0.7 ? "ok" : "ng"}" style="width:${(x.ok / x.n) * 100}%"></i></div><span class="hv">${x.ok}/${x.n}</span></div>`).join("")}</div>` : ""}
  <div class="card">${mock.keys.map((k, i) => { const q = D.byId[k], a = mock.ans[k];
    return `<div class="hrow kk-row"><span>${a === q.answer ? "✅" : "❌"}</span><span class="hl">第 ${i + 1} 题 · ${esc(D.exams[q.exam])} 問${q.no}</span>
      <span class="small muted" style="flex:1">你选 ${a || "—"} · 正解 ${q.answer}</span><button class="btn sm" data-rv="${i}">看解析</button></div>`; }).join("")}</div>
  <div class="row"><button class="btn primary" id="rvAll">逐题看解析</button><a class="btn" href="#/kk">回过去问</a></div>`;
  const review = (i) => { start("q", mock.keys, `${mock.title} 复盘`, { preset: { ...mock.ans } }); run.i = i; run.picked = run.preset[mock.keys[i]] ?? 0; viewRun(); };
  $("#rvAll").onclick = () => review(0);
  $("#app").onclick = (e) => { const b = e.target.closest("[data-rv]"); if (b) review(Number(b.dataset.rv)); };
}

// ---------- 做题页 ----------
const nl = (s) => C.esc(String(s ?? "").replace(/^[【（(]?問\s*\d+[】）)]\s*/, "")).replace(/\n/g, "<br>");
const typeName = { single: "四选一", count: "个数问题", combo: "组合问题" };
const ptLinks = (ids) => ids.map((id) => { const p = POINT_BY_ID[id]; return p ? `<a class="pt-link" href="#/p/${id}">📖 ${C.esc(p.courseTitle)} › ${C.esc(p.title)}</a>` : ""; }).join(" ");

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
      <div class="row"><b>${esc(D.exams[q.exam])} 【問${q.no}】</b><span class="muted small">${esc(BOOK_BY_ID[q.book]?.title || "")} · ${typeName[q.type]}</span><span class="spacer"></span><button class="btn sm" id="zhBtn">中文意思</button></div>
      <div class="kk-stem">${nl(q.stem)}</div>
      <div class="kk-zh" id="zh" hidden>${esc(q.stemZh)}</div>
      ${q.items?.length ? `<div class="kk-items">${q.items.map((it, i) => {
        const s = q.statements[i];
        return `<div class="kk-item ${shown ? (s.ok ? "ok" : "ng") : ""}"><b>${esc(it.label)}</b> ${nl(it.text)}${shown ? ` <span class="mk">${s.ok ? "○" : "×"}</span>` : ""}</div>`;
      }).join("")}</div>` : ""}
      <div class="kk-choices">${q.choices.map((c, i) => {
        const n = i + 1, cls = !shown ? "" : n === q.answer ? "right" : n === ans ? "wrong" : "dim";
        const s = q.type === "single" ? q.statements[i] : null;
        return `<button class="kk-choice ${cls}" data-c="${n}" ${shown ? "disabled" : ""}><b>${n}</b><span>${nl(c)}</span>${shown && s ? `<span class="mk">${s.ok ? "○" : "×"}</span>` : ""}</button>`;
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
      <div class="row"><span class="muted small">${esc(D.exams[q.exam])} 【問${q.no}】 第 ${esc(x.s.key)} 肢 · ${esc(BOOK_BY_ID[q.book]?.title || "")}</span><span class="spacer"></span><button class="btn sm" id="zhBtn">中文意思</button></div>
      <details class="kk-ctx"><summary class="small muted">题目前提（判决文、人物关系等在这里）</summary><div class="kk-stem small">${nl(q.stem)}</div></details>
      <div class="kk-ox-text">${nl(text)}</div>
      <div class="kk-zh" id="zh" hidden>${esc(x.s.textZh)}</div>
      <p class="small muted" style="margin:6px 0 0">判断这句话本身对不对（按出题当时的法律）。</p>
      <div class="row kk-ox">
        <button class="kk-ob ${shown ? (x.s.ok ? "right" : ans === "o" ? "wrong" : "dim") : ""}" data-ox="o" ${shown ? "disabled" : ""}>○</button>
        <button class="kk-ob ${shown ? (!x.s.ok ? "right" : ans === "x" ? "wrong" : "dim") : ""}" data-ox="x" ${shown ? "disabled" : ""}>×</button>
      </div>
    </div>
    ${shown ? `<div class="card kk-exp ${right ? "ok" : "ng"}">
      <div class="kk-verdict">${right ? "✅ 答对了" : "❌ 答错了"}　正确：<b>${x.s.ok ? "○" : "×"}</b></div>
      ${stmtHtml(x.s, x.pts, true)}
      ${q.lawChange ? `<div class="kk-law">⚠️ 法改正注意：${esc(q.lawChange)}</div>` : ""}
      <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn primary" id="kkNext">下一肢 →</button></div>
    </div>` : `<p class="small muted">键盘：O / X（或 1 / 2）。</p>`}`;
    if (!shown) document.querySelectorAll("[data-ox]").forEach((b) => b.onclick = () => answerOX(x, b.dataset.ox));
  }
  $("#zhBtn").onclick = () => { $("#zh").hidden = !$("#zh").hidden; };
  if ($("#kkNext")) $("#kkNext").onclick = next;
  $("#kkQuit").onclick = () => {
    if (run.preset) { location.hash = "#/kk/mock"; return; }
    run.keys = run.keys.slice(0, run.i + (shown ? 1 : 0)); run.i = run.keys.length; viewRun();
  };
}
function stmtHtml(s, pts, full) {
  const { esc, md } = C;
  return `<div class="kk-st ${s.ok ? "ok" : "ng"}">
    <div class="kk-st-h"><b>${esc(s.key)}</b> <span class="mk">${s.ok ? "○" : "×"}</span> ${full ? "" : `<span class="small">${esc(s.textZh)}</span>`}</div>
    ${full ? `<div class="small muted" style="margin-bottom:4px">${esc(s.textZh)}</div>` : ""}
    <div class="kk-st-b">${md(s.explain)}</div>
    <div class="small muted">${s.law ? `依据：${esc(s.law)}　` : ""}${ptLinks(pts || [])}</div>
  </div>`;
}
function explainQ(q, ans) {
  const { esc } = C;
  const right = ans === q.answer;
  const last = run.i >= run.keys.length - 1;
  return `<div class="card kk-exp ${right ? "ok" : "ng"}">
    <div class="kk-verdict">${right ? "✅ 答对了" : ans ? `❌ 答错了（你选 ${ans}）` : "❌ 没作答"}　正解：<b>${q.answer}</b></div>
    ${q.takeaway ? `<p class="kk-take">💡 ${esc(q.takeaway)}</p>` : ""}
    ${q.lawChange ? `<div class="kk-law">⚠️ 法改正注意：${esc(q.lawChange)}</div>` : ""}
    ${q.statements.map((s) => stmtHtml(s, s.points?.length ? s.points : q.points, false)).join("")}
    <div class="row" style="margin-top:12px"><span class="small muted">相关ポイント：${ptLinks(q.points)}</span><span class="spacer"></span><button class="btn primary" id="kkNext">${run.preset && last ? "回到成绩" : "下一题 →"}</button></div>
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
  <div class="card">${run.keys.slice(0, n).map((k, i) => `<div class="hrow kk-row"><span>${run.res[i] ? "✅" : "❌"}</span><span class="hl" style="flex:1">${esc(name(k))}</span><button class="btn sm" data-one="${k}">再做</button></div>`).join("") || "没有作答。"}</div>
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
      return `<div class="hrow kk-row small"><span>${a ? (a.seq.at(-1) ? "✅" : "❌") : "⬜"}</span><span class="hl">${esc(D.exams[q.exam])} 問${q.no}</span><span style="flex:1">${esc(q.takeaway || q.stemZh)}</span><button class="btn sm" data-kq="${q.id}">做</button></div>`;
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
