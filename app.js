import { BOOKS, POINTS, POINT_BY_ID, EXAM_DATE, DOJO_URL, DOJO_FIELDS } from "./toc.js?v=47e2629c20";
import { ENV, DEFAULT_REPO, detectEnv, probeLocalAI, localNetPermission, ghCfg, setGhCfg, testToken, clearContentCache, loadPoint, loadAudio as fetchAudio, loadGen,
  loadLocalState, writeLocalState, stamp, stampBaseline, sync, syncNow } from "./store.js?v=47e2629c20";

// ---------------- 状态 ----------------
let S = { points: {}, stuck: [], days: {}, stuckDel: [] };
const INTV = [1, 3, 7, 14, 30, 60]; // 复习间隔（天）
const SPEEDS = [0.8, 1, 1.25, 1.5, 1.75, 2];

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// 中日文里 **（教材外补充）**法律、**「善意」**的 这种加粗，标准 Markdown 规则认不出来（紧挨全角标点），这里补一条规则
marked.use({ extensions: [{
  name: "strongCJK", level: "inline",
  start(src) { const i = src.indexOf("**"); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = /^\*\*(?!\s)((?:[^*]|\*(?!\*))+?)(?<!\s)\*\*(?!\*)/.exec(src);
    if (m) return { type: "strong", raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
  },
}] });
const md = (s) => DOMPurify.sanitize(marked.parse(s || ""));
const today = () => new Date().toLocaleDateString("sv-SE");
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv-SE"); };
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function P(id) {
  return (S.points[id] ||= { status: "new", imp: null, notes: "", explain: "", chat: [], review: null });
}
let saveTimer, pushTimer;
function save() {
  stamp(S);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; writeLocalState(S); }, 400);
  clearTimeout(pushTimer);
  if (ghCfg()) pushTimer = setTimeout(doSync, 4000);
  renderNav();
}
// 关页面/刷新时，还没写出去的保存立刻写掉
addEventListener("pagehide", () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; writeLocalState(S); } });
const getS = () => S;
const setS = (x) => { S = x; stampBaseline(S); writeLocalState(S); };
async function doSync() {
  clearTimeout(pushTimer);
  const changed = await syncNow(getS, setS);
  // 别的设备有新记录：不在知识点页（避免打断音频/输入）时直接刷新页面
  if (changed && !location.hash.startsWith("#/p/")) route();
  else renderNav();
}
function touchDay() { S.days[today()] = (S.days[today()] || 0) + 1; }

const statusOf = (id) => S.points[id]?.status || "new";
const impOf = (pt) => S.points[pt.id]?.imp || pt.imp;
const dueList = () => POINTS.filter((pt) => { const r = S.points[pt.id]?.review; return r && r.due <= today(); });
const openStuck = () => S.stuck.filter((s) => !s.done);

function setStatus(id, st) {
  const p = P(id);
  p.status = st;
  if (st === "mastered" && !p.review) p.review = { step: 0, due: addDays(INTV[0]) };
  if (st === "new") p.review = null;
  touchDay(); save();
}
function rate(id, how) {
  const p = P(id);
  const step = p.review?.step ?? 0;
  if (how === "good") { const s = Math.min(step + 1, INTV.length - 1); p.review = { step: s, due: addDays(INTV[s]) }; p.status = "mastered"; }
  if (how === "vague") p.review = { step, due: addDays(Math.max(1, Math.round(INTV[step] / 2))) };
  if (how === "forgot") { p.review = { step: 0, due: addDays(1) }; p.status = "learning"; }
  touchDay(); save();
}

// ---------------- 导航 ----------------
function renderNav() {
  const r = location.hash.split("/")[1] || "";
  const due = dueList().length, stuck = openStuck().length;
  const item = (h, label, n) => `<a href="#/${h}" class="${r === h ? "on" : ""}">${label}${n ? `<span class="badge">${n}</span>` : ""}</a>`;
  $("#nav").innerHTML = item("", "首页") + item("toc", "目录") + item("review", "今日复习", due) + item("stuck", "卡点本", stuck) + item("stats", "统计");
  const sy = { off: "", syncing: "sync-ing", ok: "sync-ok", error: "sync-err" }[sync.state];
  const sb = $("#syncBtn");
  sb.classList.toggle("on", r === "sync");
  sb.title = `同步：${syncTip()}`;
  sb.innerHTML = `☁️${sy ? `<i class="sync-dot ${sy}"></i>` : ""}`;
}

// ---------------- 首页 ----------------
function viewHome() {
  const total = POINTS.length;
  const m = POINTS.filter((p) => statusOf(p.id) === "mastered").length;
  const l = POINTS.filter((p) => statusOf(p.id) === "learning").length;
  const left = daysBetween(today(), EXAM_DATE);
  const next = POINTS.find((p) => statusOf(p.id) === "learning") || POINTS.find((p) => statusOf(p.id) === "new");
  // 书里建议：11 月开始的话，2 月底前学完权利关系
  const target = "2027-02-28";
  const remain = total - m;
  const perWeek = remain ? Math.ceil(remain / Math.max(1, daysBetween(today(), target) / 7)) : 0;
  const studyDays = Object.keys(S.days).length;

  $("#app").innerHTML = `
  <div class="stats">
    <div class="stat"><div class="v">${left}</div><div class="k">天后考试（${EXAM_DATE}）</div></div>
    <div class="stat"><div class="v">${m}<span class="muted small"> / ${total}</span></div><div class="k">权利关系 已掌握</div></div>
    <div class="stat"><div class="v">${dueList().length}</div><div class="k">今天要复习</div></div>
    <div class="stat"><div class="v">${openStuck().length}</div><div class="k">没解决的卡点</div></div>
  </div>
  <div class="card">
    <div class="row"><h2 style="margin:0">继续学习</h2><span class="spacer"></span><span class="muted small">已学习 ${studyDays} 天</span></div>
    ${next ? `<p style="margin:8px 0 12px">第${next.course}コース「${esc(next.courseTitle)}」 › <b>第${next.n}ポイント ${esc(next.title)}</b></p>
      <a class="btn primary" href="#/p/${next.id}">开始这一节 →</a>` : `<p>🎉 权利关系全部掌握了！</p>`}
  </div>
  <div class="card">
    <h2>权利关系 进度</h2>
    <div class="bar"><i class="m" style="width:${(m / total) * 100}%"></i><i class="l" style="width:${(l / total) * 100}%"></i></div>
    <div class="legend"><span><i class="dot" style="background:var(--good)"></i>已掌握 ${m}</span><span><i class="dot" style="background:var(--warn)"></i>学习中 ${l}</span><span><i class="dot" style="background:var(--line)"></i>未学 ${total - m - l}</span></div>
    <p class="small muted" style="margin:12px 0 0">教材建议 11 月开始的话，2 月底前学完权利关系。按这个节奏，每周大约学 <b>${perWeek}</b> 个ポイント（共 ${total} 个，考试 14 题）。</p>
  </div>
  <div class="card">
    <h2>每一节怎么学</h2>
    <ol style="margin:0;padding-left:1.3em">
      <li><b>听原文</b>：先听作者朗读这一节（可以调速），跟着看日文原文。</li>
      <li><b>读中文讲义</b>：AI 根据原文生成的中文讲义，弄懂"为什么"。</li>
      <li><b>问 AI</b>：哪里不懂直接问；然后让 AI 出题，或者你讲给 AI 听。</li>
      <li><b>标记状态</b>：真懂了就标「已掌握」，系统会在 1、3、7、14、30、60 天后安排复习。</li>
      <li><b>记卡点</b>：暂时想不通的，记进卡点本，之后回来解决。</li>
    </ol>
  </div>`;
}

// ---------------- 目录 ----------------
function viewToc() {
  const b = BOOKS[0];
  $("#app").innerHTML = `<h1>${b.title}（${b.zh}）</h1>
  <p class="muted small" style="margin-top:0">${b.volume} · ${b.courses.length} 个コース · ${POINTS.length} 个ポイント · 考试 ${b.examQ} 题</p>
  ${b.courses.map((c) => {
    const pts = POINTS.filter((p) => p.course === c.n);
    const done = pts.filter((p) => statusOf(p.id) === "mastered").length;
    return `<div class="course">
      <div class="course-h"><b>第${c.n}コース ${esc(c.title)}</b><span class="muted small">p.${c.p} · ${done}/${pts.length}</span>
      ${c.ichimon ? `<span class="muted small">一問一答 ${c.ichimon} · 過去問 ${c.kakomon}</span>` : ""}</div>
      <div class="plist">${pts.map((pt) => {
        const imp = impOf(pt), r = S.points[pt.id]?.review;
        return `<a class="pitem" href="#/p/${pt.id}"><i class="st ${statusOf(pt.id)}"></i>
          <span class="t">${"❶❷❸❹❺❻❼❽"[pt.n - 1]} ${esc(pt.title)}</span>
          ${r && r.due <= today() ? `<span class="due-tag">复习</span>` : ""}
          ${imp ? `<span class="imp ${imp}">${imp}</span>` : ""}</a>`;
      }).join("")}</div></div>`;
  }).join("")}`;
}

// ---------------- 知识点页 ----------------
let cur = null; // { id, segments, streaming }

async function viewPoint(id, opts = {}) {
  const pt = POINT_BY_ID[id];
  if (!pt) return viewToc();
  const p = P(id);
  if (p.status === "new") { p.status = "learning"; touchDay(); save(); }
  const idx = POINTS.indexOf(pt);
  const prev = POINTS[idx - 1], next = POINTS[idx + 1];
  const isDue = p.review && p.review.due <= today();
  cur = { id, segments: [], streaming: false, gen: null };

  $("#app").innerHTML = `
  <div class="crumbs"><a href="#/toc">${pt.bookTitle}</a> › 第${pt.course}コース ${esc(pt.courseTitle)} › 教材 ${pt.volume} p.${pt.page}</div>
  <div class="phead">
    <div class="spacer"><h1>第${pt.n}ポイント　${esc(pt.title)}</h1></div>
    <div class="row">
      <span class="small muted">重要度</span>
      <div class="seg" id="impSeg">${["A", "B", "C"].map((x) => `<button data-imp="${x}" class="${impOf(pt) === x ? "on learning" : ""}">${x}</button>`).join("")}</div>
      <div class="seg" id="stSeg">${[["new", "未学"], ["learning", "学习中"], ["mastered", "已掌握"]].map(([k, v]) => `<button data-st="${k}" class="${p.status === k ? "on " + k : ""}">${v}</button>`).join("")}</div>
    </div>
  </div>
  ${isDue || opts.review ? `<div class="review-bar"><div class="row"><b>🔁 复习这一节</b><span class="small muted">先在右边点「复习提问」让 AI 考你，答完后给自己打分：</span><span class="spacer"></span>
    <button class="btn sm" data-rate="forgot">😵 忘了</button><button class="btn sm" data-rate="vague">🤔 模糊</button><button class="btn sm primary" data-rate="good">😎 记得</button></div></div>` : ""}
  <div class="steps"><span>① 听原文</span><span>② 读讲义</span><span>③ 问 AI · 做题 · 讲给 AI 听</span><span>④ 标记掌握</span></div>
  <div class="grid2">
    <div>
      <div class="card">
        <div class="tabs"><button data-tab="audio" class="on">🎧 原文朗读</button><button data-tab="explain">📖 中文讲义</button><button data-tab="cards">🃏 闪卡</button><button data-tab="notes">✏️ 我的笔记</button></div>
        <div id="tab-audio"><div class="empty">加载中…</div></div>
        <div id="tab-explain" hidden></div>
        <div id="tab-cards" hidden></div>
        <div id="tab-notes" hidden>
          <textarea id="notes" rows="10" placeholder="用自己的话写下这一节的要点。AI 回答时也会参考你的笔记。">${esc(p.notes)}</textarea>
          <p class="small muted">自动保存。</p>
        </div>
      </div>
      <div class="card">
        <div class="row"><h2 style="margin:0">📝 真题练习</h2><span class="spacer"></span>${dojoSummary(pt)}</div>
        ${pt.dojo ? `<p class="small" style="margin:10px 0">本节对应「${pt.dojo.n}. ${esc(pt.dojo.name)}」分野。点按钮跳过去 → 点书签栏的 <b>📌 宅建</b> 直接开始；<b>做完一批不想做了，再点一次 📌 宅建</b>，一問一答的对错就自动记回来（过去问记不回来，用下面的 ✅ / ❌ 手动记）。</p>` : ""}
        ${bmInstalled() ? "" : `<p class="small" style="margin:0 0 10px">还没装 📌 宅建 书签？去 <a href="#/sync">☁️ 同步</a> 页面装一下。</p>`}
        <div class="row">
          <button class="btn primary" data-dojo="marubatu">一問一答（○×）↗</button>
          <button class="btn primary" data-dojo="kakomon">过去问（四选一）↗</button>
          ${ENV.ai ? `<button class="btn" id="wrongQ">做错了？让 AI 讲</button>` : ""}
        </div>
        <div class="row small muted" style="margin-top:10px">
          <span>过去问的成绩读不到，做完可以手动记：</span>
          <button class="btn sm" data-tally="ok">✅ 对 <b>${p.quiz?.ok || 0}</b></button>
          <button class="btn sm" data-tally="ng">❌ 错 <b>${p.quiz?.ng || 0}</b></button>
        </div>
      </div>
      <div class="pager">
        ${prev ? `<a class="btn" href="#/p/${prev.id}">← ${esc(prev.title)}</a>` : "<span></span>"}
        ${next ? `<a class="btn" href="#/p/${next.id}">${esc(next.title)} →</a>` : "<span></span>"}
      </div>
    </div>
    <div class="side"><div class="card chat">
      <div class="row" style="margin-bottom:8px"><h2 style="margin:0">💬 AI 老师</h2><span class="spacer"></span><button class="btn sm" id="clearChat">清空</button></div>
      <div class="quick" ${ENV.ai ? "" : "hidden"}>
        <button class="btn sm" data-q="again">换个例子再讲</button>
        <button class="btn sm" data-q="quiz">出 3 道题</button>
        <button class="btn sm" data-q="teach">我讲给你听</button>
        <button class="btn sm" data-q="compare">易混点对比</button>
        <button class="btn sm" data-q="review">复习提问</button>
      </div>
      <div class="msgs" id="msgs"></div>
      ${ENV.ai ? `<div class="composer">
        <textarea id="input" rows="2" placeholder="哪里不懂？直接问。（Enter 发送，Shift+Enter 换行）"></textarea>
        <button class="btn primary" id="send">发送</button>
      </div>` : `<div class="no-ai-note">📵 这台设备不连接 AI。上面是在电脑上问过的对话记录；要问 AI，请到电脑上打开这一节。<br>不懂的地方可以先 <a href="#/stuck">记进卡点本</a>。</div>`}
    </div></div>
  </div>`;

  // 事件
  $("#stSeg").onclick = (e) => { const b = e.target.closest("[data-st]"); if (b) { setStatus(id, b.dataset.st); viewPoint(id); } };
  $("#impSeg").onclick = (e) => { const b = e.target.closest("[data-imp]"); if (b) { P(id).imp = b.dataset.imp; save(); viewPoint(id); } };
  document.querySelectorAll("[data-rate]").forEach((b) => b.onclick = () => {
    rate(id, b.dataset.rate);
    const nextDue = dueList()[0];
    location.hash = nextDue ? `#/p/${nextDue.id}/review` : "#/review";
  });
  document.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => {
    document.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b));
    ["audio", "explain", "cards", "notes"].forEach((t) => $("#tab-" + t).hidden = t !== b.dataset.tab);
  });
  document.querySelectorAll("[data-tally]").forEach((b) => b.onclick = () => {
    const q = (P(id).quiz ||= { ok: 0, ng: 0 });
    q[b.dataset.tally]++; touchDay(); save();
    b.querySelector("b").textContent = q[b.dataset.tally];
  });
  document.querySelectorAll("[data-dojo]").forEach((b) => b.onclick = () => openDojo(b.dataset.dojo, pt.dojo?.n));
  if ($("#wrongQ")) $("#wrongQ").onclick = () => {
    $("#input").value = "我做错了一道真题：\n【题目】\n\n【我的答案】\n【正确答案】\n请告诉我错在哪里、对应这一节的哪条规则，以及下次怎么避免。";
    $("#input").rows = 7; $("#input").focus();
  };
  $("#notes").oninput =(e) => { P(id).notes = e.target.value; save(); };
  $("#clearChat").onclick = () => { if (confirm("清空这一节的对话？")) { P(id).chat = []; save(); renderMsgs(); } };
  if (ENV.ai) {
    document.querySelectorAll("[data-q]").forEach((b) => b.onclick = () => send(QUICK[b.dataset.q]));
    $("#send").onclick = () => send($("#input").value);
    $("#input").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send($("#input").value); } };
    if (opts.ask) { $("#input").value = opts.ask; $("#input").focus(); }
  }

  renderExplain();
  renderCards();
  renderMsgs();
  loadAudio(id);
  loadGen(id).then((g) => {
    if (cur?.id !== id) return;
    cur.gen = g;
    const before = JSON.stringify(p);
    // 和仓库里的内容一样的，就不再重复存进学习记录
    if (p.explain && p.explain === g.explain) p.explain = "";
    if (p.cards?.length && JSON.stringify(p.cards.map((c) => c.q)) === JSON.stringify(g.cards.map((c) => c.q))) {
      p.cardStat ||= {};
      p.cards.forEach((c, i) => { if (c.ok || c.ng || c.known) p.cardStat[i] = { ok: c.ok || 0, ng: c.ng || 0, known: !!c.known }; });
      delete p.cards;
    }
    if (JSON.stringify(p) !== before) save();
    renderExplain(); renderCards();
  }).catch((e) => { if (cur?.id === id) { cur.gen = { explain: "", cards: [], error: e.message }; renderExplain(); renderCards(); } });
}

const QUICK = {
  again: "我还是不太理解。请换一个更生活化的例子，把这一节最核心的内容再讲一遍。",
  quiz: "请针对这一节出 3 道宅建真题风格的题（○×题或四选一）。先只出题，不要给答案，等我作答。",
  teach: "我要把这一节的内容讲给你听，你扮演严格的考官：听完后指出我讲错的、讲漏的地方，并打分（满分 10 分）。请先简短提示我可以开始了。",
  compare: "这一节有哪些容易混淆的概念（包括和其他章节的概念）？请做成对比表，并说明考试中怎么区分。",
  review: "现在是复习时间。请对这一节进行复习提问：一次只问一个问题，问理解型问题（不要只问定义），不要给答案，等我回答后再批改并问下一个。共问 3 个。",
};

// ----- 宅建試験ドットコム（一問一答道場 / 過去問道場） -----
// 那个网站只接受「从它自己页面」点的出題開始，所以用一个书签「📌 宅建」在它的页面上帮你操作：
// ① 从本站按钮跳过去（网址带 #tk=分野号）→ 点书签：提交它自己的出题表单，直接从这个分野开始
// ② 其他时候（做完一批题）→ 点书签：读出你浏览器里一問一答的答题记录（它自己存的 MB_RESULT），
//    带着打开本站 #/import/…，本站去重后记进学习记录。过去问的成绩存在它的服务器上，读不到。
const bookmarklet = () => `javascript:(()=>{` +
  `if(location.hostname!=='takken-siken.com'){alert('这个书签要在宅建試験ドットコム的页面上点。');return}` +
  `const m=location.hash.match(/tk=(\\d+)/);` +
  `if(m){` +
    `const k=/kakomon/.test(location.pathname)?'kakomon':'marubatu';` +
    `const c=document.getElementById('configform');` +
    `let T=c?[...c.querySelectorAll('[name="times[]"]:checked')].map(e=>e.value):[];` +
    `if(!T.length)T=['26','25','24','23','22','21-2','21-1','20-2','20-1','19','18','17','16','15','14','13','12'];` +
    `const f=document.createElement('form');f.method='post';f.action='/'+k+'.php';` +
    `const a=(n,v)=>{const i=document.createElement('input');i.type='hidden';i.name=n;i.value=v;f.appendChild(i)};` +
    `T.forEach(t=>a('times[]',t));a('fields[]','1');a('categories[]','1_'+m[1]);` +
    `if(k==='kakomon'){[1,2,3,4,5].forEach(l=>a('level[]',l));a('mode','1');a('qno','0')}else{a('settingChange','1');a('requestCount','1')}` +
    `(document.body||document.documentElement).appendChild(f);f.submit();return}` +
  `const d=(localStorage.getItem('MB_RESULT')||'').split('|').map(x=>x.split(',')).filter(x=>x.length===4&&/^1_\\d+$/.test(x[2])).map(x=>[x[0],x[1],x[2].slice(2),x[3]].join(',')).join(';');` +
  `if(!d){alert('这台设备上还没有一問一答（権利関係）的答题记录。\\n（过去问的成绩存在对方服务器上，读不到，请在学习站手动记。）');return}` +
  `window.open(${JSON.stringify(location.origin + location.pathname)}+'#/import/'+encodeURIComponent(d),'_blank')})()`;
// 书签装在浏览器里，所以「装没装」按设备记（localStorage），不跟着学习记录同步
const BM_KEY = "takken.bm";
function bmInstalled() { try { return localStorage.getItem(BM_KEY) === "1"; } catch { return false; } }
function setBmInstalled(v) { try { v ? localStorage.setItem(BM_KEY, "1") : localStorage.removeItem(BM_KEY); } catch {} }
const isTouch = () => matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches;
function bmSetupHtml() {
  return `<ol class="bm-steps">
    <li>按 <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>（Windows 是 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>）显示书签栏</li>
    <li>把这个按钮<b>拖到书签栏</b>上 → <a class="bm-link" href="${esc(bookmarklet())}" onclick="alert('不要点它，把它拖到书签栏上。');return false">📌 宅建</a></li>
    <li>跳过去：课程页点「一問一答」或「过去问」按钮 → 到那边点 <b>📌 宅建</b>，自动选好这一节的分野开始出题（两种都可以）</li>
    <li>记回来：<b>一問一答</b>做完一批，再点一次 <b>📌 宅建</b>，对错自动记回来；<b>过去问</b>的成绩存在对方服务器上，书签读不到，做完在课程页「真题练习」里手动点 ✅ / ❌</li>
  </ol>`;
}
// 新设备（这个浏览器还没确认装过书签）：弹窗提示先装书签。手机/平板拖不了书签，不弹。
let bmAsked = false;
function maybeAskBookmark() {
  if (bmAsked || bmInstalled() || isTouch() || $(".modal-bg")) return;
  bmAsked = true;
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="bmTitle">
    <h2 id="bmTitle" style="margin-top:0">📌 新设备：先装做题书签</h2>
    <p class="small muted" style="margin-top:0">做真题要靠这个书签：跳到宅建試験ドットコム后自动选好分野，做完一批还能把一問一答的对错记回来。每个浏览器装一次就行。</p>
    ${bmSetupHtml()}
    <div class="row" style="justify-content:flex-end;margin-top:12px">
      <button class="btn" id="bmLater">稍后</button>
      <button class="btn primary" id="bmYes">已经装好了</button>
    </div></div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.querySelector("#bmLater").onclick = close;
  bg.querySelector("#bmYes").onclick = () => { setBmInstalled(true); close(); route(); };
}
function openDojo(kind, n) {
  window.open(`https://takken-siken.com/${kind}.php${n ? `#tk=${n}` : ""}`, "_blank");
}

// ----- 音频 + 原文 -----
async function loadAudio(id) {
  const box = $("#tab-audio");
  let d;
  try { d = await loadPoint(id); }
  catch (e) { if (cur?.id === id) box.innerHTML = `<div class="empty">原文加载失败：${esc(e.message)}</div>`; return; }
  if (cur?.id !== id) return;
  cur.segments = d.segments || [];
  if (!d.audio && !cur.segments.length) {
    box.innerHTML = `<div class="empty">这一节的朗读音频还没切好。</div>`;
    return;
  }
  const rate = Number(localStorage.getItem("rate") || 1);
  box.innerHTML = `
    ${d.audio ? `<audio id="audio" controls preload="metadata"></audio><div class="small muted" id="audioMsg"></div>
    <div class="row"><span class="small muted">速度</span><div class="speeds">${SPEEDS.map((s) => `<button class="btn sm ${s === rate ? "on" : ""}" data-sp="${s}">${s}×</button>`).join("")}</div>
    <span class="spacer"></span><label class="small muted"><input type="checkbox" id="follow" checked> 自动滚动</label></div>` : ""}
    <div class="transcript" id="tr">${cur.segments.map((s, i) => `<div class="line" data-i="${i}"><span class="ts">${fmtT(s.start)}</span><span>${esc(s.text)}</span></div>`).join("")}</div>
    <p class="small muted" style="margin:8px 0 0">原文由语音识别生成，个别术语可能有错字，以教材为准。点击任意一句可以从那里开始播放。</p>`;
  const audio = $("#audio");
  if (!audio) return;
  if (!ENV.local) $("#audioMsg").textContent = "音频下载中…（第一次打开这一节需要下载，之后会缓存）";
  fetchAudio(id).then((url) => {
    if (cur?.id !== id) return;
    $("#audioMsg").textContent = url ? "" : "这一节没有音频";
    if (url) { audio.defaultPlaybackRate = rate; audio.src = url; audio.playbackRate = rate; }
  }).catch((e) => { if (cur?.id === id) $("#audioMsg").textContent = `音频加载失败：${e.message}`; });
  audio.playbackRate = rate;
  box.querySelectorAll("[data-sp]").forEach((b) => b.onclick = () => {
    audio.playbackRate = Number(b.dataset.sp); localStorage.setItem("rate", b.dataset.sp);
    box.querySelectorAll("[data-sp]").forEach((x) => x.classList.toggle("on", x === b));
  });
  $("#tr").onclick = (e) => { const l = e.target.closest(".line"); if (l) { audio.currentTime = cur.segments[l.dataset.i].start; audio.play(); } };
  let last = -1;
  audio.ontimeupdate = () => {
    const t = audio.currentTime;
    let i = cur.segments.findIndex((s) => t >= s.start && t < s.end);
    if (i < 0) return;
    if (i === last) return;
    last = i;
    const tr = $("#tr");
    tr.querySelector(".cur")?.classList.remove("cur");
    const el = tr.querySelector(`[data-i="${i}"]`);
    el.classList.add("cur");
    if ($("#follow").checked) tr.scrollTo({ top: el.offsetTop - tr.offsetTop - tr.clientHeight / 3, behavior: "smooth" });
  };
}

// ----- 中文讲义 -----
function renderExplain() {
  const p = P(cur.id), box = $("#tab-explain");
  if (cur.streaming === "explain") return;
  if (!cur.gen && !p.explain) { box.innerHTML = `<div class="empty">讲义加载中…</div>`; return; }
  const text = p.explain || cur.gen?.explain;
  box.innerHTML = text
    ? `<div class="md">${md(text)}</div>${ENV.ai ? `<div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn sm" id="regen">重新生成讲义</button></div>` : ""}`
    : `<div class="empty"><p>${cur.gen?.error ? `讲义加载失败：${esc(cur.gen.error)}` : "这一节的中文讲义还没生成。"}</p>${ENV.ai ? `<button class="btn primary" id="regen">生成中文讲义</button>` : ""}</div>`;
  if ($("#regen")) $("#regen").onclick = genExplain;
}
async function genExplain() {
  if (cur.streaming) return;
  const id = cur.id, box = $("#tab-explain");
  cur.streaming = "explain";
  box.innerHTML = `<div class="md typing"></div>`;
  const out = box.firstChild;
  const text = await streamAI({ pointId: id, kind: "explain" }, (t) => { if (cur.id === id) out.innerHTML = md(t); });
  P(id).explain = text; save();
  if (cur.id === id) { cur.streaming = false; renderExplain(); }
}

// ----- 闪卡 -----
// 卡片内容：仓库里的 data/gen/<id>.cards.json（自己重新生成过的话用 p.cards）
// 记忆记录：p.cardStat = { 卡片下标: { ok, ng, known } }；cur.deck = { order: [卡片下标], i, flipped, mode }
const deckCards = () => (P(cur.id).cards?.length ? P(cur.id).cards : cur.gen?.cards || []);
const cs = (i) => ((P(cur.id).cardStat ||= {})[i] ||= {});
const csPeek = (i) => P(cur.id).cardStat?.[i] || {};
function renderCards() {
  const p = P(cur.id), box = $("#tab-cards");
  if (cur.streaming === "cards") return;
  updateCardTab();
  const cards = deckCards();
  if (!cards.length) {
    if (!cur.gen) { box.innerHTML = `<div class="empty">闪卡加载中…</div>`; return; }
    box.innerHTML = `<div class="empty"><p>${cur.gen.error ? `闪卡加载失败：${esc(cur.gen.error)}` : "这一节的闪卡还没生成。"}</p>
      ${ENV.ai ? `<button class="btn primary" id="genCards">生成闪卡</button><p class="small">大约需要 1～2 分钟。</p>` : ""}</div>`;
    if ($("#genCards")) $("#genCards").onclick = genCards;
    return;
  }
  if (!cur.deck) startDeck("all");
  const d = cur.deck, known = cards.filter((_, i) => csPeek(i).known).length;
  if (d.i >= d.order.length) {
    const weak = cards.length - known;
    box.innerHTML = `<div class="empty"><p style="font-size:28px;margin:0">🎉</p><p>这一轮 ${d.order.length} 张练完了。<br>已记住 <b>${known}</b> / ${cards.length} 张。</p>
      <div class="row" style="justify-content:center">${weak ? `<button class="btn primary" data-deck="weak">再练没记住的 ${weak} 张</button>` : ""}
      <button class="btn" data-deck="all">全部重来</button><button class="btn" id="cardList">查看全部卡片</button></div></div>`;
  } else {
    const c = cards[d.order[d.i]], st = csPeek(d.order[d.i]);
    box.innerHTML = `
      <div class="row small muted" style="margin-bottom:10px">
        <span>第 <b>${d.i + 1}</b> / ${d.order.length} 张${d.mode === "weak" ? "（只练没记住的）" : ""}</span><span class="spacer"></span>
        <span>已记住 ${known}/${cards.length}</span>
      </div>
      <div class="bar" style="margin-bottom:12px"><div class="m" style="width:${(known / cards.length) * 100}%"></div></div>
      <div class="flash ${d.flipped ? "flipped" : ""}" id="flash" title="点击翻面（空格键）">
        <div class="flash-tag">${esc(c.tag || "")}${st.ng ? ` · 错过 ${st.ng} 次` : ""}</div>
        <div class="flash-q">${esc(c.q)}</div>
        ${d.flipped ? `<div class="flash-a md">${md(c.a)}</div>` : `<div class="flash-hint">先在心里回答，再点击翻面</div>`}
      </div>
      <div class="row" style="justify-content:center;margin-top:12px">
        ${d.flipped
          ? `<button class="btn" data-grade="ng">❌ 没记住 <span class="small muted">1</span></button><button class="btn primary" data-grade="ok">✅ 记住了 <span class="small">2</span></button>`
          : `<button class="btn primary" id="flipBtn">翻面 <span class="small">空格</span></button>`}
      </div>
      <div class="row small" style="margin-top:14px"><span class="spacer"></span>
        <button class="btn sm" data-deck="all">从头练全部</button>
        <button class="btn sm" data-deck="weak">只练没记住的</button>
        <button class="btn sm" id="cardList">查看全部</button>
        ${ENV.ai ? `<button class="btn sm" id="askCard">这张不懂，问 AI</button>` : ""}
      </div>`;
    $("#flash").onclick = flipCard;
    if ($("#flipBtn")) $("#flipBtn").onclick = flipCard;
    box.querySelectorAll("[data-grade]").forEach((b) => b.onclick = () => gradeCard(b.dataset.grade));
    if ($("#askCard")) $("#askCard").onclick = () => { $("#input").value = `闪卡上这一张我不太懂：\n【问题】${c.q}\n【答案】${c.a}\n请再用例子讲一下为什么。`; $("#input").focus(); };
  }
  box.querySelectorAll("[data-deck]").forEach((b) => b.onclick = () => { startDeck(b.dataset.deck); renderCards(); });
  $("#cardList").onclick = renderCardList;
}
function startDeck(mode) {
  const cards = deckCards();
  let order = cards.map((_, i) => i);
  if (mode === "weak") order = order.filter((i) => !csPeek(i).known);
  if (!order.length) { order = cards.map((_, i) => i); mode = "all"; }
  // 没记住 / 错得多的排前面，其余保持教材顺序
  order.sort((x, y) => (!!csPeek(x).known - !!csPeek(y).known) || ((csPeek(y).ng || 0) - (csPeek(x).ng || 0)) || x - y);
  cur.deck = { order, i: 0, flipped: false, mode };
}
function flipCard() { cur.deck.flipped = !cur.deck.flipped; renderCards(); }
function gradeCard(g) {
  const d = cur.deck, c = cs(d.order[d.i]);
  c[g] = (c[g] || 0) + 1; c.known = g === "ok";
  touchDay(); save();
  d.i++; d.flipped = false; renderCards();
}
function updateCardTab() {
  const cards = deckCards(), b = document.querySelector('[data-tab="cards"]');
  if (b) b.innerHTML = `🃏 闪卡${cards.length ? ` <span class="small">${cards.filter((_, i) => csPeek(i).known).length}/${cards.length}</span>` : ""}`;
}
function renderCardList() {
  const cards = deckCards(), box = $("#tab-cards");
  box.innerHTML = `<div class="row" style="margin-bottom:10px"><b>全部 ${cards.length} 张</b><span class="spacer"></span>
      <button class="btn sm" id="backDeck">← 回去练习</button>${ENV.ai ? `<button class="btn sm" id="genCards">重新生成</button>` : ""}</div>
    <div class="card-list">${cards.map((c, i) => { const st = csPeek(i); return `<details class="cl ${st.known ? "known" : ""}"><summary><span class="muted small">${i + 1}.</span> ${esc(c.q)} ${st.known ? "✅" : st.ng ? "❌" : ""}</summary><div class="md">${md(c.a)}</div></details>`; }).join("")}</div>`;
  $("#backDeck").onclick = renderCards;
  if ($("#genCards")) $("#genCards").onclick = () => { if (confirm("重新生成会替换现在的闪卡（记忆记录也会清零），确定？")) genCards(); };
}
async function genCards() {
  if (cur.streaming) return;
  const id = cur.id, box = $("#tab-cards");
  cur.streaming = "cards";
  box.innerHTML = `<div class="empty"><p class="typing">AI 正在做闪卡…</p><p class="small" id="cardProg">已写 0 张</p></div>`;
  const text = await streamAI({ pointId: id, kind: "cards" }, (t) => {
    const n = (t.match(/"q"\s*:/g) || []).length;
    if (cur.id === id && $("#cardProg")) $("#cardProg").textContent = `已写 ${n} 张`;
  });
  let cards = null;
  try {
    const s = text.indexOf("["), e = text.lastIndexOf("]");
    cards = JSON.parse(text.slice(s, e + 1)).filter((c) => c && c.q && c.a).map((c) => ({ q: String(c.q), a: String(c.a), tag: String(c.tag || "") }));
  } catch {}
  if (cur.id === id) cur.streaming = false;
  if (!cards?.length) {
    if (cur.id === id) box.innerHTML = `<div class="empty"><p>闪卡生成失败了。</p><pre class="small" style="white-space:pre-wrap;text-align:left">${esc(text.slice(-400))}</pre><button class="btn primary" id="genCards">重试</button></div>`;
    if (cur.id === id) $("#genCards").onclick = genCards;
    return;
  }
  P(id).cards = cards; P(id).cardStat = {}; save();
  if (cur.id === id) { cur.deck = null; renderCards(); }
}
document.addEventListener("keydown", (e) => {
  if (!cur?.deck || $("#tab-cards")?.hidden || /INPUT|TEXTAREA/.test(document.activeElement?.tagName) || !$("#flash")) return;
  if (e.key === " ") { e.preventDefault(); flipCard(); }
  else if (cur.deck.flipped && e.key === "1") gradeCard("ng");
  else if (cur.deck.flipped && e.key === "2") gradeCard("ok");
});

// ----- 对话 -----
function renderMsgs() {
  const chat = P(cur.id).chat;
  $("#msgs").innerHTML = chat.length
    ? chat.map((m, i) => `<div class="msg ${m.role}"><div class="bubble ${m.role === "assistant" ? "md" : ""}">${m.role === "assistant" ? md(m.content) : esc(m.content).replace(/\n/g, "<br>")}</div>
      ${m.role === "assistant" ? `<div class="acts"><button data-stuck="${i}">📌 记为卡点</button></div>` : ""}</div>`).join("")
    : `<div class="empty small">还没有对话。<br>不懂的地方直接问，或者点上面的按钮。</div>`;
  $("#msgs").querySelectorAll("[data-stuck]").forEach((b) => b.onclick = () => {
    const q = chat[b.dataset.stuck - 1]?.content || "";
    const text = prompt("记下这个卡点（简单写哪里没懂）：", q.slice(0, 80));
    if (text) { S.stuck.unshift({ id: Date.now(), pointId: cur.id, text, created: today(), done: false }); save(); }
  });
  $("#msgs").scrollTop = 1e9;
}
async function send(text) {
  text = (text || "").trim();
  if (!text || cur.streaming) return;
  const id = cur.id, p = P(id);
  $("#input").value = "";
  p.chat.push({ role: "user", content: text });
  renderMsgs();
  cur.streaming = "chat";
  $("#send").disabled = true;
  const wrap = document.createElement("div");
  wrap.className = "msg assistant";
  wrap.innerHTML = `<div class="bubble md typing"></div>`;
  $("#msgs").querySelector(".empty")?.remove();
  $("#msgs").appendChild(wrap);
  const bubble = wrap.firstChild;
  const answer = await streamAI({ pointId: id, history: p.chat, notes: p.notes }, (t) => {
    if (cur.id !== id) return;
    bubble.innerHTML = md(t);
    const m = $("#msgs"); if (m.scrollHeight - m.scrollTop - m.clientHeight < 200) m.scrollTop = 1e9;
  });
  p.chat.push({ role: "assistant", content: answer });
  touchDay(); save();
  if (cur.id === id) { cur.streaming = false; $("#send").disabled = false; renderMsgs(); }
}
async function streamAI(body, onText) {
  let text = "";
  try {
    const res = await fetch(`${ENV.aiBase}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const reader = res.body.getReader(), dec = new TextDecoder();
    let pending = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; onText(text); }); }
    }
  } catch (e) { text += `\n\n⚠️ 网络错误：${e.message}`; }
  onText(text);
  if (ENV.ai) refreshAI(); // 每次问完都顺便更新右上角状态（出错会变色）
  return text;
}

// ---------------- 右上角 Claude 连接状态 ----------------
const AI_LABEL = {
  checking: ["checking", "Claude 检查中…", "正在检查本机 Claude 登录"],
  ok: ["ok", "Claude 已连接", "AI 走你的 Claude 套餐额度，可以正常提问"],
  limited: ["warn", "Claude 额度用完", "套餐额度暂时用完，过一会儿再试"],
  logged_out: ["bad", "Claude 未登录", "在终端运行一次 claude（Claude Code）用你的账号登录，然后点这里重新检查"],
  error: ["bad", "Claude 连不上", "检查失败"],
  offline: ["bad", "本地服务没开", "终端里运行 npm start 启动本机服务（线上版也靠它连 Claude）"],
};
async function refreshAI(force = false) {
  const el = $("#aiStatus");
  if (force) { el.className = "ai-dot checking"; el.querySelector(".txt").textContent = "Claude 检查中…"; }
  let s;
  try { s = await fetch(`${ENV.aiBase}/api/ai-status${force ? "?force" : ""}`).then((r) => r.json()); }
  catch { s = { state: "offline" }; }
  const [cls, txt, tip] = AI_LABEL[s.state] || AI_LABEL.error;
  el.className = `ai-dot ${cls}`;
  el.querySelector(".txt").textContent = s.state === "ok" && s.plan ? `${txt} · ${s.plan}` : txt;
  el.title = `${tip}${s.detail ? `（${s.detail}）` : ""}\n点击重新检查`;
}
function initAIStatus() {
  const el = $("#aiStatus");
  if (!ENV.ai) {
    el.className = "ai-dot off"; el.querySelector(".txt").textContent = "AI 仅电脑可用";
    el.title = "这台设备不连接 Claude。听原文、讲义、闪卡、做题、复习都能用；问 AI 请在电脑上。";
    return;
  }
  el.addEventListener("click", () => refreshAI(true));
  refreshAI();
  setInterval(refreshAI, 60_000);
}

// ---------------- 今日复习 ----------------
function viewReview() {
  const due = dueList();
  const upcoming = POINTS.filter((pt) => { const r = S.points[pt.id]?.review; return r && r.due > today(); })
    .sort((a, b) => S.points[a.id].review.due.localeCompare(S.points[b.id].review.due)).slice(0, 12);
  $("#app").innerHTML = `<h1>今日复习</h1>
  <p class="muted small" style="margin-top:0">标记「已掌握」的ポイント会在 1、3、7、14、30、60 天后再次出现。复习时让 AI 提问，然后根据自己答得怎么样打分。</p>
  <div class="card">${due.length ? `
    <div class="row" style="margin-bottom:10px"><b>今天要复习 ${due.length} 个</b><span class="spacer"></span><a class="btn primary" href="#/p/${due[0].id}/review">开始复习 →</a></div>
    <div class="plist">${due.map((pt) => `<a class="pitem" href="#/p/${pt.id}/review"><i class="st ${statusOf(pt.id)}"></i><span class="t">${esc(pt.courseTitle)} › ${esc(pt.title)}</span></a>`).join("")}</div>`
    : `<div class="empty">今天没有要复习的。🎉</div>`}</div>
  ${upcoming.length ? `<div class="card"><h2>接下来</h2>${upcoming.map((pt) => `<div class="row small" style="padding:3px 0"><span class="muted" style="width:96px">${S.points[pt.id].review.due}</span><a href="#/p/${pt.id}">${esc(pt.courseTitle)} › ${esc(pt.title)}</a></div>`).join("")}</div>` : ""}`;
}

// ---------------- 卡点本 ----------------
function viewStuck() {
  const list = S.stuck;
  $("#app").innerHTML = `<h1>卡点本</h1>
  <p class="muted small" style="margin-top:0">暂时想不通的地方记在这里。点「去问 AI」会回到那一节，并把问题填进输入框。</p>
  <div class="card">
    <div class="row" style="margin-bottom:10px">
      <select id="newPt" class="btn" style="max-width:260px">${POINTS.map((pt) => `<option value="${pt.id}">${esc(pt.courseTitle)} › ${esc(pt.title)}</option>`).join("")}</select>
      <input id="newTxt" class="btn" style="flex:1;min-width:200px" placeholder="哪里没懂？">
      <button class="btn primary" id="addStuck">添加</button>
    </div>
    ${list.length ? list.map((s) => { const pt = POINT_BY_ID[s.pointId]; return `
      <div class="stuck-item ${s.done ? "done" : ""}">
        <input type="checkbox" data-done="${s.id}" ${s.done ? "checked" : ""} title="已解决">
        <div style="flex:1"><div class="txt">${esc(s.text)}</div><div class="small muted">${s.created} · <a href="#/p/${s.pointId}">${esc(pt?.courseTitle)} › ${esc(pt?.title)}</a></div></div>
        <button class="btn sm" data-ask="${s.id}">去问 AI</button><button class="btn sm" data-del="${s.id}">删除</button>
      </div>`; }).join("") : `<div class="empty">还没有卡点。</div>`}
  </div>`;
  const find = (id) => S.stuck.find((s) => s.id == id);
  $("#addStuck").onclick = () => { const t = $("#newTxt").value.trim(); if (!t) return; S.stuck.unshift({ id: Date.now(), pointId: $("#newPt").value, text: t, created: today(), done: false }); save(); viewStuck(); };
  document.querySelectorAll("[data-done]").forEach((c) => c.onchange = () => { find(c.dataset.done).done = c.checked; save(); viewStuck(); });
  document.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => { S.stuck = S.stuck.filter((s) => s.id != b.dataset.del); S.stuckDel.push(Number(b.dataset.del)); save(); viewStuck(); });
  document.querySelectorAll("[data-ask]").forEach((b) => b.onclick = () => { const s = find(b.dataset.ask); pendingAsk = `我在这里卡住了：${s.text}\n请帮我讲清楚。`; location.hash = `#/p/${s.pointId}`; });
}
let pendingAsk = null;

// ---------------- 路由 ----------------
function route() {
  const [, r, id, mode] = location.hash.split("/");
  renderNav();
  window.scrollTo(0, 0);
  if (!booted && r !== "sync") return viewSync();
  if (r === "toc") return viewToc();
  if (r === "review") return viewReview();
  if (r === "stuck") return viewStuck();
  if (r === "sync") return viewSync();
  if (r === "stats") return viewStats();
  if (r === "import") return viewImport(location.hash.slice("#/import/".length));
  if (r === "p") { const ask = pendingAsk; pendingAsk = null; return viewPoint(id, { review: mode === "review", ask }); }
  return viewHome();
}
window.addEventListener("hashchange", route);

// ---------------- 同步设置 ----------------
function syncTip() {
  if (!ghCfg()) return "还没有填写令牌，学习记录只保存在这台设备";
  if (sync.state === "syncing") return "同步中…";
  if (sync.state === "error") return `同步失败：${sync.error}`;
  if (sync.state === "ok") return `已同步 ${new Date(sync.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  return "";
}
function viewSync() {
  const c = ghCfg();
  const pts = Object.values(S.points);
  const learned = pts.filter((p) => p.status && p.status !== "new").length;
  const mastered = pts.filter((p) => p.status === "mastered").length;
  const cards = pts.reduce((n, p) => n + Object.values(p.cardStat || {}).filter((x) => x.known).length, 0);
  const chats = pts.reduce((n, p) => n + (p.chat?.length || 0), 0);
  $("#app").innerHTML = `<h1>☁️ 同步</h1>
  <div class="card kv">
    <div><span>当前设备</span><b>${ENV.local ? "💻 电脑 · 本地版（AI 可用）" : ENV.ai ? "💻 电脑 · 线上版（AI 借本机服务）" : "📱 其他设备（无 AI）"}</b></div>
    <div><span>同步</span><b>${esc(syncTip())}</b>${c ? `<button class="btn sm" id="syncNow">立即同步</button>` : ""}</div>
    <div><span>学习记录</span><b>${booted ? `学过 ${learned} 节 · 掌握 ${mastered} 节 · 闪卡记住 ${cards} 张 · 对话 ${chats} 条 · 学习 ${Object.keys(S.days).length} 天` : "—"}</b></div>
  </div>
  <div class="card">
    <div class="row">
      <input id="ghToken" class="btn" type="password" autocomplete="off" style="flex:1;min-width:220px" placeholder="${c ? "令牌已保存，要换就重新填" : "填写令牌"}">
      <button class="btn primary" id="ghSave">${c ? "更换" : "连接"}</button>
      ${c ? `<button class="btn" id="ghOut">删除令牌</button>` : ""}
    </div>
    <div class="small" id="ghMsg" style="margin-top:6px"></div>
  </div>
  <div class="card">
    <div class="row"><h2 style="margin:0">📌 定位书签</h2><span class="spacer"></span>
      <span class="small ${bmInstalled() ? "" : "muted"}">${bmInstalled() ? "✅ 这台设备已装好" : "这台设备还没装"}</span></div>
    ${isTouch() ? `<p class="small muted" style="margin:8px 0 0">手机 / 平板上拖不了书签，这一项请在电脑上装。</p>` : bmSetupHtml()}
    ${isTouch() ? "" : `<div class="row"><span class="spacer"></span>${bmInstalled()
      ? `<button class="btn sm" id="bmReset">书签丢了，重新装</button>`
      : `<button class="btn sm primary" id="bmMark">已经装好了</button>`}</div>`}
  </div>
  ${booted ? `<div class="card"><div class="row"><div style="flex:1"><b>清除学习记录</b><div class="small muted">从头开始学：进度、笔记、对话、闪卡记忆、复习计划、卡点全部清空${c ? "，所有设备一起清空" : ""}。讲义和闪卡内容不受影响。</div></div>
    <button class="btn danger" id="resetAll">清除</button></div></div>` : ""}
  ${ENV.local ? "" : `<p class="small muted"><a href="javascript:void 0" id="clearCache">清除本机内容缓存</a>（内容更新后用）</p>`}`;
  $("#ghSave").onclick = async () => {
    const token = $("#ghToken").value.trim();
    if (!token) return ($("#ghMsg").textContent = "请先填写令牌");
    const old = c;
    setGhCfg({ repo: c?.repo || DEFAULT_REPO, token });
    $("#ghMsg").textContent = "连接中…";
    try {
      await testToken();
      $("#ghMsg").textContent = "✅ 已连接，正在同步…";
      await doSync();
      if (!ENV.local && !booted) return boot2();
      viewSync();
    } catch (e) { setGhCfg(old); $("#ghMsg").textContent = `❌ ${e.message}`; }
  };
  if ($("#ghOut")) $("#ghOut").onclick = () => { if (confirm("从这台设备删除令牌？（仓库里的记录不受影响）")) { setGhCfg(null); viewSync(); renderNav(); } };
  if ($("#bmMark")) $("#bmMark").onclick = () => { setBmInstalled(true); viewSync(); };
  if ($("#bmReset")) $("#bmReset").onclick = () => { setBmInstalled(false); viewSync(); };
  if ($("#syncNow")) $("#syncNow").onclick = async () => { await doSync(); viewSync(); };
  if ($("#clearCache")) $("#clearCache").onclick = async () => { await clearContentCache(); alert("已清除"); };
  if ($("#resetAll")) $("#resetAll").onclick = async () => {
    if (!confirm("确定清除全部学习记录，从头开始？")) return;
    if (prompt("这一步不能撤销。请输入「清除」确认：") !== "清除") return;
    S = { points: {}, stuck: [], days: {}, stuckDel: [], bmOk: S.bmOk, bm2: S.bm2, dojoLog: [], resetAt: Date.now() };
    stampBaseline(S);
    writeLocalState(S);
    if (ghCfg()) await doSync();
    location.hash = "#/";
  };
}

// ---------------- 一問一答成绩（从书签导入） ----------------
// S.dojoLog = [[题号, 结果(1 对 / 2 错 / 0 跳过), 分野号, 时间(秒)], …]
const dojoLog = () => (S.dojoLog ||= []);
function dojoStats(filter = () => true) {
  let ok = 0, ng = 0;
  for (const [, r, c, t] of dojoLog()) if (filter(c, t)) { if (r === 1) ok++; else if (r === 2) ng++; }
  return { ok, ng, n: ok + ng };
}
function dojoSummary(pt) {
  if (!pt.dojo) return "";
  const s = dojoStats((c) => c === pt.dojo.n);
  return s.n ? `<span class="small muted" title="这个分野在一問一答里的成绩（来自书签导入）">一問一答 本分野 <b>${s.ok}/${s.n}</b> · ${Math.round((s.ok / s.n) * 100)}%</span>` : "";
}
function viewImport(raw) {
  setBmInstalled(true);
  const since = Math.floor((S.resetAt || 0) / 1000);
  const have = new Set(dojoLog().map((x) => `${x[0]}@${x[3]}`));
  const rows = decodeURIComponent(raw || "").split(";").map((x) => x.split(","))
    .filter((x) => x.length === 4 && /^\d+$/.test(x[2]) && /^\d+$/.test(x[3]))
    .map(([sid, r, c, t]) => [sid, Number(r), Number(c), Number(t)])
    .filter((x) => x[3] > since);
  const fresh = rows.filter((x) => !have.has(`${x[0]}@${x[3]}`));
  fresh.forEach((x) => { dojoLog().push(x); const d = new Date(x[3] * 1000).toLocaleDateString("sv-SE"); S.days[d] = (S.days[d] || 0) + 1; });
  dojoLog().sort((a, b) => a[3] - b[3]);
  if (fresh.length) save();
  history.replaceState(null, "", location.pathname + "#/import");
  const ok = fresh.filter((x) => x[1] === 1).length, ng = fresh.filter((x) => x[1] === 2).length, pass = fresh.length - ok - ng;
  const byCat = {};
  fresh.forEach(([, r, c]) => { const b = (byCat[c] ||= { ok: 0, ng: 0 }); if (r === 1) b.ok++; else if (r === 2) b.ng++; });
  $("#app").innerHTML = `<h1>📥 一問一答成绩</h1>
  <div class="card">${fresh.length ? `
    <p style="margin-top:0">新记下 <b>${fresh.length}</b> 题：✅ 对 <b>${ok}</b>　❌ 错 <b>${ng}</b>${pass ? `　跳过 ${pass}` : ""}${ok + ng ? `　正确率 <b>${Math.round((ok / (ok + ng)) * 100)}%</b>` : ""}</p>
    ${Object.entries(byCat).map(([c, b]) => `<div class="hrow"><span class="hl">${c}. ${esc(DOJO_FIELDS[c] || "")}</span>
      <div class="hbar single">${b.ok + b.ng ? `<span style="display:flex;gap:2px;width:100%">${b.ok ? `<i class="ok" style="flex:${b.ok}"></i>` : ""}${b.ng ? `<i class="ng" style="flex:${b.ng}"></i>` : ""}</span>` : ""}</div>
      <span class="hv">${b.ok}/${b.ok + b.ng}</span></div>`).join("")}`
    : `<p style="margin:0">没有新的答题记录（${rows.length ? `这 ${rows.length} 条之前已经记过了` : "没有権利関係的一問一答记录"}）。</p>`}
  </div>
  <p class="small muted">累计一問一答 ${dojoStats().n} 题 · 对 ${dojoStats().ok} 题。去 <a href="#/stats">📊 统计</a> 看全部。这个页面可以直接关掉。</p>`;
}

// ---------------- 统计 ----------------
function viewStats() {
  const pts = (pt) => S.points[pt.id] || {};
  const all = POINTS.map((pt) => ({ pt, p: pts(pt) }));
  const mastered = all.filter((x) => x.p.status === "mastered").length;
  const learning = all.filter((x) => x.p.status === "learning").length;
  const sum = (f) => all.reduce((n, x) => n + f(x.p), 0);
  const known = sum((p) => Object.values(p.cardStat || {}).filter((c) => c.known).length);
  const tries = sum((p) => Object.values(p.cardStat || {}).reduce((n, c) => n + (c.ok || 0) + (c.ng || 0), 0));
  const ds = dojoStats();
  const qOk = sum((p) => p.quiz?.ok || 0) + ds.ok, qNg = sum((p) => p.quiz?.ng || 0) + ds.ng;
  // 真题按宅建試験ドットコム的分野统计：一問一答（书签导入）+ 过去问（手动记）
  const fields = Object.entries(DOJO_FIELDS).map(([n, name]) => {
    n = Number(n);
    const d = dojoStats((c) => c === n);
    const man = all.filter((x) => x.pt.dojo?.n === n).reduce((a, x) => ({ ok: a.ok + (x.p.quiz?.ok || 0), ng: a.ng + (x.p.quiz?.ng || 0) }), { ok: 0, ng: 0 });
    return { n, name, ok: d.ok + man.ok, ng: d.ng + man.ng };
  });
  const fMax = Math.max(1, ...fields.map((x) => x.ok + x.ng));
  const asks = sum((p) => (p.chat || []).filter((m) => m.role === "user").length);
  const stuckOpen = S.stuck.filter((x) => !x.done).length, stuckDone = S.stuck.length - stuckOpen;
  const dayKeys = Object.keys(S.days).sort();
  const first = dayKeys[0];

  // 最近 30 天每天的学习动作数
  const days = Array.from({ length: 30 }, (_, i) => { const d = addDays(i - 29); return { d, n: S.days[d] || 0 }; });
  const dMax = Math.max(1, ...days.map((x) => x.n));
  // 连续学习天数
  let streak = 0; for (let i = S.days[today()] ? 0 : 1; S.days[addDays(-i)]; i++) streak++; // 今天还没学也不算断
  // 未来 14 天复习安排
  const due = Array.from({ length: 14 }, (_, i) => { const d = addDays(i); return { d, n: all.filter((x) => x.p.review && (i === 0 ? x.p.review.due <= d : x.p.review.due === d)).length }; });
  const dueMax = Math.max(1, ...due.map((x) => x.n));
  const courses = BOOKS[0].courses.map((c) => {
    const xs = all.filter((x) => x.pt.course === c.n);
    return { c, total: xs.length,
      m: xs.filter((x) => x.p.status === "mastered").length, l: xs.filter((x) => x.p.status === "learning").length,
      known: xs.reduce((n, x) => n + Object.values(x.p.cardStat || {}).filter((k) => k.known).length, 0),
      ok: xs.reduce((n, x) => n + (x.p.quiz?.ok || 0), 0), ng: xs.reduce((n, x) => n + (x.p.quiz?.ng || 0), 0) };
  });
  const kMax = Math.max(1, ...courses.map((x) => x.known));
  const qMax = Math.max(1, ...courses.map((x) => x.ok + x.ng));
  const md2 = (d) => d.slice(5).replace("-", "/");
  const tile = (v, k, sub = "") => `<div class="stat"><div class="v">${v}${sub ? `<span class="muted small"> ${sub}</span>` : ""}</div><div class="k">${k}</div></div>`;
  const colChart = (data, max, label) => `<div class="cols">${data.map((x) =>
    `<div class="col" title="${x.d}：${label} ${x.n}"><div class="col-bar" style="height:${(x.n / max) * 100}%"></div>${x.n ? `<span class="col-v">${x.n}</span>` : ""}</div>`).join("")}</div>
    <div class="cols-x"><span>${md2(data[0].d)}</span><span>${md2(data[Math.floor(data.length / 2)].d)}</span><span>${md2(data.at(-1).d)}</span></div>`;

  $("#app").innerHTML = `<h1>📊 统计</h1>
  <p class="muted small" style="margin-top:0">${first ? `从 ${first} 开始，已经学了 ${dayKeys.length} 天${streak ? `，连续 ${streak} 天` : ""}。` : "还没有学习记录。"}</p>
  <div class="stats">
    ${tile(mastered, "已掌握的ポイント", `/ ${POINTS.length}`)}
    ${tile(learning, "学习中")}
    ${tile(known, "闪卡已记住", `张 · 练 ${tries} 次`)}
    ${tile(qOk + qNg ? Math.round((qOk / (qOk + qNg)) * 100) + "%" : "—", "真题正确率", qOk + qNg ? `${qOk}/${qOk + qNg} 题` : "")}
    ${tile(asks, "问 AI 的次数")}
    ${tile(stuckOpen, "没解决的卡点", stuckDone ? `· 已解决 ${stuckDone}` : "")}
  </div>
  <div class="card"><h2>最近 30 天学习量</h2><p class="small muted" style="margin-top:-6px">每天的学习动作数（打开新的一节、打分、做卡、问 AI、记录真题……）</p>${colChart(days, dMax, "学习动作")}</div>
  <div class="card"><h2>各コース进度</h2>
    <div class="legend" style="margin:-4px 0 10px"><span><i class="dot" style="background:var(--good)"></i>已掌握</span><span><i class="dot" style="background:var(--warn)"></i>学习中</span><span><i class="dot" style="background:var(--line)"></i>未学</span></div>
    ${courses.map((x) => `<div class="hrow" title="${esc(x.c.title)}：已掌握 ${x.m}，学习中 ${x.l}，未学 ${x.total - x.m - x.l}">
      <span class="hl">${x.c.n}. ${esc(x.c.title)}</span>
      <div class="hbar">${x.m ? `<i class="seg-m" style="flex:${x.m}"></i>` : ""}${x.l ? `<i class="seg-l" style="flex:${x.l}"></i>` : ""}${x.total - x.m - x.l ? `<i class="seg-n" style="flex:${x.total - x.m - x.l}"></i>` : ""}</div>
      <span class="hv">${x.m}/${x.total}</span></div>`).join("")}
  </div>
  <div class="grid-2">
    <div class="card"><h2>闪卡记住张数</h2>
      ${courses.map((x) => `<div class="hrow" title="${esc(x.c.title)}：记住 ${x.known} 张"><span class="hl">${x.c.n}. ${esc(x.c.title)}</span>
        <div class="hbar single">${x.known ? `<i style="width:${(x.known / kMax) * 100}%"></i>` : ""}</div><span class="hv">${x.known}</span></div>`).join("")}
    </div>
    <div class="card"><h2>真题对错（按分野）</h2>
      <div class="legend" style="margin:-4px 0 10px"><span><i class="dot" style="background:var(--good)"></i>✅ 对</span><span><i class="dot" style="background:var(--bad)"></i>❌ 错</span><span class="small">一問一答自动导入 + 过去问手动记</span></div>
      ${fields.map((x) => `<div class="hrow" title="${esc(x.name)}：对 ${x.ok}，错 ${x.ng}${x.ok + x.ng ? `，正确率 ${Math.round((x.ok / (x.ok + x.ng)) * 100)}%` : ""}"><span class="hl">${x.n}. ${esc(x.name)}</span>
        <div class="hbar single">${x.ok + x.ng ? `<span style="display:flex;gap:2px;width:${((x.ok + x.ng) / fMax) * 100}%">${x.ok ? `<i class="ok" style="flex:${x.ok}"></i>` : ""}${x.ng ? `<i class="ng" style="flex:${x.ng}"></i>` : ""}</span>` : ""}</div>
        <span class="hv">${x.ok + x.ng ? `${x.ok}/${x.ok + x.ng}` : "—"}</span></div>`).join("")}
    </div>
  </div>
  <div class="card"><h2>接下来 14 天要复习</h2><p class="small muted" style="margin-top:-6px">第一根包括今天和已经过期的。</p>${colChart(due, dueMax, "要复习")}</div>`;
}

// ---------------- 主题 ----------------
function applyTheme() {
  const t = document.documentElement.dataset.theme
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  $("#themeBtn").textContent = t === "dark" ? "☀️" : "🌙";
  $("#themeBtn").title = t === "dark" ? "切换到浅色" : "切换到深色";
  return t;
}
$("#themeBtn").onclick = () => {
  const next = applyTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("takken.theme", next); } catch {}
  applyTheme();
};
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
applyTheme();

// ---------------- 启动 ----------------
let booted = false;
sync.onChange = () => { renderNav(); if (location.hash === "#/sync" && sync.state !== "syncing") viewSync(); };
async function boot2() {
  booted = true;
  S = await loadLocalState();
  stampBaseline(S);
  if (ghCfg()) await doSync();
  route();
  if (!location.hash.startsWith("#/import")) maybeAskBookmark();
}
(async () => {
  await detectEnv();
  document.body.classList.toggle("no-ai", !ENV.ai);
  initAIStatus();
  // 外部设备：没有令牌就只能先去填令牌
  if (!ENV.local && !ghCfg()) { renderNav(); location.hash = "#/sync"; viewSync(); return; }
  await boot2();
  // 线上版在电脑上：本机服务开着就切到「有 AI」；Chrome 还没给「本地网络访问」权限时提示一下
  if (!ENV.local && !isTouch()) localNetPermission().then((st) => {
    if (ENV.ai || (st !== "prompt" && st !== "denied")) return;
    const el = $("#aiStatus");
    el.className = "ai-dot warn";
    el.querySelector(".txt").textContent = st === "denied" ? "Chrome 拦住了本机 Claude" : "等你允许连接本机 Claude";
    el.title = st === "denied"
      ? "Chrome 拒绝了这个网站访问本机服务。点地址栏左边的图标 → 网站设置，把「此设备上的应用」（访问本机的应用和服务，不是「本地网络」）改成允许，然后刷新。"
      : "Chrome 会弹出「访问此设备上的其他应用和服务」，点允许就能用电脑上的 Claude。没看到弹窗：点地址栏左边的图标 → 本地网络访问 → 允许，然后刷新。";
  });
  if (!ENV.local) probeLocalAI().then((ok) => {
    if (!ok) return;
    document.body.classList.remove("no-ai");
    initAIStatus();
    if (!(cur?.streaming)) route();
  });
  setInterval(() => { if (ghCfg() && document.visibilityState === "visible") doSync(); }, 120_000);
  document.addEventListener("visibilitychange", () => { if (ghCfg()) doSync(); });
})();
