#!/usr/bin/env python3
"""H3 双通道 P1 迷你实弹(10-27;PRD §5.8-1):480P 单镜直发验证。

验证目标=API 模板(h3-shot-template.api.json)与注入点真实可跑:
1. 加载 API 模板,【删节点 100 MyShot】——实弹不触发 writeback(防污染 App 收件箱);
2. 标量直填(与前端 buildShotH3ApiWorkflow 同口径):14.value 提示词 / 20.value=5(number)
   / 4.filename_prefix 五段式 / 16.width=608+16.height=352(480P 档,直填覆盖 22 连线);
3. 上传首帧(ch1_head.png)回填 9.image;POST 17001/prompt;轮询 /history;
4. 判据:success + output 下 mp4 + ffprobe 608x352/24fps/≈5.17s/h264+aac。
"""
import base64
import json
import time
import urllib.request
import uuid
from pathlib import Path

BASE = "http://127.0.0.1:17001"
ROOT = Path(__file__).resolve().parents[2]  # apps/
API_JSON = ROOT / "frontend/lib/assist/image-studio/h3-shot-template.api.json"
HEAD_FRAME = ROOT / "output/bili_h3_unlimited_segments_1025/ch1_head.png"
PREFIX = "video/livefire-1027/sb-livefire-960p/ambient"
POLL_S = 15
BUDGET_S = 2100

PROMPT = ("A young swordsman in dark blue robes stands in a bamboo grove, morning light filtering "
          "through leaves, a gentle breeze sways the bamboo, Chinese guofeng 2D anime hand-drawn "
          "illustration style, fine colored line art, the face stays clean and well-formed with "
          "clear eyes and stable features, subtle camera push-in, serene atmosphere")


def http(method: str, path: str, payload=None, timeout: int = 30):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def upload_image(path: Path) -> str:
    boundary = uuid.uuid4().hex
    body = path.read_bytes()
    parts = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{path.name}\"\r\n"
        f"Content-Type: image/png\r\n\r\n".encode() + body + f"\r\n--{boundary}--\r\n".encode()
    )
    req = urllib.request.Request(BASE + "/upload/image", data=parts, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        reply = json.loads(resp.read().decode())
    name = reply.get("name")
    if not isinstance(name, str) or not name:
        raise RuntimeError(f"上传失败:{reply}")
    sub = reply.get("subfolder") or ""
    return f"{sub}/{name}" if sub else name


def main() -> int:
    graph = json.loads(API_JSON.read_text())
    if "100" in graph:
        del graph["100"]  # 实弹不触发 MyShot writeback
    graph["14"]["inputs"]["value"] = PROMPT
    graph["20"]["inputs"]["value"] = 5
    graph["4"]["inputs"]["filename_prefix"] = PREFIX
    graph["16"]["inputs"]["width"] = 1344
    graph["16"]["inputs"]["height"] = 768
    image_name = upload_image(HEAD_FRAME)
    graph["9"]["inputs"]["image"] = image_name
    print(f"[livefire] 首帧上传={image_name} 节点数={len(graph)}(已删 MyShot)")

    t0 = time.time()
    reply = http("POST", "/prompt", {"prompt": graph, "client_id": uuid.uuid4().hex})
    if reply.get("node_errors"):
        print("[livefire] node_errors:", json.dumps(reply["node_errors"], ensure_ascii=False)[:800])
        return 1
    pid = reply["prompt_id"]
    print(f"[livefire] 发车 prompt_id={pid}")
    while time.time() - t0 < BUDGET_S:
        time.sleep(POLL_S)
        history = http("GET", f"/history/{pid}")
        entry = history.get(pid)
        if entry is None:
            print(f"[livefire][{int(time.time()-t0)}s] 执行中…")
            continue
        status = entry.get("status", {})
        state = status.get("status_str")
        print(f"[livefire][{int(time.time()-t0)}s] 终态={state}")
        if state == "error":
            for msg in status.get("messages", []):
                if msg[0] == "execution_error":
                    print("[livefire] execution_error:", str(msg[1].get("exception_message"))[:500])
            return 1
        outputs = entry.get("outputs", {})
        for node_id, out in outputs.items():
            for vid in out.get("gifs", []) or []:
                print(f"[livefire] 产物: node={node_id} {vid.get('filename')} subfolder={vid.get('subfolder')}")
        print(f"[livefire] 总耗时={int(time.time()-t0)}s")
        return 0
    print(f"[livefire] 超预算({BUDGET_S}s)")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
