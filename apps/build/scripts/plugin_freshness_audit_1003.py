#!/usr/bin/env python3
"""1003 插件新鲜度审计(只读):引擎家 custom_nodes 各 git 插件 + ComfyUI 本体 vs 上游。

fetch 仅更新 refs/remotes(远端追踪引用),不改工作树、不改安装版本。
输出 TSV: name|behind|ahead|head_sha|upstream_sha|local_date|remote_date|status
status ∈ ok(落后0) / behind / ahead(本地超前=改造件或钉版新) / fetch-fail / no-upstream
"""
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

CN = os.path.expanduser("~/Library/Application Support/漫影工作室/comfyui/ComfyUI")
TARGETS = [os.path.join(CN, "custom_nodes", d) for d in sorted(os.listdir(os.path.join(CN, "custom_nodes")))]
TARGETS.append(CN)  # ComfyUI 本体
SKIP = ("__pycache__",)
ENV = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}


def git(repo: str, *args: str, timeout: int = 60) -> str:
    r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, timeout=timeout, env=ENV)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:200])
    return r.stdout.strip()


def probe(repo: str) -> str:
    name = os.path.basename(repo)
    if name in SKIP:
        return None
    # fetch:先直连,败则走本机代理 7897
    for env in (ENV, {**ENV, "https_proxy": "http://127.0.0.1:7897", "http_proxy": "http://127.0.0.1:7897"}):
        r = subprocess.run(["git", "-C", repo, "fetch", "origin", "--quiet", "--prune"],
                           capture_output=True, text=True, timeout=90, env=env)
        if r.returncode == 0:
            break
    else:
        return f"{name}|0|0|?|?|?|?|fetch-fail"
    head = git(repo, "rev-parse", "--short", "HEAD")
    # 上游分支:@{u} 优先,退化 origin/main → origin/master
    up = None
    try:
        up = git(repo, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    except Exception:
        for cand in ("origin/main", "origin/master"):
            try:
                git(repo, "rev-parse", "--verify", cand)
                up = cand
                break
            except Exception:
                continue
    if not up:
        return f"{name}|0|0|{head}|?|?|?|no-upstream"
    behind = git(repo, "rev-list", "--count", f"HEAD..{up}")
    ahead = git(repo, "rev-list", "--count", f"{up}..HEAD")
    ldate = git(repo, "log", "-1", "--format=%cs", "HEAD")
    rdate = git(repo, "log", "-1", "--format=%cs", up)
    up_sha = git(repo, "rev-parse", "--short", up)
    status = "ok" if behind == "0" else ("ahead" if ahead != "0" and behind != "0" else "behind")
    if behind == "0" and ahead != "0":
        status = "local-ahead"
    return f"{name}|{behind}|{ahead}|{head}|{up_sha}|{ldate}|{rdate}|{status}"


def main() -> int:
    repos = [t for t in TARGETS if os.path.isdir(t)]
    with ThreadPoolExecutor(max_workers=8) as ex:
        rows = [r for r in ex.map(probe, repos) if r]
    rows.sort(key=lambda r: -(int(r.split("|")[1]) if r.split("|")[7] not in ("fetch-fail", "no-upstream") else -1))
    print("name|behind|ahead|head|upstream|local_date|remote_date|status")
    for r in rows:
        print(r)
    return 0


if __name__ == "__main__":
    sys.exit(main())
