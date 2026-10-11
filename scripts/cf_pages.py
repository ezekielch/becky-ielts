#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""在 Cloudflare 建 Pages 项目 becky-ielts（令牌从本地文件读取，不打印、不入仓）。"""
import os, re, ssl, json
import urllib.request, urllib.error

CF = r"F:\WorkBuddy\projects\DP04\密钥层\cloudflare_token.txt"
NAME, OWNER, REPO = "becky-ielts", "ezekielch", "becky-ielts"
ssl._create_default_https_context = ssl._create_unverified_context


def load_kv(path):
    kv = {}
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        kv[k.strip().upper()] = v.strip().strip('"').strip("'")
    return kv


kv = load_kv(CF)
print("可用键：%s" % ", ".join(sorted(kv)))
TOKEN = next((v for k, v in kv.items() if "TOKEN" in k or k.endswith("API")), "")
ACCOUNT = next((v for k, v in kv.items() if "ACCOUNT" in k), "")
EMAIL = next((v for k, v in kv.items() if "EMAIL" in k or "MAIL" in k), "")
if not TOKEN:
    raise SystemExit("未找到 API TOKEN")


def call(path, method="GET", body=None):
    h = {"Content-Type": "application/json", "User-Agent": "cf-pages"}
    if len(TOKEN) == 40 and TOKEN.isalnum() and EMAIL:
        h["X-Auth-Email"], h["X-Auth-Key"] = EMAIL, TOKEN   # Global API Key
    else:
        h["Authorization"] = "Bearer " + TOKEN               # API Token
    r = urllib.request.Request("https://api.cloudflare.com/client/v4" + path,
                               data=json.dumps(body).encode() if body else None,
                               headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as x:
            return x.status, json.loads(x.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


# 账号级 API Token 调 /accounts 会返回空列表，此时直接用文件里的 ACCOUNT_ID
st, r = call("/accounts")
accs = r.get("result", [])
aid = ACCOUNT or (accs[0]["id"] if accs else "")
if not aid:
    raise SystemExit("拿不到 Account ID（/accounts 返回 %s，文件里也没有）" % st)
print("Account ID：%s %s" % (aid, "(来自令牌文件)" if ACCOUNT else "(来自 /accounts)"))

st, r = call("/accounts/%s/pages/projects" % aid, "POST", {
    "name": NAME, "production_branch": "main",
    "source": {"type": "github", "config": {
        "owner": OWNER, "repo_name": REPO, "production_branch": "main",
        "deployments_enabled": True, "preview_deployment_setting": "all",
        "pr_comments_enabled": True}},
    "build_config": {"build_command": "", "destination_dir": "", "root_dir": ""},
})
if st in (200, 201):
    print("✅ Pages 项目已创建：https://%s.pages.dev" % NAME)
else:
    errs = r.get("errors") or []
    print("HTTP %s：%s" % (st, errs[0].get("message") if errs else r.get("message")))
    if st == 403 or (errs and errs[0].get("code") in (9109, 10400)):
        print("→ 多半是 Cloudflare 侧还没授权 GitHub 应用，需在面板点一次授权。")
