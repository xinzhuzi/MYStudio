#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 单口战役(10-02-qi21-subgraph-singleport)引擎起立 + object_info 验单口新接口。

先例 argv 与骨架(逐段照抄,验点换本役):
  apps/build/scripts/qi21_biground_engine_up_1002.py(大轮引擎管理员丁)
  argv = <home>/venv/bin/python <home>/ComfyUI/main.py --listen 127.0.0.1
         --port 17599 --enable-manager --use-pytorch-cross-attention
         --gpu-only --reserve-vram 16 --input-directory <home>/input
         --output-directory <home>/output

object_info 验单口新接口(本役 design §1 终态):
  R1 MyQi21PromptSelect 单口:output=["STRING"] / output_name=["进编码文本"]
     (旧两口「最终文本/透明文本」绝迹);
  输入面 7 槽零漂(required 空+optional 序=装配全文/PE出文/pe开关/透明模式/
     RGBA官方头句/RGBA官方尾句/W1收束句;⑭ 槽序,单口化不动输入面);
  pe开关/透明模式 BOOLEAN default true/false;三固定句 multiline default 官方值。

前置(实弹收官员已做):引擎家部署副本 my_qi21_prompt_select.py 已同步仓库
单口版(diff 一致;两口旧版备份 apps/output/singleport-1002/engine/
deploy-backup-twoport.py)——在跑引擎热读引擎家副本(F5 口径)。

坑位对照:坑10(起前查占用,双口探活)/坑9(实弹在打包前)。
产物:apps/output/singleport-1002/engine/{evidence.json,system_stats.json}。
引擎保持运行(供前端验证+实弹三发);pid/log=/tmp/qi21-singleport-1002/。
退出码:0=全绿;1=有红;2=环境错。并行会话零接触(只读仓库+引擎家部署副本)。
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

HOME_COMFY = Path("~/Library/Application Support/漫影工作室/comfyui").expanduser()
REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "apps/output/singleport-1002/engine"
RUNTIME = Path("/tmp/qi21-singleport-1002")
PORT = 17599
LEDGER_PORT = 17000  # manifest.json "port"(engine_manager 账本口)
BASE = f"http://127.0.0.1:{PORT}"
LOG = RUNTIME / "engine.log"
PID_FILE = RUNTIME / "engine.pid"

SEL_EXPECT_OPT = ["装配全文", "PE出文", "pe开关", "透明模式",
                  "RGBA官方头句", "RGBA官方尾句", "W1收束句"]
SEL_EXPECT_OUT = ["进编码文本"]
RGBA_HEAD = "This is an RGBA format image with transparency."
RGBA_TAIL = "The image has an alpha channel and a transparent background."

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


def node(name: str) -> dict:
    st, one = http_json(f"{BASE}/object_info/{name}", 15.0)
    if isinstance(one, dict) and name in one:
        return one[name]
    return {"__status": st}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    RUNTIME.mkdir(parents=True, exist_ok=True)
    ev = {
        "role": "单口战役-引擎起立+object_info验单口",
        "startedAt": datetime.now().isoformat(),
        "port": PORT,
        "ledgerPort": LEDGER_PORT,
        "argvPrecedent": "qi21_biground_engine_up_1002.py(大轮引擎管理员丁)",
    }

    # ── 0. 起前盘点(坑10:占用即停,不自作主打断并行域) ────────
    pg = subprocess.run(["pgrep", "-f", "ComfyUI/main.py"], capture_output=True, text=True)
    existing = [p for p in pg.stdout.split() if p]
    mine = PID_FILE.exists() and PID_FILE.read_text().strip()
    proc = None
    if existing and mine in existing and http_json(f"{BASE}/system_stats", 4)[0] == 200:
        check("起前盘点:复用本脚本自拉实例(pidfile 命中且 17599 探活 200)", True, f"pid={mine}")
        ev["enginePid"] = int(mine)
        ev["reused"] = True
    else:
        if existing:
            log(f"环境错:外部 ComfyUI/main.py 进程 {existing}(非本脚本 pidfile {mine})——坑10 占用冲突,不自拉")
            return 2
        check("起前盘点:全机无 ComfyUI/main.py 进程(17599/17000 双空已另核)", True, "pgrep -f ComfyUI/main.py 空")

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

    # ── 2. 双口探活(17599 自拉=200 / 17000 账本口=down) ──
    st_self, sysstats = http_json(f"{BASE}/system_stats", 8.0)
    check("双口·自拉口 17599 = 200", st_self == 200,
          f"comfyui {sysstats.get('system', {}).get('comfyui_version', '?')}" if sysstats else str(st_self))
    if sysstats:
        (OUT / "system_stats.json").write_text(json.dumps(sysstats, ensure_ascii=False, indent=2))
    st_ledger, _ = http_json(f"http://127.0.0.1:{LEDGER_PORT}/system_stats", 4.0)
    check(f"双口·账本口 {LEDGER_PORT} = down(无并行托管引擎)", st_ledger is None, f"探活={st_ledger}")
    ev["dualProbe"] = {"self": st_self, "ledger": st_ledger}

    # ── 3. object_info 验单口新接口 ──
    st, oi = http_json(f"{BASE}/object_info", 30.0)
    if not check("GET /object_info 全量 = 200", st == 200, str(st)):
        (OUT / "evidence.json").write_text(json.dumps(ev, ensure_ascii=False, indent=2))
        return 1
    ev["objectInfoNodeCount"] = len(oi)

    sel = node("MyQi21PromptSelect")
    # 3a. R1 单口定形
    check("R1 单口·output = ['STRING'](恰一口)", sel.get("output") == ["STRING"], str(sel.get("output")))
    check("R1 单口·output_name = ['进编码文本'](旧两口绝迹)",
          sel.get("output_name") == SEL_EXPECT_OUT, str(sel.get("output_name")))

    # 3b. 输入面 7 槽零漂(required 空+optional 序)
    inp = sel.get("input", {})
    req = list(inp.get("required", {}) or {})
    opt = list(inp.get("optional", {}) or {})
    check("输入面·required 空(⑭ 全槽 optional 化保持)", req == [], str(req))
    check("输入面·optional 7 槽序零漂(装配全文/PE出文 前置+五参数下沉)",
          opt == SEL_EXPECT_OPT, json.dumps(opt, ensure_ascii=False))
    o = inp.get("optional", {})
    check("输入面·pe开关 BOOLEAN default=true / 透明模式 default=false",
          o.get("pe开关", [None, {}])[1].get("default") is True
          and o.get("透明模式", [None, {}])[1].get("default") is False,
          f"pe={o.get('pe开关', [None, {}])[1].get('default')};透明={o.get('透明模式', [None, {}])[1].get('default')}")
    check("输入面·PE出文 lazy=True(懒执行协议口面)",
          o.get("PE出文", [None, {}])[1].get("lazy") is True, str(o.get("PE出文", [None, {}])[1].get("lazy")))
    check("输入面·三固定句 multiline default 官方值",
          o.get("RGBA官方头句", [None, {}])[1].get("default") == RGBA_HEAD
          and o.get("RGBA官方尾句", [None, {}])[1].get("default") == RGBA_TAIL
          and bool(o.get("W1收束句", [None, {}])[1].get("default")),
          "头/尾逐字+W1非空")

    # 3c. 相邻件零漂(装配/底座——单口化只动 Select,输入面邻件验在役)
    asm = node("MyQi21PromptAssembly")
    check("邻件·装配全文件单口「装配全文」(零漂)",
          asm.get("output_name") == ["装配全文"], str(asm.get("output_name")))
    base = node("MyQi21DaojieBase")
    check("邻件·底座件四出 BASE/WIDTH/HEIGHT/透明值(零漂)",
          base.get("output_name") == ["BASE", "WIDTH", "HEIGHT", "透明值"], str(base.get("output_name")))

    # ── 4. 收官 ──
    failed = [c for c in checks if not c["pass"]]
    ev["finishedAt"] = datetime.now().isoformat()
    ev["checks"] = checks
    ev["allPass"] = not failed
    (OUT / "evidence.json").write_text(json.dumps(ev, ensure_ascii=False, indent=2))
    log("════ object_info 验单口汇总 ════")
    for c in checks:
        log(f"{'PASS' if c['pass'] else 'FAIL'}  {c['name']}")
    log(f"{'全绿' if not failed else f'失败 {len(failed)} 项'}(引擎保持运行 pid={ev.get('enginePid')})")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys_rc = main()
    raise SystemExit(sys_rc)
