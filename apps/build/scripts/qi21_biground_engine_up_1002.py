#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 大轮(1002)引擎起立 + object_info 验新接口(引擎管理员丁,10-02)。

先例 argv(两处同源,照抄仅口不变):
  - apps/build/scripts/qwen21_sancai_ab_1002.mjs:88-103(自拉配方);
  - .trellis/tasks/archive/2026-09/09-29-qi21-canvas-batch/research/
    s6-transparency-evidence.md:16-19(S6 §一同源配方,本口 17599 原始实录)。
  argv = <home>/venv/bin/python <home>/ComfyUI/main.py --listen 127.0.0.1
         --port 17599 --enable-manager --use-pytorch-cross-attention
         --gpu-only --reserve-vram 16 --input-directory <home>/input
         --output-directory <home>/output

双口探活(S6 同口径):17599(自拉)=200 / 17000(账本口,manifest.json:9)=down。

object_info 验新接口(design §1/§2 终态,任务=10-01-qi21-usetest-batch 大轮):
  ⑭ 槽序:三自研件连线槽前置(MyQi21PromptAssembly/PromptSelect/WhSuggest);
     底座件零连线槽(声明序维持,my_qi21_base.py:169-170);
  ⑰ tooltip:三件+底座件全控件(prd.md:167;rgba 顺带,speed 不在批);
  ⑱ 默认档:MyQi21SpeedSelect combo 首项=Fun-Acc 4步
     (my_qi21_speed_select.py:52-56 SPEED_MODES);
  ⑯/㉑ 负面槽:底座件无 型名/pe_clip/PE开关 槽;RETURN=BASE/WIDTH/HEIGHT/透明值;
  ㉑ PE启用?节点:[4012]=PrimitiveBoolean(子图内,已核 t2i 工作流 JSON)。

产物(证据落盘,apps/output/* gitignored .gitignore:122):
  apps/output/qi21-biground-1002/engine/{report.md,evidence.json,
  system_stats.json,object_info_slices.json}
引擎保持运行(供扩展验证与实弹);pid/log=/tmp/qi21-biground-1002/。
退出码:0=全绿;1=有红;2=环境错。并行会话零接触(本脚本只读仓库+引擎家)。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

HOME_COMFY = Path("~/Library/Application Support/漫影工作室/comfyui").expanduser()
REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "apps/output/qi21-biground-1002/engine"
RUNTIME = Path("/tmp/qi21-biground-1002")
PORT = 17599
LEDGER_PORT = 17000  # manifest.json "port"(engine_manager 账本口)
BASE = f"http://127.0.0.1:{PORT}"
LOG = RUNTIME / "engine.log"
PID_FILE = RUNTIME / "engine.pid"

SPEED_MODES_EXPECT = ["0 · Fun-Acc 4步", "1 · 直出40步", "2 · viggle"]

checks: list[dict] = []


def log(msg: str) -> None:
    print(f"[{datetime.now().isoformat(timespec='seconds')}] {msg}", flush=True)


def check(name: str, ok: bool, detail: str = "") -> bool:
    checks.append({"name": name, "pass": bool(ok), "detail": detail})
    log(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail[:400]}" if detail else ""))
    return ok


def http_json(url: str, timeout: float = 10.0):
    """GET → (status, json|None)。连接拒绝/超时返回 (None, None)。"""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            body = r.read()
            return r.status, json.loads(body)
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, TimeoutError, OSError):
        return None, None


def input_keys_order(node: dict) -> tuple[list[str], dict[str, list[str]]]:
    """object_info 节点 → (required 键序, {段: 键序})。"""
    inp = node.get("input", {})
    req = list(inp.get("required", {}) or {})
    opt = list(inp.get("optional", {}) or {})
    return req, {"required": req, "optional": opt}


def all_inputs(node: dict) -> dict[str, list]:
    inp = node.get("input", {})
    merged: dict[str, list] = {}
    for sec in ("required", "optional"):
        for k, v in (inp.get(sec) or {}).items():
            merged[k] = v
    return merged


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    RUNTIME.mkdir(parents=True, exist_ok=True)
    ev = {
        "role": "引擎管理员丁-起立+验新接口",
        "startedAt": datetime.now().isoformat(),
        "port": PORT,
        "argvPrecedent": "qwen21_sancai_ab_1002.mjs:88-103 + s6-transparency-evidence.md:16-19",
    }

    # ── 0. 起前盘点(S6 §一同口径;幂等复用本脚本自拉实例) ──────
    pg = subprocess.run(["pgrep", "-f", "ComfyUI/main.py"],
                        capture_output=True, text=True)
    existing = [p for p in pg.stdout.split() if p]
    mine = PID_FILE.exists() and PID_FILE.read_text().strip()
    proc = None
    if existing and mine in existing and http_json(f"{BASE}/system_stats", 4)[0] == 200:
        check("起前盘点:复用本脚本自拉实例(pidfile 命中且 17599 探活 200)",
              True, f"pid={mine}")
        ev["enginePid"] = int(mine)
        ev["reused"] = True
    else:
        if existing:
            log(f"环境错:外部 ComfyUI/main.py 进程 {existing}(非本脚本 pidfile "
                f"{mine})——复用/启停纪律冲突,不自拉")
            return 2
        check("起前盘点:全机无 ComfyUI/main.py 进程", True,
              "pgrep -f ComfyUI/main.py 空")

        # ── 1. 自拉引擎(先例 argv,口=17599) ──────────────────
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
                                start_new_session=True, env=env,
                                stdin=subprocess.DEVNULL)
        PID_FILE.write_text(str(proc.pid))
        ev["enginePid"] = proc.pid
        log(f"自拉引擎 pid={proc.pid} 口={PORT} 日志={LOG}")

    up = bool(ev.get("reused"))
    deadline = time.time() + 240
    while not up and time.time() < deadline:
        st, _ = http_json(f"{BASE}/system_stats", 4.0)
        if st == 200:
            up = True
            break
        if proc is not None and proc.poll() is not None:
            log(f"环境错:引擎进程早退 rc={proc.returncode},日志尾见 report")
            tail = subprocess.run(["tail", "-30", str(LOG)],
                                  capture_output=True, text=True).stdout
            ev["engineLogTail"] = tail
            (OUT / "evidence.json").write_text(
                json.dumps(ev, ensure_ascii=False, indent=2))
            print(tail)
            return 2
        time.sleep(3)
    if not check("引擎就绪 /system_stats@17599", up,
                 f"240s 内探活 {'200' if up else '超时'}"):
        (OUT / "evidence.json").write_text(json.dumps(ev, ensure_ascii=False, indent=2))
        return 1

    # ── 2. 双口探活 ────────────────────────────────────────────
    st_self, sysstats = http_json(f"{BASE}/system_stats", 8.0)
    check("双口·自拉口 17599 = 200", st_self == 200,
          f"comfyui {sysstats.get('system', {}).get('comfyui_version', '?')}"
          if sysstats else str(st_self))
    if sysstats:
        (OUT / "system_stats.json").write_text(
            json.dumps(sysstats, ensure_ascii=False, indent=2))
    st_ledger, _ = http_json(f"http://127.0.0.1:{LEDGER_PORT}/system_stats", 4.0)
    check(f"双口·账本口 {LEDGER_PORT} = down(无并行托管引擎)", st_ledger is None,
          f"探活={st_ledger}")
    ev["dualProbe"] = {"self": st_self, "ledger": st_ledger}

    # ── 3. object_info 验新接口 ────────────────────────────────
    st, oi = http_json(f"{BASE}/object_info", 30.0)
    if not check("GET /object_info 全量 = 200", st == 200, f"{st}"):
        (OUT / "evidence.json").write_text(json.dumps(ev, ensure_ascii=False, indent=2))
        return 1
    ev["objectInfoNodeCount"] = len(oi)

    slices: dict[str, dict] = {}

    def node(name: str):
        if name in slices:
            return slices[name]
        st2, one = http_json(f"{BASE}/object_info/{name}", 10.0)
        # per-node 端点顶层以节点名封包:{name: {...}} → 解包
        if isinstance(one, dict) and name in one:
            one = one[name]
        else:
            one = {"__status": st2}
        slices[name] = one
        return slices[name]

    # 3a. 底座件 MyQi21DaojieBase(⑯ 槽删+⑰ tooltip+四出定形)
    b = node("MyQi21DaojieBase")
    req, order = input_keys_order(b)
    check("底座件·槽序 = [base] + [透明覆盖]",
          req == ["base"] and order["optional"] == ["透明覆盖"],
          json.dumps(order, ensure_ascii=False))
    ins = all_inputs(b)
    banned = [k for k in ("型名", "pe_clip", "pe开关", "PE开关") if k in ins]
    check("底座件·负面槽不在场(型名/pe_clip/PE开关)", not banned, f"命中={banned}")
    tt = [k for k, v in ins.items() if len(v) > 1 and isinstance(v[1], dict)
          and v[1].get("tooltip")]
    check("底座件·全控件 tooltip(⑰:base+透明覆盖)",
          set(tt) >= {"base", "透明覆盖"}, f"带tooltip={tt}")
    check("底座件·四出定形 BASE/WIDTH/HEIGHT/透明值(⑯ 型名出删)",
          b.get("output_name") == ["BASE", "WIDTH", "HEIGHT", "透明值"],
          str(b.get("output_name")))

    # 3b. 装配全文件 MyQi21PromptAssembly(⑭ BASE 前置)
    a = node("MyQi21PromptAssembly")
    req, order = input_keys_order(a)
    check("装配件·槽序 = BASE→主体句→锁层A全文(⑭ 连线槽前置)",
          not req and order["optional"] == ["BASE", "主体句", "锁层A全文"],
          json.dumps(order, ensure_ascii=False))
    ins = all_inputs(a)
    tt = [k for k, v in ins.items() if len(v) > 1 and isinstance(v[1], dict)
          and v[1].get("tooltip")]
    check("装配件·全控件 tooltip(⑰ 三件)", len(tt) == 3, f"带tooltip={tt}")

    # 3c. 最终文本合成器 MyQi21PromptSelect(⑭ 两连线槽前置+lazy)
    s = node("MyQi21PromptSelect")
    req, order = input_keys_order(s)
    check("合成器·槽序 = 装配全文→PE出文→pe开关→透明模式→头句→尾句→W1收束句",
          not req and order["optional"] == ["装配全文", "PE出文", "pe开关", "透明模式",
                                            "RGBA官方头句", "RGBA官方尾句", "W1收束句"],
          json.dumps(order, ensure_ascii=False))
    ins = all_inputs(s)
    pe = ins.get("PE出文")
    check("合成器·PE出文 lazy=True(懒执行协议)",
          bool(pe) and len(pe) > 1 and isinstance(pe[1], dict)
          and pe[1].get("lazy") is True, str(pe))
    tt = [k for k, v in ins.items() if len(v) > 1 and isinstance(v[1], dict)
          and v[1].get("tooltip")]
    check("合成器·全控件 tooltip(⑰ 三件)", len(tt) == 7, f"带tooltip={tt}")

    # 3d. 画幅联动建议器 MyQi21WhSuggest(⑭ 三连线槽前置)
    w = node("MyQi21WhSuggest")
    req, order = input_keys_order(w)
    check("画幅件·槽序 = wh_ratio→九型WIDTH→九型HEIGHT→联动开关→手动宽→手动高",
          not req and order["optional"] == ["wh_ratio", "九型WIDTH", "九型HEIGHT",
                                            "联动开关", "手动宽", "手动高"],
          json.dumps(order, ensure_ascii=False))
    ins = all_inputs(w)
    wr = ins.get("wh_ratio")
    check("画幅件·wh_ratio lazy=True(pe关×联动关=[140]不进执行图)",
          bool(wr) and len(wr) > 1 and isinstance(wr[1], dict)
          and wr[1].get("lazy") is True, str(wr))
    tt = [k for k, v in ins.items() if len(v) > 1 and isinstance(v[1], dict)
          and v[1].get("tooltip")]
    check("画幅件·全控件 tooltip(⑰ 三件)", len(tt) == 6, f"带tooltip={tt}")

    # 3e. 加速档位 MyQi21SpeedSelect(⑱ 默认档 FunAcc 提首)
    sp = node("MyQi21SpeedSelect")
    mode = sp.get("input", {}).get("required", {}).get("mode")
    combo = list(mode[0]) if mode else []
    check("加速件·档序 = 0·Fun-Acc 4步 / 1·直出40步 / 2·viggle(⑱ 首项=默认)",
          combo == SPEED_MODES_EXPECT, str(combo))
    default = (mode[1] or {}).get("default") if mode and len(mode) > 1 else None
    check("加速件·默认 = 首项 Fun-Acc 4步",
          default == SPEED_MODES_EXPECT[0], str(default))
    req, order = input_keys_order(sp)
    check("加速件·三 latent 槽序 funacc/viggle/direct 全 lazy",
          order["optional"] == ["latent_funacc", "latent_viggle", "latent_direct"]
          and all(isinstance(v[1], dict) and v[1].get("lazy") is True
                  for v in sp.get("input", {}).get("optional", {}).values()),
          json.dumps(order, ensure_ascii=False))
    disp = oi.get("MyQi21SpeedSelect", {}).get("display_name")
    check("加速件·显示名含「默认Fun-Acc 4步」(__init__.py:157)",
          "Fun-Acc" in (disp or ""), str(disp))

    # 3f. RGBA 三态 MyQi21RgbaSelect(顺序维持;tooltip 顺带)
    r = node("MyQi21RgbaSelect")
    req, order = input_keys_order(r)
    check("RGBA件·槽序 = [mode] + [rgba_hint](⑭ 批外,序维持)",
          req == ["mode"] and order["optional"] == ["rgba_hint"],
          json.dumps(order, ensure_ascii=False))

    # 3g. PE启用?节点([4012]=PrimitiveBoolean,㉑)
    pb = node("PrimitiveBoolean")
    pb_ins = all_inputs(pb)
    check("PE启用?节点·PrimitiveBoolean 在册([4012] 类,"
          "t2i 子图已核 title='[4012] PE启用?' widgets=[true])",
          "value" in pb_ins, f"inputs={list(pb_ins)}")

    # 3h. 实弹前置件(S6 七件口径补充,软记录不设门)
    soft = {}
    for kw in ("PromptRewrite", "FunAcc", "RegexReplace", "showAnything"):
        soft[kw] = [k for k in oi if kw.lower() in k.lower()][:6]
    ev["livefirePreconditionNodes"] = soft
    log(f"实弹前置件(软记录): {json.dumps(soft, ensure_ascii=False)}")

    # ── 4. 证据落盘 + 汇总 ─────────────────────────────────────
    ev["checks"] = checks
    ev["finishedAt"] = datetime.now().isoformat()
    try:
        os.kill(int(PID_FILE.read_text().strip()), 0)
        ev["engineStillRunning"] = True
    except OSError:
        ev["engineStillRunning"] = False
    (OUT / "object_info_slices.json").write_text(
        json.dumps(slices, ensure_ascii=False, indent=2))
    (OUT / "evidence.json").write_text(json.dumps(ev, ensure_ascii=False, indent=2))

    fails = [c for c in checks if not c["pass"]]
    lines = [
        "# 引擎起立+object_info 验新接口(引擎管理员丁,10-02 大轮)",
        "",
        f"- 起立:pid={ev['enginePid']} 口=17599 先例argv(sancai 1002:88-103 / S6 evidence:16-19)"
        f"{'(本趟复用既有实例)' if ev.get('reused') else '(本趟自拉)'}",
        f"- 双口探活:17599={st_self}(200) / {LEDGER_PORT}(账本口)={st_ledger}",
        f"- object_info 节点总数:{ev['objectInfoNodeCount']}",
        f"- 引擎保持运行:{ev['engineStillRunning']}(供扩展验证与实弹;停机归收摊员)",
        f"- 日志:{LOG} pidfile:{PID_FILE}",
        "",
        "## 检查项",
        "",
        "| 结果 | 项 | 明细 |",
        "|---|---|---|",
    ]
    for c in checks:
        lines.append(f"| {'✅' if c['pass'] else '❌'} | {c['name']} | {c['detail'][:200]} |")
    lines += ["", f"**{len(checks) - len(fails)}/{len(checks)} 绿;"
              f"红 {len(fails)}**" + (f":{[c['name'] for c in fails]}" if fails else ""),
        ""]
    (OUT / "report.md").write_text("\n".join(lines))

    log(f"汇总:{len(checks) - len(fails)}/{len(checks)} 绿,证据={OUT}")
    return 0 if not fails else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
