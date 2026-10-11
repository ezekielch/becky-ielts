// 贝琪酱雅思英语无痛逆袭站 · 前端主程序（无框架、无外部依赖、纯静态）
// 所有数据来自本地 assets/data，音频走有道 dictvoice（英音 type=1 / 美音 type=2），
// 断网时自动降级到浏览器 speechSynthesis。

/* ============================== 配置 ============================== */
// 单词打卡是独立板块（与听说读写四科并列，四科后续单独建设）
const LANES = {
  words: {
    name: '背单词', icon: '🔤', cls: 'l-reading',
    desc: '60 天走完 10,000 个雅思核心词条：英音／美音、口语例句、名著原文、KJV + WEB 双译本经文、搭配与派生词，遗忘曲线自动排复习。',
    order: ['b', 'q', 'o'], audioFirst: false, dictate: false, hideWord: false,
  },
};
// 雅思四科（后续建设，当前为占位说明）
const SUBJECTS = {
  listening: { name: '听力', icon: '🎧', cls: 'l-listening',
    plan: '真题精听 · 场景词汇听辨 · 听写填空 · 英音美音辨析' },
  reading: { name: '阅读', icon: '📖', cls: 'l-reading',
    plan: '题型技巧 · 同义替换库 · 长难句拆解 · 计时模考' },
  writing: { name: '写作', icon: '✍️', cls: 'l-writing',
    plan: '大作文题库 · 句型模板 · 同义升级 · 批改反馈' },
  speaking: { name: '口语', icon: '💬', cls: 'l-speaking',
    plan: 'Part1/2/3 题库 · 话题词汇 · 跟读评分 · 模考录音' },
};
const AUDIO = (w, type) => `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(w)}&type=${type}`;
const KEY = (lane) => `bq8.${lane}`;
const DAY_MS = 86400000;

/* ============================== 状态 ============================== */
let META = null;
const cache = new Map();

const loadJSON = async (p) => {
  if (cache.has(p)) return cache.get(p);
  const r = await fetch(p, { cache: 'force-cache' });
  const j = await r.json();
  cache.set(p, j);
  return j;
};

const todayStr = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD

function loadStore(lane) {
  try { return JSON.parse(localStorage.getItem(KEY(lane)) || '{}'); }
  catch (e) { return {}; }
}
function saveStore(lane, s) {
  try { localStorage.setItem(KEY(lane), JSON.stringify(s)); } catch (e) {}
  // 登录状态下把这份进度推到云端（内部做了 1.2s 防抖）
  try { if (window.BQCloud) window.BQCloud.push(lane, s); } catch (e) {}
}
function blankStore() {
  return { rec: {}, log: {}, streak: 0, lastDay: '', mode: 'curve', wrongPool: [] };
}
const storeFor = (lane) => {
  let s = loadStore(lane);
  if (!s || typeof s !== 'object' || !s.rec) s = Object.assign(blankStore(), s);
  s.rec = s.rec || {}; s.log = s.log || {}; s.wrongPool = s.wrongPool || [];
  return s;
};

/* ============================== 记忆曲线 (SM-2 精简) ============================== */
const INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60];   // 天

function grade(rec, g) {
  const now = Date.now();
  if (g === 0) {                       // 不认识：本轮重排，压缩间隔
    rec.wrong = (rec.wrong || 0) + 1;
    rec.i = 0;
    rec.due = now + 8 * 60000;         // 8 分钟后回到本轮队尾
    rec.stage = -1;
  } else if (g === 1) {                // 模糊
    rec.stage = Math.max(0, (rec.stage || 0));
    rec.due = now + Math.max(DAY_MS * INTERVALS[Math.max(1, rec.stage)], 6 * 3600000);
  } else {                             // 记得
    rec.stage = (rec.stage === -1 ? 0 : (rec.stage || 0));
    rec.stage = Math.min((rec.stage || 0) + 1, INTERVALS.length - 1);
    rec.due = now + DAY_MS * INTERVALS[rec.stage];
  }
  rec.n = (rec.n || 0) + 1;
  rec.last = now;
  return rec;
}

/* ============================== 工具 ============================== */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function highlight(sentence, word) {
  if (!sentence) return '';
  const w = esc(word);
  const forms = [w, w + 's', w + 'es', w + 'ed', w + 'ing'];
  if (w.endsWith('y')) { const b = w.slice(0, -1); forms.push(b + 'ies', b + 'ied', b + 'ying'); }
  if (w.endsWith('e')) forms.push(w.slice(0, -1) + 'ing', w.slice(0, -1) + 'ed');
  let out = esc(sentence);
  for (const f of forms.sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(out)) { out = out.replace(re, `<mark>$&</mark>`); break; }
  }
  return out;
}

/* ---- 发音：有道（网络可用） -> 浏览器 TTS（降级） ---- */
let audioEl = null;
function speak(word, type) {
  const lang = type === 1 ? 'en-GB' : 'en-US';
  const url = AUDIO(word, type);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try {
      if (!audioEl) audioEl = new Audio();
      audioEl.src = url;
      audioEl.onerror = () => { tts(word, lang); finish(); };
      audioEl.onended = finish;
      const p = audioEl.play();
      if (p && p.catch) p.catch(() => { tts(word, lang); finish(); });
      setTimeout(finish, 6000);
    } catch (e) { tts(word, lang); finish(); }
  });
}
function speakSentence(text, lang) { tts(text, lang); }
function tts(text, lang = 'en-GB') {
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/<[^>]+>/g, ''));
    u.lang = lang; u.rate = 0.95;
    const vs = speechSynthesis.getVoices();
    const v = vs.find(x => x.lang === lang) || vs.find(x => (x.lang || '').startsWith('en'));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) {}
}

/* ============================== 日月 progressing ============================== */
function plannedDay(lane) {
  const s = storeFor(lane);
  if (s.mode === 'flat') {
    const total = META.days.filter(d => !d.sprint).reduce((a, d) => a + d.n, 0);
    return Math.min(META.totalDays, Math.floor(total / META.totalDays) && (s.totalDone || 0) / Math.max(1, total / META.totalDays) + 1);
  }
  return Math.min(META.totalDays, Object.keys(s.log).length + 1);
}
function todayQuota(lane, day) {
  const dm = META.days.find(d => d.d === day);
  return dm ? dm.n : 0;
}

/* ============================== 队列构建 ============================== */
async function buildQueue(lane, day) {
  const s = storeFor(lane);
  const pack = await loadJSON(`./assets/data/day-${String(day).padStart(2, '0')}.json`);
  const now = Date.now();
  const due = [], fresh = [];
  for (const w of pack.words) {
    const key = `${day}:${w.w}`;
    const rec = s.rec[key];
    if (!rec) fresh.push({ w, day, kind: 'new', key });
    else if (rec.due && rec.due <= now) due.push({ w, day, kind: 'rev', key });
  }
  due.sort((a, b) => (s.rec[a.key].due || 0) - (s.rec[b.key].due || 0));
  let q = due.slice(0, 150).concat(fresh);
  // 错词本回流：把到期的历史错词插到后续任何一天（每轮最多 25 个，且与本日词去重）
  const keys = new Set(q.map(it => it.key));
  const inject = (s.wrongPool || []).filter(it => !keys.has(it.key) && s.rec[it.key] && s.rec[it.key].due <= now);
  q = q.concat(inject.slice(0, 25));
  return q;
}

/* ============================== 视图：首页 ============================== */
async function viewHome() {
  if (!META) META = await loadJSON('./assets/data/meta.json');
  const totalNew = META.days.filter(d => !d.sprint).reduce((a, d) => a + d.n, 0);
  const s0 = storeFor('words');
  const done0 = Object.values(s0.rec).filter(r => r.n > 0).length;
  const wrongN = (s0.wrongPool || []).length;
  const pct0 = Math.min(100, (done0 / Math.max(1, totalNew)) * 100);
  const lanesHtml =
    `<a class="lane ${LANES.words.cls}" href="#/lane/words">
      <div class="ic">${LANES.words.icon}</div>
      <b>背单词 · 60 天万词</b>
      <p>${LANES.words.desc}</p>
      <p style="margin-top:8px"><span class="tag">已学 ${done0} 词</span>
        <span class="tag">连续 ${s0.streak || 0} 天</span>
        ${wrongN ? `<span class="tag">错词 ${wrongN}</span>` : ''}</p>
      <div class="bar"><i style="width:${pct0}%"></i></div>
    </a>` +
    Object.entries(SUBJECTS).map(([k, S]) =>
      `<a class="lane ${S.cls}" href="#/sub/${k}">
        <div class="ic">${S.icon}</div>
        <b>${S.name}</b>
        <p>${S.plan}</p>
        <p style="margin-top:8px"><span class="tag">建设中</span></p>
      </a>`).join('') +
    `<a class="lane l-writing" href="#/wrong">
      <div class="ic">🗂️</div>
      <b>错词本</b>
      <p>打卡中答错的词自动进这里，按遗忘曲线回插到后续天数。</p>
      <p style="margin-top:8px"><span class="tag">${wrongN} 词待清</span></p>
    </a>`;
  return `    <div class="hero">
      <h1>贝琪酱雅思英语无痛逆袭站</h1>
      <p class="slogan">雅思8分孵化器 <span class="en">IELTS Band 8 Incubator</span></p>
      <p>雅思听说读写四条词汇航道。<b>第一天只有 10 个词</b>，按遗忘曲线自动加量，
      每天半小时，60 天走完 ${totalNew} 个雅思核心词条。</p>
      <p style="margin-top:10px">每个词都配：<b>英音 / 美音</b>、<b>口语化例句</b>、<b>名著原文例句</b>、
      <b>圣经原文例句</b>（真实书卷章节号）、高频<b>搭配</b>与<b>派生词</b>，每日还有<b>篇章拓展阅读</b>。</p>
    </div>
    <div class="lanes">${lanesHtml}</div>
    <div class="card pad" style="margin-top:18px">
      <h2>每日新词曲线</h2>
      <div class="muted">按你定的节奏：Day1 = 10 词，递增至 Day24 峰值 167 词，之后递减；复习由遗忘曲线自动插入，不占新词额度。</div>
      <div class="heat">${META.days.filter(d => !d.sprint).map(d => {
        const lv = d.n > 140 ? 'l4' : d.n > 100 ? 'l3' : d.n > 50 ? 'l2' : 'l1';
        return `<i class="${lv}" title="Day ${d.d}：${d.n} 词"></i>`;
      }).join('')}</div>
    </div>
    <div class="card pad" style="margin-top:14px">
      <h2>词库构成</h2>
      <div class="muted">${Object.entries(META.stat).map(([k, v]) => `${({ bible: '圣经原文例句', oral: '口语化例句', lit: '名著原文例句', deriv: '派生词', coll: '高频搭配' })[k] || k} ${v}`).join(' · ')}</div>
    </div>`;
}

/* ============================== 视图：航道 ============================== */
async function viewLane(lane) {
  const L = LANES[lane];
  if (!META) META = await loadJSON('./assets/data/meta.json');
  const s = storeFor(lane);
  const day = plannedDay(lane);
  const pack = await loadJSON(`./assets/data/day-${String(day).padStart(2, '0')}.json`);
  const done = pack.words.filter(w => (s.rec[`${day}:${w.w}`] || {}).n > 0).length;
  const pct = pack.words.length ? Math.round(done / pack.words.length * 100) : 0;

  return `<div class="spread">
      <div><h1>${L.icon} ${L.name} · 单词打卡</h1>
      <div class="muted">${L.desc}</div></div>
      <a class="btn" href="#/study/${lane}/${day}">开始 Day ${day}（${pack.words.length} 词）</a>
    </div>

    <div class="card pad" style="margin-top:16px">
      <div class="spread"><h2 style="margin:0">今日进度 · Day ${day}</h2>
        <span class="muted">${done} / ${pack.words.length} · ${pct}%</span></div>
      <div class="progress-wrap"><i style="width:${pct}%"></i></div>
      <div class="row" style="margin-top:6px">
        <span class="tag">连续打卡 ${s.streak || 0} 天</span>
        <span class="tag">已掌握 ${Object.values(s.rec).filter(r => r.n > 0).length} 词</span>
        ${ (s.wrongPool || []).length ? `<span class="tag">错词 ${(s.wrongPool || []).length}</span>` : '' }
        <span class="tag">模式：${s.mode === 'flat' ? '匀速（60 天全覆盖）' : '渐进曲线'}</span>
        <button class="chip2" id="toggleMode" style="margin-left:auto">切换模式</button>
      </div>
    </div>

    <div class="card pad" style="margin-top:14px">
      <div class="spread"><h2 style="margin:0">今日词表速览</h2>
        <button class="chip2" id="toggleList">展开/收起</button></div>
      <div id="wordlist" class="wordlist" style="margin-top:12px;display:none">
        ${pack.words.map(w => `<div class="wcard ${(s.rec[`${day}:${w.w}`] || {}).n > 0 ? 'done' : ''}">
          <b>${esc(w.w)}</b><span>${esc(w.m)}</span></div>`).join('')}
      </div>
    </div>

    <div class="card pad" style="margin-top:14px">
      <h2>篇章拓展阅读</h2>
      <div class="muted">${esc((pack.passage && pack.passage.author) || '')}${pack.passage && pack.passage.title ? ' · 《' + esc(pack.passage.title) + '》' : ''}</div>
      <div class="passage" style="margin-top:10px">${pack.passage ? packPassage(pack.passage.text, pack.words.map(w => w.w)) : '<span class="muted">暂无</span>'}</div>
      ${pack.passage ? `<div class="row" style="margin-top:12px"><button class="chip2" id="readPassage">🔊 朗读全文</button></div>` : ''}
    </div>`;
}

function packPassage(text, words) {
  let t = esc(text);
  const sorted = [...new Set(words)].sort((a, b) => b.length - a.length);
  for (const w of sorted) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*\\b`, 'i');
    if (re.test(t)) t = t.replace(re, `<mark>$&</mark>`);
  }
  return t;
}

/* ============================== 视图：学习 ============================== */
let session = null;

async function viewStudy(lane, dayStr) {
  const day = parseInt(dayStr, 10) || 1;
  const L = LANES[lane];
  const pack = await loadJSON(`./assets/data/day-${String(day).padStart(2, '0')}.json`);
  const q = await buildQueue(lane, day);
  session = {
    lane, day, L, queue: q, idx: 0, revealed: false, start: Date.now(),
    total: q.length, remainSec: 30 * 60, timer: null, newDone: 0, revDone: 0,
    right: 0, wrong: 0, fuzzy: 0, mode: 'study',
  };
  return `<div class="study">
      <div class="spread">
        <div><span class="tag">${L.icon} ${L.name}</span> <span class="tag">Day ${day}</span>
          <span class="tally" id="tally">✓ <b id="tRight">0</b> ✗ <b id="tWrong">0</b> ～ <b id="tFuzzy">0</b></span></div>
        <div class="row">
          <span class="timer" id="timer">30:00</span>
          <button class="chip2" id="kbHelp">⌨ 说明</button>
          <button class="chip2" id="exitBtn">退出</button>
        </div>
      </div>
      <div class="progress-wrap"><i id="pbar" style="width:0%"></i></div>
      <div class="row spread"><span class="muted" id="ptext">准备开始</span><span class="muted" id="counter">0 / ${session.total}</span></div>
      <div class="kblegend" id="kblegend">
        <span><kbd>空格</kbd> 显示释义 / 记「记得」</span>
        <span><kbd>1</kbd> 不认识</span><span><kbd>2</kbd> 模糊</span><span><kbd>3</kbd> 记得</span>
        <span><kbd>↑</kbd> 英音 <kbd>↓</kbd> 美音</span><span><kbd>←</kbd><kbd>→</kbd> 上下词</span>
      </div>
      <div id="card" class="card pad" style="margin-top:14px"></div>
    </div>`;
}

function renderCard() {
  const el = document.getElementById('card');
  if (!el) return;
  const s = session;
  if (s.idx >= s.queue.length) return renderDone();
  const item = s.queue[s.idx];
  const w = item.w;
  const hidden = s.L.hideWord && !s.revealed;
  const bar = Math.round(s.idx / Math.max(1, s.total) * 100);
  document.getElementById('pbar').style.width = bar + '%';
  document.getElementById('counter').textContent = `${s.idx} / ${s.total}`;
  document.getElementById('ptext').innerHTML =
    `<span class="tag">${item.kind === 'new' ? '新词' : '复习'}</span> 剩余 ${s.total - s.idx} 张`;

  const ipa = `<div class="ipa">
      <div class="ipa-item"><span class="accent-name">英</span>
        <button class="speak" data-audio="${esc(w.w)}" data-type="1">🔊</button>
        <em>${esc(w.uk)}</em></div>
      <div class="ipa-item"><span class="accent-name">美</span>
        <button class="speak" data-audio="${esc(w.w)}" data-type="2">🔊</button>
        <em>${esc(w.us)}</em></div>
    </div>`;

  const mean = s.revealed
    ? `<div class="mean">${esc(w.p)} ${esc(w.m)}</div>`
    : `<div class="mean" style="color:var(--ink-3);font-size:15px">点击「显示释义」或直接自评</div>`;

  const blocks = [];
  if (w.c && w.c.length) blocks.push(secColl('高频搭配', w.c.map(c => `<span class="chip2 col">${esc(c)}</span>`).join(''), 'coll'));
  if (w.f && w.f.length) blocks.push(secDeriv('派生词 / 词族', w.f));
  for (const kind of s.L.order) {
    if (kind === 'o' && w.o) blocks.push(exHtml('o', 'violet', '口语化例句', w.o.w, null, w.o.t, w.w));
    if (kind === 'q' && w.q) blocks.push(exHtml('q', 'mint', '名著原文例句', `《${w.q.w}》`, w.q.a, w.q.t, w.w));
    if (kind === 'b' && w.b) blocks.push(exHtml('b', 'sky', '圣经原文例句 · KJV 钦定本', w.b.c, null, w.b.t, w.w));
    if (kind === 'b' && w.b2) blocks.push(exHtml('b', 'sky', '圣经对照 · WEB 现代英文译本', w.b2.c, null, w.b2.t, w.w));
  }

  const dictate = s.L.dictate ? `
    <input class="dictate" id="dictate" placeholder="先听音，然后拼出这个单词…" autocomplete="off" autocapitalize="off" spellcheck="false">
    <div class="muted" id="dictateTip" style="margin-top:5px">提示：${esc(w.w.slice(0, 1))}… ${w.w.length} 个字母</div>` : '';

  el.innerHTML = `
    <div class="wordhead">
      <div class="word" style="${hidden ? 'filter:blur(7px)' : ''}">${esc(w.w)}</div>
      ${w.p ? `<div class="pos">${esc(w.p)}</div>` : ''}
    </div>
    ${s.L.hideWord && !s.revealed ? dictate : ipa}
    ${mean}
    ${s.revealed ? blocks.join('') : ''}
    ${!s.revealed
      ? `<div class="grade"><button class="g2" data-g="2">显示释义<small>空格</small></button></div>`
      : `<div class="grade">
          <button class="g0" data-g="0">不认识<small>1 · 立刻重排</small></button>
          <button class="g1" data-g="1">有点模糊<small>2 · 明天再见</small></button>
          <button class="g2" data-g="2">记得<small>3 · 进入曲线</small></button>
        </div>`}
    <div class="row" style="margin-top:12px">
      <button class="chip2" id="audioAgain">🔊 再听一遍</button>
      ${item.kind === 'new' ? '<span class="muted">新词</span>' : '<span class="muted">记忆曲线自动排入</span>'}
    </div>`;

  if (hidden) setTimeout(() => speak(w.w, 1), 350);
  bindCard(w, item);
}

function secColl(title, html) {
  return `<div class="sec"><div class="sec-t">${title}</div><div class="chips">${html}</div></div>`;
}
function secDeriv(title, arr) {
  return `<div class="sec"><div class="sec-t">${title}</div><div class="chips">${
    arr.map(f => `<span class="chip2 dev" data-audio="${esc(f)}" data-type="1" style="cursor:pointer">${esc(f)} 🔊</span>`).join('')
  }</div></div>`;
}
function exHtml(kind, _c, title, src, author, text, word) {
  const cleanText = (text || '').replace(/<[^>]+>/g, '');
  return `<div class="sec"><div class="sec-t">${title}</div>
    <div class="ex ${kind}">
      <div class="src"><b>${esc(src)}</b>${author ? ' · ' + esc(author) : ''}
        <span class="play-inline" data-say="${esc(cleanText)}">🔊 朗读</span></div>
      <div class="en">${highlight(text, word)}</div>
    </div></div>`;
}

function bindCard(w, item) {
  const el = document.getElementById('card');
  el.querySelectorAll('.speak, .chip2[data-audio]').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      speak(b.dataset.audio, parseInt(b.dataset.type || '1', 10));
    };
  });
  el.querySelectorAll('[data-say]').forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); speakSentence(b.dataset.say, 'en-GB'); };
  });
  const again = document.getElementById('audioAgain');
  if (again) again.onclick = () => speak(w.w, 1);

  const dict = document.getElementById('dictate');
  if (dict) {
    dict.focus();
    dict.addEventListener('input', () => {
      const v = dict.value.trim().toLowerCase();
      if (!v) { dict.className = 'dictate'; return; }
      const ok = v === w.w.toLowerCase();
      dict.className = 'dictate ' + (ok ? 'ok' : (w.w.toLowerCase().startsWith(v) ? '' : 'bad'));
    });
  }

  el.querySelectorAll('.grade button').forEach(b => {
    b.onclick = () => onGrade(parseInt(b.dataset.g, 10), w, item);
  });
}

function addToPool(st, item, w) {
  st.wrongPool = st.wrongPool || [];
  if (!st.wrongPool.some(p => p.key === item.key)) st.wrongPool.push({ key: item.key, day: item.day, w: w });
}
function removeFromPool(st, key) {
  if (!st.wrongPool) return;
  st.wrongPool = st.wrongPool.filter(p => p.key !== key);
}
function updateTally() {
  const r = document.getElementById('tRight'), x = document.getElementById('tWrong'), z = document.getElementById('tFuzzy');
  if (r) r.textContent = session.right; if (x) x.textContent = session.wrong; if (z) z.textContent = session.fuzzy;
}
function onGrade(g, w, item) {
  const s = session;
  if (!s.revealed) { s.revealed = true; if (s.L.audioFirst) speak(w.w, 1); renderCard(); return; }
  const st = storeFor(s.lane);
  const key = item.key || `${s.day}:${w.w}`;
  st.rec[key] = grade(st.rec[key] || { due: 0 }, g);

  // 错词本：不认识 / 模糊 进池，记得 出池
  if (g === 0 || g === 1) addToPool(st, item, w);
  else if (g === 2) removeFromPool(st, key);

  // 本轮对错计数
  if (g === 2) s.right++; else if (g === 0) s.wrong++; else s.fuzzy++;

  // 当天统计
  const t = todayStr();
  st.log = st.log || {};
  const cur = st.log[t] || { new: 0, rev: 0 };
  if (item.kind === 'new') { cur.new++; s.newDone++; } else { cur.rev++; s.revDone++; }
  st.log[t] = cur;
  if (st.lastDay !== t) {
    const y = new Date(Date.now() - DAY_MS).toLocaleDateString('sv');
    st.streak = (st.lastDay === y) ? (st.streak || 0) + 1 : 1;
    st.lastDay = t;
  }
  saveStore(s.lane, st);

  s.idx++; s.revealed = false;
  renderCard();
  updateTally();
}

function renderDone() {
  const s = session;
  const el = document.getElementById('card');
  const mins = Math.round((Date.now() - s.start) / 60000);
  const el2 = document.getElementById('pbar'); if (el2) el2.style.width = '100%';
  const c = document.getElementById('counter'); if (c) c.textContent = `${s.total} / ${s.total}`;
  const p = document.getElementById('ptext'); if (p) p.textContent = '本轮完成';
  const st = storeFor(s.lane);
  const poolN = (st.wrongPool || []).length;
  if (s.mode === 'wrong') {
    el.innerHTML = `<div class="done-box">
      <div class="big">🗂️</div>
      <h2>错词复习完成</h2>
      <div class="muted">本轮记对 ${s.right} · 记错 ${s.wrong} · 模糊 ${s.fuzzy}</div>
      <div class="muted" style="margin-top:8px">错词本还剩 ${poolN} 个词待清，会持续回插到每日打卡</div>
      <div class="row" style="justify-content:center;margin-top:16px">
        <a class="btn" href="#/wrong">回到错词本</a>
        <a class="btn ghost" href="#/home">回首页</a>
      </div></div>`;
    return;
  }
  el.innerHTML = `<div class="done-box">
      <div class="big">🎉</div>
      <h2>Day ${s.day} 打卡成功</h2>
      <div class="muted">用时约 ${mins} 分钟 · 新词 ${s.newDone} · 复习 ${s.revDone}</div>
      <div class="sumrow">
        <span class="sum ok">记对 ${s.right}</span>
        <span class="sum bad">记错 ${s.wrong}</span>
        <span class="sum mid">模糊 ${s.fuzzy}</span>
      </div>
      ${s.wrong ? `<div class="muted" style="margin-top:8px">有 ${s.wrong} 个词进错词本，后续天数会自动回炉复习 → <a href="#/wrong">去巩固</a></div>` : `<div class="muted" style="margin-top:8px">全部记住啦，继续保持 💪</div>`}
      <div class="row" style="justify-content:center;margin-top:16px">
        <a class="btn" href="#/lane/${s.lane}">回到 ${s.L.name} 频道</a>
        <a class="btn ghost" href="#/study/${s.lane}/${Math.min(60, s.day + 1)}">预习 Day ${s.day + 1}</a>
      </div>
      <div class="muted" style="margin-top:14px">连续打卡 ${st.streak} 天</div>
    </div>`;
}

/* ============================== 会话计时 ============================== */
function startTimer() {
  if (!session || session.timer) return;
  session.timer = setInterval(() => {
    session.remainSec--;
    const el = document.getElementById('timer');
    if (!el) { clearInterval(session.timer); session.timer = null; return; }
    const m = Math.max(0, Math.floor(session.remainSec / 60));
    const sec = session.remainSec % 60;
    el.textContent = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    el.classList.toggle('warn', session.remainSec < 300);
    if (session.remainSec <= 0) { clearInterval(session.timer); session.timer = null; }
  }, 1000);
}

/* ============================== 错词本 ============================== */
async function buildWrongQueue(lane) {
  const s = storeFor(lane);
  const pool = s.wrongPool || [];
  const now = Date.now();
  const due = pool.filter(it => { const r = s.rec[it.key]; return r && r.due && r.due <= now; });
  const src = due.length ? due : pool.slice();
  return src.map(it => ({ key: it.key, day: it.day, w: it.w, kind: 'rev' }));
}
async function viewWrong() {
  const s = storeFor('words');
  const pool = s.wrongPool || [];
  if (!pool.length) {
    return `<div class="card pad"><h2>🗂️ 错词本</h2>
      <p class="muted">还没有答错的词。打卡时选「不认识 / 模糊」的词会自动进这里，并在后续天数回炉复习。</p>
      <p style="margin-top:14px"><a class="btn" href="#/lane/words">去背单词</a></p></div>`;
  }
  const now = Date.now();
  const list = pool.map(it => `<div class="wcard ${(s.rec[it.key] && s.rec[it.key].due <= now) ? 'due' : ''}">
      <b>${esc(it.w.w)}</b><span>${esc(it.w.p)} ${esc(it.w.m)}</span>
      <button class="speak sm" data-audio="${esc(it.w.w)}" data-type="1">🔊</button></div>`).join('');
  return `<div class="card pad">
    <div class="spread"><h2 style="margin:0">🗂️ 错词本（${pool.length}）</h2>
      <a class="btn" href="#/wrongstudy">开始错词复习</a></div>
    <div class="muted" style="margin-top:6px">这些词在打卡时被判「不认识 / 模糊」，会按遗忘曲线回插到每日打卡；在这里可专项突击。</div>
    <div class="wordlist" style="margin-top:14px">${list}</div>
  </div>`;
}
function afterWrong() {
  document.querySelectorAll('#view .wcard .speak').forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); speak(b.dataset.audio, parseInt(b.dataset.type || '1', 10)); };
  });
}
async function viewWrongStudy() {
  const lane = 'words';
  const q = await buildWrongQueue(lane);
  session = {
    lane, day: plannedDay(lane), L: LANES[lane], queue: q, idx: 0, revealed: false, start: Date.now(),
    total: q.length, remainSec: 30 * 60, timer: null, newDone: 0, revDone: 0,
    right: 0, wrong: 0, fuzzy: 0, mode: 'wrong',
  };
  return `<div class="study">
    <div class="spread">
      <div><span class="tag">🗂️ 错词复习</span> <span class="tag">${q.length} 词</span>
        <span class="tally" id="tally">✓ <b id="tRight">0</b> ✗ <b id="tWrong">0</b> ～ <b id="tFuzzy">0</b></span></div>
      <div class="row"><span class="timer" id="timer">30:00</span>
        <button class="chip2" id="kbHelp">⌨ 说明</button>
        <button class="chip2" id="exitBtn">退出</button></div>
    </div>
    <div class="progress-wrap"><i id="pbar" style="width:0%"></i></div>
    <div class="row spread"><span class="muted" id="ptext">错词专项</span><span class="muted" id="counter">0 / ${q.length}</span></div>
    <div class="kblegend" id="kblegend">
      <span><kbd>空格</kbd> 显示释义 / 记「记得」</span><span><kbd>1</kbd> 不认识</span>
      <span><kbd>2</kbd> 模糊</span><span><kbd>3</kbd> 记得</span>
      <span><kbd>↑</kbd> 英音 <kbd>↓</kbd> 美音</span></div>
    <div id="card" class="card pad" style="margin-top:14px"></div>
  </div>`;
}
function viewSubject(k) {
  const S = SUBJECTS[k];
  return `<div class="card pad">
    <div class="spread"><h1 style="margin:0">${S.icon} ${S.name}</h1><span class="tag">建设中</span></div>
    <p class="muted" style="margin-top:10px">${S.plan}</p>
    <div class="muted" style="margin-top:14px">四大板块（听 / 读 / 写 / 口）将基于单词打卡的记忆引擎陆续上线，敬请期待。</div>
    <p style="margin-top:16px"><a class="btn" href="#/lane/words">先去背单词 →</a></p>
  </div>`;
}

/* ============================== 路由 ============================== */
function setNav(name) {
  document.querySelectorAll('#nav a').forEach(a => {
    a.classList.toggle('on', a.dataset.nav === name);
  });
}

async function route() {
  document.removeEventListener('keydown', keyHandler);
  const h = location.hash || '#/home';
  const m = h.match(/^#\/(\w+)(?:\/([\w-]+))?(?:\/(\d+))?/);
  const view = document.getElementById('view');
  const [, page, a, b] = m || [, 'home'];
  if (session && session.timer) { clearInterval(session.timer); session.timer = null; }
  session = null;
  try {
    if (page === 'home') { setNav('home'); view.innerHTML = await viewHome(); afterHome(); }
    else if (page === 'lane' && LANES[a]) { setNav(a); view.innerHTML = await viewLane(a); afterLane(a); }
    else if (page === 'study' && LANES[a]) { setNav(a); view.innerHTML = await viewStudy(a, b); renderCard(); startTimer(); afterStudy(); }
    else if (page === 'sub' && SUBJECTS[a]) { setNav(a); view.innerHTML = viewSubject(a); }
    else if (page === 'wrong') { setNav('words'); view.innerHTML = await viewWrong(); afterWrong(); }
    else if (page === 'wrongstudy') { setNav('words'); view.innerHTML = await viewWrongStudy(); renderCard(); startTimer(); afterStudy(); }
    else if (page === 'login') { setNav('login'); view.innerHTML = '';
      if (window.BQCloud) window.BQCloud.showLogin(); else location.hash = '#/home'; }
    else { location.hash = '#/home'; }
  } catch (e) {
    view.innerHTML = `<div class="card pad"><h2>加载失败</h2><div class="muted">${esc(e.message)}</div>
      <p><a class="btn" href="#/home">回首页</a></p></div>`;
  }
  window.scrollTo(0, 0);
}

function afterHome() {}
function afterLane(lane) {
  const tm = document.getElementById('toggleMode');
  if (tm) tm.onclick = () => {
    const s = storeFor(lane);
    s.mode = s.mode === 'flat' ? 'curve' : 'flat';
    saveStore(lane, s);
    route();
  };
  const tl = document.getElementById('toggleList');
  const wl = document.getElementById('wordlist');
  if (tl && wl) tl.onclick = () => { wl.style.display = wl.style.display === 'none' ? 'grid' : 'none'; };
  const rp = document.getElementById('readPassage');
  if (rp) rp.onclick = (e) => speakSentence(e.target.closest('.card').querySelector('.passage').textContent, 'en-GB');
  // 词表里点发音
  document.querySelectorAll('#wordlist .wcard').forEach(c => {
    c.style.cursor = 'pointer';
    c.onclick = () => speak(c.querySelector('b').textContent, 1);
  });
}
function afterStudy() {
  const ex = document.getElementById('exitBtn');
  if (ex) ex.onclick = () => { location.hash = session.mode === 'wrong' ? '#/wrong' : `#/lane/${session.lane}`; };
  const bh = document.getElementById('kbHelp'); if (bh) bh.onclick = toggleKbHelp;
  document.addEventListener('keydown', keyHandler);
}
function gradeKey(g, w, item) {
  if (!session.revealed) { session.revealed = true; renderCard(); return; }
  onGrade(g, w, item);
}
function scrub(d) {
  const ni = session.idx + d;
  if (ni < 0 || ni >= session.queue.length) return;
  session.idx = ni; session.revealed = true; renderCard();
}
function toggleKbHelp() {
  let ov = document.getElementById('kbHelpOverlay');
  if (ov) { ov.remove(); return; }
  ov = document.createElement('div');
  ov.id = 'kbHelpOverlay'; ov.className = 'kbhelp';
  ov.innerHTML = `<div class="kbhelp-box card">
    <div class="spread"><h2 style="margin:0">⌨ 按键操作说明</h2><button class="chip2" id="kbHelpClose">关闭</button></div>
    <ul class="kb-list">
      <li><kbd>空格</kbd> 未显示释义时 → 显示释义；已显示 → 记「记得」并过词</li>
      <li><kbd>1</kbd> 不认识（立刻重排，并进错词本）</li>
      <li><kbd>2</kbd> 有点模糊（明天再见）</li>
      <li><kbd>3</kbd> 记得（进入记忆曲线）</li>
      <li><kbd>↑</kbd> 播放英音　<kbd>↓</kbd> 播放美音</li>
      <li><kbd>←</kbd> 上一个词（回看）　<kbd>→</kbd> 下一个词（跳过）</li>
      <li><kbd>R</kbd> 再听一遍</li>
      <li><kbd>?</kbd> 打开 / 关闭本说明</li>
    </ul>
    <div class="muted">鼠标点击卡片上的按钮效果相同。错词会自动回插到后续每天的打卡里复习。</div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.id === 'kbHelpClose') ov.remove(); });
}
function keyHandler(e) {
  if (!session) return;
  const item = session.queue[session.idx];
  if (!item) return;
  const w = item.w;
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    if (!session.revealed) { session.revealed = true; renderCard(); }
    else onGrade(2, w, item);
    return;
  }
  if (e.key === '1' || e.code === 'Digit1') { e.preventDefault(); gradeKey(0, w, item); return; }
  if (e.key === '2' || e.code === 'Digit2') { e.preventDefault(); gradeKey(1, w, item); return; }
  if (e.key === '3' || e.code === 'Digit3') { e.preventDefault(); gradeKey(2, w, item); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); speak(w.w, 1); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); speak(w.w, 2); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); scrub(-1); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); scrub(1); return; }
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); speak(w.w, 1); return; }
  if (e.key === '?') { e.preventDefault(); toggleKbHelp(); return; }
}

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', () => { if (session && session.timer) clearInterval(session.timer); });
if ('speechSynthesis' in window) speechSynthesis.getVoices();
// 先跑云端引导（含微信登录回调处理与进度合并），再进入路由
if (window.BQCloud && window.BQCloud.boot) {
  window.BQCloud.boot().catch(function () {}).then(route);
} else {
  route();
}
