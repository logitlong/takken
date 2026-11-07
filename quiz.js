// 过去问（站内题库）：四选一 / 一問一答（○×）/ 错题本 / 本节真题
// 题目来自 RETIO 官方过去问（R2〜R7 権利関係 問1〜14），解析由 tools/kakomon.mjs 生成。
import { BOOKS, POINTS, POINT_BY_ID } from "./toc.js?v=98bec0596e";
import { loadKakomon } from "./store.js?v=98bec0596e";

let C; // 由 app.js 注入：{ S, save, touchDay, $, esc, md, addDays, P }
export function initKK(ctx) { C = ctx; }

// ---------- 数据 ----------
let DB = null, loading = null;
export async function kkDB() {
  if (DB) return DB;
  loading ||= loadKakomon().then((d) => {
    const qs = d?.questions || [];
    const stmts = [];
    for (const q of qs) q.statements.forEach((s, i) => stmts.push({ key: `${q.id}#${s.key}`, q, s, i, pts: s.points?.length ? s.points : q.points }));
    DB = { exams: d?.exams || {}, qs, byId: Object.fromEntries(qs.map((q) => [q.id, q])), stmts, stById: Object.fromEntries(stmts.map((x) => [x.key, x])) };
    return DB;
  }).catch((e) => { loading = null; throw e; });
  return loading;
}
const courseOf = (pid) => POINT_BY_ID[pid]?.course;

// ---------- 作答记录 S.kkLog = [[key, 1 对/0 错, 时间(秒)], …]；key = "R05-03"（四选一）或 "R05-03#2"（○× 一肢） ----------
const log = () => (C.S().kkLog ||= []);
function tally() {
  const m = new Map();
  for (const [k, ok] of log()) { const a = m.get(k) || { n: 0, ok: 0, seq: [] }; a.n++; a.ok += ok; a.seq.push(ok); m.set(k, a); }
  return m;
}
// 错过、而且之后还没连续答对 2 次 → 在错题本里
const inWrong = (a) => { const z = a.seq.lastIndexOf(0); return z >= 0 && a.seq.length - 1 - z < 2; };
export function wrongKeys() { return [...tally()].filter(([, a]) => inWrong(a)).map(([k]) => k); }
export function kkTotals() { let ok = 0, n = 0; for (const e of log()) { n++; ok += e[1]; } return { ok, n }; }

function record(key, ok, pts) {
  log().push([key, ok ? 1 : 0, Math.floor(Date.now() / 1000)]);
  C.touchDay();
  // 做错 → 已掌握的相关ポイント明天回炉复习
  if (!ok) for (const id of pts || []) { const p = C.S().points[id]; if (p?.status === "mastered") p.review = { step: 0, due: C.addDays(1) }; }
  C.save();
}
const pct = (ok, n) => (n ? Math.round((ok / n) * 100) + "%" : "—");
function statFor(keys, T = tally()) { let ok = 0, n = 0, done = 0; for (const k of keys) { const a = T.get(k); if (a) { ok += a.ok; n += a.n; done++; } } return { ok, n, done }; }

// ---------- 练习会话 ----------
let run = null; // { kind: "q"|"ox", keys, i, title, res: [], picked, t0, timed }
function start(kind, keys, title, timed = false) {
  if (!keys.length) return alert("没有可做的题。");
  run = { kind, keys, i: 0, title, res: [], picked: null, t0: Date.now(), timed };
  if (location.hash === "#/kk/run") viewRun(); else location.hash = "#/kk/run";
}
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const isQ = (k) => !k.includes("#");

// ---------- 题库首页 ----------
export async function viewKK() {
  const { $, esc } = C;
  $("#app").innerHTML = `<h1>📝 过去问</h1><div class="empty">加载题库…</div>`;
  let D;
  try { D = await kkDB(); } catch (e) { $("#app").innerHTML = `<h1>📝 过去问</h1><div class="card">题库读取失败：${esc(e.message)}</div>`; return; }
  if (!D.qs.length) { $("#app").innerHTML = `<h1>📝 过去问</h1><div class="card">题库还没生成。</div>`; return; }
  const T = tally();
  const qAll = statFor(D.qs.map((q) => q.id), T), oAll = statFor(D.stmts.map((x) => x.key), T);
  const wrong = wrongKeys();
  const courses = BOOKS[0].courses.map((c) => {
    const qs = D.qs.filter((q) => q.points.some((p) => courseOf(p) === c.n));
    const st = D.stmts.filter((x) => x.pts.some((p) => courseOf(p) === c.n));
    const s = statFor([...qs.map((q) => q.id), ...st.map((x) => x.key)], T);
    return { c, qs, st, s };
  });
  $("#app").innerHTML = `<h1>📝 过去问</h1>
  <p class="muted small" style="margin-top:0">官方真题（RETIO）令和2〜7年 権利関係 ${D.qs.length} 题 · 拆成 ○× ${D.stmts.length} 肢 · 每肢都有中文解析，并挂到教材ポイント。</p>
  <div class="stats">
    <div class="stat"><div class="v">${qAll.done}<span class="muted small"> / ${D.qs.length}</span></div><div class="k">四选一 做过</div></div>
    <div class="stat"><div class="v">${pct(qAll.ok, qAll.n)}</div><div class="k">四选一 正确率</div></div>
    <div class="stat"><div class="v">${oAll.done}<span class="muted small"> / ${D.stmts.length}</span></div><div class="k">○× 做过</div></div>
    <div class="stat"><div class="v">${pct(oAll.ok, oAll.n)}</div><div class="k">○× 正确率</div></div>
  </div>
  <div class="card">
    <h2>开始练习</h2>
    <div class="row">
      <button class="btn primary" data-go="rq">随机 10 题（四选一）</button>
      <button class="btn primary" data-go="ro">随机 20 肢（○×）</button>
      <button class="btn" data-go="nq">没做过的 10 题</button>
      <button class="btn ${wrong.length ? "" : ""}" data-go="wrong" ${wrong.length ? "" : "disabled"}>❌ 错题重做（${wrong.length}）</button>
      <a class="btn" href="#/kk/wrong">错题本</a>
    </div>
    <p class="small muted" style="margin:10px 0 0">做错的题进错题本，之后连续答对 2 次才移出；相关ポイント如果已标「已掌握」，会被排到明天回炉复习。</p>
  </div>
  <div class="card">
    <h2>按年度（整套 14 题）</h2>
    ${Object.entries(D.exams).map(([ex, name]) => {
      const ids = D.qs.filter((q) => q.exam === ex).map((q) => q.id);
      const s = statFor(ids, T);
      const last = ids.map((id) => T.get(id)?.seq.at(-1));
      const score = last.filter((x) => x === 1).length;
      return `<div class="hrow kk-row"><span class="hl">${esc(name)}</span>
        <span class="small muted" style="flex:1">${s.done ? `做过 ${s.done}/${ids.length} · 最近一次 ${score} 题对` : "还没做"}</span>
        <button class="btn sm" data-exam="${ex}">做这一套</button><button class="btn sm" data-mock="${ex}">⏱ 限时</button></div>`;
    }).join("")}
  </div>
  <div class="card">
    <h2>按コース（跟着教材练）</h2>
    ${courses.map((x) => `<div class="hrow kk-row"><span class="hl">${x.c.n}. ${esc(x.c.title)}</span>
      <span class="small muted" style="flex:1">${x.qs.length} 题 · ${x.st.length} 肢${x.s.n ? ` · 正确率 ${pct(x.s.ok, x.s.n)}` : ""}</span>
      <button class="btn sm" data-cq="${x.c.n}" ${x.qs.length ? "" : "disabled"}>四选一</button><button class="btn sm" data-co="${x.c.n}" ${x.st.length ? "" : "disabled"}>○×</button></div>`).join("")}
  </div>`;
  const D2 = D;
  $("#app").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const d = b.dataset;
    if (d.go === "rq") start("q", shuffle(D2.qs.map((q) => q.id)).slice(0, 10), "随机 10 题");
    if (d.go === "ro") start("ox", shuffle(D2.stmts.map((x) => x.key)).slice(0, 20), "随机 20 肢");
    if (d.go === "nq") start("q", shuffle(D2.qs.filter((q) => !T.has(q.id)).map((q) => q.id)).slice(0, 10), "没做过的题");
    if (d.go === "wrong") startWrong();
    if (d.exam) start("q", D2.qs.filter((q) => q.exam === d.exam).map((q) => q.id), D2.exams[d.exam]);
    if (d.mock) start("q", D2.qs.filter((q) => q.exam === d.mock).map((q) => q.id), D2.exams[d.mock] + " 限时", true);
    if (d.cq) { const c = courses.find((x) => x.c.n == d.cq); start("q", c.qs.map((q) => q.id), `第${c.c.n}コース ${c.c.title}`); }
    if (d.co) { const c = courses.find((x) => x.c.n == d.co); start("ox", shuffle(c.st.map((x) => x.key)), `第${c.c.n}コース ${c.c.title} ○×`); }
  };
}
function startWrong() {
  const ks = wrongKeys();
  const q = ks.filter(isQ), o = ks.filter((k) => !isQ(k));
  // 四选一和 ○× 混着的话，先做四选一
  if (q.length) start("q", shuffle(q), "错题重做（四选一）"); else start("ox", shuffle(o), "错题重做（○×）");
}

// ---------- 错题本 ----------
export async function viewWrong() {
  const { $, esc } = C;
  const D = await kkDB();
  const T = tally();
  const ks = wrongKeys().filter((k) => (isQ(k) ? D.byId[k] : D.stById[k]));
  const q = ks.filter(isQ), o = ks.filter((k) => !isQ(k));
  const row = (k) => {
    const a = T.get(k);
    if (isQ(k)) { const x = D.byId[k]; return `<div class="hrow kk-row"><span class="hl">${esc(D.exams[x.exam])} 問${x.no}</span><span class="small" style="flex:1">${esc(x.takeaway || x.stemZh)}</span><span class="small muted">错 ${a.n - a.ok} 次</span><button class="btn sm" data-one="${k}">重做</button></div>`; }
    const x = D.stById[k]; return `<div class="hrow kk-row"><span class="hl">${esc(D.exams[x.q.exam])} 問${x.q.no}-${esc(x.s.key)}</span><span class="small" style="flex:1">${esc(x.s.textZh)}</span><span class="small muted">错 ${a.n - a.ok} 次</span><button class="btn sm" data-one="${k}">重做</button></div>`;
  };
  $("#app").innerHTML = `<div class="crumbs"><a href="#/kk">过去问</a> › 错题本</div><h1>❌ 错题本</h1>
  <p class="muted small" style="margin-top:0">做错后连续答对 2 次，就自动移出。</p>
  ${ks.length ? `<div class="row" style="margin-bottom:12px">${q.length ? `<button class="btn primary" id="wq">重做四选一 ${q.length} 题</button>` : ""}${o.length ? `<button class="btn primary" id="wo">重做 ○× ${o.length} 肢</button>` : ""}</div>` : `<div class="card">🎉 错题本是空的。</div>`}
  ${q.length ? `<div class="card"><h2>四选一</h2>${q.map(row).join("")}</div>` : ""}
  ${o.length ? `<div class="card"><h2>○×</h2>${o.map(row).join("")}</div>` : ""}`;
  if ($("#wq")) $("#wq").onclick = () => start("q", shuffle(q), "错题重做（四选一）");
  if ($("#wo")) $("#wo").onclick = () => start("ox", shuffle(o), "错题重做（○×）");
  $("#app").onclick = (e) => { const b = e.target.closest("[data-one]"); if (b) start(isQ(b.dataset.one) ? "q" : "ox", [b.dataset.one], "错题重做"); };
}

// ---------- 做题页 ----------
const nl = (s) => C.esc(String(s ?? "").replace(/^[【（(]?問\s*\d+[】）)]\s*/, "")).replace(/\n/g, "<br>");
const typeName = { single: "四选一", count: "个数问题", combo: "组合问题" };
const ptLinks = (ids) => ids.map((id) => { const p = POINT_BY_ID[id]; return p ? `<a class="pt-link" href="#/p/${id}">📖 ${C.esc(p.courseTitle)} › ${C.esc(p.title)}</a>` : ""; }).join(" ");
let timer = null;

export async function viewRun() {
  const { $, esc } = C;
  clearInterval(timer);
  if (!run) { location.hash = "#/kk"; return; }
  const D = await kkDB();
  if (run.i >= run.keys.length) return viewDone(D);
  const key = run.keys[run.i];
  const head = `<div class="crumbs"><a href="#/kk">过去问</a> › ${esc(run.title)} · 第 ${run.i + 1} / ${run.keys.length} ${run.kind === "q" ? "题" : "肢"}
    ${run.timed ? `<span class="kk-timer" id="kkTimer"></span>` : ""}<span class="spacer"></span><a href="javascript:void 0" id="kkQuit" class="small">结束</a></div>
    <div class="bar" style="margin-bottom:12px"><i class="m" style="width:${(run.i / run.keys.length) * 100}%"></i></div>`;
  if (run.kind === "q") {
    const q = D.byId[key];
    const ans = run.picked;
    $("#app").innerHTML = head + `<div class="card kk-q">
      <div class="row"><b>${esc(D.exams[q.exam])} 【問${q.no}】</b><span class="muted small">${typeName[q.type]}</span><span class="spacer"></span><button class="btn sm" id="zhBtn">中文意思</button></div>
      <div class="kk-stem">${nl(q.stem)}</div>
      <div class="kk-zh" id="zh" hidden>${esc(q.stemZh)}</div>
      ${q.items?.length ? `<div class="kk-items">${q.items.map((it, i) => {
        const s = q.statements[i];
        return `<div class="kk-item ${ans ? (s.ok ? "ok" : "ng") : ""}"><b>${esc(it.label)}</b> ${nl(it.text)}${ans ? ` <span class="mk">${s.ok ? "○" : "×"}</span>` : ""}</div>`;
      }).join("")}</div>` : ""}
      <div class="kk-choices">${q.choices.map((c, i) => {
        const n = i + 1, cls = !ans ? "" : n === q.answer ? "right" : n === ans ? "wrong" : "dim";
        const s = q.type === "single" ? q.statements[i] : null;
        return `<button class="kk-choice ${cls}" data-c="${n}" ${ans ? "disabled" : ""}><b>${n}</b><span>${nl(c)}</span>${ans && s ? `<span class="mk">${s.ok ? "○" : "×"}</span>` : ""}</button>`;
      }).join("")}</div>
    </div>
    ${ans ? explainQ(q, ans) : `<p class="small muted">键盘：1〜4 选择。</p>`}`;
    $("#zhBtn").onclick = () => { $("#zh").hidden = !$("#zh").hidden; };
    if (!ans) document.querySelectorAll("[data-c]").forEach((b) => b.onclick = () => answerQ(q, Number(b.dataset.c)));
  } else {
    const x = D.stById[key], q = x.q;
    const text = q.type === "single" ? q.choices[x.i] : q.items[x.i]?.text;
    const ans = run.picked; // "o" | "x"
    const right = ans && ((ans === "o") === x.s.ok);
    $("#app").innerHTML = head + `<div class="card kk-q">
      <div class="row"><span class="muted small">${esc(D.exams[q.exam])} 【問${q.no}】 第 ${esc(x.s.key)} 肢</span><span class="spacer"></span><button class="btn sm" id="zhBtn">中文意思</button></div>
      <details class="kk-ctx"><summary class="small muted">题目前提（判决文、人物关系等在这里）</summary><div class="kk-stem small">${nl(q.stem)}</div></details>
      <div class="kk-ox-text">${nl(text)}</div>
      <div class="kk-zh" id="zh" hidden>${esc(x.s.textZh)}</div>
      <p class="small muted" style="margin:6px 0 0">判断这句话本身对不对（按出题当时的法律）。</p>
      <div class="row kk-ox">
        <button class="kk-ob ${ans ? (x.s.ok ? "right" : ans === "o" ? "wrong" : "dim") : ""}" data-ox="o" ${ans ? "disabled" : ""}>○</button>
        <button class="kk-ob ${ans ? (!x.s.ok ? "right" : ans === "x" ? "wrong" : "dim") : ""}" data-ox="x" ${ans ? "disabled" : ""}>×</button>
      </div>
    </div>
    ${ans ? `<div class="card kk-exp ${right ? "ok" : "ng"}">
      <div class="kk-verdict">${right ? "✅ 答对了" : "❌ 答错了"}　正确：<b>${x.s.ok ? "○" : "×"}</b></div>
      ${stmtHtml(x.s, x.pts, true)}
      ${q.lawChange ? `<div class="kk-law">⚠️ 法改正注意：${esc(q.lawChange)}</div>` : ""}
      <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn primary" id="kkNext">下一肢 →</button></div>
    </div>` : `<p class="small muted">键盘：O / X（或 1 / 2）。</p>`}`;
    $("#zhBtn").onclick = () => { $("#zh").hidden = !$("#zh").hidden; };
    if (!ans) document.querySelectorAll("[data-ox]").forEach((b) => b.onclick = () => answerOX(x, b.dataset.ox));
  }
  if ($("#kkNext")) $("#kkNext").onclick = next;
  $("#kkQuit").onclick = () => { run.keys = run.keys.slice(0, run.i + (run.picked ? 1 : 0)); run.i = run.keys.length; viewRun(); };
  if (run.timed) { const tick = () => { const el = $("#kkTimer"); if (!el) return clearInterval(timer); const s = Math.floor((Date.now() - run.t0) / 1000); el.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }; tick(); timer = setInterval(tick, 1000); }
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
  return `<div class="card kk-exp ${right ? "ok" : "ng"}">
    <div class="kk-verdict">${right ? "✅ 答对了" : `❌ 答错了（你选 ${ans}）`}　正解：<b>${q.answer}</b></div>
    ${q.takeaway ? `<p class="kk-take">💡 ${esc(q.takeaway)}</p>` : ""}
    ${q.lawChange ? `<div class="kk-law">⚠️ 法改正注意：${esc(q.lawChange)}</div>` : ""}
    ${q.statements.map((s) => stmtHtml(s, s.points?.length ? s.points : q.points, false)).join("")}
    <div class="row" style="margin-top:12px"><span class="small muted">相关ポイント：${ptLinks(q.points)}</span><span class="spacer"></span><button class="btn primary" id="kkNext">下一题 →</button></div>
  </div>`;
}
function answerQ(q, n) {
  run.picked = n; run.res.push(n === q.answer);
  record(q.id, n === q.answer, q.points);
  viewRun();
  document.querySelector(".kk-exp")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function answerOX(x, v) {
  const ok = (v === "o") === x.s.ok;
  run.picked = v; run.res.push(ok);
  record(x.key, ok, x.pts);
  viewRun();
}
function next() { run.i++; run.picked = null; viewRun(); }

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
    <div class="stat"><div class="v">${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}</div><div class="k">用时</div></div>
  </div>
  ${run.kind === "q" && n === 14 ? `<p class="small muted">本试 権利関係 14 题；合格者一般在这部分拿 9〜10 题以上。</p>` : ""}
  <div class="card">${run.keys.slice(0, n).map((k, i) => `<div class="hrow kk-row"><span>${run.res[i] ? "✅" : "❌"}</span><span class="hl" style="flex:1">${esc(name(k))}</span><button class="btn sm" data-one="${k}">再做</button></div>`).join("") || "没有作答。"}</div>
  <div class="row">${wrongHere.length ? `<button class="btn primary" id="again">重做这轮错的 ${wrongHere.length} ${run.kind === "q" ? "题" : "肢"}</button>` : ""}<a class="btn" href="#/kk">回题库</a></div>`;
  const kind = run.kind;
  if ($("#again")) $("#again").onclick = () => start(kind, wrongHere, "重做错的");
  $("#app").onclick = (e) => { const b = e.target.closest("[data-one]"); if (b) start(isQ(b.dataset.one) ? "q" : "ox", [b.dataset.one], "再做一次"); };
}

// 键盘
addEventListener("keydown", (e) => {
  if (location.hash !== "#/kk/run" || !run || /INPUT|TEXTAREA/.test(document.activeElement?.tagName) || e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (!run.picked) {
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
  if (!qs.length && !st.length) { box.innerHTML = `<p class="small muted" style="margin:8px 0 0">令和2〜7年的过去问里没有直接考这一节的题。</p>`; return; }
  const T = tally();
  const s = statFor([...qs.map((q) => q.id), ...st.map((x) => x.key)], T);
  const w = new Set(wrongKeys());
  const nw = [...qs.map((q) => q.id), ...st.map((x) => x.key)].filter((k) => w.has(k));
  box.innerHTML = `<p class="small" style="margin:8px 0">本节相关：四选一 <b>${qs.length}</b> 题 · ○× <b>${st.length}</b> 肢${s.n ? ` · 正确率 <b>${pct(s.ok, s.n)}</b>（${s.ok}/${s.n}）` : " · 还没做过"}</p>
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
  return BOOKS[0].courses.map((c) => {
    const keys = [...D.qs.filter((q) => q.points.some((p) => courseOf(p) === c.n)).map((q) => q.id), ...D.stmts.filter((x) => x.pts.some((p) => courseOf(p) === c.n)).map((x) => x.key)];
    return { c, ...statFor(keys, T) };
  });
}
