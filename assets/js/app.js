// 贝琪酱英语无痛逆袭站 · 前端主程序（无框架、无外部依赖、纯静态）
// 所有数据来自本地 assets/data，音频走有道 dictvoice（英音 type=1 / 美音 type=2），
// 断网时自动降级到浏览器 speechSynthesis。

/* ============================== 配置 ============================== */
// 7 个知识板块（学段 / 考试），与「单词打卡」并列
const BOARDS = [
  { id: 'zhongkao', name: '中考',   icon: '🎓', cls: 'l-blue' },
  { id: 'gaokao',   name: '高考',   icon: '📚', cls: 'l-violet' },
  { id: 'cet',      name: '四六级', icon: '📝', cls: 'l-amber' },
  { id: 'kaoyan',   name: '考研',   icon: '🎯', cls: 'l-mint' },
  { id: 'toefl',    name: '托福',   icon: '🌎', cls: 'l-sky' },
  { id: 'ielts',    name: '雅思',   icon: '🇬🇧', cls: 'l-rose' },
  { id: 'native',   name: '原版娃', icon: '🧒', cls: 'l-peach' },
];
// 原版娃 6 个子体系
const NATIVE = [
  { id: 'nce',      name: '新概念英语',        icon: '📘' },
  { id: 'raz',      name: 'RAZ',              icon: '🌱' },
  { id: 're',       name: 'Reading Explorer', icon: '🔭' },
  { id: 'unlock',   name: 'Unlock',           icon: '🔓' },
  { id: 'think',    name: 'Think',            icon: '💡' },
  { id: 'classics', name: '英语名著3000',      icon: '📖' },
];
// 单词打卡引擎：按知识板块动态选择；仅 ielts 已上线真实词库
const CHECKIN = {
  zhongkao: { name: '中考核心词', ready: false, icon: '🎓', desc: '中考考纲高频词，配例句与记忆曲线，每天 15 分钟轻松积累。' },
  gaokao:   { name: '高考核心词', ready: false, icon: '📚', desc: '高考 3500 词 + 高频拓展，按遗忘曲线自动排复习。' },
  cet:      { name: '四六级核心词', ready: false, icon: '📝', desc: '四六级核心词库，真题语境例句，听音辨词 + 拼写训练。' },
  kaoyan:   { name: '考研核心词', ready: false, icon: '🎯', desc: '考研英语一/二核心词，长难句语境，写作高频搭配。' },
  toefl:    { name: '托福核心词', ready: false, icon: '🌎', desc: '托福学术词汇，TPO 语境例句，美音真人发音。' },
  ielts:    { name: '60天打卡雅思1万单词', ready: true, icon: '🇬🇧',
    desc: '60 天走完 10,000 个雅思核心词条：英音／美音、口语例句、名著原文、KJV + WEB 双译本经文、搭配与派生词，遗忘曲线自动排复习。',
    order: ['b', 'q', 'o'], audioFirst: false, hideWord: false },
};
const AUDIO = (w, type) => `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(w)}&type=${type}`;
const KEY = (subj) => `bq8.${subj}`;
const DAY_MS = 86400000;

// 100句7000词板块（俞敏洪《100个句子记完7000个雅思单词》）：10 天课程，
// 每天 10 句 → 学完测验 30 题 → 未掌握词进错词本与记忆曲线
const S100 = { name: '6天100句英语打卡雅思7000词', icon: '💯', quizN: 30, days: 6 };

// 旧版 'bq8.words' 进度迁移到 'bq8.ielts'（一次性的本地兼容）
function migrateStore() {
  try {
    const old = localStorage.getItem('bq8.words');
    if (old && !localStorage.getItem('bq8.ielts')) localStorage.setItem('bq8.ielts', old);
  } catch (e) {}
}

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
  const sI = storeFor('ielts');
  const doneI = Object.values(sI.rec).filter(r => r.n > 0).length;
  const wrongN = (sI.wrongPool || []).length;
  const pctI = Math.min(100, (doneI / Math.max(1, totalNew)) * 100);

  // 7 知识板块卡片（原版娃内嵌 6 子项）
  const boardCards = BOARDS.map(B => {
    if (B.id === 'native') {
      const subs = NATIVE.map((n, i) => `<a class="subcard" style="animation-delay:${i * 60}ms" href="#/native/${n.id}">
          <span class="si">${n.icon}</span><span class="sn">${esc(n.name)}</span>
        </a>`).join('');
      return `<div class="lane ${B.cls}">
        <a class="lane-h" href="#/board/native"><div class="ic">${B.icon}</div><b>${B.name}</b></a>
        <p>原版阅读体系一站式打卡：新概念 / RAZ / Reading Explorer / Unlock / Think / 英语名著3000。</p>
        <div class="subcards">${subs}</div>
      </div>`;
    }
    const C = CHECKIN[B.id];
    const prog = B.id === 'ielts'
      ? `<p style="margin-top:8px"><span class="tag">已学 ${doneI} 词</span>
          <span class="tag">连续 ${sI.streak || 0} 天</span>
          ${wrongN ? `<span class="tag">错词 ${wrongN}</span>` : ''}</p>
        <div class="bar"><i style="width:${pctI}%"></i></div>`
      : `<p style="margin-top:8px"><span class="tag">词库筹备中</span></p>`;
    return `<a class="lane ${B.cls}" href="#/board/${B.id}">
      <div class="ic">${B.icon}</div><b>${B.name}</b>
      <p>${esc(C ? C.desc : '')}</p>${prog}
    </a>`;
  }).join('');

  // 单词打卡入口（统一动态选择）
  const ckCard = `<a class="lane l-rose" href="#/checkin">
      <div class="ic">🔤</div><b>单词打卡</b>
      <p>按前面任一知识板块动态选择词库开刷：中考 / 高考 / 四六级 / 考研 / 托福 / 雅思 / 原版娃。遗忘曲线自动排复习，错词本持续回炉。</p>
      <p style="margin-top:8px"><span class="tag">雅思 10000 词已上线</span><span class="tag">其余板块筹备中</span></p>
    </a>`;

  return `<div class="hero">
      <h1>贝琪酱英语无痛逆袭站</h1>
      <p class="slogan">英语满分孵化站 <span class="en">Full-Mark English Incubator</span></p>
      <p>覆盖<b>中考 · 高考 · 四六级 · 考研 · 托福 · 雅思</b>全学段，以及<b>原版娃</b>阅读体系。每个板块都能开背单词打卡，每天半小时，按遗忘曲线自动排复习。</p>
      <p style="margin-top:10px">旗舰词库 <b>雅思 10,000 词</b>已上线：每词配英音／美音、口语例句、名著原文、KJV + WEB 双译本经文、搭配与派生词，每日还有篇章拓展阅读。</p>
    </div>
    <div class="lanes">${boardCards}${ckCard}</div>
    <div class="card pad" style="margin-top:18px">
      <h2>每日新词曲线 · 雅思旗舰</h2>
      <div class="muted">Day1 = 10 词，递增至 Day24 峰值 167 词，之后递减；复习由遗忘曲线自动插入，不占新词额度。</div>
      <div class="heat">${META.days.filter(d => !d.sprint).map(d => {
        const lv = d.n > 140 ? 'l4' : d.n > 100 ? 'l3' : d.n > 50 ? 'l2' : 'l1';
        return `<i class="${lv}" title="Day ${d.d}：${d.n} 词"></i>`;
      }).join('')}</div>
    </div>
    <div class="card pad" style="margin-top:14px">
      <h2>旗舰词库构成 · 雅思万词</h2>
      <div class="muted">${Object.entries(META.stat).map(([k, v]) => `${({ bible: '圣经原文例句', oral: '口语化例句', lit: '名著原文例句', deriv: '派生词', coll: '高频搭配' })[k] || k} ${v}`).join(' · ')}</div>
    </div>
    <div class="qr-promo">
      <img class="qr-img" src="./assets/img/qrcode.jpg" alt="公众号二维码" loading="lazy">
      <div class="qr-text">
        <b>关注公众号 · 贝琪酱英语无痛逆袭站</b>
        <span class="en">Follow us on WeChat — Becky's Painless English Station</span>
        <span class="muted">微信扫码，打卡提醒、学习方法与英语资讯持续更新</span>
      </div>
    </div>`;
}

/* ============================== 视图：打卡（按板块） ============================== */
async function viewCheckin(subj, isBoard) {
  const C = CHECKIN[subj];
  if (!C) { location.hash = '#/home'; return ''; }
  if (!C.ready) {
    return `<div class="card pad">
      <div class="spread"><h1 style="margin:0">${C.icon} ${C.name}</h1><span class="tag">词库筹备中</span></div>
      <p class="muted" style="margin-top:10px">${esc(C.desc)}</p>
      <div class="muted" style="margin-top:14px">该板块的词库正在筹备上线。你可以先用已上线的 <b>雅思课程</b> 开刷，或回到「单词打卡」选择其他板块。</div>
      <p style="margin-top:16px">
        <a class="btn" href="#/checkin/ielts">去刷雅思万词 →</a>
        <a class="btn ghost" href="#/checkin">单词打卡总入口</a>
      </p>
    </div>`;
  }
  if (!META) META = await loadJSON('./assets/data/meta.json');
  const s = storeFor(subj);
  const day = plannedDay(subj);
  const pack = await loadJSON(`./assets/data/day-${String(day).padStart(2, '0')}.json`);
  const done = pack.words.filter(w => (s.rec[`${day}:${w.w}`] || {}).n > 0).length;
  const pct = pack.words.length ? Math.round(done / pack.words.length * 100) : 0;

  // ===== 雅思板块下两门课程并列：万词打卡 + 100句7000词 =====
  const sS = storeFor('s100');
  const doneS = Object.values(sS.rec).filter(r => r.n > 0).length;
  const nextS = Math.min(S100.days, Object.keys(sS.log || {}).length + 1);

  const cardIelts = `
    <div class="card pad course-card">
      <div class="course-h"><span class="ci">🇬🇧</span><h2 style="margin:0">${esc(C.name)}</h2></div>
      <div class="muted" style="margin:8px 0">${esc(C.desc)}</div>
      <div class="row" style="margin-bottom:8px">
        <a class="btn" href="#/study/${subj}/${day}">开始 Day ${day}（${pack.words.length} 词）</a>
        <a class="btn ghost" href="#/wrong">🗂️ 错词本</a>
      </div>
      <div class="row">
        <span class="tag">连续打卡 ${s.streak || 0} 天</span>
        <span class="tag">已掌握 ${Object.values(s.rec).filter(r => r.n > 0).length} 词</span>
        ${ (s.wrongPool || []).length ? `<span class="tag">错词 ${(s.wrongPool || []).length}</span>` : '' }
        <span class="tag">模式：${s.mode === 'flat' ? '匀速（60 天全覆盖）' : '渐进曲线'}</span>
        <button class="chip2" id="toggleMode" style="margin-left:auto">切换模式</button>
      </div>
    </div>`;

  const cardS100 = `
    <div class="card pad course-card">
      <div class="course-h"><span class="ci">💯</span><h2 style="margin:0">${esc(S100.name)}</h2></div>
      <div class="muted" style="margin:8px 0">俞敏洪《100个句子记完7000个雅思单词》：精学 100 个剑桥真题难句 → 测验摸底 → 没掌握的词自动进错词本与记忆曲线回炉。</div>
      <div class="row" style="margin-bottom:8px">
        <a class="btn" href="#/s100/${nextS}">${doneS ? '继续 Day ' + nextS : '开始 Day 1'} →</a>
        <a class="btn ghost" href="#/wrong/s100">🗂️ 错词本</a>
      </div>
      <div class="row">
        <span class="tag">已掌握 ${doneS} 词</span>
        ${(sS.wrongPool || []).length ? `<span class="tag">错词 ${(sS.wrongPool || []).length}</span>` : ''}
        <span class="tag">连续打卡 ${sS.streak || 0} 天</span>
      </div>
    </div>`;

  return `<div class="spread">
      <div><h1>${C.icon} 雅思 · 课程中心</h1>
      <div class="muted">雅思板块下两门课程，进度各自独立保存，均按遗忘曲线自动排复习。</div></div>
    </div>

    <div class="course-grid" style="margin-top:14px">${cardIelts}${cardS100}</div>

    ${isBoard ? '' : `
    <div class="card pad" style="margin-top:16px">
      <div class="spread"><h2 style="margin:0">${esc(C.name)} · 今日进度 Day ${day}</h2>
        <span class="muted">${done} / ${pack.words.length} · ${pct}%</span></div>
      <div class="progress-wrap"><i style="width:${pct}%"></i></div>
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
    </div>`}
`;
}

/* ============================== 视图：单词打卡总入口（动态选板块） ============================== */
function viewCheckinHub() {
  const tiles = Object.entries(CHECKIN).map(([id, C]) =>
    `<a class="subtile ${C.ready ? 'on' : ''}" href="#/checkin/${id}">
      <span>${C.icon}</span>${esc(C.name)}${C.ready ? '<i>已上线</i>' : '<i class="soft">筹备中</i>'}
    </a>`).join('')
    + `<a class="subtile on" href="#/s100"><span>💯</span>${esc(S100.name)}<i>雅思课程</i></a>`;
  const wrongN = (storeFor('ielts').wrongPool || []).length;
  return `<div class="card pad">
    <h1>单词打卡 · 选板块</h1>
    <div class="muted">选择一个知识板块开始背单词。打卡进度按板块独立保存，遗忘曲线自动排复习，错词本持续回炉。</div>
    <div class="subgrid big" style="margin-top:16px">${tiles}</div>
    <p class="muted" style="margin-top:14px">提示：雅思 <b>${esc(CHECKIN.ielts.name)}</b> 与 <b>${esc(S100.name)}</b> 已上线，其余板块词库正在筹备。</p>
  </div>
  <div class="card pad" style="margin-top:14px">
    <div class="spread"><h2 style="margin:0">🗂️ 错词本</h2>
      <a class="btn" href="#/wrong">${wrongN ? `复习错词（${wrongN}）` : '查看错词本'}</a></div>
    <div class="muted" style="margin-top:6px">打卡时判「不认识 / 模糊」的词会自动进错词本，按遗忘曲线回插到后续每天的打卡里，也可在这里专项突击。</div>
  </div>`;
}

/* ============================== 视图：原版娃 ============================== */
function viewNative() {
  const subs = NATIVE.map((n, i) => `<a class="subcard big" style="animation-delay:${i * 60}ms" href="#/native/${n.id}">
      <span class="si">${n.icon}</span><span class="sn">${esc(n.name)}</span>
      <span class="sd">原版阅读体系 · 词库筹备中</span>
    </a>`).join('');
  return `<div class="spread"><h1>🧒 原版娃</h1><span class="tag">阅读体系</span></div>
    <p class="muted" style="margin-top:10px">原版阅读一站式打卡，覆盖新概念英语、RAZ、Reading Explorer、Unlock、Think、英语名著3000。各体系词库正在筹备上线。</p>
    <div class="subcards wide" style="margin-top:16px">${subs}</div>`;
}
function viewNativeSub(id) {
  const n = NATIVE.find(x => x.id === id);
  if (!n) { location.hash = '#/board/native'; return ''; }
  return `<div class="card pad">
    <div class="spread"><h1 style="margin:0">${n.icon} ${n.name}</h1><span class="tag">词库筹备中</span></div>
    <p class="muted" style="margin-top:10px">${n.name} 体系的单词打卡词库正在筹备上线。可先用已上线的雅思万词保持手感。</p>
    <p style="margin-top:16px"><a class="btn" href="#/checkin/ielts">去刷雅思万词 →</a>
      <a class="btn ghost" href="#/board/native">回到原版娃</a></p>
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

async function viewStudy(subj, dayStr) {
  const C = CHECKIN[subj];
  if (!C || !C.ready) { location.hash = '#/checkin'; return ''; }
  const day = parseInt(dayStr, 10) || 1;
  const L = C;
  const pack = await loadJSON(`./assets/data/day-${String(day).padStart(2, '0')}.json`);
  const q = await buildQueue(subj, day);
  session = {
    lane: subj, day, L, queue: q, idx: 0, revealed: false, start: Date.now(),
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
        <a class="btn" href="#/checkin/${s.lane}">回到 ${s.L.name} 打卡</a>
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
async function viewWrong(lane) {
  lane = lane || 'ielts';
  const s = storeFor(lane);
  const pool = s.wrongPool || [];
  if (!pool.length) {
    return `<div class="card pad"><h2>🗂️ 错词本</h2>
      <p class="muted">还没有答错的词。打卡时选「不认识 / 模糊」的词会自动进这里，并在后续天数回炉复习。</p>
      <p style="margin-top:14px"><a class="btn" href="#/checkin/ielts">去背单词</a></p></div>`;
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
async function viewWrongStudy(lane) {
  lane = lane || 'ielts';
  const q = await buildWrongQueue(lane);
  session = {
    lane, day: plannedDay(lane), L: CHECKIN[lane] || { name: '错词复习', icon: '🗂️', order: [] }, queue: q, idx: 0, revealed: false, start: Date.now(),
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
/* ============================== 100句7000词 ============================== */
let S100META = null;
let s100 = null; // s100 会话：{day, pack, quiz, stage, sidx, qidx, revq, ridx, revealed, start, right, wrong}

const s100Store = () => storeFor('s100');

async function viewS100Home() {
  if (!S100META) S100META = await loadJSON('./assets/data/s100-meta.json');
  const s = s100Store();
  const done = Object.values(s.rec).filter(r => r.n > 0).length;
  const wrongN = (s.wrongPool || []).length;
  const pct = Math.min(100, done / Math.max(1, S100META.totalWords) * 100);
  const nextDay = Math.min(S100.days, Object.keys(s.log || {}).length + 1);
  const tiles = S100META.days.map(d => {
    const dn = Object.keys(s.rec).filter(k => k.indexOf(d.d + ':') === 0 && s.rec[k].n > 0).length;
    const p = Math.min(100, dn / Math.max(1, d.quiz) * 100);
    return `<a class="subtile ${dn ? 'on' : ''}" href="#/s100/${d.d}">
      <span>Day ${d.d}</span>${d.n} 词 · 测验 ${d.quiz} 词
      <div class="bar" style="width:100%;margin-top:6px"><i style="width:${p}%"></i></div>
    </a>`;
  }).join('');
  return `<div class="card pad">
      <div class="spread"><h1 style="margin:0">💯 ${esc(S100.name)}</h1>
        <a class="btn" href="#/s100/${nextDay}">${done ? '继续 Day ' + nextDay : '开始 Day 1'} →</a></div>
      <div class="muted" style="margin-top:10px">俞敏洪《100个句子记完7000个雅思单词》全收录：${S100.days} 天 · 100 个剑桥真题难句 · ${S100META.totalWords} 个词条。
      每天三步走：① 精学 10 句（原文 + 译文 + 句法 + 核心词/主题词）→ ② 测验 ${S100.quizN} 题选出正确释义，摸清哪些词没掌握 → ③ 没掌握的词自动进错词本和记忆曲线，后续每天回炉复习。</div>
      <div class="row" style="margin-top:12px">
        <span class="tag">已掌握 ${done} / ${S100META.totalWords}</span>
        <span class="tag">连续打卡 ${s.streak || 0} 天</span>
        ${wrongN ? `<span class="tag">错词 ${wrongN}</span>` : ''}
        <span class="tag">累计测验 ${S100META.totalQuiz} 词</span>
      </div>
      <div class="bar" style="margin-top:10px"><i style="width:${pct}%"></i></div>
    </div>
    <div class="card pad" style="margin-top:14px">
      <h2>${S100.days} 天课程表</h2>
      <div class="subgrid big" style="margin-top:12px">${tiles}</div>
    </div>
    <div class="card pad" style="margin-top:14px">
      <div class="spread"><h2 style="margin:0">🗂️ 错词本</h2>
        <a class="btn" href="#/wrongstudy/s100">复习错词${wrongN ? `（${wrongN}）` : ''}</a></div>
      <div class="muted" style="margin-top:6px">测验答错或复习判「不认识 / 模糊」的词会进这里，按遗忘曲线回插到每天的测验前复习环节。</div>
    </div>`;
}

function s100Hi(en, words) {
  let out = esc(en);
  const seen = new Set();
  for (const w of words.filter(x => !x.sub && x.w.length > 2)) {
    const k = w.w.toLowerCase();
    if (seen.has(k)) continue; seen.add(k);
    const f = w.w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${f}\\w*\\b`, 'i');
    if (re.test(out)) out = out.replace(re, m => `<mark>${m}</mark>`);
  }
  return out;
}

function s100WordLines(words) {
  return words.map(w => `<div class="s100-wordline">
      <b>${esc(w.w)}</b>
      <button class="speak sm" data-audio="${esc(w.w)}" data-type="1">🔊</button>
      ${w.p ? `<span class="pos" style="font-size:12px">${esc(w.p)}</span>` : ''}
      <span class="m">${esc(w.m)}</span>
      ${w.n && w.n.length ? `<span class="nt">${w.n.map(esc).join('　')}</span>` : ''}
    </div>`).join('');
}

async function viewS100Study(day) {
  if (!S100META) S100META = await loadJSON('./assets/data/s100-meta.json');
  if (!(day >= 1 && day <= S100.days)) { location.hash = '#/s100'; return ''; }
  const pack = await loadJSON(`./assets/data/s100-${String(day).padStart(2, '0')}.json`);
  // 组卷：主词优先随机抽 S100.quizN 题
  const pool = pack.words.filter(w => !w.sub && w.m);
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  const quiz = shuffled.slice(0, S100.quizN).map(w => ({ w, opts: s100Opts(w, pack.words) }));
  // 到期复习：错词本到期 + 本包词曲线到期（每轮最多 25 个）
  const st = s100Store();
  const now = Date.now();
  const revq = (st.wrongPool || [])
    .filter(it => st.rec[it.key] && st.rec[it.key].due && st.rec[it.key].due <= now)
    .slice(0, 25).map(it => ({ key: it.key, w: it.w }));
  const inPack = pack.words.filter(w => {
    if (revq.some(r => r.w.w === w.w)) return false;
    const r = st.rec[`${day}:${w.w}`];
    return r && r.due && r.due <= now;
  }).slice(0, 25).map(w => ({ key: `${day}:${w.w}`, w }));
  const revAll = revq.concat(inPack);

  s100 = { day, pack, quiz, revq: revAll, stage: 'sent', sidx: 0, qidx: 0, ridx: 0,
           revealed: false, start: Date.now(), right: 0, wrong: 0, quizRight: 0, quizWrong: 0 };
  const total = 10 + quiz.length + revAll.length;
  return `<div class="study">
      <div class="spread">
        <div><span class="tag">💯 ${esc(S100.name)}</span> <span class="tag">Day ${day}</span>
          <span class="s100-stage" id="s100Stage">阶段 1 · 精学句子</span>
          <span class="tally">✓ <b id="tRight">0</b> ✗ <b id="tWrong">0</b></span></div>
        <div class="row">
          <button class="chip2" id="exitBtn">退出</button>
        </div>
      </div>
      <div class="progress-wrap"><i id="pbar" style="width:0%"></i></div>
      <div class="row spread"><span class="muted" id="ptext">准备开始</span><span class="muted" id="counter">0 / ${total}</span></div>
      <div id="card" class="card pad" style="margin-top:14px"></div>
    </div>`;
}

// 4 选 1 干扰项：优先同词性
function s100Opts(w, words) {
  const samePos = words.filter(x => x.w !== w.w && x.m && x.p && x.p === w.p);
  const others = words.filter(x => x.w !== w.w && x.m && (!x.p || !w.p || x.p !== w.p));
  const pick = (arr, n) => arr.slice().sort(() => Math.random() - 0.5).slice(0, n);
  const distract = pick(samePos, 3);
  if (distract.length < 3) distract.push(...pick(others, 3 - distract.length).filter(x => !distract.includes(x)));
  const correct = (w.p ? w.p + ' ' : '') + w.m;
  const opts = distract.map(x => (x.p ? x.p + ' ' : '') + x.m);
  opts.push(correct);
  return opts.sort(() => Math.random() - 0.5).map(t => ({ t, ok: t === correct }));
}

function s100Progress() {
  const s = s100;
  const done = s.stage === 'sent' ? s.sidx : 10 + (s.stage === 'quiz' ? s.qidx : s.quiz.length + s.ridx);
  const total = 10 + s.quiz.length + s.revq.length;
  const bar = document.getElementById('pbar');
  if (bar) bar.style.width = Math.round(done / Math.max(1, total) * 100) + '%';
  const c = document.getElementById('counter');
  if (c) c.textContent = `${done} / ${total}`;
}

function s100BindSpeak(el) {
  el.querySelectorAll('.speak, .chip2[data-audio]').forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); speak(b.dataset.audio, parseInt(b.dataset.type || '1', 10)); };
  });
  el.querySelectorAll('[data-say]').forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); speakSentence(b.dataset.say, 'en-GB'); };
  });
}

function s100Tally() {
  const r = document.getElementById('tRight'), x = document.getElementById('tWrong');
  if (r) r.textContent = s100.right; if (x) x.textContent = s100.wrong;
}

function renderS100() {
  const el = document.getElementById('card');
  if (!el || !s100) return;
  const s = s100;
  s100Progress();
  if (s.stage === 'sent') return renderS100Sent(el);
  if (s.stage === 'quiz') return renderS100Quiz(el);
  if (s.stage === 'rev') return renderS100Rev(el);
  return renderS100Done(el);
}

/* ---- 阶段 1：句子精学 ---- */
function renderS100Sent(el) {
  const s = s100;
  const sn = s.pack.sentences[s.sidx];
  document.getElementById('s100Stage').textContent = '阶段 1 · 精学句子';
  document.getElementById('ptext').textContent = `第 ${s.sidx + 1} / 10 句`;
  const last = s.sidx === s.pack.sentences.length - 1;
  const themeHtml = sn.themes.map(t => `<div class="s100-sec">
      <div class="sec-t">${esc(t.t)}</div>${s100WordLines(t.ws)}</div>`).join('');
  el.innerHTML = `<div class="spread"><span class="tag">句子 ${sn.num} · ${esc(sn.source)}</span>
      <button class="chip2" data-say="${esc(sn.en)}">🔊 朗读句子</button></div>
    <div class="s100-sent">
      <div class="s100-en">${s100Hi(sn.en, sn.core)}</div>
      <div class="s100-zh">${esc(sn.zh)}</div>
      ${sn.grammar ? `<div class="s100-gram">✏️ ${esc(sn.grammar)}</div>` : ''}
    </div>
    <div class="s100-sec"><div class="sec-t">核心词</div>${s100WordLines(sn.core)}</div>
    ${themeHtml}
    <div class="grade" style="margin-top:16px">
      ${s.sidx > 0 ? `<button class="g1" id="s100Prev">← 上一句</button>` : ''}
      <button class="g2" id="s100Next">${last ? '学完 10 句，开始测验 →' : '下一句 →'}<small>点击 / 空格</small></button>
    </div>`;
  s100BindSpeak(el);
  document.getElementById('s100Next').onclick = () => s100NextSent();
  const pv = document.getElementById('s100Prev');
  if (pv) pv.onclick = () => s100PrevSent();
}

function s100PrevSent() {
  if (s100.sidx > 0) { s100.sidx--; s100.revealed = false; renderS100(); }
}

function s100NextSent() {
  const s = s100;
  s.sidx++;
  if (s.sidx >= s.pack.sentences.length) { s.stage = 'quiz'; s.qidx = 0; }
  // 当天打卡记录
  const st = s100Store();
  const t = todayStr();
  st.log = st.log || {};
  st.log[t] = st.log[t] || { new: 0, rev: 0 };
  st.log[t].new++;
  if (st.lastDay !== t) {
    const y = new Date(Date.now() - DAY_MS).toLocaleDateString('sv');
    st.streak = (st.lastDay === y) ? (st.streak || 0) + 1 : 1;
    st.lastDay = t;
  }
  saveStore('s100', st);
  renderS100();
}

/* ---- 阶段 2：测验（4 选 1 释义） ---- */
function renderS100Quiz(el) {
  const s = s100;
  document.getElementById('s100Stage').textContent = `阶段 2 · 测验 ${s.quiz.length} 题`;
  if (s.qidx >= s.quiz.length) { s.stage = s.revq.length ? 'rev' : 'done'; s.ridx = 0; s.revealed = false; return renderS100(); }
  const q = s.quiz[s.qidx];
  const w = q.w;
  const sn = s.pack.sentences[w.si];
  document.getElementById('ptext').innerHTML = `<span class="tag">测验</span> 第 ${s.qidx + 1} / ${s.quiz.length} 题`;
  el.innerHTML = `<div class="spread"><span class="tag">选出正确释义</span>
      <button class="speak" data-audio="${esc(w.w)}" data-type="1">🔊</button></div>
    <div class="wordhead"><div class="word">${esc(w.w)}</div>${w.p ? `<div class="pos">${esc(w.p)}</div>` : ''}</div>
    ${sn ? `<div class="s100-sent"><div class="s100-en" style="font-size:15px">${s100Hi(sn.en, [w])}</div></div>` : ''}
    <div id="opts">${q.opts.map((o, i) => `<button class="qopt" data-i="${i}" data-ok="${o.ok ? 1 : 0}">
      <b>${'ABCD'[i]}</b>　${esc(o.t)}</button>`).join('')}</div>
    <div class="muted" id="qtip" style="margin-top:10px">键盘 1-4 也可作答</div>`;
  s100BindSpeak(el);
  el.querySelectorAll('.qopt').forEach(b => {
    b.onclick = () => s100Answer(q, parseInt(b.dataset.ok, 10) === 1, b);
  });
}

function s100Answer(q, ok, btn) {
  const s = s100;
  const optsEl = document.getElementById('opts');
  optsEl.querySelectorAll('.qopt').forEach(b => { b.disabled = true; if (b.dataset.ok === '1') b.classList.add('ok'); });
  if (!ok && btn) btn.classList.add('bad');
  const st = s100Store();
  const key = `${s.day}:${q.w.w}`;
  st.rec[key] = grade(st.rec[key] || { due: 0 }, ok ? 2 : 0);
  if (ok) { s.right++; s.quizRight++; removeFromPool(st, key); }
  else { s.wrong++; s.quizWrong++; addToPool(st, { key, day: s.day }, q.w); }
  saveStore('s100', st);
  s100Tally();
  const tip = document.getElementById('qtip');
  if (tip) tip.innerHTML = (ok
    ? `<span class="tag">✓ 记得 · 已进入记忆曲线</span>`
    : `<span class="tag">✗ 正确答案见绿色项 · 已进错词本，8 分钟后回来再考</span>`)
    + ` <button class="g2" id="s100NextQ" style="margin-left:8px">下一题 →</button>`;
  const nb = document.getElementById('s100NextQ');
  if (nb) nb.onclick = s100AdvanceQuiz;
  if (s.qTimer) { clearTimeout(s.qTimer); s.qTimer = null; }
  s.qGuard = false;
  s.qTimer = setTimeout(s100AdvanceQuiz, ok ? 900 : 1700);
}

function s100AdvanceQuiz() {
  const s = s100;
  if (!s || s.qGuard) return;
  s.qGuard = true;
  if (s.qTimer) { clearTimeout(s.qTimer); s.qTimer = null; }
  s.qidx++;
  s.qGuard = false;
  if (s.qidx >= s.quiz.length) { s.stage = s.revq.length ? 'rev' : 'done'; s.ridx = 0; s.revealed = false; }
  renderS100();
}

/* ---- 阶段 3：错词/到期复习（自评卡） ---- */
function renderS100Rev(el) {
  const s = s100;
  document.getElementById('s100Stage').textContent = '阶段 3 · 复习回炉';
  if (s.ridx >= s.revq.length) { s.stage = 'done'; return renderS100(); }
  const it = s.revq[s.ridx];
  const w = it.w;
  document.getElementById('ptext').innerHTML = `<span class="tag">复习</span> 第 ${s.ridx + 1} / ${s.revq.length} 个`;
  const revealed = s.revealed;
  el.innerHTML = `<div class="spread"><span class="tag">${revealed ? '还记得它吗？' : '回炉复习'}</span>
      <button class="speak" data-audio="${esc(w.w)}" data-type="1">🔊</button></div>
    <div class="wordhead"><div class="word">${esc(w.w)}</div>${w.p ? `<div class="pos">${esc(w.p)}</div>` : ''}</div>
    ${revealed
      ? `<div class="mean">${esc(w.p || '')} ${esc(w.m || '')}</div>
         <div class="grade" style="margin-top:14px">
           <button class="g0" data-g="0">不认识<small>点击 / 1 · 8 分钟后再来</small></button>
           <button class="g1" data-g="1">有点模糊<small>点击 / 2 · 明天再见</small></button>
           <button class="g2" data-g="2">记得<small>点击 / 3 · 进入曲线</small></button>
         </div>`
      : `<div class="mean" style="color:var(--ink-3);font-size:15px">先回忆意思，再点下方显示</div>
         <div class="grade" style="margin-top:14px">
           <button class="g2" id="s100Reveal">显示释义<small>点击 / 空格</small></button>
         </div>`}
    <div class="row" style="margin-top:12px">
      ${s.ridx > 0 ? `<button class="chip2" id="s100RevPrev">← 上一词</button>` : ''}
      <button class="chip2" id="audioAgain">🔊 再听一遍</button>
    </div>`;
  s100BindSpeak(el);
  const again = document.getElementById('audioAgain');
  if (again) again.onclick = () => speak(w.w, 1);
  const rp = document.getElementById('s100RevPrev');
  if (rp) rp.onclick = () => { if (s.ridx > 0) { s.ridx--; s.revealed = false; renderS100(); } };
  const rv = document.getElementById('s100Reveal');
  if (rv) rv.onclick = () => { s.revealed = true; renderS100(); };
  el.querySelectorAll('.grade button[data-g]').forEach(b => {
    b.onclick = () => s100RevGrade(it, parseInt(b.dataset.g, 10));
  });
}

function s100RevGrade(it, g) {
  const s = s100;
  const st = s100Store();
  st.rec[it.key] = grade(st.rec[it.key] || { due: 0 }, g);
  if (g === 2) removeFromPool(st, it.key);
  if (g === 2) s.right++; else s.wrong++;
  const t = todayStr();
  st.log = st.log || {};
  st.log[t] = st.log[t] || { new: 0, rev: 0 };
  st.log[t].rev++;
  saveStore('s100', st);
  s100Tally();
  s.ridx++; s.revealed = false;
  if (s.ridx >= s.revq.length) s.stage = 'done';
  renderS100();
}

/* ---- 完成 ---- */
function renderS100Done(el) {
  const s = s100;
  const mins = Math.round((Date.now() - s.start) / 60000);
  const bar = document.getElementById('pbar'); if (bar) bar.style.width = '100%';
  const c = document.getElementById('counter'); if (c) c.textContent = '全部完成';
  const p = document.getElementById('ptext'); if (p) p.textContent = '本轮完成';
  const st = s100Store();
  const poolN = (st.wrongPool || []).length;
  el.innerHTML = `<div class="done-box">
      <div class="big">🎉</div>
      <h2>Day ${s.day} 完成</h2>
      <div class="muted">用时约 ${mins} 分钟 · 学了 10 句 · 测验 ${s.quiz.length} 题${s.revq.length ? ` · 复习 ${s.revq.length} 词` : ''}</div>
      <div class="sumrow">
        <span class="sum ok">掌握 ${s.right}</span>
        <span class="sum bad">没掌握 ${s.wrong}</span>
      </div>
      ${s.wrong ? `<div class="muted" style="margin-top:8px">${s.wrong} 个词已进错词本与记忆曲线：今天 8 分钟后会再考一轮，之后按 1 → 2 → 4 → 7 → 15 天间隔回炉 → <a href="#/wrongstudy/s100">现在去巩固</a></div>`
                : `<div class="muted" style="margin-top:8px">全部掌握，太强了 💪</div>`}
      <div class="row" style="justify-content:center;margin-top:16px">
        ${s.day < 10 ? `<a class="btn" href="#/s100/${s.day + 1}">预习 Day ${s.day + 1} →</a>` : `<a class="btn" href="#/s100">10 天课程全部完成，回到总览 🎓</a>`}
        <a class="btn ghost" href="#/s100">回到课程总览</a>
        <a class="btn ghost" href="#/home">回首页</a>
      </div>
      <div class="muted" style="margin-top:14px">连续打卡 ${st.streak || 0} 天 · 错词本 ${poolN} 词</div>
    </div>`;
}

function afterS100() {
  const ex = document.getElementById('exitBtn');
  if (ex) ex.onclick = () => { location.hash = '#/s100'; };
  document.addEventListener('keydown', s100Key);
  if (s100 && s100.stage === 'sent') setTimeout(() => speakSentence(s100.pack.sentences[s100.sidx].en, 'en-GB'), 500);
}

function s100Key(e) {
  if (!s100 || ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  const s = s100;
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    if (s.stage === 'sent') s100NextSent();
    else if (s.stage === 'rev' && !s.revealed) { s.revealed = true; renderS100(); }
    else if (s.stage === 'rev' && s.revealed) s100RevGrade(s.revq[s.ridx], 2);
    return;
  }
  if (s.stage === 'quiz') {
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 4) {
      const b = document.querySelectorAll('#opts .qopt')[n - 1];
      if (b && !b.disabled) b.click();
    }
    return;
  }
  if (s.stage === 'rev' && s.revealed) {
    if (e.key === '1') s100RevGrade(s.revq[s.ridx], 0);
    if (e.key === '2') s100RevGrade(s.revq[s.ridx], 1);
    if (e.key === '3') s100RevGrade(s.revq[s.ridx], 2);
  }
}

/* ============================== 路由 ============================== */
function setNav(name) {
  document.querySelectorAll('#nav a').forEach(a => {
    a.classList.toggle('on', a.dataset.nav === name);
  });
}

async function route() {
  document.removeEventListener('keydown', keyHandler);
  document.removeEventListener('keydown', s100Key);
  const h = location.hash || '#/home';
  const m = h.match(/^#\/(\w+)(?:\/([\w-]+))?(?:\/(\d+))?/);
  const view = document.getElementById('view');
  const [, page, a, b] = m || [, 'home'];
  if (session && session.timer) { clearInterval(session.timer); session.timer = null; }
  session = null;
  try {
    if (page === 'home') { setNav('home'); view.innerHTML = await viewHome(); afterHome(); }
    else if (page === 'checkin' && a && CHECKIN[a]) { setNav('checkin'); view.innerHTML = await viewCheckin(a, false); afterCheckin(a); }
    else if (page === 'checkin') { setNav('checkin'); view.innerHTML = viewCheckinHub(); }
    else if (page === 'board' && a === 'native') { setNav('native'); view.innerHTML = viewNative(); }
    else if (page === 'board' && CHECKIN[a]) { setNav(a); view.innerHTML = await viewCheckin(a, true); afterCheckin(a); }
    else if (page === 'native' && NATIVE.find(n => n.id === a)) { setNav('native'); view.innerHTML = viewNativeSub(a); }
    else if (page === 'study' && CHECKIN[a]) { setNav(a); view.innerHTML = await viewStudy(a, b); renderCard(); startTimer(); afterStudy(); }
    else if (page === 'wrong') { setNav('wrong'); view.innerHTML = await viewWrong(a); afterWrong(); }
    else if (page === 'wrongstudy') { setNav('wrong'); view.innerHTML = await viewWrongStudy(a); renderCard(); startTimer(); afterStudy(); }
    else if (page === 's100' && /^\d+$/.test(a || '')) { setNav('s100'); view.innerHTML = await viewS100Study(parseInt(a, 10)); afterS100(); }
    else if (page === 's100') { setNav('s100'); view.innerHTML = await viewS100Home(); }
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
function afterCheckin(lane) {
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
  if (ex) ex.onclick = () => { location.hash = session.mode === 'wrong' ? '#/wrong' : `#/checkin/${session.lane}`; };
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
migrateStore();
if (window.BQCloud && window.BQCloud.boot) {
  window.BQCloud.boot().catch(function () {}).then(route);
} else {
  route();
}
