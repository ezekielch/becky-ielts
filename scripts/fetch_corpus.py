#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
贝琪酱雅思英语无痛逆袭站 · 语料抓取
仅抓取公有领域文本：Project Gutenberg（1929 年前出版 / 美国公版）。
版权约束：非 PD 的现代作品（如 Orwell 1984、Hemingway 老人与海）请自行把合法文本
放到 corpus/novels/ 目录，本脚本不会去下载它们。
"""
import os
import re
import ssl
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIBLE_DIR = os.path.join(ROOT, "corpus", "bible")
NOVEL_DIR = os.path.join(ROOT, "corpus", "novels")
os.makedirs(BIBLE_DIR, exist_ok=True)
os.makedirs(NOVEL_DIR, exist_ok=True)

ssl._create_default_https_context = ssl._create_unverified_context
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

# 圣经（公有领域）
BIBLES = {
    "KJV": "https://www.gutenberg.org/cache/epub/10/pg10.txt",
}

# 名著语料：全部为美国公有领域（出版 <= 1929）
# id: (文件名, 书名中文, 作者)
NOVELS = {
    1342: ("austen_pride", "傲慢与偏见", "Jane Austen"),
    1260: ("bronte_jane_eyre", "简·爱", "Charlotte Bronte"),
    768:  ("bronte_wuthering", "呼啸山庄", "Emily Bronte"),
    158:  ("austen_emma", "爱玛", "Jane Austen"),
    105:  ("austen_persuasion", "劝导", "Jane Austen"),
    161:  ("austen_sense", "理智与情感", "Jane Austen"),
    141:  ("austen_mansfield", "曼斯菲尔德庄园", "Jane Austen"),
    2701: ("melville_moby", "白鲸", "Herman Melville"),
    84:   ("shelley_frankenstein", "弗兰肯斯坦", "Mary Shelley"),
    98:   ("dickens_two_cities", "双城记", "Charles Dickens"),
    1400: ("dickens_expectations", "远大前程", "Charles Dickens"),
    730:  ("dickens_oliver", "雾都孤儿", "Charles Dickens"),
    766:  ("collins_moonstone", "月亮宝石", "Wilkie Collins"),
    345:  ("stoker_dracula", "德古拉", "Bram Stoker"),
    174:  ("wilde_dorian", "道林·格雷的画像", "Oscar Wilde"),
    11:   ("carroll_alice", "爱丽丝梦游仙境", "Lewis Carroll"),
    1661: ("doyle_sherlock", "福尔摩斯冒险史", "Arthur Conan Doyle"),
    2852: ("doyle_baskervilles", "巴斯克维尔的猎犬", "Arthur Conan Doyle"),
    244:  ("doyle_scarlet", "血字的研究", "Arthur Conan Doyle"),
    1184: ("dumas_monte_cristo", "基督山伯爵", "Alexandre Dumas"),
    219:  ("conrad_darkness", "黑暗的心", "Joseph Conrad"),
    2600: ("tolstoy_war_peace", "战争与和平", "Leo Tolstoy"),
    1727: ("homer_odyssey", "奥德赛", "Homer (S. Butler trans.)"),
    203:  ("wells_time_machine", "时间机器", "H. G. Wells"),
    35:   ("wells_war_worlds", "世界大战", "H. G. Wells"),
    164:  ("baum_oz", "绿野仙踪", "L. Frank Baum"),
    45:   ("montgomery_anne", "绿山墙的安妮", "L. M. Montgomery"),
    521:  ("kipling_kim", "基姆", "Rudyard Kipling"),
    4363: ("xueqin_red_chamber", "红楼梦", "Cao Xueqin (trans.)"),
    215:  ("wilde_earnest", "不可儿戏", "Oscar Wilde"),
    1232: ("machiavelli_prince", "君主论", "Niccolo Machiavelli"),
    1497: ("plato_republic", "理想国", "Plato (B. Jowett trans.)"),
    3300: ("smith_wealth", "国富论", "Adam Smith"),
    1228: ("darwin_origin", "物种起源", "Charles Darwin"),
    34901:("mill_liberty", "论自由", "John Stuart Mill"),
    2814: ("joyce_dubliners", "都柏林人", "James Joyce"),
    4217: ("joyce_portrait", "一个青年艺术家的画像", "James Joyce"),
    2814.1: ("doyle_lost_world", "失落的世界", "Arthur Conan Doyle"),
}

# 带小数 key 的补%)
EXTRA = {
    1080: ("swift_modest_proposal", "一个温和的建议", "Jonathan Swift"),
    2542: ("ibsen_doll_house", "玩偶之家", "Henrik Ibsen"),
    2542.1: ("ibc", "_skip_", "_"),
}


def http_get(url, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except Exception as e:
            if i == retries - 1:
                print("  FAIL", url, e)
                return None
            time.sleep(2 + i * 2)
    return None


def fetch_bible(item):
    key, url = item
    path = os.path.join(BIBLE_DIR, key + ".txt")
    if os.path.exists(path) and os.path.getsize(path) > 500000:
        print("  [skip]", key)
        return key, True
    data = http_get(url)
    if data:
        with open(path, "wb") as f:
            f.write(data)
        print("  [ok]", key, len(data))
        return key, True
    return key, False


def fetch_novel(item):
    gid, (slug, cn, author) = item
    if slug == "_skip_":
        return None
    path = os.path.join(NOVEL_DIR, "%s.txt" % slug)
    if os.path.exists(path) and os.path.getsize(path) > 20000:
        print("  [skip]", slug)
        return None
    for tmpl in (
        "https://www.gutenberg.org/cache/epub/%d/pg%d.txt",
        "https://www.gutenberg.org/files/%d/%d-0.txt",
        "https://www.gutenberg.org/files/%d/%d.txt",
    ):
        url = tmpl % (gid, gid)
        data = http_get(url, retries=2)
        if data and len(data) > 20000 and b"This file should be named" not in data[:2000] or (data and len(data) > 20000):
            with open(path, "wb") as f:
                f.write(data)
            print("  [ok]", slug, len(data))
            return slug
    print("  [404]", slug, gid)
    return None


def main():
    print("== 1/2 下载圣经 ==")
    with ThreadPoolExecutor(max_workers=3) as ex:
        list(ex.map(fetch_bible, BIBLES.items()))

    print("== 2/2 下载名著 ==")
    items = [(k, v) for k, v in NOVELS.items() if isinstance(k, int)]
    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(fetch_novel, items))

    nb = len(os.listdir(BIBLE_DIR))
    nn = len(os.listdir(NOVEL_DIR))
    print("\n完成：圣经 %d 份，名著 %d 份" % (nb, nn))


if __name__ == "__main__":
    main()
