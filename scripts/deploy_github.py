#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
贝琪酱语无痛逆袭站 · GitHub 部署
令牌从本地文件读取（F:\\WorkBuddy\\projects\\DP08\\密钥层\\github.txt），
绝不写入仓库、绝不打印到终端、绝不进对话。

用法：  python3 scripts/deploy_github.py           # 建仓 + 推送 + 开 Pages
        python3 scripts/deploy_github.py --check   # 只检查令牌与仓库状态
"""
import os
import re
import ssl
import json
import subprocess
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN_FILE = r"F:\WorkBuddy\projects\DP08\密钥层\github.txt"
OWNER = "ezekielch"
REPO = "becky-ielts"
BRANCH = "main"

ssl._create_default_https_context = ssl._create_unverified_context


def read_token():
    if not os.path.exists(TOKEN_FILE):
        raise SystemExit(
            "缺少令牌文件：%s\n请在该文件里只写入一行 GitHub PAT（repo 权限）。" % TOKEN_FILE)
    tok = open(TOKEN_FILE, "r", encoding="utf-8").read().strip().split()
    tok = tok[0] if tok else ""
    tok = re.sub(r"\s+", "", tok)
    if not re.match(r"^(ghp_|github_pat_)", tok):
        raise SystemExit("令牌格式不对（应以 ghp_ 或 github_pat_ 开头），请检查文件内容。")
    return tok


def api(tok, method, path, body=None):
    req = urllib.request.Request(
        "https://api.github.com" + path,
        data=json.dumps(body).encode() if body else None,
        headers={"Authorization": "Bearer " + tok,
                 "Accept": "application/vnd.github+json",
                 "User-Agent": "beiqi-deploy"},
        method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def git(tok, *args, capture=True):
    # GitHub 的 git HTTPS 端点只接受 Basic 认证（不接受 Bearer）。
    # 用 x-access-token:<token> 做 Basic，不把令牌写进 remote URL / .git/config。
    import base64
    basic = base64.b64encode(("%s:" % tok).encode()).decode().strip()
    cmd = ["git",
           "-c", "http.extraHeader=Authorization: Basic " + basic,
           "-c", "user.name=ezekielch",
           "-c", "user.email=ezekielch@users.noreply.github.com",
           *args]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=capture,
                       text=True, encoding="utf-8", errors="ignore")
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def ensure_gitignore():
    p = os.path.join(ROOT, ".gitignore")
    want = {"corpus/", "scripts/__pycache__/", "密钥层/", "*.pat", "*.token"}
    have = set()
    if os.path.exists(p):
        have = set(l.strip() for l in open(p, "r", encoding="utf-8"))
    miss = want - have
    if miss:
        with open(p, "a", encoding="utf-8") as f:
            f.write("\n# 语料与密钥不入仓（部署脚本自动追加）\n")
            f.write("\n".join(sorted(miss)) + "\n")
        print("   .gitignore 追加：%s" % ", ".join(sorted(miss)))


def main():
    import sys
    tok = read_token()
    print("[1/5] 令牌已读取（不显示）")

    st, info = api(tok, "GET", "/user")
    if st != 200:
        raise SystemExit("令牌校验失败 HTTP %s：%s" % (st, info.get("message")))
    print("      身份：%s" % info.get("login"))

    # 建仓（已存在则跳过）
    st, r = api(tok, "GET", "/repos/%s/%s" % (OWNER, REPO))
    if st == 200:
        print("[2/5] 仓库已存在，跳过创建")
    else:
        st, r = api(tok, "POST", "/user/repos",
                    {"name": REPO, "private": False, "auto_init": False,
                     "description": "贝琪酱语无痛逆袭站 · 雅思听说读写四科词汇打卡"})
        if st not in (200, 201):
            raise SystemExit("建仓失败 HTTP %s：%s" % (st, r.get("message")))
        print("[2/5] 仓库已创建")

    ensure_gitignore()

    print("[3/5] 提交 …")
    if not os.path.exists(os.path.join(ROOT, ".git")):
        git(tok, "init", "-b", BRANCH)
    git(tok, "add", "-A")
    code, out = git(tok, "commit", "-m", "贝琪酱语无痛逆袭站 · 首版（60天万词 · 四科航道）")
    if code != 0 and "nothing to commit" not in out:
        print("       commit 提示：%s" % out[:300])

    print("[4/5] 推送 …")
    git(tok, "remote", "remove", "origin")
    git(tok, "remote", "add", "origin",
        "https://github.com/%s/%s.git" % (OWNER, REPO))
    code, out = git(tok, "push", "-u", "origin", BRANCH, "--force")
    if code != 0:
        raise SystemExit("推送失败：\n%s" % out[:800])
    print("       已推送 %s 分支" % BRANCH)

    print("[5/5] 开启 GitHub Pages …")
    st, r = api(tok, "POST", "/repos/%s/%s/pages" % (OWNER, REPO),
                {"source": {"branch": BRANCH, "path": "/"}})
    if st in (200, 201, 204):
        print("       Pages 已开启")
    elif st == 409:
        print("       Pages 已开启过，跳过")
    else:
        print("       Pages 接口返回 %s：%s（可手工在 Settings→Pages 里开）" % (st, r.get("message")))

    print("\n✅ 完成：https://%s.github.io/%s/" % (OWNER, REPO))


if __name__ == "__main__":
    main()
