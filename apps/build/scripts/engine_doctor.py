#!/usr/bin/env python3
"""engine_doctor —— 引擎侧只读诊断聚合(四段;research/04 证据D:诊断曾是每次手敲 pgrep+curl 拼盘)。

出处:2026-09-28 任务 09-28-process-formalization S8(R7.4;design §11;prd AC12)。
用法:
  python3 engine_doctor.py [--json]

四段(全只读——本工具零改写、零杀进程;可 spawn 的命令白名单=pgrep/ps/lsof):
  1. pgrep 盘点:三关键词 ComfyUI/main.py(引擎)/daojie_engine_keeper(keeper)/
     image_gen.main(image sidecar);逐 pid 打印 argv 全文+托管/手动判据(argv 含
     「漫影工作室」装机家路径=托管,同 install-and-smoke.mjs killDetachedComfyEngines
     收编判据;否则=手动嫌疑)+ --port 提取。
  2. 端口探活:候选口=引擎 manifest 记账口(<userData>/comfyui/manifest.json 的
     engine.port)∪ 盘点 argv 的 --port ∪ lsof 17xxx 家族在听口(17000-17999,
     保留段 17595/17598=桥,engine_manager.PORT_RANGE 同源);逐口 GET /system_stats
     (超时 2s 容错;形状判据同 engine_manager._orphan_is_comfyui:dict 且含
     system/devices=ComfyUI 引擎);不可达=引擎 down 合法态,不判红。探活/取桥
     配置恒直连(无代理 opener 禁 http_proxy 等 env 代理,2026-09-29 修复:
     代理在场曾把回环探活路由进代理 → false GREEN+双 RED 致盲)。
  3. 桥 token 一致性:<userData>/python/profiles/image-gen/config.json 的
     controlToken(装机令牌落盘真源,bridge_contract.sidecar_control_token 同路径)
     vs 每个活引擎 /my_bridge/config 回显 bridgeToken——match/mismatch/不可达三态;
     mismatch=RED(自愈未覆盖的矛盾态)。令牌字面量绝不入输出/报告(只记长度)。
  4. 双引擎并存检测:活引擎口 ≥2=RED(同引擎多活口=矛盾态)。

收尾块:「干完即停」命令清单(pkill 家族+逐口验 down)——只打印,绝不执行
(破坏性操作铁律;杀进程由人执行裁定)。
退出码:引擎 down=合法态,退出 0+状态表如实;仅「双引擎并存」或「token mismatch」=RED 退出 1。
--json:报告落 apps/output/automation/engine-doctor-report.json。
"""
from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

SCRIPTS = pathlib.Path(__file__).resolve().parent
REPO = SCRIPTS.parents[2]  # 房子写法同 preflight_gate.py(防 apps/ 错位复发)
REPORT_JSON = REPO / "apps" / "output" / "automation" / "engine-doctor-report.json"
USER_DATA = pathlib.Path.home() / "Library" / "Application Support" / "漫影工作室"
CONFIG_JSON = USER_DATA / "python" / "profiles" / "image-gen" / "config.json"
ENGINE_MANIFEST = USER_DATA / "comfyui" / "manifest.json"
PORT_START, PORT_END = 17000, 17999          # engine_manager.PORT_RANGE_START/END 同源
RESERVED_BRIDGE_PORTS = (17595, 17598)       # engine_manager.RESERVED_PORTS 同源(桥段位)
PROBE_TIMEOUT_S = 2.0                        # engine_manager.is_healthy 同源超时
PGREP_PATTERNS = {                           # 引擎/keeper/sidecar 三关键词(research/04 仪式)
    "engine": "ComfyUI/main.py",
    "keeper": "daojie_engine_keeper",
    "sidecar": "image_gen.main",
}
# 只读盘点白名单:本工具能 spawn 的命令仅此三件;pkill/kill/osascript 零路径
# (收尾清单只以打印字符串形态存在,build-scripts.test.ts 锁定本行)。
_RUN_ALLOWLIST = frozenset({"pgrep", "ps", "lsof"})
TAG = "[doctor]"


def _sh(cmd: list[str], timeout_s: float = 10) -> subprocess.CompletedProcess:
    if cmd[0] not in _RUN_ALLOWLIST:  # 防御:结构性保证只读(白名单外拒绝执行)
        raise RuntimeError(f"engine_doctor 白名单外命令被拒:{cmd[0]}(只读铁律)")
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_s)


# ── 段1 pgrep 盘点 ───────────────────────────────────────────────────────────


def snap_processes() -> dict:
    inventory: dict[str, list] = {}
    for kind, pattern in PGREP_PATTERNS.items():
        found: list[dict] = []
        proc = _sh(["pgrep", "-f", pattern])
        if proc.returncode == 0:
            for pid_line in proc.stdout.strip().splitlines():
                pid = pid_line.strip()
                if not pid:
                    continue
                argv = ""
                try:
                    argv = _sh(["ps", "-ww", "-o", "command=", "-p", pid]).stdout.strip()
                except (subprocess.SubprocessError, RuntimeError):
                    pass  # 进程刚退场=盘点瞬态,如实留空 argv
                if not argv:
                    argv = f"(argv 不可取——进程可能刚退场,pid={pid})"
                managed = "漫影工作室" in argv  # 装机家路径判据(同 install-and-smoke)
                port_match = re.search(r"--port[= ](\d+)", argv)
                found.append({"pid": pid, "argv": argv,
                              "managed": managed,
                              "verdict": "托管" if managed else "手动嫌疑",
                              "port": int(port_match.group(1)) if port_match else None})
        inventory[kind] = found
    return inventory


# ── 段2 端口探活 ─────────────────────────────────────────────────────────────


def recorded_port() -> int | None:
    try:
        manifest = json.loads(ENGINE_MANIFEST.read_text(encoding="utf-8"))
        port = manifest.get("engine", {}).get("port")
        return int(port) if isinstance(port, int) else None
    except (OSError, ValueError, TypeError):
        return None


def listening_ports() -> list[dict] | None:
    """lsof 列 17xxx 家族在听口(进程名一并盘点);lsof 不可用=None 容错跳过。"""
    proc = _sh(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"], timeout_s=30)
    if proc.returncode != 0:
        return None
    rows: list[dict] = []
    for line in proc.stdout.splitlines():
        match = re.search(r"TCP\s+\S*:(\d+)\s+\(LISTEN\)", line)
        if not match:
            continue
        port = int(match.group(1))
        if PORT_START <= port <= PORT_END:
            rows.append({"port": port, "process": line.split()[0] if line.split() else "?"})
    return rows


# 回环探活/取桥配置禁走代理(2026-09-29 修复):裸 urlopen 吃 http_proxy 等 env
# 代理变量(Python darwin 的 proxy_bypass 在 env 代理在场时只查 env no_proxy)——
# 代理在场时 127.0.0.1 探活被路由进代理 → 活引擎整体误判 unreachable → false
# GREEN 退出 0,且 dual_engine/token_mismatch 两个 RED(均派生自 live_ports)被
# 结构性致盲。无代理 opener(ProxyHandler({}))恒直连,与目标恒为回环地址匹配。
_DIRECT_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _get_json(url: str) -> dict | None:
    with _DIRECT_OPENER.open(url, timeout=PROBE_TIMEOUT_S) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    return body if isinstance(body, dict) else None


def probe_port(port: int) -> dict:
    """GET /system_stats;不可达/超时/非 JSON=容错记 unreachable(引擎 down 合法态)。"""
    try:
        stats = _get_json(f"http://127.0.0.1:{port}/system_stats")
    except Exception as exc:  # noqa: BLE001(超时/拒连/坏 JSON 全=不可达容错,不吞其余段)
        return {"port": port, "state": "unreachable", "detail": type(exc).__name__}
    comfyui = isinstance(stats, dict) and ("system" in stats or "devices" in stats)
    return {"port": port, "state": "comfyui" if comfyui else "not_comfyui"}


# ── 段3 桥 token 一致性(令牌字面量绝不外泄) ─────────────────────────────────


def sidecar_control_token() -> tuple[str | None, str]:
    """读装机令牌真源;返回 (token, 状态)——状态=ok/missing/unreadable。"""
    try:
        data = json.loads(CONFIG_JSON.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None, "unreadable"
    token = data.get("controlToken") if isinstance(data, dict) else None
    if not isinstance(token, str) or not token:
        return None, "missing"
    return token, "ok"


def check_token(live_ports: list[int], token: str | None, token_state: str) -> list[dict]:
    results: list[dict] = []
    for port in live_ports:
        try:
            payload = _get_json(f"http://127.0.0.1:{port}/my_bridge/config")
        except Exception as exc:  # noqa: BLE001
            results.append({"port": port, "state": "unreachable", "detail": type(exc).__name__})
            continue
        echoed = payload.get("bridgeToken") if isinstance(payload, dict) else None
        if not isinstance(echoed, str) or not echoed:
            results.append({"port": port, "state": "unreachable", "detail": "端点不在或空令牌"})
        elif token_state != "ok":
            results.append({"port": port, "state": "cannot_compare",
                            "detail": f"controlToken 真源 {token_state},无法对照"})
        else:
            results.append({"port": port, "state": "match" if echoed == token else "mismatch",
                            "engineTokenLen": len(echoed), "controlTokenLen": len(token)})
    return results


# ── 编排 ─────────────────────────────────────────────────────────────────────


def main(argv: list[str]) -> int:
    as_json = "--json" in argv
    if "--help" in argv:
        print(__doc__)
        return 0
    report: dict = {"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "ok": False,
                    "platform": sys.platform, "segments": {}}
    if sys.platform != "darwin":
        print(f"{TAG} 非 darwin 平台({sys.platform}):装机家/引擎语义不适用,四段记 N/A")
        report["segments"] = {"platform": {"status": "not_applicable",
                                           "reason": "doctor 为 darwin 装机诊断件"}}
        report["ok"] = True
        return _finish(report, as_json)

    # 段1 盘点
    inventory = snap_processes()
    report["segments"]["inventory"] = inventory
    print(f"{TAG} ── 段1 pgrep 盘点 ──")
    for kind, found in inventory.items():
        if not found:
            print(f"{TAG}  {kind}({PGREP_PATTERNS[kind]}):零进程在场")
            continue
        for item in found:
            print(f"{TAG}  {kind} pid={item['pid']} [{item['verdict']}]"
                  + (f" --port={item['port']}" if item["port"] else ""))
            print(f"{TAG}    argv: {item['argv']}")

    # 段2 探活
    print(f"{TAG} ── 段2 端口探活(/system_stats,超时 {PROBE_TIMEOUT_S}s 容错)──")
    listeners = listening_ports()
    candidates: set[int] = set()
    if listeners is not None:
        candidates.update(row["port"] for row in listeners)
        for row in sorted(listeners, key=lambda r: r["port"]):
            print(f"{TAG}  lsof 在听:{row['port']}({row['process']})")
    else:
        print(f"{TAG}  lsof 不可用——在听口发现腿跳过(容错)")
    rec_port = recorded_port()
    if rec_port is not None:
        candidates.add(rec_port)
        print(f"{TAG}  manifest 记账口:{rec_port}({ENGINE_MANIFEST})")
    else:
        print(f"{TAG}  manifest 记账口:读不到({ENGINE_MANIFEST} 缺失或无 engine.port)")
    for found in inventory.values():
        for item in found:
            if item["port"]:
                candidates.add(item["port"])
    probes = [probe_port(p) for p in sorted(candidates)]
    report["segments"]["probe"] = {"recordedPort": rec_port, "listeners": listeners,
                                   "results": probes}
    for probe in probes:
        note = {"comfyui": "ComfyUI 引擎在听", "not_comfyui": "在听但非 ComfyUI 应答(如桥/别家)",
                "unreachable": "不可达或非预期应答(引擎 down=合法态;detail 区分拒连/超时/HTTP错)"}[probe["state"]]
        print(f"{TAG}  口 {probe['port']} → {probe['state']}:{note}"
              + (f"({probe['detail']})" if probe.get("detail") else ""))
    live_ports = [p["port"] for p in probes if p["state"] == "comfyui"]

    # 段3 token 一致性
    print(f"{TAG} ── 段3 桥 token 一致性(controlToken vs /my_bridge/config 回显)──")
    token, token_state = sidecar_control_token()
    print(f"{TAG}  真源 {CONFIG_JSON} → {token_state}"
          + (f"(len={len(token)})" if token else "(令牌字面量不入输出)"))
    token_results = check_token(live_ports, token, token_state)
    report["segments"]["token"] = {"controlTokenState": token_state} | {
        "results": token_results}
    if not live_ports:
        print(f"{TAG}  零活引擎——无可对照(引擎 down 合法态)")
    for row in token_results:
        print(f"{TAG}  口 {row['port']} → {row['state']}"
              + (f"({row['detail']})" if row.get("detail") else ""))

    # 段4 双引擎并存
    print(f"{TAG} ── 段4 双引擎并存检测 ──")
    dual = len(live_ports) >= 2
    report["segments"]["dualEngine"] = {"livePorts": live_ports, "red": dual}
    print(f"{TAG}  活引擎口={live_ports or '(空)'} → " + ("RED 双引擎并存!" if dual else "PASS(≤1 实例)"))

    # 收尾:只打印,绝不执行
    verify_ports = sorted(set(live_ports + ([rec_port] if rec_port else [])) | set(RESERVED_BRIDGE_PORTS))
    print(f"{TAG} ── 收尾「干完即停」清单(只打印,绝不执行;杀进程由人裁定)──")
    print(f"{TAG}   pkill -f daojie_engine_keeper        # keeper 常驻拉起器")
    print(f"{TAG}   pkill -f 'ComfyUI/main.py'           # 引擎(建议先逐 pid 核 argv:ps -ww -o command= -p <pid>,只杀自家)")
    print(f"{TAG}   pkill -f image_gen.main              # image sidecar(桥 17595)")
    for port in verify_ports:
        print(f"{TAG}   curl -m 2 -s http://127.0.0.1:{port}/system_stats >/dev/null 2>&1 && echo still-up || echo down  # 验 down 口 {port}")

    mismatch = any(row["state"] == "mismatch" for row in token_results)
    reds = [name for name, hit in (("token_mismatch", mismatch), ("dual_engine", dual)) if hit]
    report["ok"] = not reds
    report["reds"] = reds
    print(f"{TAG} 汇总:{'GREEN' if not reds else 'RED'}(活引擎={len(live_ports)} 口"
          f"{live_ports}, reds={reds or '无'};down=合法态)")
    return _finish(report, as_json)


def _finish(report: dict, as_json: bool) -> int:
    if as_json:
        REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
        REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                               encoding="utf-8")
        try:
            shown: pathlib.Path | str = REPORT_JSON.relative_to(REPO)
        except ValueError:
            shown = REPORT_JSON
        print(f"{TAG} 报告落 {shown}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
