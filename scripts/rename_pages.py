#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""仓库改名 beiqi-ielts -> becky-ielts，并在 Cloudflare 建 Pages 项目 becky-ielts。
令牌全部从本地文件读取，不打印、不入仓。"""
import os, re, ssl, json, base64, subprocess
import urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GH = r"F:\WorkBuddy\projects\DP08\密钥层\github.txt"
CF = r"F:\WorkBuddy\projects\DP04\密钥层\cloudflare_token.txt"
OWNER, OLD, NEW = "ezekielch", "beiqi-ielts", "becky-ielts"
ssl._create_default_https_context = ssl._create_unverified_context


def rd(p, must=True):
    if not os.path.exists(p):
        if must:
            raise SystemExit("缺少文件 " + p)
        return ""
    t = open(p, "r", encoding="utf-8").read().split()
    return re.sub(r"\s+", "", t[0]) if t else ""


def req(url, tok, method="GET", body=None, bearer=True):
    h = {"Accept": "application/vnd.github+json", "User-Agent": "deploy"}
    if tok:
        h["Authorization"] = ("Bearer " if bearer else "Basic ") + tok
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as x:
            return x.status, json.loads(x.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def gh(tok, path, method="GET", body=None):
    return req("https://api.github.com" + path, tok, method, body)


def cf(tok, path, method="GET", body=None):
    return req("https://api.cloudflare.com/client/v4" + path, tok, method, body)


def git(tok, *a):
    b = base64.b64encode(("%s:" % tok).encode()).decode().strip()
    return subprocess.run(["git", "-c", "http.extraHeader=Authorization: Basic " + b, *a],
                          cwd=ROOT, capture_output=True, text=True,
                          encoding="utf-8", errors="ignore")


print("=== 1. GitHub 仓库改名 ===")
ght = rd(GH)
st, r = gh(ght, "/repos/%s/%s" % (OWNER, NEW))
if st == 200:
    print("   已是 %s，跳过" % NEW)
else:
    st, r = gh(ght, "/repos/%s/%s" % (OWNER, OLD), "PATCH", {"name": NEW})
    if st != 200:
        raise SystemExit("改名失败 %s：%s" % (st, r.get("message")))
    print("   %s -> %s 完成" % (OLD, NEW))

git(ght, "remote", "remove", "origin")
git(ght, "remote", "add", "origin", "https://github.com/%s/%s.git" % (OWNER, NEW))
print("   本地 remote 已更新 ->", NEW)

print("\n=== 2. 重新开启 Pages ===")
st, r = gh(ght, "/repos/%s/%s/pages" % (OWNER, NEW), "POST",
           {"source": {"branch": "main", "path": "/"}})
print("   HTTP %s %s" % (st, "已开启" if st in (200, 201, 204) else (r.get("message") or "")))
print("   https://%s.github.io/%s/" % (OWNER, NEW))

print("\n=== 3. Cloudflare 账号 ===")
cft = rd(CF, must=False)
if not cft:
    raise SystemExit("未找到 Cloudflare 令牌：" + CF)
st, r = cf(cft, "/accounts")
accs = r.get("result", []) if st == 200 else []
if not accs:
    raise SystemExit("Cloudflare 账号查询失败 %s：%s" % (st, r.get("errors")))
acc = accs[0]
print("   账号：%s (%s)" % (acc.get("name"), acc.get("id")))
aid = acc["id"]

print("\n=== 4. 建 Pages 项目 becky-ielts ===")
st, r = cf(cft, "/accounts/%s/pages/projects" % aid, "POST", {
    "name": "becky-ielts",
    "production_branch": "main",
    "source": {"type": "github", "config": {
        "owner": OWNER, "repo_name": NEW, "production_branch": "main",
        "deployments_enabled": True, "preview_deployment_setting": "all",
        "pr_comments_enabled": True}},
    "build_config": {"build_command": "", "destination_dir": "", "root_dir": ""},
})
if st in (200, 201):
    p = r.get("result", {})
    print("   ✅ 创建成功")
    print("   https://becky-ielts.pages.dev")
    print("   仓库已连接：%s/%s" % (OWNER, NEW))
else:
    errs = r.get("errors") or []
    msg = errs[0].get("message") if errs else r.get("message")
    print("   ⚠️ HTTP %s：%s" % (st, msg))
    print("   （常见于 Cloudflare 尚未授权 GitHub 应用；需在 Cloudflare 面板点一次授权）")
