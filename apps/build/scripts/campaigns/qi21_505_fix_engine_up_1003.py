#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""505 修复实弹验证(1003)引擎起立 + object_info 双口径验名。

先例 argv 与骨架(逐段照抄):
  apps/build/scripts/qi21_singleport_engine_up_1002.py(单口战役引擎起立)
  argv = <home>/venv/bin/python <home>/ComfyUI/main.py --listen 127.0.0.1
         --port 17599 --enable-manager --use-pytorch-cross-attention
         --gpu-only --reserve-vram 16 --input-directory <home>/input
         --output-directory <home>/output
引擎协调(lora-facts.md:11):先探 17001/17000,有则复用不停,无则自拉
(venv 四参数+家目录);自拉的跑完只停自己的 pid(由收尾 kill 执行)。

本役验点(505 修复=type 带空格全称对齐引擎注册名):
  L1 object_info 新名 'Image Comparer (rgthree)' 在册(200+键在+输出面);
  L2 旧名 'ImageComparer (rgthree)' 绝迹(404)。
  静态链已核:引擎家 rgthree-comfy/py/image_comparer.py:9
  NAME=get_name('Image Comparer'),constants.py get_name='{} ({})'.format
  → 'Image Comparer (rgthree)'(带空格全称)。

坑位对照:坑10(起前查占用,pgrep+双口探活)。
产物:apps/output/505-fix-1003/engine/{evidence.json,system_stats.json}。
引擎保持运行(供装载验证+发弹);pid/log=/tmp/qi21-505-fix-1003/。
退出码:0=全绿;1=有红;2=环境错(占用冲突/早退)。
"""
from __future__ import annotations

import json
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

HOME_COMFY = Path("~/Library/Application Support/漫影工作室/comfyui").expanduser()
REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "apps/output/505-fix-1003/engine"
RUNTIME = Path("/tmp/qi21-505-fix-1003")
PORT = 17599
PROBE_PORTS = (17001, 17000, 8188)  # lora-facts.md:11 引擎协调探口
BASE = f"http://127.0.0.1:{PORT}"
LOG = RUNTIME / "engine.log"
PID_FILE = RUNTIME / "engine.pid"

NEW_NAME = "Image Comparer (rgthree)"  # 修复后真源 [505].type(带空格全称)
OLD_NAME = "ImageComparer (rgthree)"   # 26437ec 判死的无空格错名

checks: list[dict] = []


def log(msg: str) -> None:
    print(f"[{datetime.now().isoformat(timespec='seconds')}] {msg}", flush=True)


def check(name: str, ok: bool, detail: str = "") -> bool:
    checks.append({"name": name, "pass": bool(ok), "detail": detail})
    log(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail[:400]}" if detail else ""))
    return bool(ok)


def http_json(url: str, timeout: float = 10.0):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, TimeoutError, OSError):
        return None, None


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    RUNTIME.mkdir(parents=True, exist_ok=True)
    ev = {
        "role": "505修复实弹验证-引擎起立+object_info双口径验名",
        "startedAt": datetime.now().isoformat(),
        "port": PORT,
        "newName": NEW_NAME,
        "oldName": OLD_NAME,
        "staticChain": "rgthree-comfy/py/image_comparer.py:9 NAME=get_name('Image Comparer') "
                       "+ py/constants.py:5 '{} ({})'.format → 'Image Comparer (rgthree)'",
    }

    # ── 0. 起前盘点(坑10:占用即停,不自作主张打断并行域) ──
    pg = subprocess.run(["pgrep", "-f", "ComfyUI/main.py"], capture_output=True, text=True)
    existing = [p for p in pg.stdout.split() if p]
    mine = PID_FILE.exists() and PID_FILE.read_text().strip()
    proc = None
    if existing and mine in existing and http_json(f"{BASE}/system_stats", 4)[0] == 200:
        check("起前盘点:复用本脚本自拉实例(pidfile 命中且 17599 探活 200)", True, f"pid={mine}")
        ev["enginePid"] = int(mine)
        ev["reused"] = True
    else:
        # 引擎协调:先探兄弟口(17001/17000/8188),有则复用
        for pp in PROBE_PORTS:
            st, _ = http_json(f"http://127.0.0.1:{pp}/system_stats", 3.0)
            if st == 200:
                log(f"环境错:外部引擎在口 {pp}(pgrep={existing or '空'} 非 pidfile {mine})——坑10 占用冲突,不自拉")
                ev["blockedPort"] = pp
                (OUT / "evidence.json").write_text(json.dumps(ev, ensure_ascii=False, indent=2))
                return 2
        if existing:
            log(f"环境错:进程在但 17599 不通且非本脚本 pidfile(existing={existing},pidfile={mine})——不自拉")
            ev["existingPids"] = existing
            (OUT / "evidence.json").write_text(json.dumps(ev, ensure_ascii=False, indent=2))
            return 2
        check("起前盘点:全机无 ComfyUI/main.py 进程(17599+17001/17000/8188 全空)", True,
              "pgrep 空+四口探活全 down")

        # ── 1. 自拉引擎(先例 argv,口=17599) ──
        argv = [
            str(HOME_COMFY / "venv/bin/python"),
            str(HOME_COMFY / "ComfyUI/main.py"),
            "--listen", "127.0.0.1", "--port", str(PORT),
            "--enable-manager", "--use-pytorch-cross-attention",
            "--gpu-only", "--reserve-vram", "16",
            "--input-directory", str(HOME_COMFY / "input"),
            "--output-directory", str(HOME_COMFY / "output"),
        ]
        ev["argv"] = argv
        import os
        env = {**os.environ, "MYSTUDIO_COMFYUI_HOME": str(HOME_COMFY)}
        logf = open(LOG, "a")
        proc = subprocess.Popen(argv, stdout=logf, stderr=logf,
                                start_new_session=True, env=env, stdin=subprocess.DEVNULL)
        PID_FILE.write_text(str(proc.pid))
        ev["enginePid"] = proc.pid
        log(f"自拉引擎 pid={proc.pid} 口={PORT} 日志={LOG}")

    up = bool(ev.get("reused"))
    deadline = time.time() + 300
    while not up and time.time() < deadline:
        st, _ = http_json(f"{BASE}/system_stats", 4.0)
        if st == 200:
            up = True
            break
        if proc is not None and proc.poll() is not None:
            log(f"环境错:引擎进程早退 rc={proc.returncode}")
            tail = subprocess.run(["tail", "-30", str(LOG)], capture_output=True, text=True).stdout
            ev["engineLogTail"] = tail
            (OUT / "evidence.json").write_text(json.dumps(ev, ensure_ascii=False, indent=2))
            print(tail)
            return 2
        time.sleep(3)
    if not check("引擎就绪 /system_stats@17599", up, f"300s 内探活 {'200' if up else '超时'}"):
        (OUT / "evidence.json").write_text(json.dumps(ev, ensure_ascii=False, indent=2))
        return 1

    # ── 2. object_info 双口径验名 ──
    st, sysstats = http_json(f"{BASE}/system_stats", 8.0)
    if sysstats:
        (OUT / "system_stats.json").write_text(json.dumps(sysstats, ensure_ascii=False, indent=2))
    ev["comfyuiVersion"] = sysstats.get("system", {}).get("comfyui_version") if sysstats else None

    # L1 新名在册:单件查询 200 + 键在 + 输出面(IMAGE 出口,comparer result 口)
    st_new, oi_new = http_json(f"{BASE}/object_info/{urllib.request.quote(NEW_NAME)}", 15.0)
    has_new = isinstance(oi_new, dict) and NEW_NAME in oi_new
    check("L1 object_info 新名 'Image Comparer (rgthree)' 在册(HTTP 200+键在)",
          st_new == 200 and has_new, f"status={st_new};keys={list(oi_new)[:3] if isinstance(oi_new, dict) else oi_new}")
    if has_new:
        node = oi_new[NEW_NAME]
        check("L1b 新名输出面 IMAGE(comparer result 口,result=(image_a,)直通)",
              node.get("output") == ["IMAGE"], str(node.get("output")))
        check("L1c 新名 optional 双图口 image_a/image_b(required 空=纯预览无强制)",
              list(node.get("input", {}).get("optional", {})) == ["image_a", "image_b"]
              and node.get("input", {}).get("required", {}) == {},
              json.dumps(node.get("input", {}), ensure_ascii=False)[:300])
        check("L1d 新名 CATEGORY=rgthree(get_category())", node.get("category") == "rgthree",
              str(node.get("category")))

    # L2 旧名绝迹:单件查询 200+空体 {}=未知名统一形态(实测对照 Definitely.Not.A.Node.XYZ
    # 同返 200+{};ComfyUI 对未知名不回 404——首版断言期望 404 系取证口径错误,非链路红);
    # 权威判据=L2b 全量键集。
    st_old, oi_old = http_json(f"{BASE}/object_info/{urllib.request.quote(OLD_NAME)}", 15.0)
    check("L2a object_info 旧名 'ImageComparer (rgthree)' 绝迹(单件查询空体 {},未知名同形)",
          oi_old == {}, f"status={st_old};body={json.dumps(oi_old) if oi_old is not None else '(非JSON)'}")
    st_all, oi_all = http_json(f"{BASE}/object_info", 60.0)
    if isinstance(oi_all, dict):
        ev["objectInfoNodeCount"] = len(oi_all)
        check("L2b 全量 object_info 键集:旧名不在/新名恰 1",
              OLD_NAME not in oi_all and oi_all.get(NEW_NAME) is not None,
              f"nodes={len(oi_all)};旧名在={OLD_NAME in oi_all};新名在={NEW_NAME in oi_all}")
        rgthree_comparers = sorted(k for k in oi_all if "comparer" in k.lower())
        ev["rgthreeComparerKeys"] = rgthree_comparers
        check("L2c 引擎侧 comparer 家族恰新名一件(无别名双注册)",
              rgthree_comparers == [NEW_NAME], json.dumps(rgthree_comparers, ensure_ascii=False))
    else:
        check("L2b 全量 object_info 拉取", False, f"status={st_all}")

    # ── 3. 收官 ──
    failed = [c for c in checks if not c["pass"]]
    ev["finishedAt"] = datetime.now().isoformat()
    ev["checks"] = checks
    ev["allPass"] = not failed
    (OUT / "evidence.json").write_text(json.dumps(ev, ensure_ascii=False, indent=2))
    log("════ 引擎起立+验名汇总 ════")
    for c in checks:
        log(f"{'PASS' if c['pass'] else 'FAIL'}  {c['name']}")
    log(f"{'全绿' if not failed else f'失败 {len(failed)} 项'}(引擎保持运行 pid={ev.get('enginePid')})")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
