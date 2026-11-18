// 专项：法律用语词典 / 易混对比表 / 题型・陷阱用语・读题训练
// 用语：tools/glossary.mjs → data/gen/glossary.json（从讲义、闪卡、过去问解析里收集「用語（よみ／中文）」）
// 对比表：data/gen/compare/<科目>.json（人工整理，按 2027 年考试适用的现行法）
import { BOOKS, BOOK_BY_ID, POINTS, POINT_BY_ID } from "./toc.js?v=f963d86b65";
import { loadData } from "./store.js?v=f963d86b65";
import { kkDB, startQ, startOX } from "./quiz.js?v=f963d86b65";

let C; // 由 app.js 注入：{ S, save, touchDay, $, esc, md }
export function initLearn(ctx) { C = ctx; }

const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const ls = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const bookTabs = (route, cur, has) => `<div class="book-tabs">${BOOKS.map((x) => `<a class="book-tab bk-${x.id} ${x.id === cur ? "on" : ""} ${has(x) ? "" : "off"}" href="#/${route}/${x.id}"><b>${C.esc(x.title)}</b><span class="small">${has(x) ? "" : "待导入"}</span></a>`).join("")}</div>`;
// **粗体** → <b>（对比表、说明文字用）
const rich = (s) => C.esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

// ======================= 法律用语词典 =======================
// 记忆记录：S.terms = { 用語: [1 记住 / 0 没记住, 时间秒] }，同步时按时间取新的
let GL = null;
const loadGL = async () => (GL ||= (await loadData("gen/glossary.json").catch(() => null)) || []);
const known = (jp) => C.S().terms?.[jp]?.[0] === 1;
function mark(jp, v) { (C.S().terms ||= {})[jp] = [v ? 1 : 0, Math.floor(Date.now() / 1000)]; C.touchDay(); C.save(); }
let TF = { q: "", course: "", mode: "list", only: false, ...ls.get("takken.termsF", {}) };
const saveTF = () => ls.set("takken.termsF", TF);
let drill = null; // { list, i, flipped, ok, ng, dir: "jz"|"zj" }

export async function viewTerms(bookId) {
  const { $, esc } = C;
  const b = BOOK_BY_ID[bookId] || BOOKS[0];
  $("#app").innerHTML = `<h1>法律用语</h1><div class="empty">加载…</div>`;
  const all = await loadGL();
  const has = (x) => all.some((t) => POINT_BY_ID[t.first]?.book === x.id);
  const rows = all.filter((t) => POINT_BY_ID[t.first]?.book === b.id);
  const head = `<h1>法律用语</h1>${bookTabs("terms", b.id, has)}`;
  if (!rows.length) { $("#app").innerHTML = `${head}<div class="card">${esc(b.title)}的讲义还没导入，用语表会在讲义生成后自动整理出来。</div>`; return; }
  if (drill && drill.book === b.id) return renderDrill(head);
  const nKnown = rows.filter((t) => known(t.jp)).length;
  $("#app").innerHTML = `${head}
  <p class="muted small" style="margin-top:0">从中文讲义、闪卡和过去问解析里自动整理的日文法律用语（读音 + 中文）。按教材里第一次出现的顺序排列；点ポイント名可以回到讲义。</p>
  <div class="stats">
    <div class="stat"><div class="v">${rows.length}</div><div class="k">个用语</div></div>
    <div class="stat"><div class="v">${nKnown}</div><div class="k">已记住</div></div>
    <div class="stat"><div class="v">${pct(nKnown, rows.length)}</div><div class="k">掌握率</div></div>
  </div>
  <div class="card">
    <div class="row" style="margin-bottom:12px"><b>闪卡练习</b><span class="small muted">没记住的优先</span><span class="spacer"></span>
      <button class="btn sm primary" data-drill="jz">日文 → 读音・中文（20 个）</button><button class="btn sm" data-drill="zj">中文 → 日文（20 个）</button></div>
    <div class="stuck-filter">
      <input id="tfQ" class="btn" type="search" placeholder="搜索：日文 / 读音 / 中文" value="${esc(TF.q)}">
      <select id="tfC" class="btn"><option value="">全部コース</option>${b.courses.map((c) => `<option value="${c.n}" ${String(TF.course) === String(c.n) ? "selected" : ""}>第${c.n}コース ${esc(c.title)}</option>`).join("")}</select>
      <div class="seg" id="tfM">${[["list", "全部显示"], ["hz", "遮住中文"], ["hj", "遮住日文"]].map(([k, v]) => `<button data-m="${k}" class="${TF.mode === k ? "on" : ""}">${v}</button>`).join("")}</div>
      <label class="small"><input type="checkbox" id="tfO" ${TF.only ? "checked" : ""}> 只看没记住的</label>
    </div>
    <div id="termList"></div>
  </div>`;
  const render = () => {
    const kw = TF.q.trim().toLowerCase();
    const list = rows.filter((t) => (!TF.course || String(POINT_BY_ID[t.first].course) === String(TF.course))
      && (!TF.only || !known(t.jp))
      && (!kw || [t.jp, t.yomi, t.zh, ...t.zhAlt].join(" ").toLowerCase().includes(kw)));
    const groups = new Map();
    for (const t of list) { const c = POINT_BY_ID[t.first].course; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(t); }
    const hide = (cls, html) => `<span class="term-hide ${cls}" data-show>${html}</span>`;
    $("#termList").innerHTML = !list.length ? `<div class="empty">没有符合条件的用语。</div>` : `<p class="small muted" style="margin:4px 0 0">${list.length} 个</p>` +
      [...groups].map(([cn, ts]) => { const c = b.courses.find((x) => x.n === cn);
        return `<div class="stuck-group"><div class="stuck-gh">第${cn}コース <span lang="ja">${esc(c?.title || "")}</span><span class="muted small">　${ts.length}</span></div>
        <div class="terms">${ts.map((t) => { const jp = `<b lang="ja">${esc(t.jp)}</b><span class="small muted" lang="ja">${esc(t.yomi)}</span>`, zh = `<span>${esc(t.zh)}</span>${t.zhAlt.length ? `<span class="small muted">（${t.zhAlt.map(esc).join("・")}）</span>` : ""}`;
          return `<div class="term ${known(t.jp) ? "known" : ""}">
            <div class="term-jp">${TF.mode === "hj" ? hide("", jp) : jp}</div>
            <div class="term-zh">${TF.mode === "hz" ? hide("", zh) : zh}</div>
            <div class="term-meta small"><a href="#/p/${t.first}" lang="ja">${esc(POINT_BY_ID[t.first].title)}</a>${t.n > 1 ? `<span class="muted"> · 出现 ${t.n} 次</span>` : ""}</div>
            <button class="term-k" data-k="${esc(t.jp)}" title="${known(t.jp) ? "标记为没记住" : "标记为记住了"}">${known(t.jp) ? "✓ 记住" : "记住了？"}</button></div>`; }).join("")}</div></div>`; }).join("");
  };
  render();
  $("#tfQ").oninput = (e) => { TF.q = e.target.value; saveTF(); render(); };
  $("#tfC").onchange = (e) => { TF.course = e.target.value; saveTF(); render(); };
  $("#tfO").onchange = (e) => { TF.only = e.target.checked; saveTF(); render(); };
  $("#tfM").onclick = (e) => { const x = e.target.closest("[data-m]"); if (!x) return; TF.mode = x.dataset.m; saveTF(); document.querySelectorAll("#tfM button").forEach((y) => y.classList.toggle("on", y === x)); render(); };
  $("#termList").onclick = (e) => {
    const h = e.target.closest("[data-show]"); if (h) { h.classList.add("shown"); return; }
    const k = e.target.closest("[data-k]"); if (k) { mark(k.dataset.k, !known(k.dataset.k)); render(); }
  };
  $("#app").querySelectorAll("[data-drill]").forEach((x) => x.onclick = () => {
    const pool = TF.course ? rows.filter((t) => String(POINT_BY_ID[t.first].course) === String(TF.course)) : rows;
    const fresh = shuffle(pool.filter((t) => !known(t.jp))), old = shuffle(pool.filter((t) => known(t.jp)));
    drill = { book: b.id, list: [...fresh, ...old].slice(0, 20), i: 0, flipped: false, ok: 0, ng: 0, dir: x.dataset.drill };
    renderDrill(head);
  });
}
function renderDrill(head) {
  const { $, esc } = C, d = drill;
  if (d.i >= d.list.length) {
    $("#app").innerHTML = `${head}<div class="card" style="text-align:center"><h2>练完了</h2><p>记得 <b>${d.ok}</b> 个 · 没记住 <b>${d.ng}</b> 个</p>
      <div class="row" style="justify-content:center"><button class="btn primary" id="dAgain">再来 20 个</button><button class="btn" id="dBack">回用语表</button></div></div>`;
    $("#dBack").onclick = () => { drill = null; viewTerms(d.book); };
    $("#dAgain").onclick = () => { drill = null; viewTerms(d.book).then(() => document.querySelector(`[data-drill="${d.dir}"]`)?.click()); };
    return;
  }
  const t = d.list[d.i];
  const jp = `<div class="dr-jp" lang="ja">${esc(t.jp)}</div>`, yomi = `<div class="dr-yomi" lang="ja">${esc(t.yomi)}</div>`, zh = `<div class="dr-zh">${esc(t.zh)}</div>`;
  const front = d.dir === "jz" ? jp : zh, back = d.dir === "jz" ? yomi + zh : jp + yomi;
  $("#app").innerHTML = `${head}
  <div class="row" style="margin-bottom:10px"><b>用语闪卡</b><span class="small muted">${d.i + 1} / ${d.list.length}</span><span class="spacer"></span><button class="btn sm" id="dQuit">结束</button></div>
  <div class="flash dr-card" id="drCard">${front}${d.flipped ? `<div class="dr-back">${back}<a class="small" href="#/p/${t.first}" lang="ja">${esc(POINT_BY_ID[t.first].title)} →</a></div>` : `<div class="small muted">点卡片或按空格翻面 · 1 没记住 · 2 记住了</div>`}</div>
  <div class="row" style="justify-content:center;margin-top:12px"><button class="btn" data-g="0">没记住 <kbd>1</kbd></button><button class="btn" id="drFlip">${d.flipped ? "翻回正面" : "翻面"} <kbd>空格</kbd></button><button class="btn primary" data-g="1">记住了 <kbd>2</kbd></button></div>`;
  const flip = () => { d.flipped = !d.flipped; renderDrill(head); };
  $("#drCard").onclick = flip; $("#drFlip").onclick = flip;
  $("#dQuit").onclick = () => { const b = d.book; drill = null; viewTerms(b); };
  $("#app").querySelectorAll("[data-g]").forEach((x) => x.onclick = () => grade(x.dataset.g === "1", head));
}
function grade(ok, head) { const d = drill, t = d.list[d.i]; mark(t.jp, ok); ok ? d.ok++ : d.ng++; d.i++; d.flipped = false; renderDrill(head); }
document.addEventListener("keydown", (e) => {
  if (!drill || !document.querySelector("#drCard") || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  const head = document.querySelector("#app h1").outerHTML + document.querySelector("#app .book-tabs").outerHTML;
  if (e.key === " ") { e.preventDefault(); drill.flipped = !drill.flipped; renderDrill(head); }
  else if (e.key === "1" || e.key === "2") grade(e.key === "2", head);
});

// ======================= 易混对比表 =======================
const cmpCache = {};
export async function viewCompare(bookId) {
  const { $, esc } = C;
  const b = BOOK_BY_ID[bookId] || BOOKS[0];
  $("#app").innerHTML = `<h1>易混对比表</h1><div class="empty">加载…</div>`;
  const tables = (cmpCache[b.id] ||= (await loadData(`gen/compare/${b.id}.json`).catch(() => null)) || []);
  const head = `<h1>易混对比表</h1>${bookTabs("cmp", b.id, (x) => x.id === b.id ? tables.length : !!cmpCache[x.id]?.length || x.id === "kenri")}`;
  if (!tables.length) { $("#app").innerHTML = `${head}<div class="card">${esc(b.title)}的对比表还没整理（教材内容待导入）。</div>`; return; }
  const D = await kkDB().catch(() => null);
  const oxFor = (pts) => D ? D.stmts.filter((x) => x.pts.some((p) => pts.includes(p))).map((x) => x.key) : [];
  const hideOn = ls.get("takken.cmpHide", false);
  $("#app").innerHTML = `${head}
  <p class="muted small" style="margin-top:0">宅建最爱考「长得像但结论不同」的地方。每张表把容易混的放在一起；打开「遮住表格自测」后点格子看答案。按 2027 年考试适用的现行法整理，细节以教材为准。</p>
  <div class="cmp-top">
    <div class="cmp-toc">${tables.map((t) => `<a href="javascript:void 0" data-jump="${t.id}">${esc(t.title.split("：")[0])}</a>`).join("")}</div>
    <label class="small"><input type="checkbox" id="cmpHide" ${hideOn ? "checked" : ""}> 遮住表格自测</label>
  </div>
  ${tables.map((t) => { const n = oxFor(t.pts).length;
    return `<div class="card cmp" id="cmp-${t.id}">
    <h2>${rich(t.title)}</h2>
    <p class="cmp-why">${rich(t.why)}</p>
    <div class="cmp-wrap"><table class="cmp-t ${hideOn ? "quiz" : ""}"><thead><tr>${t.cols.map((c) => `<th>${rich(c)}</th>`).join("")}</tr></thead>
      <tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => i === 0 ? `<th>${rich(c)}</th>` : `<td><span>${rich(c)}</span></td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="cmp-tip">💡 ${rich(t.tip)}</div>
    <div class="row cmp-foot"><span class="small muted">相关ポイント：</span>${t.pts.map((id) => `<a class="pt-link" href="#/p/${id}" lang="ja">${esc(POINT_BY_ID[id]?.title || id)}</a>`).join("")}
      <span class="spacer"></span>${n ? `<button class="btn sm primary" data-ox="${t.id}">练相关 ○×（${Math.min(n, 30)}）</button>` : ""}</div></div>`; }).join("")}`;
  $("#cmpHide").onchange = (e) => { ls.set("takken.cmpHide", e.target.checked); document.querySelectorAll(".cmp-t").forEach((x) => { x.classList.toggle("quiz", e.target.checked); x.querySelectorAll("td.shown").forEach((td) => td.classList.remove("shown")); }); };
  $("#app").onclick = (e) => {
    const j = e.target.closest("[data-jump]"); if (j) { document.getElementById(`cmp-${j.dataset.jump}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const td = e.target.closest(".cmp-t.quiz td"); if (td) { td.classList.toggle("shown"); return; }
    const o = e.target.closest("[data-ox]"); if (o) { const t = tables.find((x) => x.id === o.dataset.ox); startOX(shuffle(oxFor(t.pts)).slice(0, 30), `对比表：${t.title.split("：")[0]}`); }
  };
}

// ======================= 题型・陷阱用语・读题 =======================
// 陷阱用语：在过去问 ○× 肢的日文原文里出现时，统计这类句子有多少是 ×
const TRAPS = [
  { w: ["必ず", "常に", "一切", "いかなる", "例外なく", "全て", "すべて"], name: "必ず・常に・一切（绝对化）", tip: "法律几乎都有例外。句子把话说死了，先怀疑它是 ×，再想有没有例外。" },
  { w: ["のみ", "に限り", "に限られ", "だけ"], name: "のみ・に限り（限定）", tip: "「只有……才」的说法：想一想是不是还有别的情形也可以。" },
  { w: ["しなければならない", "しなければならず", "要する"], name: "しなければならない（义务）", tip: "和「することができる（可以）」互换是经典陷阱：到底是必须，还是可以但不强制？" },
  { w: ["することができない", "できない"], name: "できない（禁止・不能）", tip: "否定句里经常藏着例外：「原则不能，但……时可以」。" },
  { w: ["直ちに", "遅滞なく", "あらかじめ", "までに"], name: "直ちに・遅滞なく・あらかじめ（时间点）", tip: "事前还是事后、立即还是不迟延，题目常把时间点换掉。" },
  { w: ["善意", "悪意", "無過失", "有過失", "過失"], name: "善意・悪意・過失（主观要件）", tip: "善意 / 善意無過失 / 悪意 —— 谁要哪一个，看对比表「意思表示」「無権代理」。" },
  { w: ["対抗することができ", "対抗できる", "対抗することができない", "対抗できない"], name: "対抗できる / できない", tip: "能不能对抗第三者：先分清对抗关系（看登记先后）还是当事者关系。" },
  { w: ["無効", "取り消すことができ", "取消し"], name: "無効 / 取消し（效果）", tip: "無効和取消し互换：錯誤是取消し（2020 年前是無効），虚偽表示是無効。" },
  { w: ["以上", "以下", "未満", "超え", "以内"], name: "以上・未満・超え（数字界限）", tip: "「以上・以下」含本数，「未満・超え」不含。配合速记表复习数字。" },
];
const stmtText = (x) => (x.q.type === "single" ? x.q.choices[x.i] : x.q.items?.[x.i]?.text) || "";
// 题干问法 → 要做什么
function askOf(q) {
  const s = q.stem.replace(/正しいものの組合せ/, "正しいもの");
  const neg = /誤っている|不適当|正しくない|誤りである/.test(s), pos = /正しい|適当/.test(s) && !neg;
  if (q.type === "count") return neg ? "count-ng" : "count-ok";
  if (q.type === "combo") return neg ? "combo-ng" : "combo-ok";
  return neg ? "pick-ng" : pos ? "pick-ok" : "other";
}
const ASK = { "pick-ok": "选出 **正确** 的那一个", "pick-ng": "选出 **错误** 的那一个", "count-ok": "数 **正确** 的有几个", "count-ng": "数 **错误** 的有几个", "combo-ok": "选 **正确** 的组合", "combo-ng": "选 **错误** 的组合" };
const ASK_RE = /(誤っているもの|正しいもの|不適当なもの|適当なもの|正しくないもの|いくつあるか|組合せ|判決文)/g;
let rd = null; // 读题训练 { list, i, picked, ok }

export async function viewTraps() {
  const { $, esc } = C;
  $("#app").innerHTML = `<h1>题型・陷阱・读题</h1><div class="empty">加载题库…</div>`;
  const D = await kkDB();
  if (rd) return renderRead(D);
  const T = (k) => C.S().kkLog?.filter((e) => e[0] === k) || [];
  const acc = (keys) => { let ok = 0, n = 0; for (const k of keys) for (const e of T(k)) { n++; ok += e[1]; } return { ok, n }; };
  const types = ["count", "combo"].map((ty) => { const qs = D.qs.filter((q) => q.type === ty); return { ty, qs, a: acc(qs.map((q) => q.id)) }; });
  const hanketsu = D.qs.filter((q) => /判決文/.test(q.stem));
  const traps = TRAPS.map((t) => { const xs = D.stmts.filter((x) => t.w.some((w) => stmtText(x).includes(w))); return { ...t, xs, ng: xs.filter((x) => !x.s.ok).length, a: acc(xs.map((x) => x.key)) }; });
  $("#app").innerHTML = `<h1>题型・陷阱・读题</h1>
  <p class="muted small" style="margin-top:0">不是知识点，而是「怎么读题、怎么不被套路」。数据来自已导入的过去问（${D.qs.length} 题、${D.stmts.length} 肢）。</p>
  <div class="card">
    <h2>① 读题：这题到底让我选什么？</h2>
    <p class="small muted" style="margin-top:-6px">很多分是因为把「誤っているもの」看成「正しいもの」丢的。下面是常见问法，然后用真题题干练 10 次。</p>
    <div class="cmp-wrap"><table class="cmp-t"><thead><tr><th>题干结尾</th><th>意思</th><th>做法</th></tr></thead><tbody>
      <tr><th lang="ja">正しいものはどれか</th><td>哪个是对的</td><td>找 1 个 ○</td></tr>
      <tr><th lang="ja">誤っているものはどれか</th><td>哪个是错的</td><td>找 1 个 ×（最容易看反）</td></tr>
      <tr><th lang="ja">正しいものはいくつあるか</th><td>对的有几个</td><td>ア〜エ 每个都要判断，<b>一个都不能跳</b></td></tr>
      <tr><th lang="ja">正しいものの組合せはどれか</th><td>对的组合</td><td>先排除确定错的选项，常常判断 2 个就够</td></tr>
      <tr><th lang="ja">民法の規定及び下記判決文によれば</th><td>按民法和下面的判决</td><td>先读判决文最后一句（结论），再看选项</td></tr>
      <tr><th lang="ja">（以下この問において「○○」という。）</th><td>本题里简称为「○○」</td><td>只是定义，不是考点</td></tr>
    </tbody></table></div>
    <div class="row" style="margin-top:12px"><button class="btn primary" id="readGo">读题训练 10 题</button><span class="small muted">只看题干，判断要选什么，不用作答</span></div>
  </div>
  <div class="card">
    <h2>② 题型专项</h2>
    ${types.map((x) => `<div class="hrow kk-row"><span class="hl">${x.ty === "count" ? "个数问题（いくつあるか）" : "组合问题（組合せ）"}</span>
      <span class="small muted" style="flex:1">${x.qs.length} 题${x.a.n ? ` · 正确率 ${pct(x.a.ok, x.a.n)}` : ""}</span><button class="btn sm" data-ty="${x.ty}" ${x.qs.length ? "" : "disabled"}>练</button></div>`).join("")}
    <div class="hrow kk-row"><span class="hl">判决文问题</span><span class="small muted" style="flex:1">${hanketsu.length} 题</span><button class="btn sm" data-ty="hanketsu" ${hanketsu.length ? "" : "disabled"}>练</button></div>
    <p class="small muted" style="margin:8px 0 0">个数问题要求 ア〜エ 全部判断对，是最难拿分的题型；平时用 ○× 把每一肢都练熟最有效。</p>
  </div>
  <div class="card">
    <h2>③ 陷阱用语</h2>
    <p class="small muted" style="margin-top:-6px">过去问 ○× 肢里出现这些词时，有多少是错的（×）。比例高的，看到就要提高警惕。</p>
    ${traps.map((t, i) => `<div class="trap">
      <div class="row"><b lang="ja">${esc(t.name)}</b><span class="spacer"></span>
        <span class="small">${t.xs.length} 肢 · <span class="${t.xs.length && t.ng / t.xs.length >= 0.6 ? "trap-hi" : ""}">× 占 ${pct(t.ng, t.xs.length)}</span>${t.a.n ? ` · 我的正确率 ${pct(t.a.ok, t.a.n)}` : ""}</span>
        <button class="btn sm" data-trap="${i}" ${t.xs.length ? "" : "disabled"}>练 ○×</button></div>
      <div class="small muted">${esc(t.tip)}</div></div>`).join("")}
  </div>`;
  $("#readGo").onclick = () => { rd = { list: shuffle(D.qs.filter((q) => ASK[askOf(q)])).slice(0, 10), i: 0, picked: null, ok: 0 }; renderRead(D); };
  $("#app").onclick = (e) => {
    const ty = e.target.closest("[data-ty]");
    if (ty) { const d = ty.dataset.ty; const qs = d === "hanketsu" ? hanketsu : D.qs.filter((q) => q.type === d); startQ(shuffle(qs.map((q) => q.id)).slice(0, 10), d === "hanketsu" ? "判决文问题" : d === "count" ? "个数问题" : "组合问题"); }
    const tr = e.target.closest("[data-trap]");
    if (tr) { const t = traps[Number(tr.dataset.trap)]; startOX(shuffle(t.xs.map((x) => x.key)).slice(0, 20), `陷阱用语：${t.name.split("（")[0]}`); }
  };
}
function renderRead(D) {
  const { $, esc } = C, r = rd;
  if (r.i >= r.list.length) {
    $("#app").innerHTML = `<h1>读题训练</h1><div class="card" style="text-align:center"><h2>${r.ok} / ${r.list.length}</h2><p class="muted">${r.ok === r.list.length ? "全对，读题没问题。" : "看错的那几题，回去注意题干最后那半句。"}</p>
      <div class="row" style="justify-content:center"><button class="btn primary" id="rAgain">再练 10 题</button><button class="btn" id="rBack">返回</button></div></div>`;
    $("#rAgain").onclick = () => { rd = { list: shuffle(D.qs.filter((q) => ASK[askOf(q)])).slice(0, 10), i: 0, picked: null, ok: 0 }; renderRead(D); };
    $("#rBack").onclick = () => { rd = null; viewTraps(); };
    return;
  }
  const q = r.list[r.i], want = askOf(q);
  const opts = ["pick-ok", "pick-ng", "count-ok", "count-ng", "combo-ok", "combo-ng"];
  const stem = esc(q.stem.replace(/^[【（(]?問\s*\d+[】）)]\s*/, "")).replace(/\n/g, "<br>");
  $("#app").innerHTML = `<h1>读题训练</h1>
  <div class="row" style="margin-bottom:10px"><span class="small muted">${r.i + 1} / ${r.list.length} · ${esc(D.exams[q.exam])} 問${q.no}</span><span class="spacer"></span><button class="btn sm" id="rQuit">结束</button></div>
  <div class="card kk-q">
    <div class="kk-stem" lang="ja">${r.picked ? stem.replace(ASK_RE, "<mark>$1</mark>") : stem}</div>
    ${q.items?.length ? `<div class="small muted">（下面还有 ${q.items.map((x) => esc(x.label)).join("・")} ${q.items.length} 个小项）</div>` : ""}
    <p class="small" style="margin:14px 0 8px"><b>这题要你做什么？</b></p>
    <div class="read-opts">${opts.map((o) => `<button class="btn ${r.picked ? (o === want ? "right" : o === r.picked ? "wrong" : "") : ""}" data-o="${o}" ${r.picked ? "disabled" : ""}>${rich(ASK[o])}</button>`).join("")}</div>
    ${r.picked ? `<p style="margin:12px 0 0">${r.picked === want ? "✅ 对" : "❌ 看错了"} —— 正确是「${rich(ASK[want])}」。题干中文：${esc(q.stemZh || "")}</p>
      <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn primary" id="rNext">下一题 →</button></div>` : ""}
  </div>`;
  $("#rQuit").onclick = () => { rd = null; viewTraps(); };
  $("#app").querySelectorAll("[data-o]").forEach((x) => x.onclick = () => { r.picked = x.dataset.o; if (r.picked === want) r.ok++; renderRead(D); });
  if ($("#rNext")) $("#rNext").onclick = () => { r.i++; r.picked = null; renderRead(D); };
}
