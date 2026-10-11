#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
贝琪酱语无痛逆袭站 · 内容生成器（全确定性，零 AI 参与）

每个主词条产出三类真实语料例句（引用式，不搬运全书）：
  O 口语例句 —— 取自名著中的对话行（引号内容），按口语特征打分
  L 名著例句 —— 取自名著叙述/描写句，附书名与作者
  B 圣经例句 —— 取自 KJV 原文，书卷章节号与正文严格同源
另产出：派生词（词表校验）、高频搭配（名著原文二元组统计）、每日篇章拓展阅读。

输入
  ../托雅万词斩/data/words.js        10000 主词条
  corpus/bible/KJV.txt               King James Version（公有领域）
  corpus/novels/*.txt                Project Gutenberg 名著（公有领域）
  corpus/lexicon/words_alpha.txt     英文词表（派生词校验）
输出
  assets/data/meta.json + day-01..60.json
"""
import json
import os
import re
import sys
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS_JS = os.path.join(os.path.dirname(ROOT), "托雅万词斩", "data", "words.js")
if not os.path.exists(WORDS_JS):  # 兼容 DP08 根目录下的同名项目
    WORDS_JS = os.path.join(
        os.path.dirname(os.path.dirname(ROOT)), "DP08", "托雅万词斩", "data", "words.js")
NOVEL_DIR = os.path.join(ROOT, "corpus", "novels")
BIBLE = os.path.join(ROOT, "corpus", "bible", "KJV.txt")
LEXICON = os.path.join(ROOT, "corpus", "lexicon", "words_alpha.txt")
CATALOG = os.path.join(ROOT, "scripts", "catalog.json")
OUT = os.path.join(ROOT, "assets", "data")
os.makedirs(OUT, exist_ok=True)

TOTAL_DAYS = 60
WORDS_PER_DAY = 167

# ================================================== 1. 词表 ==================================================


def load_words():
    raw = open(WORDS_JS, "r", encoding="utf-8").read()
    body = raw[raw.index("[", raw.index("module.exports")):]
    arr = json.loads(body.rstrip().rstrip(";").rstrip())
    out = []
    for r in arr:
        out.append({"word": r[0], "uk": r[1], "us": r[2], "pos": r[3],
                    "cn": r[4], "tags": r[5] or [], "level": r[6]})
    return out


# ================================================== 2. KJV ==================================================

BOOKS = [
    ("Genesis", "创世记"), ("Exodus", "出埃及记"), ("Leviticus", "利未记"),
    ("Numbers", "民数记"), ("Deuteronomy", "申命记"), ("Joshua", "约书亚记"),
    ("Judges", "士师记"), ("Ruth", "路得记"), ("1 Samuel", "撒母耳记上"),
    ("2 Samuel", "撒母耳记下"), ("1 Kings", "列王纪上"), ("2 Kings", "列王纪下"),
    ("1 Chronicles", "历代志上"), ("2 Chronicles", "历代志下"), ("Ezra", "以斯拉记"),
    ("Nehemiah", "尼希米记"), ("Esther", "以斯帖记"), ("Job", "约伯记"),
    ("Psalms", "诗篇"), ("Proverbs", "箴言"), ("Ecclesiastes", "传道书"),
    ("Song of Solomon", "雅歌"), ("Isaiah", "以赛亚书"), ("Jeremiah", "耶利米书"),
    ("Lamentations", "耶利米哀歌"), ("Ezekiel", "以西结书"), ("Daniel", "但以理书"),
    ("Hosea", "何西阿书"), ("Joel", "约珥书"), ("Amos", "阿摩司书"),
    ("Obadiah", "俄巴底亚书"), ("Jonah", "约拿书"), ("Micah", "弥迦书"),
    ("Nahum", "那鸿书"), ("Habakkuk", "哈巴谷书"), ("Zephaniah", "西番雅书"),
    ("Haggai", "哈该书"), ("Zechariah", "撒迦利亚书"), ("Malachi", "玛拉基书"),
    ("Matthew", "马太福音"), ("Mark", "马可福音"), ("Luke", "路加福音"),
    ("John", "约翰福音"), ("Acts", "使徒行传"), ("Romans", "罗马书"),
    ("1 Corinthians", "哥林多前书"), ("2 Corinthians", "哥林多后书"),
    ("Galatians", "加拉太书"), ("Ephesians", "以弗所书"), ("Philippians", "腓立比书"),
    ("Colossians", "歌罗西书"), ("1 Thessalonians", "帖撒罗尼迦前书"),
    ("2 Thessalonians", "帖撒罗尼迦后书"), ("1 Timothy", "提摩太前书"),
    ("2 Timothy", "提摩太后书"), ("Titus", "提多书"), ("Philemon", "腓利门书"),
    ("Hebrews", "希伯来书"), ("James", "雅各书"), ("1 Peter", "彼得前书"),
    ("2 Peter", "彼得后书"), ("1 John", "约翰一书"), ("2 John", "约翰二书"),
    ("3 John", "约翰三书"), ("Jude", "犹大书"), ("Revelation", "启示录"),
]
BOOK_NAMES = [b[0] for b in BOOKS]
BOOK_CN = dict(BOOKS)


def parse_kjv(path):
    """逐卷推进：凡下一节恰为 1:1 即进入正典中的下一卷，
    因此引用编号与正文严格对应（不依赖任何可能被改写的题名格式）。"""
    t = open(path, "r", encoding="utf-8", errors="ignore").read()
    # 去掉 Gutenberg 首尾封装，否则页脚会被当成最后一节经文，
    # 导致页脚里出现的词被误配到启示录 22:21
    m = re.search(r"\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*", t, re.S)
    if m:
        t = t[m.end():]
    m = re.search(r"\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK", t, re.S)
    if m:
        t = t[:m.start()]
    lines = t.split("\n")
    verse_re = re.compile(r"^(\d+):(\d+)\s+(.*)$")
    verses, book, idx, cur, buf = {}, None, 0, None, []

    def flush():
        if cur and book:
            t = " ".join(" ".join(buf).split())
            if t:
                verses["%s %s" % (book, cur)] = t

    for line in lines:
        m = verse_re.match(line.strip())
        if m:
            if m.group(1) == "1" and m.group(2) == "1" and idx < len(BOOK_NAMES):
                book = BOOK_NAMES[idx]
                idx += 1
            if book is None:
                continue
            flush()
            cur, buf = "%s:%s" % (m.group(1), m.group(2)), [m.group(3)]
        elif line.strip() and cur:
            buf.append(line.strip())
    flush()
    return verses


# ================================================== 3. 名著语料 ==================================================

ABBR_DOT = re.compile(r"\b(Mr|Mrs|Ms|Dr|St|Prof|Rev|Hon|Capt|Col|Gen|Lt|Sgt|Messrs|Jr|Sr|"
                      r"vs|etc|viz|al|Fig|No|pp|ibid|Esq|Mt|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|"
                      r"Sept|Oct|Nov|Dec)\.")
INITIAL_DOT = re.compile(r"\b([A-Z])\.")
FRAG_TAIL = re.compile(r"\b(Mr|Mrs|Ms|Dr|St|Prof|Rev|Jr|Sr|etc|vs|Mt|Lt|Capt|Col|Gen)$")

ABBR_SET = {"mr", "mrs", "ms", "dr", "st", "prof", "rev", "hon", "capt", "col", "gen",
            "lt", "sgt", "messrs", "jr", "sr", "vs", "etc", "viz", "al", "fig", "no",
            "pp", "ibid", "esq", "mt", "i", "a"}


def split_sentences(para):
    """缩写感知的句子切分：遇到 Mr./Mrs./首字母缩写 等句点不切。"""
    out, start, n = [], 0, len(para)
    for m in re.finditer(r"[.!?][\"'»”’)\]]*(?=\s|$)", para):
        end = m.end()
        j = m.start()
        while j > 0 and para[j - 1].isspace():
            j -= 1
        k = j
        while k > 0 and (para[k - 1].isalnum() or para[k - 1] == "."):
            k -= 1
        prev = para[k:m.start()]
        if prev.lower() in ABBR_SET or (len(prev) == 1 and prev.isupper()):
            continue
        out.append(para[start:end].strip())
        start = end
    out.append(para[start:].strip())
    return [p for p in out if p]

QUOTE_RE = re.compile(r"[“\"]([^“”\"]{28,190})[”\"]")
SPOKEN = re.compile(r"\b(I|you|we|he|she|they|it's|isn't|don't|can't|won't|didn't|"
                    r"ain't|I'm|you're|we're|let's|I'll|I'd|I've|he's|she's|there's|that's|"
                    r"well|oh|why|sure|hush|look|listen|come|go)\b", re.I)


def strip_gutenberg(t):
    m = re.search(r"\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*", t, re.S)
    if m:
        t = t[m.end():]
    for pat in (r"\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*",
                r"End of (?:the )?Project Gutenberg"):
        m = re.search(pat, t, re.S)
        if m:
            t = t[:m.start()]
    return t


def clean(s):
    s = " ".join(s.replace("’", "'").replace("‘", "'")
                 .replace("“", '"').replace("”", '"').split())
    return s


def ok_text(s):
    letters = sum(c.isalpha() or c.isspace() for c in s)
    return letters / max(1, len(s)) >= 0.88 and s.count("  ") == 0


def load_novels():
    """返回 (dialogs, narratives)，元素结构均为 (text, work, author)"""
    cat = {}
    if os.path.exists(CATALOG):
        cat = json.load(open(CATALOG, "r", encoding="utf-8")).get("map", {})
    dialogs, narratives = [], []
    for fn in sorted(os.listdir(NOVEL_DIR)):
        if not fn.endswith(".txt"):
            continue
        slug = fn[:-4]
        info = cat.get(slug, {})
        work = info.get("cn", slug)
        author = info.get("author", "")
        t = strip_gutenberg(open(os.path.join(NOVEL_DIR, fn), "r",
                                 encoding="utf-8", errors="ignore").read())
        t = re.sub(r"[ \t]+", " ", t)
        t = re.sub(r"(?<!\n)\n(?!\n)", " ", t)
        nd = nn = 0
        for para in t.split("\n\n"):
            para = para.strip()
            if len(para) < 40 or (para.isupper() and len(para) < 60):
                continue
            for chunk in split_sentences(para):
                c = clean(chunk)
                if not c or not ok_text(c):
                    continue
                if FRAG_TAIL.search(c.strip()):   # 尾部是称呼语 -> 被缩写句点切碎的残句
                    continue
                # 对话行 -> 口语例句候选
                for q in QUOTE_RE.findall(c):
                    q = clean(q.strip(" ,;:-"))
                    if 34 <= len(q) <= 170 and re.match(r"^[A-Z\"'(]", q) and ok_text(q):
                        if re.search(r"[.!?]\"?$", q) or "," in q:
                            dialogs.append((q, work, author))
                            nd += 1
                # 叙述句 -> 名著例句候选
                if 85 <= len(c) <= 230 and re.match(r"^[A-Z]", c) and c.count('"') <= 2:
                    if c[:7] != "CHAPTER":
                        narratives.append((c, work, author))
                        nn += 1
        print("   · %-24s 对话 %5d  叙述 %5d" % (slug, nd, nn))
    return dialogs, narratives


# ================================================== 4. 词形与派生 ==================================================


def variants(w):
    w = w.lower().strip()
    if not w:
        return []
    vs = {w}
    if w.endswith("y") and len(w) > 2 and w[-2] not in "aeiou":
        vs |= {w[:-1] + "ies", w[:-1] + "ied", w[:-1] + "ying"}
    for suf in ("s", "x", "ch", "sh", "o", "z"):
        if w.endswith(suf):
            vs.add(w + "es")
            break
    vs |= {w + "s", w + "ed", w + "ing"}
    if w.endswith("e"):
        vs |= {w[:-1] + "ing", w[:-1] + "ed"}
    if len(w) > 3 and w[-1] not in "aeiou" and w[-2] in "aeiou" and w[-3] not in "aeiou":
        vs |= {w + w[-1] + "ed", w + w[-1] + "ing"}
    return [v for v in vs if len(v) > 2]


DERIV = [["al", "ic", "ical", "ous", "ful", "less", "ive", "able", "ible", "ish", "ary",
          "ant", "ent", "en"],
         ["tion", "ation", "ition", "sion", "ment", "ance", "ence", "ure", "age", "er",
          "or", "al", "ing"],
         ["ness", "ity", "ty", "ance", "ence", "ism", "dom", "ship"],
         ["ive", "able", "ible", "ent", "ant", "ative", "atory"],
         ["ly"]]
PREFIX = ["un", "in", "im", "il", "ir", "dis", "non", "mis", "over", "under", "re"]


def adjust(w, s):
    if s in ("ness", "ly", "ful", "less", "ment") and w.endswith("y") \
            and len(w) > 2 and w[-2] not in "aeiou":
        return w[:-1] + "i" + s
    if s[0] in "aeiou" and w.endswith("e") and not w.endswith(("ee", "oe", "ye")):
        return w[:-1] + s
    if s in ("ing", "ed", "er", "able"):
        if w.endswith("e") and not w.endswith(("ee", "oe", "ye")):
            return w[:-1] + s
        if len(w) > 3 and w[-1] not in "aeiou" and w[-2] in "aeiou" and w[-3] not in "aeiou":
            return w + w[-1] + s
    return w + s


def gen_derivatives(word, lex, evidence):
    """派生词必须同时满足：① 在词表中存在 ② 在名著语料里真实出现过
    只用形态规则拼出来、语料中查无实据的（如 sourceful / sourceless）一律不收。"""
    w = word.lower()
    cand = []
    for sufs in DERIV:
        for s in sufs:
            for f in {adjust(w, s), w + s}:
                if f != w and f in lex and f in evidence:
                    cand.append(f)
    for p in PREFIX:
        if p + w in lex and (p + w) in evidence:
            cand.append(p + w)
    seen, out = set(), []
    for c in cand:
        if c not in seen and c != w and len(c) > len(w):
            seen.add(c)
            out.append(c)
    return out[:3]


STOP = set("""a an the and or but of to in on at for with from as by that this these those it
its is was are were be been being have has had do does did will would shall should can could
may might must not no nor so if then than there here he she they we you i him her them us me
my your his their our what which who whom when where why how all any both each few more most
other some such only own same too very just into about over under upon out up down off again
further once because while during before after above below shall thee thou thy ye hath doth
""".split())

TOK = re.compile(r"[a-z][a-z'’]+")


def build_collocations(targets, pool):
    """只记录含目标词的相邻二元组；方向编码 F|other / B|other"""
    coll = collections.defaultdict(collections.Counter)
    for s, w, a in pool:
        ts = TOK.findall(s.lower())
        for a_, b_ in zip(ts, ts[1:]):
            if a_ in targets and len(b_) > 2 and b_ not in STOP:
                coll[a_]["F|" + b_] += 1
            if b_ in targets and len(a_) > 2 and a_ not in STOP:
                coll[b_]["B|" + a_] += 1
    return coll


# ================================================== 5. 句子打分 ==================================================


def score_lit(s):
    n = len(s)
    sc = 100 - abs(n - 140) * 0.45
    if re.search(r"\b[A-Z]{3,}\b", s):
        sc -= 12
    if s.count(",") >= 2:
        sc += 6
    if re.search(r"[;:]", s):
        sc -= 4
    return sc


def score_oral(s):
    n = len(s)
    sc = 100 - abs(n - 85) * 0.6
    hits = len(SPOKEN.findall(s))
    sc += min(hits, 4) * 14
    sc += min(s.count("'"), 3) * 6
    if s.rstrip().endswith((".", "!", "?")):
        sc += 4
    if len(re.findall(r"\b[A-Z]{3,}\b", s)):
        sc -= 10
    return sc


def pick(forms, index, pool, score, span=22, gate=0):
    """在索引 pos 里挑最佳句子，返回 (idx, score)"""
    best, bi = -1e9, None
    for v in forms:
        for i in index.get(v, [])[:span]:
            sc = score(pool[i][0])
            if sc > best:
                best, bi = sc, i
        if bi is not None and best >= gate:
            break
    return bi, best


POS_HINT = (("ous", "adj."), ("ful", "adj."), ("less", "adj."), ("ive", "adj."),
            ("able", "adj."), ("ible", "adj."), ("ical", "adj."),
            ("tion", "n."), ("sion", "n."), ("ment", "n."), ("ness", "n."),
            ("ity", "n."), ("ance", "n."), ("ence", "n."), ("ism", "n."),
            ("ship", "n."), ("ise", "v."), ("ize", "v."), ("ify", "v."))


# 学术体语料（用于计算「雅思专属度」：学术散文 vs 虚构小说 的相对频次）
ACADEMIC_WORKS = {"物种起源", "论自由", "国富论", "理想国", "君主论"}
FREQ_LIST = os.path.join(ROOT, "corpus", "lexicon", "freq_en.txt")


def guess_pos(w):
    wl = w.lower()
    for suf, p in POS_HINT:
        if wl.endswith(suf):
            return p
    return "adv." if wl.endswith("ly") else ""


# ================================================== 6. 主流程 ==================================================


def daily_curve(total_days=60, warm=(10, 25, 50)):
    """每日新词量曲线：前 3 天适应期 10/25/50 词，第 4 天起匀速，
    60 天正好走完全部词条（不因起步轻松而削减总量）。"""
    return warm


def curve_for(total_words, total_days=60, warm=(10, 25, 50)):
    """按实际词条总量反推曲线：适应期固定，剩余天数均分，余数并入最后一天。"""
    counts = {}
    for i, n in enumerate(warm, start=1):
        counts[i] = n
    rest_days = total_days - len(warm)
    left = max(0, total_words - sum(warm))
    base = left // max(1, rest_days)
    for d in range(len(warm) + 1, total_days + 1):
        counts[d] = base
    counts[total_days] += left - base * rest_days   # 余数放最后一天
    return counts


AWL_FILE = os.path.join(ROOT, "scripts", "awl.json")
FUNC_WORDS = set("""a an the of to in on at is are was were be been being am do does did have has had
it its i you he she we they them him her me my your his our their this that these those and or
but if then than as by for with from not no nor so up out off ax ox pm am c e bt dvd gps""".split())


def build_awl_index():
    """返回 {词条小写: (sublist, is_headword)} —— AWL 570 词族 + 派生形态"""
    data = json.load(open(AWL_FILE, "r", encoding="utf-8"))["sublists"]
    idx, fam = {}, {}
    for sl, words in data.items():
        for hw in words:
            h = hw.lower()
            idx[h] = (int(sl), True)
            forms = {h + s for s in ("s", "es", "ed", "ing", "ly", "al", "ion", "able", "ive")}
            forms |= {adjust(h, s) for s in
                      ("s", "es", "ed", "ing", "ly", "al", "ion", "able", "ive",
                       "ation", "ally", "ity", "ness", "ise", "ize")}
            if h.endswith("y") and len(h) > 2 and h[-2] not in "aeiou":
                forms |= {h[:-1] + "ies", h[:-1] + "ied", h[:-1] + "iedly", h[:-1] + "ies"}
            for f in forms:
                if f != h:
                    fam.setdefault(f, (int(sl), False))
    for k, v in fam.items():
        idx.setdefault(k, v)
    return idx


def clean_wordlist(words, corpus_tokens, common_top):
    """两级划分，不做丢弃：
      tier1 语料可证 / 属英语最常用词表 —— 参与雅思优先级排序，排在前面
      tier2 语料未见（多为现代术语或待考词条）—— 后置为「拓展区」
    真正剔除的只有：长度<3、功能词、全大写缩写。"""
    tier1, tier2, dropped = [], [], collections.Counter()
    for w in words:
        s, low = w["word"], w["word"].lower()
        if len(s) < 3 or low in FUNC_WORDS:
            dropped["功能词/过短"] += 1
            continue
        if s.isupper():
            dropped["缩写"] += 1
            continue
        if corpus_tokens.get(low, 0) >= 1 or low in common_top or "-" in s:
            tier1.append(w)
        else:
            tier2.append(w)
    return tier1, tier2, dropped


def ielts_score_pool(narratives, words):
    """计算每个主词条的「雅思专属度」。
    由两部分合成：
      1) 学术度 = log(学术散文中相对频次 / 小说中相对频次)——学术体越占优越像雅思核心词
      2) 频段适配 = 太基础(<1500)或过于生僻(>14000)都减分，4000~10000 为佳
    全程确定性计算，不使用任何模型。"""
    rankmap = {}
    if os.path.exists(FREQ_LIST):
        rankmap = {w.strip(): i + 1 for i, w in
                   enumerate(open(FREQ_LIST, "r", encoding="utf-8", errors="ignore"))}

    acad = collections.Counter()
    fict = collections.Counter()
    for s, work, _a in narratives:
        bucket = acad if work in ACADEMIC_WORKS else fict
        for t in set(TOK.findall(s.lower())):
            bucket[t] += 1
    at = max(1, sum(acad.values()))
    ft = max(1, sum(fict.values()))

    scores = {}
    for w in words:
        forms = variants(w["word"])
        a = sum(acad.get(f, 0) for f in forms) + 3
        f = sum(fict.get(f, 0) for f in forms) + 3
        import math
        academic = math.log((a / at) / (f / ft))
        rk = rankmap.get(w["word"].lower(), 14000)
        if rk <= 1500:
            band = -6.0 + (rk / 1500.0) * 2.0
        elif rk <= 4000:
            band = 0.0
        elif rk <= 10000:
            band = 2.0
        elif rk <= 14000:
            band = 0.5
        else:
            band = -2.5
        scores[w["word"]] = academic * 3.0 + band
    return scores


def build():
    print("[1/7] 载入词表 …")
    words = load_words()
    print("       %d 条" % len(words))

    print("[2/7] 解析 KJV …")
    verses = parse_kjv(BIBLE)
    print("       %d 节经文；样例 %s" % (len(verses), list(verses.items())[0][0]))

    print("[3/7] 解析名著语料（对话 / 叙述）…")
    dialogs, narratives = load_novels()
    print("       对话 %d 句 / 叙述 %d 句" % (len(dialogs), len(narratives)))

    # ---- 清洗词表 + 计算雅思优先级（AWL 优先，其次学术度）
    lower_freq = collections.Counter()
    for s, _w, _a in narratives + dialogs:
        for t in TOK.findall(s.lower()):
            lower_freq[t] += 1
    common_top = set()
    if os.path.exists(FREQ_LIST):
        common_top = set(w.strip() for w in
                         open(FREQ_LIST, "r", encoding="utf-8", errors="ignore"))
    tier1, tier2, dropped = clean_wordlist(words, lower_freq, common_top)
    print("       主攻 %d 条 / 拓展 %d 条 / 剔除 %s" % (len(tier1), len(tier2), dict(dropped)))

    awl = build_awl_index()
    base = ielts_score_pool(narratives, tier1)

    def priority(w):
        key = w["word"].lower()
        if key in awl:
            sl, is_head = awl[key]
            return 10000.0 - sl * 100.0 - (0.0 if is_head else 0.5)
        return base.get(w["word"], 0.0)

    tier1.sort(key=priority, reverse=True)
    tier2.sort(key=lambda w: w["word"])
    words = tier1 + tier2

    counts = curve_for(len(words), TOTAL_DAYS)
    print("       每日新词：D1=%d D2=%d D3=%d，第 4 天起 %d/天，D60=%d，合计 %d" % (
        counts[1], counts[2], counts[3], counts[4], counts[60], sum(counts.values())))
    day_of, acc = {}, 0
    for d in range(1, TOTAL_DAYS + 1):
        for w in words[acc:acc + counts[d]]:
            day_of[w["word"]] = d
        acc += counts[d]
    covered = min(acc, len(words))
    print("       曲线覆盖 %d / %d 词条（其余进「冲刺/拓展库」）" % (covered, len(words)))
    print("       Day01 开局词：%s" % ", ".join(w["word"] for w in words[:12]))
    print("       AWL 命中率：%.1f%%" % (
        100.0 * sum(1 for w in words if w["word"].lower() in awl) / len(words)))


    print("[4/7] 载入校验词表 …")
    lex = set(l.strip().lower() for l in
              open(LEXICON, "r", encoding="utf-8", errors="ignore"))

    print("[5/7] 建立倒排索引 …")
    var2w = {}
    for w in words:
        for v in variants(w["word"]):
            var2w.setdefault(v, w["word"])
    targets = set(var2w)

    def index(pool, cap=36):
        idx = collections.defaultdict(list)
        for i, (s, w, a) in enumerate(pool):
            for t in set(TOK.findall(s.lower())):
                if t in targets and len(idx[t]) < cap:
                    idx[t].append(i)
        return idx

    d_ix = index(dialogs)
    n_ix = index(narratives)
    b_ix = collections.defaultdict(list)
    for ref, txt in verses.items():
        for t in set(TOK.findall(txt.lower())):
            if t in targets and len(b_ix[t]) < 50:
                b_ix[t].append(ref)
    print("       token：对话 %d / 叙述 %d / 经文 %d" % (len(d_ix), len(n_ix), len(b_ix)))

    print("[6/7] 统计搭配 …")
    coll = build_collocations(targets, narratives + dialogs)
    print("       %d 个词元命中搭配" % len(coll))

    print("[7/7] 装配 60 天 …")
    by_book = collections.defaultdict(list)
    for i, (s, w, a) in enumerate(narratives):
        by_book[w].append(s)

    days = collections.OrderedDict()
    stat = collections.Counter()
    sprint_words = []
    for w in words:
        forms = variants(w["word"])

        # 圣经例句
        bref, bsc = None, -1e9
        for v in forms:
            for ref in b_ix.get(v, [])[:26]:
                sc = score_lit(verses[ref][:240]) - abs(len(verses[ref]) - 130) * 0.2
                if sc > bsc:
                    bsc, bref = sc, ref
            if bref and bsc > 45:
                break
        if bref:
            bk = bref.rsplit(" ", 1)[0]
            w["_b"] = {"r": bref, "c": "%s %s" % (BOOK_CN.get(bk, bk), bref.rsplit(" ", 1)[1]),
                       "t": verses[bref][:260]}
            stat["bible"] += 1
        else:
            w["_b"] = None

        # 口语例句
        i, _ = pick(forms, d_ix, dialogs, score_oral, gate=70)
        if i is not None:
            w["_o"] = {"t": dialogs[i][0], "w": dialogs[i][1]}
            stat["oral"] += 1
        else:
            w["_o"] = None

        # 名著例句
        j, _ = pick(forms, n_ix, narratives, score_lit, gate=45)
        if j is not None:
            s, work, au = narratives[j]
            w["_q"] = {"t": s, "w": work, "a": au}
            stat["lit"] += 1
        else:
            w["_q"] = None

        # 派生 + 搭配
        w["_f"] = gen_derivatives(w["word"], lex, lower_freq)
        acc = collections.Counter()
        for v in forms:
            acc.update(coll.get(v, collections.Counter()))
        tops = []
        for key, n in acc.most_common(40):
            if n < 2:
                break
            dirn, other = key.split("|", 1)
            form = next((f for f in forms
                         if (dirn == "F" and coll.get(f, {}).get(key))
                         or (dirn == "B" and coll.get(f, {}).get(key))), None)
            if form is None:
                continue
            ph = "%s %s" % (form, other) if dirn == "F" else "%s %s" % (other, form)
            if ph not in tops:
                tops.append(ph)
            if len(tops) >= 3:
                break
        w["_c"] = tops

        stat["deriv"] += len(w["_f"])
        stat["coll"] += len(w["_c"])
        dz = day_of.get(w["word"])
        if dz:
            days.setdefault(dz, []).append(w)
        else:
            sprint_words.append(w)

    print("       已确定 %d 天词表（按雅思优先级排序）" % len(days))

    # ---- 篇章拓展阅读：选与该日词表重合度最高的连续段落
    order = sorted(by_book.keys())
    metas, drew = [], 0
    for d in range(1, TOTAL_DAYS + 1):
        ws = days.get(d, [])
        if not ws:
            continue
        toks = {v for w in ws for v in variants(w["word"])}
        best = None
        for k in range(8):
            bk = order[(d + k * 5) % len(order)]
            ss = by_book[bk]
            bb, bi = -1, None
            for i in range(0, len(ss) - 7):
                ch = " ".join(ss[i:i + 7])
                if not (650 <= len(ch) <= 2100):
                    continue
                hit = len(toks & set(TOK.findall(ch.lower())))
                if hit > bb:
                    bb, bi = hit, i
            if bi is not None and (best is None or bb > best[0]):
                best = (bb, {"title": bk, "author": (by_book and _author_of(bk, narratives)) or "",
                             "text": " ".join(ss[bi:bi + 7])})
        payload = {"d": d, "passage": best[1] if best else None, "words": []}
        if best:
            drew += 1
        for w in ws:
            payload["words"].append({
                "w": w["word"], "uk": w["uk"], "us": w["us"],
                "p": w["pos"] or guess_pos(w["word"]), "m": w["cn"],
                "f": w["_f"], "c": w["_c"], "o": w["_o"], "q": w["_q"], "b": w["_b"],
            })
        fn = os.path.join(OUT, "day-%02d.json" % d)
        json.dump(payload, open(fn, "w", encoding="utf-8"),
                  ensure_ascii=False, separators=(",", ":"))
        metas.append({"d": d, "n": len(ws), "size": os.path.getsize(fn)})
        sys.stdout.write("\r       day %02d / %d" % (d, TOTAL_DAYS))
        sys.stdout.flush()
    print()

    # ---- 曲线未覆盖的词条 -> 冲刺/拓展库（匀速模式下启用）
    if sprint_words:
        sp = {"d": 0, "title": "拓展/冲刺库", "passage": None,
              "words": [{"w": w["word"], "uk": w["uk"], "us": w["us"],
                         "p": w["pos"] or guess_pos(w["word"]), "m": w["cn"],
                         "f": w["_f"], "c": w["_c"], "o": w["_o"],
                         "q": w["_q"], "b": w["_b"]} for w in sprint_words]}
        fn = os.path.join(OUT, "sprint.json")
        json.dump(sp, open(fn, "w", encoding="utf-8"),
                  ensure_ascii=False, separators=(",", ":"))
        metas.append({"d": 61, "n": len(sprint_words), "size": os.path.getsize(fn),
                      "sprint": True})
        print("       冲刺/拓展库 sprint.json：%d 条" % len(sprint_words))

    json.dump({"name": "贝琪酱语无痛逆袭站", "totalDays": TOTAL_DAYS,
               "perDay": -(-sum(m["n"] for m in metas) // TOTAL_DAYS), "totalWords": sum(m["n"] for m in metas),
               "reviewIntervals": [1, 2, 4, 7, 15, 30], "days": metas,
               "stat": dict(stat)},
              open(os.path.join(OUT, "meta.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    print("\n完成：%d 天 / %d 主词条" % (len(metas), sum(m["n"] for m in metas)))
    print("  圣经 %d · 口语 %d · 名著 %d · 派生 %d · 搭配 %d · 篇章 %d" % (
        stat["bible"], stat["oral"], stat["lit"], stat["deriv"], stat["coll"], drew))


def _author_of(bk, narratives):
    for s, w, a in narratives:
        if w == bk:
            return a
    return ""


if __name__ == "__main__":
    build()
