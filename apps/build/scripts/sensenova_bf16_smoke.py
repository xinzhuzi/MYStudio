#!/usr/bin/env python3
"""SenseNova U1.6 道劫 t2i/i2i 引擎烟雾测试(1127 固化自 bf16 换装役实弹件)。

运行方式(直投引擎 /prompt,不经 App;引擎在驾时另起发车会与 App 共享引擎,
排队执行不互斥,但长任务建议等 App 空闲):
    python3 apps/build/scripts/sensenova_bf16_smoke.py --engine http://192.168.0.101:17000
    python3 apps/build/scripts/sensenova_bf16_smoke.py --engine ... --dry-run   # 只组包不发车

引擎端口禁抄常量(17000-17999 随端口决议漂移),现查:
    Win:  ssh zbj@192.168.0.101 "type E:\\IP\\dhp\\comfyui\\manifest.json" | findstr port
    Mac:  grep '"port"' ~/Library/Application\\ Support/漫影工作室/comfyui/manifest.json

填参全走 --set 节点=值(值按 JSON 解析,失败退原文;@路径=读文件作字符串)。
两张在役模板的常用填参地图(见 docs/comfyui-kb/SenseNova-U16-烟雾测试与运维.md):
    t2i(sn-道劫-t2i-api.json):  21=seed  10=LoRA开关(true=8步LoRA档)  11=快档步数  13=快档cfg
    i2i(sn-道劫-i2i-api.json):  24=seed   9=LoRA开关                  10=快档步数  12=快档cfg
    i2i 参考图: 先 --upload-image 推到引擎,再 --set 17=<上传后的文件名>

产物落 --out(默认 apps/output/sensenova-smoke/<UTC时间戳>/),执行秒数追加写
timing-ledger.jsonl(口径=POST 到 history 出现 execution_success 的墙钟差,
含模型首次流送;跨精度同种子像素对拍无效,1127 定谳 PSNR 14.4,勿再比)。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DEFAULT_WORKFLOW = "1_图片/SenseNova/1_文生图/sn-道劫-t2i-api.json"
DEFAULT_ENGINE = "http://192.168.0.101:17000"


def parse_value(raw: str) -> object:
    """--set 的值:JSON 优先(数字/布尔/数组),失败退原文;@路径读文件。"""
    if raw.startswith("@"):
        return Path(raw[1:]).expanduser().read_text(encoding="utf-8")
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return raw


def build_payload(workflow_rel: str, sets: list[str], client_id: str) -> dict:
    path = REPO / "apps" / "backend" / "comfyui" / "workflows" / workflow_rel
    raw_graph = json.loads(path.read_text(encoding="utf-8"))
    # 顶层只留真节点(_doc 等说明键剥掉,引擎按节点号解析,实发件无说明键)
    graph = {k: v for k, v in raw_graph.items()
             if isinstance(v, dict) and "class_type" in v}
    for item in sets:
        if "=" not in item:
            sys.exit(f"--set 格式应为 节点[.输入键]=值,得: {item}")
        target, raw = item.split("=", 1)
        nid, _, key = target.partition(".")
        nid, key = nid.strip(), (key.strip() or "value")
        if nid not in graph:
            sys.exit(f"--set 节点 {nid} 不在模板里(现有节点: {', '.join(sorted(graph, key=int))})")
        node = graph[nid]
        # Primitive 系 widget 键=value;其余节点按 widget 名(如 filename_prefix/image)
        node.setdefault("inputs", {})[key] = parse_value(raw)
    return {"prompt": graph, "client_id": client_id}


def post_json(base: str, path: str, body: dict, timeout: float = 30) -> dict:
    req = urllib.request.Request(
        base + path, data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def upload_image(base: str, path: str) -> str:
    """--upload-image:multipart 推图到引擎 /upload/image,返回服务端文件名。"""
    import mimetypes
    import uuid
    fname = Path(path).name
    mime = mimetypes.guess_type(fname)[0] or "application/octet-stream"
    boundary = uuid.uuid4().hex
    data = Path(path).read_bytes()
    body = b"".join([
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{fname}\"\r\n"
        f"Content-Type: {mime}\r\n\r\n".encode("utf-8"), data,
        f"\r\n--{boundary}--\r\n".encode("utf-8")])
    req = urllib.request.Request(
        base + "/upload/image", data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))["name"]


def poll_history(base: str, prompt_id: str, timeout_s: float) -> tuple[dict, float]:
    """轮询 /history 直到出结果;返回 (history条目, 执行秒数)。"""
    t0 = time.monotonic()
    deadline = t0 + timeout_s
    while time.monotonic() < deadline:
        with urllib.request.urlopen(base + f"/history/{prompt_id}", timeout=15) as resp:
            hist = json.loads(resp.read().decode("utf-8")).get(prompt_id)
        if hist:
            status = hist.get("status", {})
            if status.get("status_str") == "error":
                sys.exit(f"引擎判错: {json.dumps(status.get('messages', status), ensure_ascii=False)[:800]}")
            if status.get("completed"):
                return hist, time.monotonic() - t0
        time.sleep(1.0)
    sys.exit(f"超时({timeout_s:.0f}s)未见完成;prompt_id={prompt_id} 可手动查 /history")


def fetch_images(base: str, hist: dict, out_dir: Path) -> list[Path]:
    saved = []
    for node_out in (hist.get("outputs") or {}).values():
        for img in node_out.get("images", []):
            q = urllib.parse.urlencode({
                "filename": img["filename"], "subfolder": img.get("subfolder", ""),
                "type": img.get("type", "output")})
            with urllib.request.urlopen(f"{base}/view?{q}", timeout=60) as resp:
                data = resp.read()
            dest = out_dir / Path(img["filename"]).name
            dest.write_bytes(data)
            saved.append(dest)
    return saved


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--engine", default=DEFAULT_ENGINE, help=f"引擎根 URL(默认 {DEFAULT_ENGINE},端口现查)")
    ap.add_argument("--workflow", default=DEFAULT_WORKFLOW, help="仓库库内相对路径(API 平铺件)")
    ap.add_argument("--set", action="append", default=[], metavar="节点=值", help="填参,可多次")
    ap.add_argument("--client-id", default="sensenova-smoke")
    ap.add_argument("--upload-image", help="先推参考图到引擎(i2i 用),配合 --set 17=<返回文件名>")
    ap.add_argument("--out", default=None, help="产物目录(默认 apps/output/sensenova-smoke/<ts>/)")
    ap.add_argument("--timeout", type=float, default=600, help="执行轮询上限秒")
    ap.add_argument("--dry-run", action="store_true", help="只组 payload 打印不发车")
    args = ap.parse_args()

    payload = build_payload(args.workflow, args.set, args.client_id)
    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=1))
        return

    base = args.engine.rstrip("/")
    if args.upload_image:
        name = upload_image(base, args.upload_image)
        print(f"uploaded: {name}")
        payload["prompt"].setdefault("17", {"inputs": {}})["inputs"]["image"] = name

    fired = datetime.now(timezone.utc).astimezone()
    resp = post_json(base, "/prompt", payload)
    prompt_id = resp.get("prompt_id")
    if not prompt_id:
        sys.exit(f"/prompt 未返回 prompt_id: {json.dumps(resp, ensure_ascii=False)[:400]}")
    print(f"prompt_id={prompt_id} fired_at={fired.isoformat(timespec='seconds')}")

    hist, seconds = poll_history(base, prompt_id, args.timeout)
    out_dir = Path(args.out) if args.out else (
        REPO / "apps" / "output" / "sensenova-smoke" / fired.strftime("%Y%m%dT%H%M%S"))
    out_dir.mkdir(parents=True, exist_ok=True)
    saved = fetch_images(base, hist, out_dir)

    ledger = out_dir / "timing-ledger.jsonl"
    with ledger.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps({
            "run": f"{Path(args.workflow).stem} seed={payload['prompt'].get('21', payload['prompt'].get('24', {})).get('inputs', {}).get('value')}",
            "fired_at": fired.isoformat(timespec="seconds"),
            "exec_seconds": round(seconds, 1),
            "engine": base, "workflow": args.workflow,
            "images": [p.name for p in saved],
            "prompt_id": prompt_id,
        }, ensure_ascii=False) + "\n")

    print(f"execution_success in {seconds:.1f}s -> {out_dir}")
    for p in saved:
        print(f"  {p}")


if __name__ == "__main__":
    main()
