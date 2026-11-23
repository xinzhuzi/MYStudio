#!/usr/bin/env python3
"""Arekejoker(Qwen21-NSFW-Pose skill)工作流烟测 · 1108(发车员脚本,Mac 侧跑)

对 Win 产线引擎(默认 http://192.168.0.101:17000,Mac 直连 HTTP 已实证通;
直连失败自动退 `ssh $WIN_SSH_HOST curl.exe`(默认 zbj@192.168.0.101)打引擎环回
http://127.0.0.1:17000)连发两件烟测:

  A) t2i : workflows/qwen21_t2i.json 原样 POST /prompt——默认提示词不动,仅
           KSampler.seed 随机化(避免同会话缓存命中,保证是真渲染)。
  B) edit: workflows/qwen21_edit.json——先 GET /object_info/LoadImage 取引擎
           input 目录现存图清单,优先 daojie_nvxiu_mounted_1108.png(清单没有则取
           第一张)填进 LoadImage.image;TextEncodeQwenImage21.prompt 改良性中文
           指令「把背景换成雪山远景,保持人物姿态、服装与表情不变」。seed 不动
           (ask 只对 A 要求随机化,B 保文件原值 20260921)。

烟测判据(不做美学评判):引擎侧 status_str == "success" 且产物图 ≥ 1。
单发轮询 /history/{prompt_id} 至完成,上限 10 分钟/发。

退出码:
  0  两发均 success
  1  已发车但有发未 success(超时/引擎报错/零产物)
  2  环境障碍(工作流文件缺、双通道都连不上引擎、input 目录空、响应畸形)
  3  发车前 /queue 非空(running/pending 任一非空)——引擎有新任务在途,取消发车,
     不算失败

输出:最后一行恒为单行 `SMOKE_VERDICT {json}`,json={"t2i":{"status","seconds",
"outputs"},"edit":{...}};status ∈ success|error|timeout。退出 2/3 路径不发车,
打一行 SMOKE_ABORT 原因收场,不打 SMOKE_VERDICT。

用法: python3 arekejoker_pose_smoke_1108.py [引擎URL]   # 默认 http://192.168.0.101:17000
环境: WIN_SSH_HOST 覆盖 ssh 目标(默认 zbj@192.168.0.101,沿 win-control-lock.sh 惯例);
      ssh 走 BatchMode(免交互),key 不通即视为该通道不可用。
"""

from __future__ import annotations

import json
import os
import random
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parents[3]
WF_DIR = REPO_ROOT / ".agents/skills/qwen-image-prompt/qwen21-nsfw-pose-skill/workflows"
WF_T2I = WF_DIR / "qwen21_t2i.json"
WF_EDIT = WF_DIR / "qwen21_edit.json"

DEFAULT_ENGINE = "http://192.168.0.101:17000"
PREFERRED_INPUT = "daojie_nvxiu_mounted_1108.png"
EDIT_PROMPT = "把背景换成雪山远景,保持人物姿态、服装与表情不变"

SHOT_DEADLINE_S = 600  # 单发上限 10 分钟(ask 口径)
POLL_INTERVAL_S = 3.0
PROBE_TIMEOUT_S = 6
GET_TIMEOUT_S = 20
POST_TIMEOUT_S = 30
CLIENT_ID = "arekejoker-pose-smoke-1108"
POLL_FAIL_STREAK_MAX = 8  # 连续 8 次轮询请求失败(约 30s)→ 判 error,不干等满 10 分钟

EXIT_OK, EXIT_SMOKE_FAIL, EXIT_ENV, EXIT_QUEUE_BUSY = 0, 1, 2, 3


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


class EnvObstacle(RuntimeError):
    """环境障碍:不可发车,退出码 2。"""


# ── 传输层:direct(urllib)/ ssh(ssh curl.exe 打环回)双通道 ──────────
class Transport:
    """统一返回 (http_status:int, body_text:str);传输级失败抛 RuntimeError。"""

    def __init__(self, mode: str, base_url: str, ssh_target: str):
        self.mode = mode  # 'direct' | 'ssh'
        self.base = base_url.rstrip("/")
        self.ssh_target = ssh_target

    def get(self, path: str, timeout: float = GET_TIMEOUT_S):
        return self._request("GET", path, None, timeout)

    def post_json(self, path: str, payload: dict, timeout: float = POST_TIMEOUT_S):
        return self._request("POST", path, json.dumps(payload).encode("utf-8"), timeout)

    def _request(self, method: str, path: str, body: bytes | None, timeout: float):
        url = self.base + path
        if self.mode == "direct":
            return self._direct(method, url, body, timeout)
        return self._ssh(method, url, body, timeout)

    @staticmethod
    def _direct(method: str, url: str, body: bytes | None, timeout: float):
        req = urllib.request.Request(
            url, data=body, method=method,
            headers={"Content-Type": "application/json"} if body is not None else {},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:  # 4xx/5xx 也拿 body(拒单原因在里面)
            return e.code, e.read().decode("utf-8", "replace")

    def _ssh(self, method: str, url: str, body: bytes | None, timeout: float):
        # 整条远程命令作为单参数交给 ssh,避免 -H "Content-Type: ..." 被远端 shell 拆词。
        # -w 尾行补 http_code;curl 自身超时 = timeout,subprocess 再留 ssh 建连余量。
        parts = [f"curl.exe -s -m {int(timeout)}"]
        if method == "POST":
            parts += ['-X POST', '-H "Content-Type: application/json"', "--data-binary @-"]
        parts += ['-w "\\n%{http_code}"', f'"{url}"']
        remote = " ".join(parts)
        try:
            cp = subprocess.run(
                ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
                 self.ssh_target, remote],
                input=body, capture_output=True, timeout=timeout + 45,
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"ssh curl 超时(>{timeout + 45}s): {url}") from None
        if cp.returncode != 0:
            err = cp.stderr.decode("utf-8", "replace").strip()[-200:]
            raise RuntimeError(f"ssh curl exit={cp.returncode}: {err}") from None
        out = cp.stdout.decode("utf-8", "replace")
        body_text, _, code = out.rpartition("\n")
        code = code.strip()
        if not code.isdigit():
            raise RuntimeError(f"ssh curl 响应缺 http_code 尾行: {out[:200]!r}") from None
        return int(code), body_text


def probe_transport(engine: str, ssh_target: str) -> Transport:
    """先 Mac 直连,不通再退 ssh;两条都死 → EnvObstacle。探测端点 /queue(只读)。"""
    try:
        tr = Transport("direct", engine, ssh_target)
        status, _ = tr.get("/queue", timeout=PROBE_TIMEOUT_S)
        if status == 200:
            log(f"通道:Mac 直连 {engine} 探通(/queue HTTP 200)")
            return tr
        raise RuntimeError(f"HTTP {status}")
    except Exception as e:
        direct_err = type(e).__name__ + ": " + str(e)[:160]
    port = urlsplit(engine).port or 80
    loopback = f"http://127.0.0.1:{port}"
    try:
        tr = Transport("ssh", loopback, ssh_target)
        status, _ = tr.get("/queue", timeout=PROBE_TIMEOUT_S)
        if status == 200:
            log(f"通道:Mac 直连失败({direct_err}),退 ssh {ssh_target} curl.exe {loopback} 探通")
            return tr
        raise RuntimeError(f"HTTP {status}")
    except Exception as e:
        raise EnvObstacle(
            f"引擎双通道均不可达:direct[{direct_err}] "
            f"ssh[{type(e).__name__}: {str(e)[:160]}]"
        ) from None


# ── 工作流装载与改造 ────────────────────────────────────────────────
def load_workflow(path: Path) -> dict:
    if not path.is_file():
        raise EnvObstacle(f"工作流文件缺失: {path}")
    try:
        graph = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as e:
        raise EnvObstacle(f"工作流 JSON 解析失败 {path}: {e}") from None
    if not isinstance(graph, dict) or not graph:
        raise EnvObstacle(f"工作流非 API 格式(非节点字典): {path}")
    return graph


def find_node(graph: dict, class_type: str) -> str:
    hits = [nid for nid, n in graph.items()
            if isinstance(n, dict) and n.get("class_type") == class_type]
    if len(hits) != 1:
        raise EnvObstacle(f"期望恰 1 个 {class_type} 节点,实得 {len(hits)}")
    return hits[0]


def build_t2i_payload() -> tuple[dict, int]:
    """A)t2i:原样,仅随机化 KSampler.seed。"""
    graph = load_workflow(WF_T2I)
    nid = find_node(graph, "KSampler")
    seed = random.randrange(2 ** 32)
    graph[nid]["inputs"]["seed"] = seed
    return graph, seed


def pick_input_image(tr: Transport) -> tuple[str, int]:
    """GET /object_info/LoadImage 取 input 目录清单;优先指定名(含子目录同名),否则第一张。"""
    status, text = tr.get("/object_info/LoadImage")
    if status != 200:
        raise EnvObstacle(f"GET /object_info/LoadImage HTTP {status}: {text[:200]}")
    try:
        listing = json.loads(text)["LoadImage"]["input"]["required"]["image"][0]
    except (ValueError, KeyError, TypeError, IndexError) as e:
        raise EnvObstacle(
            f"/object_info/LoadImage 响应畸形({e}): {text[:200]}") from None
    if not isinstance(listing, list) or not listing:
        raise EnvObstacle("引擎 input 目录现存图为 0 张,edit 发无从选图")
    if PREFERRED_INPUT in listing:
        return PREFERRED_INPUT, len(listing)
    basename_hits = [x for x in listing
                     if isinstance(x, str) and x.rsplit("/", 1)[-1] == PREFERRED_INPUT]
    if basename_hits:
        return basename_hits[0], len(listing)
    first = listing[0]
    if not isinstance(first, str):
        raise EnvObstacle(f"input 清单首项非字符串: {first!r}")
    return first, len(listing)


def build_edit_payload(image_name: str) -> dict:
    """B)edit:LoadImage 填实测图名,提示词改良性中文指令;seed 不动(ask 只要求 A 随机)。"""
    graph = load_workflow(WF_EDIT)
    graph[find_node(graph, "LoadImage")]["inputs"]["image"] = image_name
    graph[find_node(graph, "TextEncodeQwenImage21")]["inputs"]["prompt"] = EDIT_PROMPT
    return graph


# ── 发车 / 轮询 / 判读 ─────────────────────────────────────────────
def queue_load(tr: Transport) -> tuple[int, int]:
    """(running, pending) 条数;查询失败按环境障碍收场(fail-closed)。"""
    try:
        status, text = tr.get("/queue")
    except Exception as e:
        raise EnvObstacle(f"GET /queue 失败: {type(e).__name__}: {e}") from None
    if status != 200:
        raise EnvObstacle(f"GET /queue HTTP {status}: {text[:200]}")
    try:
        q = json.loads(text)
        return len(q.get("queue_running") or []), len(q.get("queue_pending") or [])
    except ValueError as e:
        raise EnvObstacle(f"/queue 响应非 JSON: {text[:200]}") from None


def _error_summary(status_obj: dict) -> str:
    for m in status_obj.get("messages") or []:
        if isinstance(m, list) and m and m[0] == "execution_error" and len(m) > 1 \
                and isinstance(m[1], dict):
            d = m[1]
            return (f"execution_error node={d.get('node_type')}/{d.get('node_id')} "
                    f"{d.get('exception_type')}: {str(d.get('exception_message'))[:160]}")
    return ""


def run_shot(tr: Transport, name: str, graph: dict) -> dict:
    """一发:POST /prompt → 轮询 /history/{id} 至完成;任何失败如实降级,不假绿。"""
    t0 = time.monotonic()
    try:
        status, text = tr.post_json("/prompt", {"prompt": graph, "client_id": CLIENT_ID})
    except Exception as e:
        log(f"[{name}] POST /prompt 传输失败: {type(e).__name__}: {e}")
        return {"status": "error", "seconds": round(time.monotonic() - t0, 1), "outputs": 0}
    try:
        resp = json.loads(text)
    except ValueError:
        log(f"[{name}] POST /prompt 响应非 JSON(HTTP {status}): {text[:200]}")
        return {"status": "error", "seconds": round(time.monotonic() - t0, 1), "outputs": 0}
    if status != 200 or not isinstance(resp, dict) or "prompt_id" not in resp:
        log(f"[{name}] 引擎拒单 HTTP {status} error={resp.get('error')} "
            f"node_errors={str(resp.get('node_errors'))[:300]}")
        return {"status": "error", "seconds": round(time.monotonic() - t0, 1), "outputs": 0}
    pid = resp["prompt_id"]
    log(f"[{name}] 已入队 prompt_id={pid},轮询 /history(上限 {SHOT_DEADLINE_S}s)")

    deadline = t0 + SHOT_DEADLINE_S
    fail_streak = 0
    while time.monotonic() < deadline:
        time.sleep(POLL_INTERVAL_S)
        try:
            status, text = tr.get(f"/history/{pid}")
            hist = json.loads(text)
            fail_streak = 0
        except Exception as e:
            fail_streak += 1
            log(f"[{name}] history 查询失败×{fail_streak}: {type(e).__name__}: {e}")
            if fail_streak >= POLL_FAIL_STREAK_MAX:
                log(f"[{name}] 连续 {fail_streak} 次查询失败,判 error")
                return {"status": "error",
                        "seconds": round(time.monotonic() - t0, 1), "outputs": 0}
            continue
        entry = hist.get(pid) if isinstance(hist, dict) else None
        if not isinstance(entry, dict):
            continue  # 未进 history / 形状异常 = 未完成,继续等
        st = entry.get("status") or {}
        if not st.get("completed"):
            continue
        secs = round(time.monotonic() - t0, 1)
        images = sum(len(v.get("images", []))
                     for v in (entry.get("outputs") or {}).values() if isinstance(v, dict))
        if st.get("status_str") == "success" and images >= 1:
            log(f"[{name}] success:{secs}s 产物图×{images}")
            return {"status": "success", "seconds": secs, "outputs": images}
        log(f"[{name}] 引擎侧终态未达标 status_str={st.get('status_str')} "
            f"产物图×{images} {_error_summary(st)}".rstrip())
        return {"status": "error", "seconds": secs, "outputs": images}
    log(f"[{name}] 超时:>{SHOT_DEADLINE_S}s 未完成")
    return {"status": "timeout",
            "seconds": round(time.monotonic() - t0, 1), "outputs": 0}


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        return 0
    engine = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ENGINE
    ssh_target = os.environ.get("WIN_SSH_HOST", "zbj@192.168.0.101")
    log(f"烟测对象:Arekejoker qwen21 t2i+edit | 引擎 {engine} | ssh 备援 {ssh_target}")
    try:
        tr = probe_transport(engine, ssh_target)
        t2i_graph, t2i_seed = build_t2i_payload()
        image_name, input_total = pick_input_image(tr)
        edit_graph = build_edit_payload(image_name)
        log(f"preflight:t2i seed={t2i_seed}(随机);edit 用图 {image_name}"
            f"(input 目录现存 {input_total} 张,优先名未命中则取首张);"
            f"edit 指令「{EDIT_PROMPT}」")

        # 发车前再查一次 /queue:非空即退出码 3(引擎有新任务在途,取消发车,不算失败)
        running, pending = queue_load(tr)
        if running or pending:
            log(f"SMOKE_ABORT /queue 非空(running={running}, pending={pending}),取消发车,退出码 3")
            return EXIT_QUEUE_BUSY
        log(f"发车前 /queue 双空(running=0, pending=0),发车")

        r_t2i = run_shot(tr, "t2i", t2i_graph)
        r_edit = run_shot(tr, "edit", edit_graph)
    except EnvObstacle as e:
        print(f"SMOKE_ABORT 环境障碍,退出码 2:{e}", flush=True)
        return EXIT_ENV

    verdict = {"t2i": r_t2i, "edit": r_edit}
    print("SMOKE_VERDICT " + json.dumps(verdict, ensure_ascii=False, separators=(",", ":")),
          flush=True)
    ok = r_t2i["status"] == "success" and r_edit["status"] == "success"
    return EXIT_OK if ok else EXIT_SMOKE_FAIL


if __name__ == "__main__":
    sys.exit(main())
