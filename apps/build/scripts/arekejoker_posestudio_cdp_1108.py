#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""VNCCS PoseStudio · 远程引擎 CDP 发车员(1108,Mac 侧跑)。

把 qwen21-nsfw-pose-skill/scripts/run_vnccs_ui.py(作者版,本机 ComfyUI)的
CDP 流程改造成远程引擎版:VNCCS_PoseStudio 需要前端 WebGL live-capture
(纯 API 会 Live capture timed out),所以仍走浏览器——Mac 本机 Chrome 开
CDP,加载图 → 摆好角色图/姿势/装配文 → 从 UI queuePrompt → 产物从引擎
/history + /view 收(引擎在远端,作者版的本地 output 目录扫描用不了)。

与作者脚本的差异(详细账见交付说明):
  ① 引擎 = http://192.168.0.101:17000(env COMFYUI_URL 同款重定向),直连
     urllib,不做 ssh 备援——浏览器本身也要直连引擎前端,ssh 通道救不了 CDP 路。
  ② 浏览器 = 本机 Chrome(/Applications/Google Chrome.app);playwright 在则
     connect_over_cdp(作者 browser_fallback 同契约);playwright 缺席时不再
     依赖它,内置纯 stdlib 裸 CDP 客户端(RFC6455 websocket + Runtime.evaluate)
     完成同样的事——本机 Mac 无 playwright/websocket 库,作者 fallback 的
     "起浏览器开调试口再连"思路照抄,客户端换自研。
  ③ 角色图 daojie_nvxiu_mounted_1108.png 已在引擎 input(发车前对
     /object_info/LoadImage 清单核账),不走本地拷贝;缺即环境障碍。
  ④ 工作流 = 仓库 4_姿势编辑/VNCCS姿势-PoseStudio.json(1108 归位令自
     3_社区模板 迁入,文件名不变;LoRA 已平铺,
     引擎在位);rgthree Comparer 照作者裁掉(纯 viewer,输入端装饰性);
     QwenImage21Cache 保留(作者删它是其机器的 aimdo 专属病;引擎 object_info
     实证该节点在)——引擎真报错时 env POSESTUDIO_DROP_CACHE=1 可启用作者手术。
  ⑤ TextEncodeQwenImage21.prompt 注入道劫三层装配全文:合成包直调仓库
     MyQi21PromptAssembly().assemble()(真源零漂移),主体句复用
     qi21_daojie_pose_build_1108.py 的 v5 终态(挂腰剑版)。发车前全文打印一次。
  ⑥ 仓库版工作流带 widgets_values_named(named 优先于 list),注入双写。

退出码:0 success;1 已发车未达(超时/引擎报错/零产物);2 环境障碍
(文件缺/引擎不可达/资产不在位/浏览器不可得);3 发车前 /queue 非空。
最后一行:单行 POSESTUDIO_VERDICT {json}(退出 2/3 打 POSESTUDIO_ABORT 不打
VERDICT),json={"pose","status","seconds","outputs","files"},
status ∈ success|error|timeout。

用法:
  python3 arekejoker_posestudio_cdp_1108.py --pose Crawling
  python3 arekejoker_posestudio_cdp_1108.py --pose "Kneeling Legs Apart" --timeout 900
  python3 arekejoker_posestudio_cdp_1108.py --pose Crawling --prompt "<装配全文,可含换行>"
  python3 arekejoker_posestudio_cdp_1108.py --list-poses
  python3 arekejoker_posestudio_cdp_1108.py --pose Crawling --dry-run   # 全预检+打印装配文,不发车
  (--prompt 给定=原文注入 TextEncodeQwenImage21.prompt;未给定=三层装配真源直调)
环境: COMFYUI_URL(默认下述引擎)/ COMFY_BROWSER_CDP(既有 CDP 端点,如
  http://127.0.0.1:9222)/ COMFY_BROWSER_PORT(自起 Chrome 调试口,默认 18800,
  端口占用时自动换闲口)/ COMFY_BROWSER_HEADLESS(默认 1=headless=new+swiftshader
  照作者实证旗;0=有头真 GPU)/ POSESTUDIO_DROP_CACHE(=1 启用作者的删
  QwenImage21Cache+LoRA直连KSampler 手术)。
"""
from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import types
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF_FILE = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/4_姿势编辑/VNCCS姿势-PoseStudio.json"
POSE_DIR = (REPO / ".agents/skills/qwen-image-prompt/qwen21-nsfw-pose-skill"
            "/pose_library/local_user_poses/Uncategorized")
NODES_DIR = REPO / "apps/backend/comfyui/my_nodes/nodes"
BUILD_1108 = REPO / "apps/build/scripts/qi21_daojie_pose_build_1108.py"

ENGINE = os.environ.get("COMFYUI_URL", "http://192.168.0.101:17000").rstrip("/")
OUT = REPO / ".zcode/tmp/posestudio-1108"
CHAR_IMAGE = "daojie_nvxiu_mounted_1108.png"
DAOJIE_BASE = "人物海报"

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
]
CDP_PORT_DEFAULT = int(os.environ.get("COMFY_BROWSER_PORT", "18800"))
CDP_ENDPOINT = (os.environ.get("COMFY_BROWSER_CDP") or f"http://127.0.0.1:{CDP_PORT_DEFAULT}").rstrip("/")
HEADLESS = os.environ.get("COMFY_BROWSER_HEADLESS", "1") != "0"
DROP_CACHE = os.environ.get("POSESTUDIO_DROP_CACHE", "") == "1"

PROBE_TIMEOUT_S = 8
GET_TIMEOUT_S = 30
PID_DISCOVER_S = 30          # queuePrompt 后在 /queue 里找自家 prompt_id 的窗口
POLL_INTERVAL_S = 5.0
POLL_FAIL_STREAK_MAX = 8     # 连续 8 次 /history 查询失败 → 判 error

EXIT_OK, EXIT_SHOT_FAIL, EXIT_ENV, EXIT_QUEUE_BUSY = 0, 1, 2, 3


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


class EnvObstacle(RuntimeError):
    """环境障碍:不可发车,退出码 2。"""


# ── 引擎 HTTP(直连;浏览器也须直连引擎前端,ssh 备援对本流程无意义) ──
def http_get(path_or_url: str, timeout: float = GET_TIMEOUT_S) -> tuple[int, str]:
    url = path_or_url if path_or_url.startswith("http") else ENGINE + path_or_url
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def http_get_bytes(url: str, timeout: float = 120) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url), timeout=timeout) as r:
        return r.read()


def queue_load() -> tuple[int, int]:
    """(running, pending);查询失败按环境障碍收场(fail-closed)。"""
    try:
        status, text = http_get("/queue", timeout=PROBE_TIMEOUT_S)
    except Exception as e:
        raise EnvObstacle(f"GET /queue 失败: {type(e).__name__}: {e}") from None
    if status != 200:
        raise EnvObstacle(f"GET /queue HTTP {status}: {text[:200]}")
    try:
        q = json.loads(text)
        return len(q.get("queue_running") or []), len(q.get("queue_pending") or [])
    except ValueError as e:
        raise EnvObstacle(f"/queue 响应非 JSON: {text[:200]}") from None


def object_info(node_type: str) -> dict | None:
    status, text = http_get("/object_info/" + urllib.parse.quote(node_type), timeout=PROBE_TIMEOUT_S)
    if status != 200:
        return None
    try:
        return json.loads(text).get(node_type)
    except ValueError:
        return None


def list_input_images() -> list[str]:
    d = object_info("LoadImage") or {}
    try:
        listing = d["input"]["required"]["image"][0]
    except (KeyError, TypeError, IndexError) as e:
        raise EnvObstacle(f"/object_info/LoadImage 响应畸形({e})") from None
    return [x for x in listing if isinstance(x, str)]


# ── 三层装配(真源直调:合成包加载 my_nodes/nodes 两件,零漂移) ─────────
def _load_daojie_module(name: str, pkg: str, loaded: dict) -> types.ModuleType:
    if name in loaded:
        return loaded[name]
    path = NODES_DIR / f"{name}.py"
    if not path.is_file():
        raise EnvObstacle(f"装配真源缺失: {path}")
    src = path.read_text(encoding="utf-8")
    for dep in re.findall(r"^from \.(\w+) import", src, re.M):
        _load_daojie_module(dep, pkg, loaded)
    spec = importlib.util.spec_from_file_location(f"{pkg}.{name}", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    loaded[name] = mod
    return mod


def build_assembly() -> tuple[str, str]:
    """返回 (装配全文, 负面词)。BASE/负面走 MyQi21DaojieBase.run 现读,装配走
    MyQi21PromptAssembly.assemble(1108 层结构体化渲染);主体句复用 build_1108
    的 v5 终态常量(挂腰剑版,与 daojie_nvxiu_mounted_1108.png 配套)。"""
    pkg = types.ModuleType("_posestudio_daojie_pkg")
    pkg.__path__ = [str(NODES_DIR)]
    sys.modules[pkg.__name__] = pkg
    loaded: dict = {}
    base_mod = _load_daojie_module("my_qi21_base", pkg.__name__, loaded)
    asm_mod = _load_daojie_module("my_qi21_prompt_assembly", pkg.__name__, loaded)

    if not BUILD_1108.is_file():
        raise EnvObstacle(f"主体句真源缺失: {BUILD_1108}")
    spec = importlib.util.spec_from_file_location("_qi21_daojie_pose_build_1108", BUILD_1108)
    build_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build_mod)  # 模块体只有常量,build() 在 __main__ 守卫内

    try:
        base_text, _w, _h, base_neg, _rgba, _name = base_mod.MyQi21DaojieBase().run(DAOJIE_BASE)
    except Exception as e:
        raise EnvObstacle(f"MyQi21DaojieBase.run({DAOJIE_BASE}) 失败: {type(e).__name__}: {e}") from None
    try:
        pos, neg = asm_mod.MyQi21PromptAssembly().assemble(
            BASE=base_text, BASE负面=base_neg, 主体句=build_mod.SUBJECT)
    except Exception as e:
        raise EnvObstacle(f"MyQi21PromptAssembly.assemble 失败: {type(e).__name__}: {e}") from None
    if not (pos or "").strip():
        raise EnvObstacle("装配全文为空")
    return pos, neg


# ── 姿势解析(按文件名匹配 Uncategorized 姿势库) ─────────────────────
def resolve_pose(name: str) -> Path:
    if not POSE_DIR.is_dir():
        raise EnvObstacle(f"姿势库目录缺失: {POSE_DIR}")
    stems = {p.stem: p for p in sorted(POSE_DIR.glob("*.json"))}
    lower = {k.lower(): v for k, v in stems.items()}
    hit = lower.get(name.strip().lower())
    if hit:
        return hit
    sub = [v for k, v in lower.items() if name.strip().lower() in k]
    if len(sub) == 1:
        return sub[0]
    if not sub:
        raise EnvObstacle(f"姿势 '{name}' 未命中 {POSE_DIR} 下任何 JSON 文件名"
                          f"(共 {len(stems)} 个;--list-poses 看全表)")
    raise EnvObstacle(f"姿势 '{name}' 歧义,命中 {[p.stem for p in sub][:6]},请用全名")


# ── 工作流手术(作者 prep_workflow 对位 + named 双写) ────────────────
def prep_workflow(pose_json: str, char_name: str, prefix: str, prompt: str) -> dict:
    wf = json.loads(WF_FILE.read_text(encoding="utf-8"))

    # 作者对位:裁 rgthree Comparer(纯 viewer 节点,输入端装饰性)
    drop = [n["id"] for n in wf["nodes"] if n["type"].startswith("Image Comparer")]
    wf["nodes"] = [n for n in wf["nodes"] if n["id"] not in drop]
    wf["links"] = [l for l in wf["links"] if l[1] not in drop and l[3] not in drop]
    # 注:QwenImage21Cache 保留(作者删它是其机器 aimdo 专属病;引擎 object_info
    # 实证该节点在)。真需要作者手术时 env POSESTUDIO_DROP_CACHE=1 走前端 JS 路。

    def set_widget(n: dict, key: str, value, index: int = 0) -> None:
        wv = n.get("widgets_values")
        if isinstance(wv, list) and len(wv) > index:
            wv[index] = value
        named = n.get("widgets_values_named")
        if isinstance(named, dict):
            named[key] = value  # named 优先于 list,必须双写(仓库版带 named)

    for n in wf["nodes"]:
        if n["type"] == "LoadImage":
            set_widget(n, "image", char_name, 0)
        elif n["type"] == "SaveImage" and n.get("widgets_values"):
            set_widget(n, "filename_prefix", prefix, 0)
        elif n["type"] == "VNCCS_PoseStudio":
            set_widget(n, "pose_data", pose_json, 0)
        elif n["type"] == "TextEncodeQwenImage21":
            set_widget(n, "prompt", prompt, 0)

    # 注入位核账:list + named 双通道都真的落上(named 优先级更高,漏写=假注入)
    named_key = {"LoadImage": "image", "TextEncodeQwenImage21": "prompt",
                 "VNCCS_PoseStudio": "pose_data", "SaveImage": "filename_prefix"}
    want = {"LoadImage": char_name, "TextEncodeQwenImage21": prompt,
            "VNCCS_PoseStudio": pose_json, "SaveImage": prefix}
    for ntype, expect in want.items():
        nodes = [n for n in wf["nodes"] if n["type"] == ntype]
        if not nodes:
            raise EnvObstacle(f"工作流缺 {ntype} 节点")
        for n in nodes:
            got_list = (n.get("widgets_values") or [None])[0]
            got_named = (n.get("widgets_values_named") or {}).get(named_key[ntype])
            if got_list != expect or got_named != expect:
                raise EnvObstacle(
                    f"{ntype}.{named_key[ntype]} 注入未落("
                    f"list={str(got_list)[:40]!r}, named={str(got_named)[:40]!r})")
    return wf


# ── 浏览器获取:本机 Chrome + CDP(作者 browser_fallback 思路,纯 stdlib) ──
def _cdp_up(endpoint: str) -> bool:
    try:
        with urllib.request.urlopen(f"{endpoint}/json/version", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def _free_port(prefer: int) -> int:
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", prefer))
            return prefer
        except OSError:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]


def launch_chrome(port: int, profile: Path) -> subprocess.Popen:
    exe = next((c for c in CHROME_CANDIDATES if Path(c).is_file()), None)
    if not exe:
        raise EnvObstacle("本机 Chrome 未找到(试过 " + " / ".join(CHROME_CANDIDATES) + ")")
    args = [exe, f"--remote-debugging-port={port}", f"--user-data-dir={profile}",
            "--no-first-run", "--no-default-browser-check", "--mute-audio",
            "--disable-dev-shm-usage", "--window-size=1600,1000", "about:blank"]
    if HEADLESS:
        # 作者 fallback 实证旗:headless=new + swiftshader 跑 WebGL live-capture
        args[1:1] = ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    endpoint = f"http://127.0.0.1:{port}"
    deadline = time.time() + 30
    while time.time() < deadline:
        if _cdp_up(endpoint):
            return proc
        if proc.poll() is not None:
            raise EnvObstacle(f"Chrome 启动即退(status={proc.returncode})")
        time.sleep(0.5)
    proc.terminate()
    raise EnvObstacle(f"Chrome 30s 内未在 {endpoint} 暴露 CDP")


class _WS:
    """最小 RFC6455 websocket 客户端(客户端帧恒掩码),够 CDP 文本帧用。"""

    def __init__(self, url: str):
        u = urllib.parse.urlsplit(url)
        self.sock = socket.create_connection((u.hostname, u.port), timeout=15)
        self.sock.settimeout(30)
        key = base64.b64encode(os.urandom(16)).decode()
        path = u.path + (f"?{u.query}" if u.query else "")
        self.sock.sendall((
            f"GET {path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("ws 握手 EOF")
            resp += chunk
        head, _, self.buf = resp.partition(b"\r\n\r\n")
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise RuntimeError(f"ws 握手被拒: {head[:120]!r}")

    def _read_exact(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError("ws EOF")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _send_frame(self, opcode: int, payload: bytes) -> None:
        mask = os.urandom(4)
        header = bytearray([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header.append(0x80 | n)
        elif n < 1 << 16:
            header.append(0x80 | 126)
            header += n.to_bytes(2, "big")
        else:
            header.append(0x80 | 127)
            header += n.to_bytes(8, "big")
        header += mask
        self.sock.sendall(bytes(header) + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def send_text(self, text: str) -> None:
        self._send_frame(0x1, text.encode("utf-8"))

    def recv_text(self, deadline: float) -> str:
        parts: list[bytes] = []
        while True:
            if time.time() > deadline:
                raise TimeoutError("ws recv 超时")
            try:
                b1, b2 = self._read_exact(2)
            except socket.timeout:
                continue
            fin, op = (b1 >> 7) & 1, b1 & 0x0F
            masked = (b2 >> 7) & 1
            ln = b2 & 0x7F
            if ln == 126:
                ln = int.from_bytes(self._read_exact(2), "big")
            elif ln == 127:
                ln = int.from_bytes(self._read_exact(8), "big")
            data = self._read_exact(ln) if ln else b""
            if masked:  # 规范禁服务端掩码,容错解之
                mk = self._read_exact(4)
                data = bytes(b ^ mk[i % 4] for i, b in enumerate(data))
            if op == 0x8:
                raise RuntimeError("ws 被服务端关闭")
            if op == 0x9:  # ping → pong
                self._send_frame(0xA, data)
                continue
            if op == 0xA:
                continue
            if op in (0x0, 0x1, 0x2):
                parts.append(data)
                if fin:
                    return b"".join(parts).decode("utf-8", "replace")

    def close(self) -> None:
        try:
            self._send_frame(0x8, b"")
        except Exception:
            pass
        try:
            self.sock.close()
        except Exception:
            pass


class RawCDPPage:
    """playwright 缺席时的裸 CDP 页面适配器(goto/evaluate/screenshot/close)。"""

    def __init__(self, endpoint: str):
        # 新版 Chrome /json/new 要 PUT;旧版收 GET——两连击
        self.endpoint = endpoint.rstrip("/")
        target = None
        for method in ("PUT", "GET"):
            try:
                req = urllib.request.Request(f"{self.endpoint}/json/new?about:blank", method=method)
                with urllib.request.urlopen(req, timeout=8) as r:
                    body = json.loads(r.read().decode("utf-8", "replace"))
                target = body[0] if isinstance(body, list) else body
                break
            except Exception:
                continue
        if not target or not target.get("webSocketDebuggerUrl"):
            raise EnvObstacle(f"CDP /json/new 建标签页失败({self.endpoint})")
        self.target_id = target["id"]
        self.ws = _WS(target["webSocketDebuggerUrl"])
        self._nid = 0
        self.console: list[str] = []
        self._events: list[dict] = []
        self._cmd("Page.enable")
        self._cmd("Runtime.enable")

    def _cmd(self, method: str, params: dict | None = None, timeout: float = 60) -> dict:
        self._nid += 1
        mid = self._nid
        self.ws.send_text(json.dumps({"id": mid, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while True:
            msg = json.loads(self.ws.recv_text(deadline))
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"CDP {method}: {msg['error'].get('message')}")
                return msg.get("result") or {}
            self._pump(msg)

    def _pump(self, msg: dict) -> None:
        """非本命令响应的消息:console/异常抽进日志,其余事件入缓冲供 _wait_event。"""
        m, p = msg.get("method"), msg.get("params") or {}
        if m == "Runtime.consoleAPICalled":
            try:
                text = " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", []))
            except Exception:
                text = str(p)[:200]
            self.console.append(f"{p.get('type')}: {text[:500]}")
        elif m == "Runtime.exceptionThrown":
            d = p.get("exceptionDetails") or {}
            self.console.append(f"pageerror: {str(d.get('text'))[:300]} "
                                f"{str((d.get('exception') or {}).get('description'))[:300]}")
        self._events.append(msg)

    def _wait_event(self, method: str, timeout: float) -> None:
        for i, msg in enumerate(self._events):  # 先扫缓冲(等响应期间可能先到)
            if msg.get("method") == method:
                del self._events[i:]
                return
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = json.loads(self.ws.recv_text(deadline))
            if msg.get("method") == method:
                return
            self._pump(msg)
        raise TimeoutError(f"等 CDP 事件 {method} 超时")

    def goto(self, url: str, timeout: float = 45) -> None:
        self._cmd("Page.navigate", {"url": url}, timeout=timeout)
        try:
            self._wait_event("Page.loadEventFired", timeout)
        except TimeoutError:
            pass  # 作者同款:靠 settle 兜底,不因事件晚到误杀

    def evaluate(self, js: str, timeout: float = 90):
        res = self._cmd("Runtime.evaluate",
                        {"expression": js, "awaitPromise": True, "returnByValue": True},
                        timeout=timeout)
        if res.get("exceptionDetails"):
            d = res["exceptionDetails"]
            raise RuntimeError(f"页面执行异常: {d.get('text')} "
                                f"{str((d.get('exception') or {}).get('description'))[:300]}")
        return (res.get("result") or {}).get("value")

    def screenshot(self, path: Path) -> None:
        res = self._cmd("Page.captureScreenshot", {"format": "png"}, timeout=60)
        path.write_bytes(base64.b64decode(res.get("data", "")))

    def close(self) -> None:
        try:
            urllib.request.urlopen(f"{self.endpoint}/json/close/{self.target_id}", timeout=3)
        except Exception:
            pass
        self.ws.close()


class PlaywrightPage:
    """playwright 在场时的适配器(作者 connect_over_cdp 契约)。"""

    def __init__(self, pw, endpoint: str):
        self._pw = pw
        self.browser = pw.chromium.connect_over_cdp(endpoint)
        ctx = self.browser.contexts[0] if self.browser.contexts else self.browser.new_context()
        self.page = ctx.new_page()
        self.console: list[str] = []
        try:
            self.page.on("console", lambda m: self.console.append(f"{m.type}: {m.text}"))
            self.page.on("pageerror", lambda e: self.console.append(f"pageerror: {e}"))
        except Exception:
            pass

    def goto(self, url: str, timeout: float = 45) -> None:
        self.page.goto(url, timeout=int(timeout * 1000))

    def evaluate(self, js: str, timeout: float = 90):
        return self.page.evaluate(js)

    def screenshot(self, path: Path) -> None:
        self.page.screenshot(path=str(path))

    def close(self) -> None:
        try:
            self.page.close()
        finally:
            self.browser.close()


def acquire_page() -> tuple[object, list]:
    """(page适配器, 资源回收器列表)。端点序:env COMFY_BROWSER_CDP → 默认口
    既有端点(作者 auto 模式)→ 自起本机 Chrome。playwright 在则用它连,缺席走裸 CDP。"""
    cleanups: list = []
    endpoint = CDP_ENDPOINT
    if os.environ.get("COMFY_BROWSER_CDP"):
        if not _cdp_up(endpoint):
            raise EnvObstacle(f"COMFY_BROWSER_CDP 指定端点不可达: {endpoint}")
    elif not _cdp_up(endpoint):
        port = _free_port(CDP_PORT_DEFAULT)
        profile = OUT / f"_chrome_profile_{int(time.time())}"
        profile.mkdir(parents=True, exist_ok=True)
        proc = launch_chrome(port, profile)
        cleanups.append(lambda: (proc.terminate(), time.sleep(1),
                                 shutil.rmtree(profile, ignore_errors=True)))
        endpoint = f"http://127.0.0.1:{port}"
        log(f"已自起本机 Chrome({'headless' if HEADLESS else '有头'}) CDP={endpoint}")
    else:
        log(f"复用既有 CDP 端点 {endpoint}")

    try:
        from playwright.sync_api import sync_playwright  # 作者首选路
    except ImportError:
        sync_playwright = None
    if sync_playwright is not None:
        pw = sync_playwright().start()
        cleanups.append(lambda: pw.stop())
        page = PlaywrightPage(pw, endpoint)
        log(f"页面通道:playwright connect_over_cdp → {endpoint}")
    else:
        page = RawCDPPage(endpoint)
        log(f"页面通道:纯 stdlib 裸 CDP → {endpoint}")
    cleanups.append(page.close)
    return page, cleanups


# ── UI 流(作者 run_vnccs_ui.py 主流程对位) ─────────────────────────
def js_call(fn_src: str, arg) -> str:
    """统一把 (arg)=>{...} 源码 + 实参编成 IIFE 字符串(playwright/裸CDP 通用)。
    ensure_ascii=True:JS 源纯 ASCII,unicode 全走 \\uXXXX 转义,传输零风险。"""
    return f"({fn_src})({json.dumps(arg, ensure_ascii=True)})"


def settle(page, ms: int) -> None:
    """作者 settle 对位:睡眠但保持信道心跳。"""
    end = time.time() + ms / 1000.0
    while time.time() < end:
        time.sleep(0.5)
        try:
            page.evaluate("(() => 1)()")
        except Exception:
            pass


def wait_app(page, deadline_s: float = 30) -> None:
    """等前端就绪:window.app / graph / loadGraphData 三件全在才继续。
    远程引擎首屏是 SPA 异步初始化,作者本机版盲 settle 4s 不够用(实测翻车),
    这里轮询到就绪,超时按环境障碍收场。"""
    deadline = time.time() + deadline_s
    probe = ("(() => (window.app && window.app.graph && "
             "typeof window.app.loadGraphData === 'function') ? 1 : 0)()")
    while time.time() < deadline:
        try:
            if page.evaluate(probe) == 1:
                return
        except Exception:
            pass
        time.sleep(1)
    raise EnvObstacle(f"引擎前端 {deadline_s:.0f}s 内未就绪(window.app/loadGraphData 缺席)")


def load_and_verify(page, wf: dict, doll_prefix: str) -> dict:
    # 注:全部 evaluate 恒为 IIFE 调用表达式——playwright 认函数源会自动调,
    # 裸 CDP Runtime.evaluate 不会,统一 IIFE 两端同语义。
    wait_app(page)
    page.evaluate(js_call("(arg) => window.app.loadGraphData(arg)", wf))
    settle(page, 3000)
    if DROP_CACHE:  # 前端侧作者手术(仅 POSESTUDIO_DROP_CACHE=1 时)
        page.evaluate("""(() => {
            const g = window.app.graph;
            const nodes = g._nodes;
            const lora = nodes.find(n => n.type === 'LoraLoaderModelOnly');
            const ks = nodes.find(n => n.type === 'KSampler');
            const cache = nodes.find(n => n.type === 'QwenImage21Cache');
            if (lora && ks) {
                const slot = ks.inputs.findIndex(i => i.name === 'model');
                lora.connect(0, ks, slot);
            }
            if (cache) g.remove(cache);
            return true;
        })()""")
        settle(page, 1500)
    # 作者对位:加第二个 SaveImage 把姿势人偶(doll)也落盘
    page.evaluate(js_call("""(prefix) => {
        try {
            const g = window.app.graph;
            const ps = g._nodes.find(n => n.type === 'VNCCS_PoseStudio');
            if (!ps || !window.LiteGraph) return false;
            const sv = window.LiteGraph.createNode('SaveImage');
            sv.widgets[0].value = prefix;
            g.add(sv);
            ps.connect(0, sv, 0);
            return true;
        } catch (e) { return 'ERR:' + e.message; }
    }""", doll_prefix))
    settle(page, 1500)
    info = page.evaluate("""(() => {
        const g = window.app.graph._nodes;
        const li = g.find(n => n.type === 'LoadImage');
        const ps = g.find(n => n.type === 'VNCCS_PoseStudio');
        const te = g.find(n => n.type === 'TextEncodeQwenImage21');
        const w = (n, k) => (n && n.widgets.find(x => x.name === k)) || {};
        return {
            nodes: g.length,
            loadImage: w(li, 'image').value,
            poseLen: ps ? String(w(ps, 'pose_data').value).length : null,
            promptLen: te ? String(w(te, 'prompt').value).length : null,
        };
    })()""")
    log(f"图已载(前端 widget 实读): {json.dumps(info, ensure_ascii=False)}")
    return info if isinstance(info, dict) else {}


def find_pid_by_prefix(prefix: str, deadline_s: float = PID_DISCOVER_S) -> str | None:
    """queuePrompt 后从 /queue 抓自家 prompt_id(图里含唯一 SaveImage 前缀);
    任务若在窗口内就跑完(快败/快成),退 /history 近表找同前缀条目。"""
    deadline = time.time() + deadline_s
    while time.time() < deadline:
        try:
            status, text = http_get("/queue", timeout=PROBE_TIMEOUT_S)
            if status == 200:
                q = json.loads(text)
                for entry in (q.get("queue_running") or []) + (q.get("queue_pending") or []):
                    if isinstance(entry, list) and len(entry) >= 3 and prefix in json.dumps(entry[2]):
                        return str(entry[1])
        except Exception:
            pass
        try:
            status, text = http_get("/history?max_items=50", timeout=PROBE_TIMEOUT_S)
            if status == 200:
                for pid, entry in (json.loads(text) or {}).items():
                    if isinstance(entry, dict) and prefix in json.dumps(entry.get("prompt")):
                        return str(pid)
        except Exception:
            pass
        time.sleep(2)
    return None


def wait_history(pid: str, deadline_s: float) -> dict:
    """轮询 /history/{pid} 至完成;返回 {status_str, images:[{filename,subfolder,type}]}。"""
    deadline = time.time() + deadline_s
    fail_streak = 0
    while time.time() < deadline:
        time.sleep(POLL_INTERVAL_S)
        try:
            status, text = http_get(f"/history/{pid}")
            hist = json.loads(text)
            fail_streak = 0
        except Exception as e:
            fail_streak += 1
            log(f"history 查询失败×{fail_streak}: {type(e).__name__}: {e}")
            if fail_streak >= POLL_FAIL_STREAK_MAX:
                return {"status_str": "error", "images": [], "reason": f"history 连查失败×{fail_streak}"}
            continue
        entry = hist.get(pid) if isinstance(hist, dict) else None
        if not isinstance(entry, dict):
            continue
        st = entry.get("status") or {}
        if not st.get("completed"):
            continue
        images = []
        for v in (entry.get("outputs") or {}).values():
            if isinstance(v, dict):
                images.extend(v.get("images") or [])
        out = {"status_str": st.get("status_str"), "images": images}
        for m in st.get("messages") or []:
            if isinstance(m, list) and m and m[0] == "execution_error" and isinstance(m[1], dict):
                d = m[1]
                out["reason"] = (f"execution_error node={d.get('node_type')}/{d.get('node_id')} "
                                 f"{d.get('exception_type')}: {str(d.get('exception_message'))[:160]}")
        return out
    return {"status_str": "timeout", "images": [], "reason": f">{deadline_s:.0f}s 未完成"}


def download_outputs(images: list[dict]) -> list[str]:
    saved = []
    for img in images:
        fn, sub, ty = img.get("filename"), img.get("subfolder", ""), img.get("type", "output")
        if not fn:
            continue
        q = urllib.parse.urlencode({"filename": fn, "subfolder": sub, "type": ty})
        data = http_get_bytes(f"{ENGINE}/view?{q}")
        (OUT / fn).write_bytes(data)
        saved.append(fn)
        log(f"已收产物 {fn}({len(data)}B)→ {OUT / fn}")
    return saved


# ── 主流程 ──────────────────────────────────────────────────────────
def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    ap.add_argument("--pose", help=f"姿势名,按 {POSE_DIR} 下 JSON 文件名匹配")
    ap.add_argument("--char", default=CHAR_IMAGE, help=f"引擎 input 里的角色图名(默认 {CHAR_IMAGE})")
    ap.add_argument("--prompt", default=None,
                    help="直接注入 TextEncodeQwenImage21.prompt 的全文(可含换行);"
                         "给定则原样注入并跳过三层装配真源直调,未给定走真源装配")
    ap.add_argument("--timeout", type=int, default=900, help="单发上限秒数(默认 900)")
    ap.add_argument("--list-poses", action="store_true", help="列出姿势库全部姿势名")
    ap.add_argument("--dry-run", action="store_true", help="全预检+打印装配全文,不启浏览器不发车")
    a = ap.parse_args()

    if a.list_poses:
        if not POSE_DIR.is_dir():
            print(f"POSESTUDIO_ABORT 环境障碍,退出码 2:姿势库目录缺失 {POSE_DIR}")
            return EXIT_ENV
        for p in sorted(POSE_DIR.glob("*.json")):
            print(p.stem)
        print(f"# 共 {len(list(POSE_DIR.glob('*.json')))} 个姿势(Uncategorized)", file=sys.stderr)
        return EXIT_OK
    if not a.pose:
        print("POSESTUDIO_ABORT 环境障碍,退出码 2:--pose 必填(--list-poses 看全表)", file=sys.stderr)
        return EXIT_ENV

    t0 = time.monotonic()
    try:
        # ── 预检(退出 2/3 路径不碰浏览器) ──
        if not WF_FILE.is_file():
            raise EnvObstacle(f"工作流缺失: {WF_FILE}")
        pose_path = resolve_pose(a.pose)
        pose_json = pose_path.read_text(encoding="utf-8")
        json.loads(pose_json)  # 姿势文件必须是合法 JSON,坏文件早爆
        # prompt 来源:--prompt 给定 → 原样注入(CLI 全文,不重排不改写);
        # 未给定 → 三层装配真源直调。负面仅存档用,CLI 路真源缺席不堵车。
        if a.prompt is not None:
            prompt = a.prompt
            if not prompt.strip():
                raise EnvObstacle("--prompt 传了但为空")
            try:
                _pos, negative = build_assembly()
            except EnvObstacle:
                negative = ""
            prompt_source = "cli"
        else:
            prompt, negative = build_assembly()
            prompt_source = "assembly"

        running, pending = queue_load()  # 引擎可达性一并验了
        log(f"引擎 {ENGINE} 可达;/queue running={running} pending={pending}")

        inputs = list_input_images()
        char_hits = [x for x in inputs if x.rsplit("/", 1)[-1] == a.char]
        if not char_hits:
            raise EnvObstacle(f"角色图 {a.char} 不在引擎 input(现存 {len(inputs)} 张;"
                              f"前 5: {inputs[:5]});ask 口径=图已在引擎,缺即环境障碍,不走上传")
        char_name = char_hits[0]

        # 工作流四 loader 资产在位核账(LoRA 已平铺路径,引擎侧实证)
        wf_raw = json.loads(WF_FILE.read_text(encoding="utf-8"))
        loaders = {"UNETLoader": "unet_name", "CLIPLoader": "clip_name",
                   "VAELoader": "vae_name", "LoraLoaderModelOnly": "lora_name"}
        for ntype, key in loaders.items():
            want = next((n["widgets_values_named"].get(key) for n in wf_raw["nodes"]
                         if n["type"] == ntype and isinstance(n.get("widgets_values_named"), dict)), None)
            if not want:
                continue
            info = object_info(ntype) or {}
            listing = next((v[0] for v in (info.get("input", {}).get("required", {}) or {}).values()
                            if isinstance(v, list) and isinstance(v[0], list)), [])
            if want not in listing:
                raise EnvObstacle(f"{ntype}.{key}={want} 不在引擎资产清单")
        if object_info("VNCCS_PoseStudio") is None:
            raise EnvObstacle("引擎无 VNCCS_PoseStudio 节点(ComfyUI_VNCCS_Utils 未装?)")

        if running or pending:
            print(f"POSESTUDIO_ABORT /queue 非空(running={running}, pending={pending}),"
                  f"引擎有任务在途,取消发车,退出码 3", flush=True)
            return EXIT_QUEUE_BUSY

        tag = "_".join("".join(c if c.isalnum() else " " for c in pose_path.stem.lower()).split())
        stamp = int(time.time())
        prefix = f"posestudio1108/pose_{tag}_{stamp}"
        doll_prefix = f"posestudio1108/doll_{tag}_{stamp}"
        wf = prep_workflow(pose_json, char_name, prefix, prompt)

        # ask ⑤:发车前把注入 TextEncodeQwenImage21.prompt 的全文打印一次(唯一一次)
        src_label = "CLI 注入(--prompt 原文)" if prompt_source == "cli" else "三层装配真源直调"
        log("─" * 30 + f" 注入全文(TextEncodeQwenImage21.prompt,{src_label},发车前确认) " + "─" * 30)
        print(prompt, flush=True)
        log("─" * 80)
        log(f"姿势={pose_path.stem}({pose_path.name}) 角色={char_name} 前缀={prefix} "
            f"注入全文 {len(prompt)} 字(来源={prompt_source})/"
            f"负面 {len(negative)} 字(负面按 ask 不注入,仅存档)")

        if a.dry_run:
            log("DRY-RUN:预检全过,装配全文已打印,不启浏览器不发车")
            return EXIT_OK

        OUT.mkdir(parents=True, exist_ok=True)

        # ── 发车(作者 CDP 流对位) ──
        page, cleanups = acquire_page()
        try:
            page.goto(ENGINE + "/", timeout=45)
            settle(page, 4000)
            load_and_verify(page, wf, doll_prefix)
            page.screenshot(OUT / f"_ui_{tag}_loaded.png")
            page.evaluate("(() => window.app.queuePrompt())()")
            log("已从 UI queuePrompt(前端 WebGL live-capture 随执行触发);找 prompt_id…")
            pid = find_pid_by_prefix(prefix)
            if not pid:
                page.screenshot(OUT / f"_ui_{tag}_nopid.png")
                log(f"30s 内未在 /queue 找到含前缀的任务;console 尾:")
                for line in (getattr(page, 'console', None) or [])[-12:]:
                    log(f"    {line}")
                verdict = {"pose": pose_path.stem, "status": "error",
                           "seconds": round(time.monotonic() - t0, 1), "outputs": 0, "files": []}
                print("POSESTUDIO_VERDICT " + json.dumps(verdict, ensure_ascii=False,
                                                         separators=(",", ":")), flush=True)
                return EXIT_SHOT_FAIL
            log(f"prompt_id={pid},轮询 /history(上限 {a.timeout}s)")
            result = wait_history(pid, a.timeout)
            saved = download_outputs(result["images"]) if result["images"] else []
            ok = result["status_str"] == "success" and len(saved) >= 1
            verdict = {"pose": pose_path.stem, "status": "success" if ok else
                       ("timeout" if result["status_str"] == "timeout" else "error"),
                       "seconds": round(time.monotonic() - t0, 1),
                       "outputs": len(saved), "files": saved}
            if not ok:
                log(f"未达标 status_str={result['status_str']} 产物×{len(saved)} "
                    f"{result.get('reason', '')}".rstrip())
                page.screenshot(OUT / f"_ui_{tag}_fail.png")
                for line in (getattr(page, 'console', None) or [])[-12:]:
                    log(f"    {line}")
            else:
                page.screenshot(OUT / f"_ui_{tag}_done.png")
            (OUT / f"{tag}_{stamp}.meta.json").write_text(json.dumps({
                "pose": pose_path.stem, "resolved": str(pose_path), "char": char_name,
                "engine": ENGINE, "comfy_prefix": prefix, "doll_prefix": doll_prefix,
                "prompt": prompt, "prompt_source": prompt_source,
                "negative_unused": negative,
                "seconds": round(time.monotonic() - t0, 1), "outputs": saved,
                "prompt_id": pid, "drop_cache": DROP_CACHE,
            }, ensure_ascii=False, indent=2), encoding="utf-8")
            print("POSESTUDIO_VERDICT " + json.dumps(verdict, ensure_ascii=False,
                                                     separators=(",", ":")), flush=True)
            return EXIT_OK if ok else EXIT_SHOT_FAIL
        finally:
            for cleanup in reversed(cleanups):  # LIFO:先关页面/停 playwright,后杀 Chrome
                try:
                    cleanup()
                except Exception:
                    pass
    except EnvObstacle as e:
        print(f"POSESTUDIO_ABORT 环境障碍,退出码 2:{e}", flush=True)
        return EXIT_ENV
    except Exception as e:  # 浏览器/CDP 层意外(未发车)——如实收场,不假绿
        print(f"POSESTUDIO_ABORT 未分类故障,退出码 2:{type(e).__name__}: {e}", flush=True)
        return EXIT_ENV


if __name__ == "__main__":
    sys.exit(main())
