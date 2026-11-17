#!/usr/bin/env python3
"""修脸内置双态探针跑架(1118,trellis 11-17-facerefine-inline-bypass §1.4)。

对已内置四采修脸臂的三采链(API 形态,--config 平铺 prompt dict)按态发车并取证:

  队列门(GET /queue:空即发;繁忙超观察窗且无同前缀/同 client 在途=降级放行排队;
  同前缀在途才死等到上限——1118 实勘:引擎被并行长任务常年占用,「空才发」不可满足)
  → 按态注入 g["1065"].value 与 g["25"].value
  → POST /prompt → /history 轮询 + /ws 执行节点流取证 → execution_interrupted 则重发(≤--max-resend)
  → 完赛取证:
     bypass:执行节点清单 50xx 前缀计数(须 websocket 证据)+ 终档 p-final 对 p3 同帧差(重编码级)
     repair:终档远端 t≈1s 帧对 p3 差分>12 像素数(千级)+ p1/p2/p3 照常落盘 + 4100 出片
  → 结果单 JSON 打 stdout;任一断言不过 exit 1(证据不足=不过)。

引擎交互恒 HTTP(view/upload/prompt/history/ws 同族);ssh 仅兜底(--ssh-host 显式给出才启用,
cat 远端产物,带重试)。素材已在引擎 input:ycx4k-ref.png / transparent_ref.png / ab_src_1117.mp4。

用法示例:
  python3 inline_fire_runner_1118.py --config probe.json --state bypass --prefix video/漫影/facerefine-1118/bypass
  python3 inline_fire_runner_1118.py --config probe.json --state repair  --prefix video/漫影/facerefine-1118/repair
  python3 inline_fire_runner_1118.py --config probe.json --state bypass --dry-run   # 只看不发
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import socket
import ssl
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_ENGINE = "http://192.168.0.101:17000"
_T0 = time.time()  # ws 逐节点实录的相对时基
NEW_IDS = {"25", "1065", "4100", "5002", "5006", "5011", "5012", "5013", "5014",
           "5015", "5016", "5017", "5018", "5019", "5020", "5021", "5022", "5023", "5100"}
# 旁路态禁执行集=修脸臂本体 5002-5023 + 输入件 25(唯一消费者 5012 在臂内,prune 应带走);
# 5100/4100/1065=终档组,两态合法执行(5100 开关本身旁路态必跑以选 4002,1118 实勘 ws 流
# 第二位即 5100 而臂零执行=lazy prune 正常,初版段判定 5000-5199 误伤 5100 即本轮假红根因)
BYPASS_ARM_NODE_IDS = NEW_IDS - {"1065", "5100", "4100"}
REPO = Path(__file__).resolve().parents[3]
API_TEMPLATE = REPO / "apps/frontend/lib/assist/image-studio/h3-three-stage-template.api.json"
PROBE_IMAGE = "ycx4k-ref.png"  # 引擎 input 实勘在位(15MB 4K;transparent_ref.png=83B 占位弃用)


def build_default_probe_config() -> dict:
    """内置 5s 探针装配(1118 门判例:发车门不传 --config):
    API 模板(仓库真源)+ 图1=ycx4k-ref.png+参考槽 9→1(1118 owner 令减载:a2 烧 136 分钟
    CPU 实锤 TE 段超载嫌疑,探针只留 ref_image_0;摘 11-18 节点+2001/3031 的
    ref_image_1..8 槽,组装器 endFrame/videoRef 缺省摘除同款先例=可选槽摘除合法)
    + 41/42+2001.ref_videos 槽、31+2002.last_frame 槽摘除(空喂占位禁进直投)
    + 时长恒 5s(124 帧,PRD §1.4 口径)+ 参考尺寸恒 match(降载护栏)。"""
    g = json.loads(API_TEMPLATE.read_text(encoding="utf-8"))
    g["1"]["inputs"]["image"] = PROBE_IMAGE
    for nid in ("11", "12", "13", "14", "15", "16", "17", "18"):
        g.pop(nid, None)
    for nid in ("2001", "3031"):
        inputs = g[nid]["inputs"]
        for k in [k for k in inputs if k.startswith("ref_images.ref_image_") and k != "ref_images.ref_image_0"]:
            inputs.pop(k)
    g.pop("41", None)
    g.pop("42", None)
    g["2001"]["inputs"].pop("ref_videos.ref_video_0", None)
    g.pop("31", None)
    g["2002"]["inputs"].pop("last_frame", None)
    g["51"]["inputs"]["value"] = 5
    # 降载护栏(1118 a2 事故复盘:9 槽 4K×max 全量进 TE 视觉编码烧穿 worker;
    # 探针口径参考尺寸恒 match,1114 实证大参考数×match 稳)
    g["2001"]["inputs"]["ref_image_size"] = "match"
    g["3031"]["inputs"]["ref_image_size"] = "match"
    return g


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def same_run_in_flight(entries: list, client_id: str, prefix: str | None) -> set:
    """在途条目里挑「同 client_id 或同 --prefix 目录段」的自家任务(防自撞/重复发车)。
    /queue 条目=[seq, prompt_id, prompt_dict, extra_data, ...](0.45 实勘)。"""
    mine: set = set()
    want = prefix.rstrip("/") if prefix else None
    for item in entries:
        if not isinstance(item, list) or len(item) < 2:
            continue
        prompt = item[2] if len(item) > 2 and isinstance(item[2], dict) else {}
        extra = item[3] if len(item) > 3 and isinstance(item[3], dict) else {}
        if extra.get("client_id") == client_id:
            mine.add(item[1])
            continue
        if want:
            for node in prompt.values():
                if isinstance(node, dict) and node.get("class_type") == "SaveVideo":
                    p = str(node.get("inputs", {}).get("filename_prefix", ""))
                    if p.rsplit("/", 1)[0] == want:
                        mine.add(item[1])
                        break
    return mine


def http_json(engine: str, path: str, timeout: int = 30, retries: int = 3):
    last = None
    for i in range(retries):
        try:
            with urllib.request.urlopen(engine + path, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 —— 兜底重试
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"GET {path} 重试{retries}次仍失败: {last}")


def post_json(engine: str, path: str, body: dict, timeout: int = 30, retries: int = 3):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(
                engine + path, data=json.dumps(body).encode("utf-8"),
                headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read().decode("utf-8", "replace").strip()
                return json.loads(raw) if raw else {}  # /interrupt 等端点 200 空 body=成功(1118 实勘:空响应被 json.loads 炸成假失败)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            raise RuntimeError(f"POST {path} HTTP {e.code}: {detail[:2000]}") from e
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"POST {path} 重试{retries}次仍失败: {last}")


def download(engine: str, filename: str, subfolder: str, ftype: str, dst: str,
             ssh_host: str | None) -> str:
    """优先 HTTP /view(带重试);显式 --ssh-host 时兜底 ssh cat(带重试)。"""
    q = urllib.parse.urlencode({"filename": filename, "subfolder": subfolder, "type": ftype})
    last = None
    for i in range(3):
        try:
            with urllib.request.urlopen(f"{engine}/view?{q}", timeout=120) as r:
                with open(dst, "wb") as f:
                    while True:
                        chunk = r.read(1 << 20)
                        if not chunk:
                            break
                        f.write(chunk)
            return dst
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    if ssh_host:
        remote = os.path.join(subfolder, filename) if subfolder else filename
        for i in range(3):
            r = subprocess.run(["ssh", ssh_host, "cat", remote], capture_output=True, timeout=300)
            if r.returncode == 0 and r.stdout:
                open(dst, "wb").write(r.stdout)
                return dst
            time.sleep(2 * (i + 1))
        raise RuntimeError(f"/view 与 ssh 兜底均失败: view={last}")
    raise RuntimeError(f"/view 下载失败(未启用 ssh 兜底): {last}")


# ---------------- 最小 RFC6455 websocket 客户端(只读事件流 + 回 pong) ----------------
class WsCapture(threading.Thread):
    """连 /ws?clientId= 收 executing 事件,攒执行节点清单(取证证据)。"""

    def __init__(self, engine: str, client_id: str):
        super().__init__(daemon=True)
        u = urllib.parse.urlparse(engine)
        self.host, self.port, self.path = u.hostname, u.port or 80, f"/ws?clientId={client_id}"
        self.client_id = client_id
        self.executed: list[str] = []      # 按抵达序去重
        self.saw: set[str] = set()
        self.error: str | None = None
        self.own_pids: set[str] = set()    # 发车后注册;事件体带 prompt_id 时过滤他家任务
        self._stop = threading.Event()

    def _recvall(self, sock, n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            chunk = sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("ws EOF")
            buf += chunk
        return buf

    def _send_pong(self, sock, payload: bytes):
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        header = bytearray([0x8A, 0x80 | len(payload)])
        sock.sendall(bytes(header) + mask + masked)

    def run(self):
        try:
            sock = socket.create_connection((self.host, self.port), timeout=10)
            key = base64.b64encode(os.urandom(16)).decode()
            req = (f"GET {self.path} HTTP/1.1\r\nHost: {self.host}:{self.port}\r\n"
                   "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                   f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
            sock.sendall(req.encode())
            resp = b""
            while b"\r\n\r\n" not in resp:
                chunk = sock.recv(4096)
                if not chunk:
                    raise ConnectionError("ws 握手 EOF")
                resp += chunk
            head, rest = resp.split(b"\r\n\r\n", 1)
            if b"101" not in head.split(b"\r\n", 1)[0]:
                raise ConnectionError(f"ws 握手被拒: {head[:120]!r}")
            expect = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
            if expect not in head:
                raise ConnectionError("ws 握手 Sec-WebSocket-Accept 不符")
            sock.settimeout(None)
            buf = rest
            while not self._stop.is_set():
                while len(buf) < 2:
                    buf += self._recvall(sock, 2 - len(buf))
                b1, b2 = buf[0], buf[1]
                op, ln, off = b1 & 0x0F, b2 & 0x7F, 2
                if ln == 126:
                    while len(buf) < off + 2:
                        buf += self._recvall(sock, off + 2 - len(buf))
                    ln = struct.unpack(">H", buf[off:off + 2])[0]; off += 2
                elif ln == 127:
                    while len(buf) < off + 8:
                        buf += self._recvall(sock, off + 8 - len(buf))
                    ln = struct.unpack(">Q", buf[off:off + 8])[0]; off += 8
                masked = b2 & 0x80
                if masked:
                    while len(buf) < off + 4:
                        buf += self._recvall(sock, off + 4 - len(buf))
                    mask = buf[off:off + 4]; off += 4
                while len(buf) < off + ln:
                    buf += self._recvall(sock, off + ln - len(buf))
                payload = buf[off:off + ln]
                buf = buf[off + ln:]
                if masked:
                    payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
                if op == 0x8:
                    break
                if op == 0x9:
                    self._send_pong(sock, payload)
                    continue
                if op != 0x1:
                    continue
                try:
                    ev = json.loads(payload.decode("utf-8", "replace"))
                except json.JSONDecodeError:
                    continue
                if ev.get("type") == "executing":
                    data = ev.get("data") or {}
                    pid = data.get("prompt_id")
                    if self.own_pids and pid and pid not in self.own_pids:
                        continue  # 他家任务的事件(client_id 唯一化主防之外的第二道)
                    node = data.get("node")
                    if isinstance(node, str) and node and node not in self.saw:
                        self.saw.add(node)
                        self.executed.append(node)
                        log(f"[WS] {time.time() - _T0:7.1f}s  #{node}")  # 1118 owner 令:逐节点实录盯 TE 段耗时
            try:
                sock.close()
            except OSError:
                pass
        except Exception as e:  # noqa: BLE001 —— 证据线程失败=降级,不倒主流程
            self.error = f"{type(e).__name__}: {e}"

    def stop(self):
        self._stop.set()


# ---------------- 帧取证 ----------------
def probe_frame(video: str, t: float) -> bytes:
    """ffmpeg 抽 t 秒灰度帧(raw)。视频短于 t 则取中点。"""
    meta = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                           "-of", "csv=p=0", video], capture_output=True, text=True)
    try:
        dur = float(meta.stdout.strip())
        if t > dur - 0.05:
            t = max(0.0, dur / 2)
    except ValueError:
        pass
    r = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", video,
                        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                       capture_output=True, timeout=120)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError(f"ffmpeg 抽帧失败: {r.stderr.decode('utf-8', 'replace')[:300]}")
    return r.stdout


def frame_diff(a: bytes, b: bytes) -> dict:
    if len(a) != len(b):
        return {"error": f"帧尺寸不符 a={len(a)} b={len(b)}(远端与 p3 分辨率不一致)", "mean": None,
                "changed_px_gt12": None, "pixels": len(a)}
    try:
        import numpy as np
        va, vb = np.frombuffer(a, dtype=np.uint8), np.frombuffer(b, dtype=np.uint8)
        d = np.abs(va.astype(np.int16) - vb.astype(np.int16))
        return {"mean": round(float(d.mean()), 4), "changed_px_gt12": int((d > 12).sum()),
                "pixels": int(va.size)}
    except ImportError:
        total = changed = s = 0
        for x, y in zip(a, b):
            dd = x - y if x >= y else y - x
            s += dd
            changed += dd > 12
            total += 1
        return {"mean": round(s / max(total, 1), 4), "changed_px_gt12": changed, "pixels": total}


# ---------------- 主流程 ----------------
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", nargs="?", const="__default__", default="__default__",
                    help="API 平铺 prompt dict JSON 文件;裸传/缺省=内置 5s 探针装配"
                         "(API 模板+ycx4k-ref.png 全图槽+组装器缺省面同款摘除)")
    ap.add_argument("--state", required=True, choices=["bypass", "repair"])
    # --prefix/--probe/--identity 均为可选值参数(nargs="?"):发车门 flag 风格裸传不炸
    # (1118 门红判例:--probe 被当无值 flag 传 → expected one argument)
    ap.add_argument("--prefix", nargs="?", const=None, default=None,
                    help="重写全部 SaveVideo filename_prefix 的目录段(basename 保留);裸传/缺省=不改")
    ap.add_argument("--probe", nargs="?", const="inline-1118", default="inline-1118",
                    help="探针标签(入结果 JSON);裸传=缺省 inline-1118")
    ap.add_argument("--engine", default=DEFAULT_ENGINE)
    ap.add_argument("--identity", nargs="?", const=None, default=None,
                    help="覆写 #25 修脸身份提示词(缺省用 config 现值);裸传=不覆写")
    ap.add_argument("--frame-t", type=float, default=1.0, help="repair 帧差取证时间点(秒,默认 1.0)")
    ap.add_argument("--max-resend", type=int, default=3, help="interrupt 重发上限(默认 3)")
    ap.add_argument("--queue-timeout", type=int, default=1800, help="队列门同前缀在途死等上限秒")
    ap.add_argument("--queue-grace", type=int, default=120,
                    help="队列繁忙观察窗秒:过窗且无同前缀/同 client 在途=降级放行排队(1118 实勘:引擎常年被并行长任务占用,「空才发」不可满足)")
    ap.add_argument("--run-timeout", type=int, default=14400, help="单次发车完赛上限秒")
    ap.add_argument("--http-stale-sec", type=int, default=600,
                    help="完赛轮询对引擎 HTTP 失联的容忍窗秒(1118 实勘:在途长任务可把引擎事件循环拖 hang,瞬断即崩=取证全丢;连续失联超窗才判死)")
    ap.add_argument("--poll", type=float, default=5.0, help="history 轮询间隔秒")
    ap.add_argument("--ssh-host", help="ssh 兜底主机(缺省不启用;引擎交互恒 HTTP 优先)")
    ap.add_argument("--dry-run", action="store_true", help="只打印注入后 prompt 与计划断言,不发车")
    a = ap.parse_args()

    if a.config in (None, "__default__"):
        g = build_default_probe_config()
        a.prefix = a.prefix or f"video/漫影/facerefine-1118/{a.probe}-{a.state}"
        config_src = f"builtin-probe(模板+{PROBE_IMAGE})"
    else:
        g = json.loads(open(a.config, encoding="utf-8").read())
        config_src = a.config
    for need in ("1065", "25", "4002", "4003", "4100"):
        if need not in g:
            print(json.dumps({"all_pass": False, "error": f"config 缺节点 {need}(须用内置修脸臂的 API 模板)"},
                             ensure_ascii=False))
            return 1
    g["1065"]["inputs"]["value"] = (a.state == "repair")
    if a.identity:
        g["25"]["inputs"]["value"] = a.identity
    if a.prefix:
        for nid, n in g.items():
            if n.get("class_type") == "SaveVideo":
                p = n["inputs"].get("filename_prefix", "")
                n["inputs"]["filename_prefix"] = a.prefix.rstrip("/") + "/" + p.rsplit("/", 1)[-1]

    planned = (["executed_50xx==0(需 websocket 执行流证据)", "p-final 对 p3 同帧差 mean<=3.0(重编码级)",
                "4100 p-final 落盘"] if a.state == "bypass" else
               ["4100 p-final 一次调用出片", "p1/p2/p3 照常落盘",
                f"t≈{a.frame_t}s 帧对 p3 差分>12 像素数>=1000(千级)"])
    if a.dry_run:
        print(json.dumps({"dry_run": True, "state": a.state, "probe": a.probe, "config": config_src,
                          "planned_assertions": planned, "prompt": g}, ensure_ascii=False, indent=2))
        return 0

    # client_id 唯一化:引擎 executing 事件按 client_id 定向路由——与在途探针撞名会串台
    # 污染取证清单(1118 实勘:队列里 inline-fire-inline-1118-bypass 在途,撞名必混流)
    import uuid
    client_id = f"inline-fire-{a.probe}-{a.state}-{uuid.uuid4().hex[:6]}"
    assertions: list[dict] = []
    result = {"state": a.state, "probe": a.probe, "config": config_src, "engine": a.engine, "prompt_id": None,
              "attempts": 0, "gate": None, "queue_wait_sec": None, "duration_sec": None,
              "executed_nodes": None, "executed_nodes_count": None, "executed_50xx": None,
              "evidence": None, "outputs": None, "diff": None, "assertions": assertions}

    # ---- 队列门三档:空即发(理想)/ 繁忙超观察窗且无自家在途=降级放行排队 / 自家在途死等 ----
    tq = time.time()
    while True:
        try:
            q = http_json(a.engine, "/queue", retries=1)
        except Exception as e:  # noqa: BLE001 —— 门阶段失联不崩,总窗 queue_timeout+grace 内重试
            if time.time() - tq > a.queue_timeout + a.queue_grace:
                result["error"] = f"队列门期间引擎 HTTP 持续失联({type(e).__name__})"
                print(json.dumps(result, ensure_ascii=False))
                return 1
            log(f"[WARN] 队列门轮询失联({type(e).__name__}),重试中")
            time.sleep(5)
            continue
        running = q.get("queue_running") or []
        pending = q.get("queue_pending") or []
        if not running and not pending:
            result["gate"] = "clean"
            break
        if time.time() - tq > a.queue_grace:
            mine = same_run_in_flight(running + pending, client_id, a.prefix)
            if not mine:
                result["gate"] = "degraded_busy"
                log(f"[GATE] 队列繁忙({len(running)}跑/{len(pending)}等)观察窗 {a.queue_grace}s 过、"
                    f"无同前缀/同 client 在途,降级放行排队(引擎自然先来后到)")
                break
            if time.time() - tq > a.queue_timeout:
                result["error"] = f"队列门超时({a.queue_timeout}s):同前缀在途未清 {sorted(mine)}"
                print(json.dumps(result, ensure_ascii=False))
                return 1
            log(f"[GATE] 同前缀在途 {sorted(mine)},继续等(防自撞重发)")
        time.sleep(5)
    result["queue_wait_sec"] = round(time.time() - tq, 1)

    # ---- 发车 + interrupt 重发 ----
    ws = WsCapture(a.engine, client_id)
    ws.start()
    t0 = time.time()
    entry = None
    for attempt in range(1, a.max_resend + 2):
        result["attempts"] = attempt
        r = post_json(a.engine, "/prompt", {"client_id": client_id, "prompt": g,
                                            "extra_data": {"client_id": client_id}})
        if "error" in r or not r.get("prompt_id"):
            ws.stop()
            result["error"] = f"引擎拒单: {json.dumps(r, ensure_ascii=False)[:500]}"
            print(json.dumps(result, ensure_ascii=False))
            return 1
        pid = r["prompt_id"]
        result["prompt_id"] = pid
        ws.own_pids.add(pid)
        log(f"[FIRE] attempt#{attempt} pid={pid} state={a.state}")
        entry = None
        stale_since = None
        while True:
            time.sleep(a.poll)
            # 旁路止损硬门(1118 owner 令):ws 实时执行流出现修脸臂节点(5002-5023/25;
            # 5100/4100/1065 终档组豁免——5100 开关旁路态合法执行以选 4002,1118 实勘定谳)
            # =prune 失效,立刻 interrupt 止损防烧穿引擎;判 FAIL 不重发(a2 事故=136 分钟 CPU 死循环)
            if a.state == "bypass":
                hit = sorted(BYPASS_ARM_NODE_IDS & set(ws.executed))
                if hit:
                    log(f"[STOP-LOSS] 旁路态 ws 执行流发现 {hit},prune 失效,interrupt 止损")
                    try:
                        post_json(a.engine, "/interrupt", {}, retries=1)
                    except Exception as e:  # noqa: BLE001
                        log(f"[STOP-LOSS] interrupt 发送失败({type(e).__name__}: {str(e)[:60]}),仍判 FAIL")
                    ws.stop()
                    result["executed_nodes"] = list(ws.executed)
                    result["executed_nodes_count"] = len(ws.executed)
                    result["executed_50xx"] = hit
                    result["evidence"] = "websocket(stop-loss)"
                    assertions.append({"name": "旁路实时止损(修脸臂节点出现即 interrupt)",
                                       "pass": False,
                                       "detail": f"ws 执行流发现臂节点 {hit} — prune 失效,已 interrupt 止损"
                                                 f"(终档组 5100/4100/1065 豁免;引擎核心 ComfySwitchNode lazy "
                                                 f"实证 nodes_logic.py:125-149,此处红=接线/引擎语义漂移,须人工核)"})
                    result["all_pass"] = False
                    print(json.dumps(result, ensure_ascii=False))
                    return 1
            if time.time() - t0 > a.run_timeout:
                ws.stop()
                result["error"] = f"完赛超时({a.run_timeout}s)"
                print(json.dumps(result, ensure_ascii=False))
                return 1
            try:
                h = http_json(a.engine, f"/history/{pid}", retries=1)
                stale_since = None
            except Exception as e:  # noqa: BLE001 —— 引擎瞬断/hang 容忍窗内继续轮询
                if stale_since is None:
                    stale_since = time.time()
                    log(f"[WARN] 引擎 HTTP 失联({type(e).__name__}: {str(e)[:60]}),"
                        f"容忍窗 {a.http_stale_sec}s 内继续轮询(1118 实勘:在途长任务可拖 hang 事件循环)")
                if time.time() - stale_since > a.http_stale_sec:
                    ws.stop()
                    result["error"] = (f"引擎 HTTP 持续失联 {a.http_stale_sec}s(进程 hang?pid={pid};"
                                       f"ws 取证 {len(ws.executed)} 节点已录,产物未取证)")
                    print(json.dumps(result, ensure_ascii=False))
                    return 1
                continue
            if pid not in h:
                continue
            e = h[pid]
            msgs = [m[0] for m in e.get("status", {}).get("messages", [])]
            if any(m == "execution_error" for m in msgs):
                ws.stop()
                err = next(m[1] for m in e["status"]["messages"] if m[0] == "execution_error")
                result["error"] = f"执行错误: {json.dumps(err, ensure_ascii=False)[:800]}"
                print(json.dumps(result, ensure_ascii=False))
                return 1
            if e.get("status", {}).get("completed") or "execution_success" in msgs:
                entry = e
                break
            if "execution_interrupted" in msgs or e.get("status", {}).get("status_str") == "error":
                log(f"[WARN] attempt#{attempt} 被中断(并行会话),重发")
                break
        if entry is not None:
            break
    result["duration_sec"] = round(time.time() - t0, 1)
    time.sleep(1.0)
    ws.stop()
    ws.join(timeout=5)
    if ws.executed:
        result["executed_nodes"] = ws.executed
        result["executed_nodes_count"] = len(ws.executed)
        result["evidence"] = "websocket"
        log(f"[WS] 执行节点 {len(ws.executed)} 个;ws.error={ws.error}")
    else:
        result["evidence"] = f"outputs_only(ws 未取到执行流: {ws.error})"
        log(f"[WS] 无执行流证据: {ws.error}")
    # 完赛统计口径=修脸臂本体+输入件 25(终档组 5100/4100/1065 两态合法,不入禁集;初版
    # 5000-5199 段判定把 5100 误计入=1118 第二轮假红根因,ws 流实证 5100 合法执行而臂零执行)
    result["executed_50xx"] = sorted(BYPASS_ARM_NODE_IDS & set(ws.executed or []))

    # ---- 产物清单 ----
    outs: dict[str, list[dict]] = {}
    for nid, o in (entry.get("outputs") or {}).items():
        arts = o.get("images") or o.get("gifs") or o.get("audio")
        if arts:
            outs[nid] = [{"filename": x.get("filename"), "subfolder": x.get("subfolder", ""),
                          "type": x.get("type", "output"),
                          **({"meta": x["metadata"]} if x.get("metadata") else {})} for x in arts]
    result["outputs"] = outs

    def save_file(nid):
        return (outs.get(nid) or [{}])[0]

    def grab(nid):
        f = save_file(nid)
        if not f.get("filename"):
            return None
        dst = os.path.join(workdir, f"{nid}_{os.path.basename(f['filename'])}")
        return download(a.engine, f["filename"], f.get("subfolder", ""), f.get("type", "output"),
                        dst, a.ssh_host)

    workdir = tempfile.mkdtemp(prefix="inline-fire-1118-")

    def judge(name, cond, detail):
        assertions.append({"name": name, "pass": bool(cond), "detail": detail})
        log(f"[{'PASS' if cond else 'FAIL'}] {name}: {detail}")

    if a.state == "bypass":
        judge("执行清单无修脸臂(5002-5023+25;终档组 5100/4100/1065 两态合法豁免)",
              result["evidence"] == "websocket" and not result["executed_50xx"],
              f"evidence={result['evidence']} 50xx={result['executed_50xx']}(无 ws 证据=证据不足判不过)")
        p3f, pff = grab("4003"), grab("4100")
        judge("4100 p-final 落盘", bool(save_file("4100").get("filename")),
              f"4100={save_file('4100').get('filename')}")
        if p3f and pff:
            d = frame_diff(probe_frame(p3f, a.frame_t), probe_frame(pff, a.frame_t))
            result["diff"] = {"frame_t": a.frame_t, **d}
            judge("终档=p3 直通(重编码级帧差)", d.get("mean") is not None and d["mean"] <= 3.0,
                  f"mean={d.get('mean')} changed_px_gt12={d.get('changed_px_gt12')}({d.get('error', '')})")
        else:
            judge("终档=p3 直通(重编码级帧差)", False, "p3 或 p-final 产物未取到")
    else:
        judge("4100 p-final 一次调用出片", bool(save_file("4100").get("filename")),
              f"4100={save_file('4100').get('filename')}")
        judge("p1/p2/p3 照常落盘", all(save_file(n).get("filename") for n in ("2061", "3071", "4003")),
              f"p1={save_file('2061').get('filename')} p2={save_file('3071').get('filename')} "
              f"p3={save_file('4003').get('filename')}")
        p3f, pff = grab("4003"), grab("4100")
        if p3f and pff:
            d = frame_diff(probe_frame(p3f, a.frame_t), probe_frame(pff, a.frame_t))
            result["diff"] = {"frame_t": a.frame_t, **d}
            judge("远端小脸修复定量(t≈1s 帧 >12 差分像素千级)",
                  d.get("changed_px_gt12") is not None and d["changed_px_gt12"] >= 1000,
                  f"changed_px_gt12={d.get('changed_px_gt12')} mean={d.get('mean')}({d.get('error', '')})")
        else:
            judge("远端小脸修复定量(t≈1s 帧 >12 差分像素千级)", False, "p3 或 p-final 产物未取到")

    result["all_pass"] = all(x["pass"] for x in assertions)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["all_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
