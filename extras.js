// 法条弹窗 / 数字・期限速记表 / 法改正专页 / 做题趋势图
import { BOOKS, BOOK_BY_ID, POINTS, POINT_BY_ID } from "./toc.js?v=703406309d";
import { loadData } from "./store.js?v=703406309d";

let C; // 由 app.js 注入：{ S, $, esc, md, today, addDays }
export function initExtras(ctx) { C = ctx; }

// ======================= 法条：解析里的「民法96条3項」可点开看原文 =======================
// 原文来自 e-Gov 法令 API（tools/laws.py → data/laws/<法令ID>.json），是取得当时的现行法
const LAW_ID = {
  民法: "129AC0000000089", 借地借家法: "403AC0000000090",
  不動産登記法: "416AC0000000123", 不登法: "416AC0000000123",
  区分所有法: "337AC0000000069", 建物の区分所有等に関する法律: "337AC0000000069",
  宅建業法: "327AC1000000176", 宅地建物取引業法: "327AC1000000176",
};
const LAW_RE = /(建物の区分所有等に関する法律|宅地建物取引業法|不動産登記法|借地借家法|区分所有法|宅建業法|不登法|民法)?\s*(?:第)?(\d+)\s*条(?:の\s*(\d+))?(?:\s*第?\s*(\d+)\s*項)?/g;
const lawCache = {};
const loadLaw = (id) => (lawCache[id] ||= loadData(`laws/${id}.json`).catch((e) => { delete lawCache[id]; throw e; }));

// 一段纯文字 → 带链接的 HTML；st.law 记住上文出现过的法令名（「民法96条、97条」里的 97 条也能点）
function linkText(text, st) {
  const esc = C.esc;
  let out = "", last = 0;
  for (const m of text.matchAll(LAW_RE)) {
    if (m[1]) st.law = LAW_ID[m[1]];
    if (!st.law) continue;
    out += esc(text.slice(last, m.index));
    const art = m[3] ? `${m[2]}_${m[3]}` : m[2];
    out += `<a class="lawref" href="javascript:void 0" data-law="${st.law}" data-art="${art}" data-para="${m[4] || ""}">${esc(m[0])}</a>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}
// 题库里的「依据」字段：Markdown 链接照样显示成链接，条文号变成可点
export function lawHtml(str) {
  if (!str) return "";
  const st = { law: null };
  let out = "", last = 0;
  for (const m of str.matchAll(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g)) {
    out += linkText(str.slice(last, m.index), st);
    out += `<a href="${C.esc(m[2])}" target="_blank" rel="noopener">${C.esc(m[1])}↗</a>`;
    last = m.index + m[0].length;
  }
  return out + linkText(str.slice(last), st);
}
// 已渲染好的讲义 / 解析：在文字节点里找条文号（跳过已有链接和代码）
export function linkLaws(root) {
  if (!root) return;
  const els = root.matches?.(".md, .kk-st-b, .kk-take") ? [root] : root.querySelectorAll(".md, .kk-st-b, .kk-take");
  for (const el of els) {
    // 讲义里「[依据：民法第147条](e-Gov 链接)」这种：改成站内弹窗（弹窗里仍有 e-Gov 全文链接）
    for (const a of el.querySelectorAll('a[href*="e-gov.go.jp"]:not(.lawref)')) {
      const m = [...a.textContent.matchAll(LAW_RE)].find((x) => x[1]);
      if (!m) continue;
      a.className = "lawref"; a.removeAttribute("target");
      Object.assign(a.dataset, { law: LAW_ID[m[1]], art: m[3] ? `${m[2]}_${m[3]}` : m[2], para: m[4] || "" });
      a.setAttribute("href", "javascript:void 0");
    }
    const st = { law: null };
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.parentElement.closest("a, code, pre") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      if (!/\d\s*条/.test(n.data) && !/民法|借地借家法|登記法|区分所有|宅建業法|宅地建物取引業法/.test(n.data)) continue;
      const html = linkText(n.data, st);
      if (!html.includes("lawref")) continue;
      const span = document.createElement("span"); span.innerHTML = html; n.replaceWith(span);
    }
  }
}
async function openLaw(id, art, para) {
  const { esc } = C;
  document.querySelector(".law-modal")?.remove();
  const bg = document.createElement("div");
  bg.className = "modal-bg law-modal";
  bg.innerHTML = `<div class="modal"><div class="empty">读取条文…</div></div>`;
  document.body.appendChild(bg);
  bg.onclick = (e) => { if (e.target === bg || e.target.closest("[data-close]")) bg.remove(); };
  let d;
  try { d = await loadLaw(id); } catch (e) { bg.querySelector(".modal").innerHTML = `<p>条文读取失败：${esc(e.message)}</p><button class="btn" data-close>关闭</button>`; return; }
  const keys = Object.keys(d.articles);
  const show = (k, p) => {
    const a = d.articles[k];
    const i = keys.indexOf(k);
    const body = a ? a.x.split("\n").map((ln) => {
      const hit = p && (p === "1" ? !/^\d+　/.test(ln) && !/^　/.test(ln) : ln.startsWith(`${p}　`));
      return `<div class="law-ln ${hit ? "hit" : ""} ${/^　/.test(ln) ? "item" : ""}">${esc(ln)}</div>`;
    }).join("") : `<p class="muted">${esc(d.title)}里没有找到第 ${esc(k.replace("_", "条の"))} 条（可能已删除，或条文号写法不同）。</p>`;
    bg.querySelector(".modal").innerHTML = `
      <div class="row"><b>${esc(d.title)}　${esc(a?.t || "")}</b><span class="muted small">${esc(a?.c || "")}</span><span class="spacer"></span><button class="btn sm" data-close>✕</button></div>
      <div class="law-body">${body}</div>
      <div class="row small" style="margin-top:10px">
        <button class="btn sm" data-nav="${keys[i - 1] || ""}" ${i > 0 ? "" : "disabled"}>← 前一条</button>
        <button class="btn sm" data-nav="${keys[i + 1] || ""}" ${i >= 0 && i < keys.length - 1 ? "" : "disabled"}>后一条 →</button>
        <span class="spacer"></span><a href="${esc(d.url)}" target="_blank" rel="noopener">e-Gov 全文 ↗</a></div>
      <p class="small muted" style="margin:8px 0 0">e-Gov 现行条文（${esc(d.fetched)} 取得）。过去问按出题当时的法律判断，修法后条文可能和题目不一样。</p>`;
    bg.querySelectorAll("[data-nav]").forEach((b) => b.onclick = () => b.dataset.nav && show(b.dataset.nav, ""));
  };
  show(art, para);
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("a.lawref"); if (!a) return;
  e.preventDefault(); openLaw(a.dataset.law, a.dataset.art, a.dataset.para);
});

// ======================= 数字・期限速记表 =======================
let NF = { course: "", q: "", hide: false };
try { NF = { ...NF, ...JSON.parse(localStorage.getItem("takken.numsFilter") || "{}") }; } catch {}
const saveNF = () => { try { localStorage.setItem("takken.numsFilter", JSON.stringify(NF)); } catch {} };
const numsCache = {};
export async function viewNums(bookId) {
  const { $, esc } = C;
  const b = BOOK_BY_ID[bookId] || BOOKS[0];
  const tabs = `<div class="book-tabs">${BOOKS.map((x) => `<a class="book-tab bk-${x.id} ${x.id === b.id ? "on" : ""} ${x.courses.length ? "" : "off"}" href="#/nums/${x.id}"><b>${esc(x.title)}</b><span class="small">${x.courses.length ? "" : "待导入"}</span></a>`).join("")}</div>`;
  $("#app").innerHTML = `<h1>数字・期限速记表</h1>${tabs}<div class="empty">加载…</div>`;
  let rows = numsCache[b.id];
  if (!rows) { try { rows = numsCache[b.id] = (await loadData(`gen/numbers/${b.id}.json`)) || []; } catch { rows = []; } }
  if (!rows.length) { $("#app").innerHTML = `<h1>数字・期限速记表</h1>${tabs}<div class="card">${esc(b.title)}的速记表还没生成${b.courses.length ? "" : "（教材内容待导入）"}。</div>`; return; }
  $("#app").innerHTML = `<h1>数字・期限速记表</h1>${tabs}
  <p class="muted small" style="margin-top:0">从教材原文和中文讲义里抽出的数字、期限、比例（AI 整理，以教材为准）。打开「遮住数字」可以自测，点 ？ 看答案。</p>
  <div class="card">
    <div class="stuck-filter">
      <input id="nfQ" class="btn" type="search" placeholder="关键词（中文 / 日文 / 数字都可以）" value="${esc(NF.q)}">
      <select id="nfC" class="btn"><option value="">全部コース</option>${b.courses.map((c) => `<option value="${c.n}" ${String(NF.course) === String(c.n) ? "selected" : ""}>第${c.n}コース ${esc(c.title)}</option>`).join("")}</select>
      <label class="small"><input type="checkbox" id="nfH" ${NF.hide ? "checked" : ""}> 遮住数字（自测）</label>
    </div>
    <div id="numList"></div>
  </div>`;
  const render = () => {
    const kw = NF.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = rows.filter((r) => (!NF.course || String(r.course) === String(NF.course))
      && kw.every((k) => [r.item, r.value, r.cond, r.jp, r.trap, POINT_BY_ID[r.point]?.title].join(" ").toLowerCase().includes(k)));
    const byCourse = new Map();
    for (const r of list) { if (!byCourse.has(r.course)) byCourse.set(r.course, []); byCourse.get(r.course).push(r); }
    $("#numList").innerHTML = !list.length ? `<div class="empty">没有符合条件的条目。</div>` : `<p class="small muted" style="margin:4px 0 0">共 ${list.length} 条</p>` +
      [...byCourse].map(([cn, rs]) => { const c = b.courses.find((x) => x.n === cn);
        return `<div class="stuck-group"><div class="stuck-gh">第${cn}コース ${esc(c?.title || "")}<span class="muted small">　${rs.length}</span></div>
        <div class="nums">${rs.map((r) => `<div class="num-row">
          <div class="num-item">${esc(r.item)}${r.cond ? `<div class="small muted">${esc(r.cond)}</div>` : ""}</div>
          <div class="num-val">${NF.hide ? `<button class="num-hide" data-v="${esc(r.value)}">？</button>` : esc(r.value)}</div>
          <div class="num-meta small">${r.jp ? `<span class="muted">${esc(r.jp)}</span>` : ""}${r.trap ? `<div class="num-trap">${esc(r.trap)}</div>` : ""}
            <a class="small" href="#/p/${r.point}">${esc(POINT_BY_ID[r.point]?.title || "")}</a></div></div>`).join("")}</div></div>`; }).join("");
  };
  render();
  $("#nfQ").oninput = (e) => { NF.q = e.target.value; saveNF(); render(); };
  $("#nfC").onchange = (e) => { NF.course = e.target.value; saveNF(); render(); };
  $("#nfH").onchange = (e) => { NF.hide = e.target.checked; saveNF(); render(); };
  $("#numList").onclick = (e) => { const h = e.target.closest(".num-hide"); if (h) { h.replaceWith(Object.assign(document.createElement("span"), { textContent: h.dataset.v, className: "num-shown" })); } };
}
// 知识点页：本节的数字
export async function pointNumbers(id) {
  const pt = POINT_BY_ID[id]; if (!pt) return [];
  let rows = numsCache[pt.book];
  if (!rows) { try { rows = numsCache[pt.book] = (await loadData(`gen/numbers/${pt.book}.json`)) || []; } catch { return []; } }
  return rows.filter((r) => r.point === id);
}

// ======================= 法改正专页 =======================
export async function viewLawChange(qsWithChange) {
  const { $, esc, md } = C;
  $("#app").innerHTML = `<h1>法改正</h1><div class="empty">加载…</div>`;
  let d = null;
  try { d = await loadData("lawchange.json"); } catch {}
  const items = d?.items || [];
  const today = C.today();
  $("#app").innerHTML = `<h1>法改正</h1>
  <p class="muted small" style="margin-top:0">宅建每年都会考法改正。考试的「適用法令」是<b>考试当年 4 月 1 日</b>施行中的法律（2027 年考试 → 2027-04-01）。
  ${d?.updated ? `本页整理于 ${esc(d.updated)}，` : ""}之后公布的修法不在里面。<b>AI 整理，以教材「法改正」部分和官方资料为准</b>。</p>
  <div class="card"><div class="row" style="gap:6px">${BOOKS.map((b) => { const n = items.filter((x) => x.book === b.id).length;
    return `<a class="btn sm" href="javascript:void 0" data-jump="${b.id}">${esc(b.title)} <b>${n}</b></a>`; }).join("")}</div></div>
  ${BOOKS.map((b) => { const xs = items.filter((x) => x.book === b.id);
    return `<div class="card" id="lc-${b.id}"><h2>${esc(b.title)}</h2>${xs.length ? xs.map((x) => `<div class="lc-item">
      <div class="row"><b>${esc(x.title)}</b><span class="spacer"></span>
        <span class="lc-tag ${x.effective && x.effective <= "2027-04-01" ? (x.effective <= today ? "on" : "soon") : "later"}">${x.effective ? `施行 ${esc(x.effective)}` : "施行日待定"}${x.effective && x.effective > "2027-04-01" ? " · 2027 年不考" : ""}</span>
        ${x.importance ? `<span class="lc-imp ${x.importance}">${x.importance}</span>` : ""}</div>
      <div class="md small">${md(x.body)}</div>
      ${x.points?.length ? `<div class="small">${x.points.map((p) => POINT_BY_ID[p] ? `<a class="pt-link" href="#/p/${p}">${esc(POINT_BY_ID[p].courseTitle)} › ${esc(POINT_BY_ID[p].title)}</a>` : "").join("")}</div>` : ""}
      ${x.source ? `<div class="small muted">出处：${lawHtml(x.source)}</div>` : ""}
    </div>`).join("") : `<p class="small muted" style="margin:0">${b.courses.length ? "暂无条目。" : "这一科教材内容待导入，导入时一起整理。"}</p>`}</div>`; }).join("")}
  ${qsWithChange?.length ? `<div class="card"><h2>过去问里受修法影响的题</h2>
    <p class="small muted" style="margin-top:-6px">这些题按出题当时的法律判断；按 2027 年适用的法律，结论可能不同。</p>
    ${qsWithChange.map((q) => `<div class="lc-item"><div class="row"><b>${esc(q.examName)} 問${q.no}</b><span class="muted small">${esc(BOOK_BY_ID[q.book]?.title || "")}</span><span class="spacer"></span><button class="btn sm" data-kq="${q.id}">做这题</button></div>
      <div class="small">${esc(q.lawChange)}</div></div>`).join("")}</div>` : ""}`;
  $("#app").onclick = (e) => {
    const j = e.target.closest("[data-jump]"); if (j) document.getElementById(`lc-${j.dataset.jump}`)?.scrollIntoView({ behavior: "smooth" });
    const k = e.target.closest("[data-kq]"); if (k) C.startQ([k.dataset.kq], "法改正相关题");
  };
  linkLaws($("#app"));
}

// ======================= 做题趋势图 =======================
// 来源：闪卡 S.cardLog、○× / 四选一 S.kkLog、模考 S.mocks
let TR = { kind: "all", days: 30 };
try { TR = { ...TR, ...JSON.parse(localStorage.getItem("takken.trend") || "{}") }; } catch {}
const dayOf = (sec) => new Date(sec * 1000).toLocaleDateString("sv-SE");
function series(kind, days) {
  const S = C.S();
  const ev = [];
  if (kind === "all" || kind === "card") for (const [, , ok, t] of S.cardLog || []) ev.push([t, ok]);
  if (kind === "all" || kind === "ox") for (const [k, ok, t] of S.kkLog || []) if (k.includes("#")) ev.push([t, ok]);
  if (kind === "all" || kind === "q") for (const [k, ok, t] of S.kkLog || []) if (!k.includes("#")) ev.push([t, ok]);
  const weekly = days > 45;
  const buckets = [];
  const n = weekly ? Math.ceil(days / 7) : days;
  for (let i = n - 1; i >= 0; i--) {
    const end = C.addDays(-(weekly ? i * 7 : i)), start = weekly ? C.addDays(-(i * 7 + 6)) : end;
    buckets.push({ start, end, n: 0, ok: 0 });
  }
  for (const [t, ok] of ev) { const d = dayOf(t); const b = buckets.find((x) => d >= x.start && d <= x.end); if (b) { b.n++; b.ok += ok; } }
  return { buckets, weekly };
}
function chartSvg(buckets, label) {
  const W = 640, H = 200, L = 34, R = 34, T = 12, B = 26;
  const iw = W - L - R, ih = H - T - B, bw = iw / buckets.length;
  const maxN = Math.max(1, ...buckets.map((b) => b.n));
  const pts = buckets.map((b, i) => b.n ? [L + bw * i + bw / 2, T + ih * (1 - b.ok / b.n), b] : null).filter(Boolean);
  const md2 = (d) => d.slice(5).replace("-", "/");
  return `<svg viewBox="0 0 ${W} ${H}" class="trend-svg" role="img" aria-label="${label}">
    ${[0, 50, 100].map((p) => `<line x1="${L}" x2="${W - R}" y1="${T + ih * (1 - p / 100)}" y2="${T + ih * (1 - p / 100)}" class="tg"/><text x="${W - R + 4}" y="${T + ih * (1 - p / 100) + 4}" class="tl">${p}%</text>`).join("")}
    <line x1="${L}" x2="${W - R}" y1="${T + ih * 0.3}" y2="${T + ih * 0.3}" class="tg pass"/>
    ${buckets.map((b, i) => b.n ? `<rect x="${L + bw * i + bw * 0.15}" y="${T + ih * (1 - b.n / maxN)}" width="${bw * 0.7}" height="${ih * (b.n / maxN)}" class="tb"><title>${b.start === b.end ? b.end : `${b.start}〜${b.end}`}：${b.n} 题，对 ${b.ok}（${Math.round((b.ok / b.n) * 100)}%）</title></rect>` : "").join("")}
    <text x="${L - 4}" y="${T + 8}" class="tl" text-anchor="end">${maxN}</text><text x="${L - 4}" y="${T + ih}" class="tl" text-anchor="end">0</text>
    ${pts.length > 1 ? `<polyline points="${pts.map((p) => `${p[0]},${p[1]}`).join(" ")}" class="tline"/>` : ""}
    ${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" class="tdot"><title>${p[2].end}：正确率 ${Math.round((p[2].ok / p[2].n) * 100)}%</title></circle>`).join("")}
    ${[0, Math.floor(buckets.length / 2), buckets.length - 1].map((i) => `<text x="${L + bw * i + bw / 2}" y="${H - 6}" class="tl" text-anchor="middle">${md2(buckets[i].end)}</text>`).join("")}
  </svg>`;
}
function mockSvg(ms) {
  const W = 640, H = 200, L = 34, R = 34, T = 12, B = 26, iw = W - L - R, ih = H - T - B;
  const step = ms.length > 1 ? iw / (ms.length - 1) : 0;
  const pts = ms.map((m, i) => [L + (ms.length > 1 ? step * i : iw / 2), T + ih * (1 - m.score / m.n), m]);
  return `<svg viewBox="0 0 ${W} ${H}" class="trend-svg" role="img" aria-label="模考得分率">
    ${[0, 50, 100].map((p) => `<line x1="${L}" x2="${W - R}" y1="${T + ih * (1 - p / 100)}" y2="${T + ih * (1 - p / 100)}" class="tg"/><text x="${W - R + 4}" y="${T + ih * (1 - p / 100) + 4}" class="tl">${p}%</text>`).join("")}
    <line x1="${L}" x2="${W - R}" y1="${T + ih * 0.3}" y2="${T + ih * 0.3}" class="tg pass"/>
    ${pts.length > 1 ? `<polyline points="${pts.map((p) => `${p[0]},${p[1]}`).join(" ")}" class="tline"/>` : ""}
    ${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" class="tdot"><title>${dayOf(p[2].t)} ${p[2].title}：${p[2].score}/${p[2].n}</title></circle>`).join("")}
    ${pts.length ? [pts[0], pts.at(-1)].map((p, i) => `<text x="${p[0]}" y="${H - 6}" class="tl" text-anchor="${i ? "end" : "start"}">${dayOf(p[2].t).slice(5).replace("-", "/")}</text>`).join("") : ""}
  </svg>`;
}
export function trendCard() {
  return `<div class="card" id="trend"><div class="row"><h2 style="margin:0">做题趋势</h2><span class="spacer"></span>
    <div class="seg" id="trKind">${[["all", "全部"], ["card", "闪卡"], ["ox", "○×"], ["q", "四选一"], ["mock", "模考"]].map(([k, v]) => `<button data-k="${k}" class="${TR.kind === k ? "on learning" : ""}">${v}</button>`).join("")}</div>
    <div class="seg" id="trDays">${[14, 30, 90].map((d) => `<button data-d="${d}" class="${TR.days === d ? "on learning" : ""}">${d} 天</button>`).join("")}</div></div>
    <div id="trBody"></div></div>`;
}
export function mountTrend() {
  const { $ } = C;
  const draw = () => {
    document.querySelectorAll("#trKind button").forEach((b) => b.className = b.dataset.k === TR.kind ? "on learning" : "");
    document.querySelectorAll("#trDays button").forEach((b) => b.className = Number(b.dataset.d) === TR.days ? "on learning" : "");
    $("#trDays").style.visibility = TR.kind === "mock" ? "hidden" : "";
    if (TR.kind === "mock") {
      const ms = (C.S().mocks || []).slice(-30);
      $("#trBody").innerHTML = ms.length ? mockSvg(ms) + `<p class="small muted" style="margin:4px 0 0">每个点是一次模考的得分率；虚线是 70%（合格线大约在这附近）。</p>` : `<div class="empty">还没有模考记录。</div>`;
      return;
    }
    const { buckets, weekly } = series(TR.kind, TR.days);
    const tot = buckets.reduce((a, b) => ({ n: a.n + b.n, ok: a.ok + b.ok }), { n: 0, ok: 0 });
    $("#trBody").innerHTML = tot.n ? chartSvg(buckets, "做题趋势") + `<p class="small muted" style="margin:4px 0 0">柱子 = ${weekly ? "每周" : "每天"}做题数，折线 = 正确率，虚线 = 70%。这段时间共 ${tot.n} 题，正确率 ${Math.round((tot.ok / tot.n) * 100)}%。${TR.kind === "card" || TR.kind === "all" ? "（闪卡从这次更新后开始记录）" : ""}</p>`
      : `<div class="empty">这段时间还没有记录。${TR.kind === "card" ? "闪卡从这次更新后开始记录。" : ""}</div>`;
  };
  $("#trKind").onclick = (e) => { const b = e.target.closest("[data-k]"); if (b) { TR.kind = b.dataset.k; save(); draw(); } };
  $("#trDays").onclick = (e) => { const b = e.target.closest("[data-d]"); if (b) { TR.days = Number(b.dataset.d); save(); draw(); } };
  const save = () => { try { localStorage.setItem("takken.trend", JSON.stringify(TR)); } catch {} };
  draw();
}
