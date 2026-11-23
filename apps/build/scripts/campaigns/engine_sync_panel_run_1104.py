#!/usr/bin/env python3
"""1104 交接#1 全量插件同步实弹驱动(一次性运维)。

照抄引擎同步面板口径(McpSettingsTab.startEngineSync):
- 取 GET /comfy/ssh/engine-sync-manifest 清单
- 同步集合 = status in (both, mac-only)(win-only 恒不同步 Q1;skip 不渲染)
- 逐件串行 POST /comfy/ssh/sync-engine {items:[name], timeoutS:剩余秒}
- 30min 全局预算跨件生效;单件失败不拦后续(C8)

用法: python3 engine_sync_panel_run_1104.py [--budget-seconds 1800]
幂等: skip-if-latest 已装件重跑即跳过,中断可续。
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SIDECAR = "http://127.0.0.1:17595"
TOKEN_PATH = Path.home() / "Library/Application Support/漫影工作室/python/profiles/image-gen/config.json"


def local_token() -> str:
    return json.loads(TOKEN_PATH.read_text(encoding="utf-8"))["controlToken"]


def call(method: str, path: str, token: str, body: dict | None = None, timeout: float = 30.0) -> dict:
    req = urllib.request.Request(
        SIDECAR + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"X-Manying-Image-Token": token, "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        try:
            return json.loads(exc.read().decode())
        except Exception:
            return {"error": {"message": f"HTTP {exc.code}"}}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--budget-seconds", type=int, default=1800)
    args = parser.parse_args()

    token = local_token()
    manifest = call("GET", "/comfy/ssh/engine-sync-manifest", token, timeout=60)
    if "error" in manifest:
        print("取清单失败:", manifest["error"], file=sys.stderr)
        return 1
    items = manifest["items"]
    names = [i["name"] for i in items if i["status"] in ("both", "mac-only")]
    print(f"清单 {len(items)} 件;面板口径将同步 {len(names)} 件(both+mac-only);win-only/skip 不同步")
    if not names:
        print("无可同步件")
        return 0

    # 断线重连配方(实弹 1104:TCP 中途被掐→paramiko EOF→「SSH session not active」;
    # 面板语义=人工点 SSH 行重连,运维驱动自动等价物=重放当前 ssh-remote.json)
    ssh_config_path = Path.home() / "Library/Application Support/漫影工作室/comfyui/ssh-remote.json"

    def reconnect() -> bool:
        cfg = json.loads(ssh_config_path.read_text(encoding="utf-8"))
        res = call("POST", "/comfy/ssh/config", token, cfg, timeout=30)
        if "error" in res:
            print("  ⚠️ 重连失败:", res["error"], file=sys.stderr)
            return False
        time.sleep(2)
        return True

    deadline = time.monotonic() + args.budget_seconds
    results: list[dict] = []
    for idx, name in enumerate(names, 1):
        remaining = int(deadline - time.monotonic())
        if remaining <= 0:
            print(f"[{idx}/{len(names)}] {name}: 整体超时,未同步")
            results.append({"name": name, "status": "整体超时,未同步"})
            continue
        for attempt in (1, 2):
            started = time.monotonic()
            res = call("POST", "/comfy/ssh/sync-engine", token, {"items": [name], "timeoutS": remaining}, timeout=remaining + 30)
            took = time.monotonic() - started
            msg = str(res.get("error", {}).get("message", "")) if isinstance(res.get("error"), dict) else ""
            if msg and ("session not active" in msg or "SSH 未连接" in msg) and attempt == 1:
                print(f"[{idx}/{len(names)}] {name}: SSH 断线({msg}),自动重连后续跑")
                if reconnect():
                    continue
            break
        if "error" in res:
            print(f"[{idx}/{len(names)}] {name}: ❌ {res['error'].get('message', res['error'])} ({took:.1f}s)")
            results.append({"name": name, "error": str(res["error"].get("message"))})
            continue
        row = res.get("results", [res])[0] if isinstance(res.get("results"), list) else res
        # 回执字段照 EngineSyncResultItem:name/type/action/status/macHead/winHead/detail
        action = row.get("action") or row.get("status") or "?"
        detail = row.get("detail") or ""
        print(f"[{idx}/{len(names)}] {name}: {action} ({took:.1f}s){' — ' + detail if detail else ''}")
        results.append(row)

    ok = sum(1 for r in results if not r.get("error") and "超时" not in str(r.get("status", "")))
    print(f"\n汇总: {ok}/{len(names)} 件完成;失败 {sum(1 for r in results if r.get('error'))} 件")
    failed = [r for r in results if r.get("error") or "超时" in str(r.get("status", ""))]
    for r in failed:
        print("  ✗", r.get("name"), r.get("error") or r.get("status"))
    return 0 if not failed else 2


if __name__ == "__main__":
    raise SystemExit(main())
