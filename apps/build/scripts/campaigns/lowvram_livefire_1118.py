#!/usr/bin/env python3
"""1118 h3-lowvram G1-G3 实弹 v2(评审三轮改造落地件;原 lowvram_livefire_1118.py / watcher 不动)。

改造清单(对 v1 缺口逐项,批准依据=逐项验证):
  C1 基线改模板反注入:App API 模板(84n 术后正典)→ A'=83n 旧结构;运行时断言
     diff(A',B) 恰 {'1071','1072','3011'}。v1 缺口:history picker 断言不足且引擎现恒无
     旧结构完链,照 v1 跑第一步即 assert 崩(lowvram_livefire_1118.py:151-153)。
  C2 G1 对账键改输出节点 id 且键集必须相等非空(v1 按 subfolder/filename 取交集:131-137/:173,
     SaveVideo 自增计数两臂文件名必不同→交集空→零比较假 PASS)。键集不等=INVALID,禁空转 PASS。
  C3 G2 主口径=引擎侧 execution_success.ts−execution_start.ts(Win 同钟自减,Mac/Win skew 相消;
     1118 实测三支 success 完链均带非空毫秒 ts:3fd07be3/957e726b/1cdc4f00)。Mac 侧 wall 仅备查
     (含 0-POLL 秒轮询检出 lag,~380s 臂≈1.3% 噪声,禁作判劣化主口径)。
  C4 首位确认三态:POST 后 GET /queue——running 含我→烧;pending=[我]且 running 空=引擎调度
     瞬态→2s×4 重试再判;pending=[我]且 running=[他]=真抢前→POST /queue {"delete":[pid]}
     只撤自家单,臂作废重窗(毫秒竞态盲区闭合;评审缺口3)。
  C5 运行期守则+超时:轮询间隙查 /queue,pid 连续 2 轮不在队列且 history 无记录=重启/中断→臂作废;
     每臂 wall 超时 1800s(v1 :115-126 while True 无超时,重启后 /history/{pid} 恒空永死循环)。
  C6 VRAM poller 样本带本地时间戳,谷值仅统计[首位确认→success 检出]区间
     (污染臂的他人执行样本进不了谷;两臂同口径)。
  C7 md5_view 三连试+逐口即时落盘(v1 :54-63 无重试,一次网络抖=整臂白烧且断点未写)。
  C8 不复用任何 /tmp 旧档;两臂提交图 JSON+模板 sha256 落 OUT_DIR 溯源,运行时复核种子逐字节等。
  C9 静窗内建纯队列口径(0/0 持续 hold;无旧结构指纹条件——v1 watcher :34-36 在新常态永不开窗)。
  C10 G1 差分预案:MD5 不等时打印 ffmpeg framemd5 命令区分『容器字节差 vs 像素差』
     (Mac ffmpeg 9.0.2 在位;触发方向=FAIL 停手,不误放行)。

fallback 阶梯(直投失败处置):node_errors→全量落盘+exit 6(图级 bug,禁变体重试毁 3 键差分);
exec error→静窗重试一次,二次→exit 6;换载体属变更裁决 escalate 不自决。
"""
import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

for k in ("http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
    os.environ.pop(k, None)

BASE = "http://192.168.0.101:17000"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "..", "output", "lowvram-1118")
TEMPLATE = os.path.join(HERE, "..", "..", "frontend", "lib", "comfyui", "h3", "templates",
                        "h3-three-stage-template.api.json")

WALL_TIMEOUT = 1800   # C5:每臂 wall 超时(实测最长完链 355.5s,留 5 倍余量)
POLL = 5              # 轮询周期(s)
CONFIRM_TRIES = 4     # C4:调度瞬态重试次数
CONFIRM_GAP = 2.0     # C4:重试间隔(s)
G2_THRESHOLD_PCT = 3.0  # PRD G2:劣化>3% 呈报候裁
SEED_SPOTS = ("4002/seed", "5016/noise_seed", "54/noise_seed")  # 全图随机源恰 4 处(含 4002 control_after_generate=fixed)


def http(path, payload=None, timeout=30, retries=3):
    last = None
    for _ in range(retries):
        try:
            data = json.dumps(payload).encode() if payload is not None else None
            req = urllib.request.Request(BASE + path, data=data,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read() or b"{}")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(4)
    raise last


def load_template():
    with open(TEMPLATE, "rb") as f:
        raw = f.read()
    g = json.loads(raw)
    return g, hashlib.sha256(raw).hexdigest()[:16]


def reverse_inject(g_new):
    """B(术后 84n)→A'(挂前 83n):恰逆三处注入。"""
    ga = copy.deepcopy(g_new)
    del ga["1072"]
    ga["1071"]["inputs"]["model"] = ["1062", 0]
    ga["3011"]["inputs"]["chunks"] = 1
    return ga


def diff_keys(a, b):
    keys = set(a) | set(b)
    return {k for k in keys
            if json.dumps(a.get(k), sort_keys=True) != json.dumps(b.get(k), sort_keys=True)}


def seed_report(g):
    out = {}
    for spot in SEED_SPOTS:
        nid, field = spot.split("/")
        out[spot] = g[nid]["inputs"].get(field)
    out["4002/control_after_generate"] = g["4002"]["inputs"].get("control_after_generate")
    return out


def asset_names(g):
    return sorted({v["inputs"]["image"] for v in g.values()
                   if isinstance(v, dict) and v.get("class_type") == "LoadImage"})


def check_assets(names):
    ok = {}
    for fn in names:
        got = False
        try:
            url = f"{BASE}/view?filename={urllib.request.quote(fn)}&type=input"
            with urllib.request.urlopen(url, timeout=20) as r:
                r.read(64)
                got = (r.status == 200)
        except urllib.error.HTTPError:
            got = False
        except Exception:  # noqa: BLE001
            got = False
        ok[fn] = got
    return ok


def queue_ids():
    q = http("/queue", timeout=8)
    run = [e[1] for e in q.get("queue_running", [])]
    pend = [e[1] for e in q.get("queue_pending", [])]
    return run, pend


def window_wait(hold, max_wait):
    """C9:纯队列静窗 0/0 持续 hold 秒(无旧结构指纹条件)。"""
    t0 = time.time()
    ok_since = None
    while time.time() - t0 < max_wait:
        try:
            run, pend = queue_ids()
        except Exception:  # noqa: BLE001
            run, pend = [-1], [-1]
        if not run and not pend:
            ok_since = ok_since or time.time()
            if time.time() - ok_since >= hold:
                return True
        else:
            ok_since = None
        time.sleep(4)
    return False


def md5_view(fname, subfolder="", retries=3):
    """C7:三连试。"""
    last = None
    for _ in range(retries):
        try:
            url = (f"{BASE}/view?filename={urllib.request.quote(fname)}"
                   f"&subfolder={urllib.request.quote(subfolder)}&type=output")
            m = hashlib.md5()
            with urllib.request.urlopen(url, timeout=180) as r:
                while True:
                    b = r.read(1 << 16)
                    if not b:
                        break
                    m.update(b)
            return m.hexdigest()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(4)
    raise last


class VramPoller:
    """C6:样本带本地时间戳,谷值按区间过滤。"""

    def __init__(self):
        self.samples = []
        self.stop = False
        self.t = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self.stop:
            try:
                st = http("/system_stats", timeout=8, retries=1)
                for dev in st.get("devices", []):
                    free = dev.get("vram_free") or dev.get("VRAMFree")
                    if isinstance(free, (int, float)):
                        self.samples.append((time.time(), free))
            except Exception:  # noqa: BLE001
                pass
            time.sleep(2)

    def start(self):
        self.t.start()

    def finish(self):
        self.stop = True
        self.t.join(timeout=5)

    def trough(self, lo=None, hi=None):
        vals = [v for ts, v in self.samples
                if (lo is None or ts >= lo) and (hi is None or ts <= hi)]
        return min(vals) if vals else None


def exec_window_ms(rec):
    """C3:引擎侧纯执行时长=success.ts−start.ts(Win 同钟,skew 相消)。"""
    ts = {}
    for m in (rec.get("status") or {}).get("messages", []):
        if isinstance(m, list) and len(m) == 2 and isinstance(m[1], dict):
            if m[0] in ("execution_start", "execution_success") and m[1].get("timestamp"):
                ts[m[0]] = m[1]["timestamp"]
    if "execution_start" in ts and "execution_success" in ts:
        return ts["execution_success"] - ts["execution_start"]
    return None


def confirm_first(pid):
    """C4 三态:running=[我]→ok;pending=[我]且running空→调度瞬态重试;
    pending=[我]且running=[他]→真抢前(撤自家单);两边都不见→重试后查 history。"""
    for _ in range(CONFIRM_TRIES):
        run, pend = queue_ids()
        if pid in run:
            return True, "running_first", time.time()
        if pid in pend and not run:
            time.sleep(CONFIRM_GAP)
            continue
        if pid in pend and run:
            try:
                http("/queue", {"delete": [pid]}, timeout=8)  # 只撤自家排队
            except Exception:  # noqa: BLE001
                pass
            return False, f"preempted_by:{run[0][:8]}", None
        time.sleep(CONFIRM_GAP)
    h = http(f"/history/{pid}")
    if (h.get(pid) or {}).get("status", {}).get("status_str") == "success":
        return True, "already_done", time.time()
    return False, "unconfirmed", None


def fetch_body(fname, subfolder, dst, retries=3):
    """GAP-A:文件本体即时落盘 Mac(引擎重启/清档不再威胁帧哈希收尾)。"""
    last = None
    for _ in range(retries):
        try:
            url = (f"{BASE}/view?filename={urllib.request.quote(fname)}"
                   f"&subfolder={urllib.request.quote(subfolder)}&type=output")
            with urllib.request.urlopen(url, timeout=180) as r, open(dst, "wb") as f:
                while True:
                    b = r.read(1 << 16)
                    if not b:
                        break
                    f.write(b)
            return hashlib.md5(open(dst, "rb").read()).hexdigest()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(4)
    raise last


def collect_outputs(rec, tag):
    """C2:按 (节点id/类型/序号) 建键;GAP-A:本体即时落盘 OUT_DIR/bodies/。"""
    bdir = os.path.join(OUT_DIR, "bodies", f"arm{tag}")
    os.makedirs(bdir, exist_ok=True)
    outs = {}
    for oid, ovals in (rec.get("outputs") or {}).items():
        for kind in ("images", "gifs", "videos"):
            for idx, item in enumerate(ovals.get(kind) or []):
                fn = item.get("filename")
                if not fn:
                    continue
                sub = item.get("subfolder", "")
                key = f"{oid}/{kind}/{idx}"
                safe = fn.replace("/", "_")
                dst = os.path.join(bdir, safe)
                outs[key] = {"md5": fetch_body(fn, sub, dst), "filename": fn,
                             "subfolder": sub, "body": dst}
                json.dump(outs, open(os.path.join(OUT_DIR, f"arm{tag}_md5.json"), "w"),
                          ensure_ascii=False, indent=1)
    return outs


def cached_nodes(rec):
    """GAP-B:execution_cached 消息里的节点集(引擎缓存命中的节点不再实跑)。"""
    for m in (rec.get("status") or {}).get("messages", []):
        if isinstance(m, list) and len(m) == 2 and m[0] == "execution_cached":
            v = m[1]
            if isinstance(v, dict) and isinstance(v.get("nodes"), list):
                return set(v["nodes"])
    return set()


def framemd5_local(path):
    """GAP-A:帧哈希本体在 Mac,不再只打印命令。"""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-map", "0:v:0",
                        "-f", "framemd5", "-"], capture_output=True, timeout=900)
    return hashlib.md5(r.stdout).hexdigest() if r.returncode == 0 else None


def run_arm(tag, graph):
    poller = VramPoller()
    poller.start()
    t_post = time.time()
    run_before, pend_before = queue_ids()
    if run_before or pend_before:  # GAP-C:发弹前队列非空=窗已被夺,禁发(重窗重配对)
        poller.finish()
        return {"valid": False, "abort": "window_race_queue_nonempty",
                "queue_before": [len(run_before), len(pend_before)]}
    resp = http("/prompt", {"prompt": graph, "client_id": f"lowvram-v2-{tag}"})
    errs = resp.get("node_errors") or {}
    if errs:
        poller.finish()
        return {"valid": False, "abort": "node_errors", "node_errors": errs,
                "queue_before": [len(run_before), len(pend_before)]}
    pid = resp["prompt_id"]
    print(f"[{tag}] pid={pid[:8]} 入队 {time.strftime('%H:%M:%S')} 队前 {len(run_before)}/{len(pend_before)}")

    ok, why, t_confirm = confirm_first(pid)  # C4
    if not ok:
        poller.finish()
        return {"valid": False, "abort": why, "pid": pid,
                "queue_before": [len(run_before), len(pend_before)]}
    print(f"[{tag}] 首位确认({why})")

    rec, abort, misses = None, None, 0
    while time.time() - t_post < WALL_TIMEOUT:  # C5
        time.sleep(POLL)
        rec = http(f"/history/{pid}").get(pid)
        if rec:
            st = rec.get("status") or {}
            if st.get("status_str") == "success" or st.get("completed"):
                abort = None
                break
            if st.get("status_str") == "error":
                abort = "exec_error"
                break
        try:
            run, pend = queue_ids()
            present = pid in run or pid in pend
        except Exception:  # noqa: BLE001
            present = True
        misses = 0 if present else misses + 1
        if misses >= 2:
            abort = "vanished_restart_or_interrupt"
            break
        sys.stdout.write(f"[{tag}] …{int(time.time()-t_post)}s\r")
    t_done = time.time()
    poller.finish()
    run_after, pend_after = queue_ids()
    arm = {"pid": pid, "queue_before": [len(run_before), len(pend_before)],
           "queue_after": [len(run_after), len(pend_after)],
           "wall_s": round(t_done - t_post, 1),
           "first_confirm": why}
    if abort:
        arm.update({"valid": False, "abort": abort,
                    "status": (rec or {}).get("status")})
        return arm
    if rec is None:
        arm.update({"valid": False, "abort": "wall_timeout"})
        return arm
    arm["exec_ms"] = exec_window_ms(rec)          # C3 主口径
    arm["vram_trough_exec_window"] = poller.trough(t_confirm, t_done)  # C6
    arm["vram_trough_global"] = poller.trough()
    if arm["exec_ms"] is None:
        arm.update({"valid": False, "abort": "no_engine_ts"})
        return arm
    arm["outputs"] = collect_outputs(rec, tag)     # C2
    arm["valid"] = bool(arm["outputs"])
    if not arm["valid"]:
        arm["abort"] = "no_outputs"
    print(f"[{tag}] exec={arm['exec_ms']/1000:.1f}s wall={arm['wall_s']}s "
          f"谷(执行窗)={arm['vram_trough_exec_window']} 口数={len(arm.get('outputs', {}))}")
    return arm


def g1_disambig_hint(diff_keys):
    """C10:容器字节差 vs 像素差 区分命令。"""
    if shutil.which("ffmpeg"):
        print("  差分预案(ffmpeg 在位):下载两臂文件后")
        print("    ffmpeg -loglevel error -i A.mp4 -map 0:v:0 -f framemd5 - > a.framemd5")
        print("    ffmpeg -loglevel error -i B.mp4 -map 0:v:0 -f framemd5 - > b.framemd5")
        print("    diff a.framemd5 b.framemd5 —— 帧哈希全等=容器层字节差(非节点破坏逐位性),不等=真逐位差")
    print(f"  不等口: {sorted(diff_keys)}")


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    hold = int(args[args.index("--hold-sec") + 1]) if "--hold-sec" in args else 30
    max_wait = int(args[args.index("--max-wait-sec") + 1]) if "--max-wait-sec" in args else 1800
    os.makedirs(OUT_DIR, exist_ok=True)

    gB, tsha = load_template()
    gA = reverse_inject(gB)
    d = diff_keys(gA, gB)
    assert d == {"1071", "1072", "3011"}, f"C1 差分非恰三处: {sorted(d, key=str)}"
    sa, sb = seed_report(gA), seed_report(gB)
    assert sa == sb and sa["4002/control_after_generate"] == "fixed", f"种子不一致: {sa} vs {sb}"
    print(f"[pre] C1 模板 sha256[:16]={tsha} A'={len(gA)}n B={len(gB)}n 差分恰三处 ✓")
    print(f"[pre] C8 种子两臂逐字节等 ✓ {sb}")

    assets = check_assets(asset_names(gB))
    print(f"[pre] input 资产 {sum(assets.values())}/{len(assets)} 200 ✓" if all(assets.values())
          else f"[pre] input 资产缺失! {assets}")
    run, pend = queue_ids()
    print(f"[pre] 当前队列 {len(run)}/{len(pend)}(他链活跃=常态)")
    h = http("/history?max_items=20")
    ok_ts = sum(1 for rec in h.values()
                if exec_window_ms(rec) is not None
                and (rec.get("status") or {}).get("status_str") == "success")
    print(f"[pre] C3 引擎侧 ts 探针:history success 支带双 ts {ok_ts}/{len(h)}")

    if dry:
        json.dump({"template_sha256": tsha, "armA_graph": gA, "armB_graph": gB},
                  open(os.path.join(OUT_DIR, "dryrun_graphs.json"), "w"), ensure_ascii=False)
        verdict = all(assets.values()) and ok_ts >= 1
        print(f"[dry-run] {'PASS(预检全绿,未发弹)' if verdict else 'FAIL(预检有红,禁发弹)'}")
        sys.exit(0 if verdict else 1)

    json.dump({"template_sha256": tsha, "armA_graph": gA, "armB_graph": gB},
              open(os.path.join(OUT_DIR, "arm_graphs.json"), "w"), ensure_ascii=False)

    pair = None
    err_count = 0
    for attempt in range(1, 4):
        if not window_wait(hold, max_wait):  # C9
            print(f"[attempt {attempt}] 静窗未开({max_wait}s),退出码4")
            sys.exit(4)

        def run_or_burn(tag, g):
            """单臂+落档+escalate 判定;invalid 返回 None(外层重窗)。"""
            nonlocal err_count
            arm = run_arm(tag, g)
            json.dump(arm, open(os.path.join(OUT_DIR, f"arm{tag}.json"), "w"),
                      ensure_ascii=False, indent=1)
            if arm["valid"]:
                return arm
            if arm["abort"] == "node_errors":
                json.dump(arm, open(os.path.join(OUT_DIR, f"node_errors_{tag}.json"), "w"),
                          ensure_ascii=False, indent=1)
                print(f"[escalate] {tag} 直投 node_errors,全量落盘,exit 6")
                sys.exit(6)
            if arm["abort"] == "exec_error":
                err_count += 1
                if err_count >= 2:
                    print(f"[escalate] {tag} exec_error ×2,exit 6")
                    sys.exit(6)
            print(f"[attempt {attempt}] {tag} 臂作废({arm['abort']}),重窗重烧整组")
            return None

        a1 = run_or_burn("A1", gA)          # GAP-B:自决定性臂
        if not a1:
            continue
        a2 = run_or_burn("A2", gA)
        if not a2:
            continue
        b = run_or_burn("B", gB)
        if not b:
            continue
        pair = (a1, a2, b)
        break
    if not pair:
        print("三次配对未成,exit 5")
        sys.exit(5)
    a1, a2, b = pair

    print("\n== G1 逐位对账(键=输出节点id,键集必须相等非空)==")

    def compare(x, y):
        """返回 (per-key 行, verdict):PASS=md5 全等或帧哈希等(容器差);FAIL=像素差。"""
        kx, ky = set(x["outputs"]), set(y["outputs"])
        if not kx or kx != ky:
            return None, "INVALID"
        rows, v = [], "PASS"
        for k in sorted(kx):
            ox, oy = x["outputs"][k], y["outputs"][k]
            if ox["md5"] == oy["md5"]:
                rows.append(f"  = {k}: md5 逐字节等 ({ox['filename']})")
                continue
            fx = framemd5_local(ox["body"])
            fy = framemd5_local(oy["body"])
            if fx and fy and fx == fy:
                rows.append(f"  ≈ {k}: md5 异但帧哈希等=容器字节差 ({ox['filename']})")
            else:
                v = "FAIL"
                rows.append(f"  ✗ {k}: 像素级差分 ({ox['filename']} vs {oy['filename']})")
        return rows, v

    # GAP-B 前置门:A₁vsA₂ 自决定性(同图两发不一致→引擎非确定,G1 终判无意义)
    rows_self, v_self = compare(a1, a2)
    g1_self = {"verdict": v_self, "note": "同图 A₁vsA₂:引擎确定性门(GAP-B)"}
    print("-- 自决定性门 A₁ vs A₂ --")
    print("\n".join(rows_self or ["  INVALID: 键集不等"]))
    if v_self != "PASS":
        g1_self["note"] += " → 引擎本会话非确定,G1 只能判 INVALID,禁出终判"
        print("G1_self INVALID(引擎非确定)")

    rows, v_g1 = compare(a2, b)
    g1 = {"verdict": (v_g1 if v_self == "PASS" else "INVALID"), "gated_by_self": v_self == "PASS"}
    print("-- 主对账 A₂ vs B --")
    print("\n".join(rows or ["  INVALID: 键集不等"]))
    print(f"G1 {g1['verdict']}" + ("(逐位一致)" if g1["verdict"] == "PASS" else "(差分/无效→停手找根因)"))

    de = (b["exec_ms"] - a2["exec_ms"]) / a2["exec_ms"] * 100
    dw = (b["wall_s"] - a2["wall_s"]) / a2["wall_s"] * 100
    print(f"\n== G2 时长 == 主口径(引擎侧纯执行):A₂={a2['exec_ms']/1000:.1f}s B={b['exec_ms']/1000:.1f}s "
          f"Δ={de:+.1f}%{' → 劣化>3% 呈报候裁' if de > G2_THRESHOLD_PCT else ''}"
          f"(A₁={a1['exec_ms']/1000:.1f}s 自决定性同图参照)")
    print(f"         备查(Mac侧wall含检出lag):A₂={a2['wall_s']}s B={b['wall_s']}s Δ={dw:+.1f}%")
    print(f"== G3 显存(vram_free 谷·执行窗,越大=峰值越低)== A₂={a2['vram_trough_exec_window']} "
          f"B={b['vram_trough_exec_window']} 差="
          f"{(b['vram_trough_exec_window'] or 0)-(a2['vram_trough_exec_window'] or 0)}B")

    result = {"g1": g1, "g1_self": g1_self,
              "g2": {"exec_ms_A1": a1["exec_ms"], "exec_ms_A2": a2["exec_ms"], "exec_ms_B": b["exec_ms"],
                     "delta_exec_pct": round(de, 2),
                     "wall_s_A2": a2["wall_s"], "wall_s_B": b["wall_s"], "delta_wall_pct": round(dw, 2),
                     "threshold_pct": G2_THRESHOLD_PCT, "metric": "engine execution_success.ts-start.ts"},
              "g3": {"trough_A2": a2["vram_trough_exec_window"], "trough_B": b["vram_trough_exec_window"],
                     "note": "24G 档零溢出则收益≈0 如实报候裁"},
              "base": f"template-reverse-inject sha256[:16]={tsha}",
              "superset_note": "模板直投=超集图(含 4001-4003 三采+修脸臂;App 段A 实发恒删之,"
                               "见 h3-shot-video-workflow.ts:847-850,871)——绝对时长≠生产段A形态,配对差分不受影响",
              "armA1": a1, "armA2": a2, "armB": b, "ran_at": time.strftime("%Y-%m-%d %H:%M:%S")}
    json.dump(result, open(os.path.join(OUT_DIR, "result.json"), "w"), ensure_ascii=False, indent=2)
    print(f"result.json -> {os.path.join(OUT_DIR, 'result.json')}")


if __name__ == "__main__":
    main()
