#!/usr/bin/env python3
"""直连生图器(08-23 自动化第一章视频·阶段一替代方案)。

绕过 renderer/CDP,直接:
1. 从 store 读分镜行(prompt + 参考图路径)
2. 调 fanren API (gpt-image-2) 生图,带参考图
3. 保存到项目 workflow-images 目录
4. 写回 store 的 mediaRef.path

用法: python3 direct_storyboard_images.py [--start 57] [--end 82] [--dry]
"""
from __future__ import annotations

import argparse
import base64
import glob
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

PROJECT_ROOT = Path("/Users/zhengbingjin/Project/IP/MA")
STORYBOARD_DIR = PROJECT_ROOT / "store" / "studio-workflow" / "chapters" / "chapter-001"
WORKFLOW_IMAGES = PROJECT_ROOT / "workflow-images"
FANREN_BASE = "https://fanrenapi.com/v1"
# 双 key 从 CDP 读取的值(2026-08-23 实测 key1 可用)
FANREN_KEYS = [
    "sk-8unvy6qQp16vHQcgZP7x0NqBHHkoFSh3qJOz0Dv9pCwXjF5l",
    "sk-q44t8ZK1hZ9M7AHGrwVWngg9aiuXHVAmVflrth3ZZItg2InD",
]
MODEL = "gpt-image-2"


def load_storyboards() -> dict[int, dict]:
    rows: dict[int, dict] = {}
    for shard in sorted(STORYBOARD_DIR.glob("storyboards-*.json")):
        data = json.loads(shard.read_text())
        state = data.get("state", data)
        for value in state.values():
            if isinstance(value, list):
                for b in value:
                    if isinstance(b, dict) and str(b.get("id", "")).startswith("sb-chapter-001"):
                        rows[int(b["id"][-3:])] = b
    return rows


# 参考图 UUID 映射(从 image-workflows 的 reference node source 提取)
_REF_UUIDS: dict[str, str] = {}

def _load_ref_uuids():
    """从 image-workflows 分片提取角色/场景名→资产 UUID 映射。"""
    if _REF_UUIDS:
        return
    for shard in sorted(STORYBOARD_DIR.glob("image-workflows-*.json")):
        data = json.loads(shard.read_text())
        state = data.get("state", data)
        for value in state.values():
            if isinstance(value, list):
                for wf in value:
                    if not isinstance(wf, dict):
                        continue
                    for node in wf.get("nodes") or []:
                        if node.get("type") != "reference":
                            continue
                        source = node.get("source") or {}
                        title = node.get("title", "")
                        uuid = source.get("id", "")
                        if title and uuid:
                            _REF_UUIDS.setdefault(title, uuid)

def resolve_asset_image(name: str) -> str | None:
    """通过 image-workflows UUID 映射找参考图;兜底用中文名模糊匹配。"""
    _load_ref_uuids()
    # 精确 UUID 匹配
    uuid = _REF_UUIDS.get(name)
    if uuid:
        for subdir in ("role", "scene", "prop"):
            f = PROJECT_ROOT / "assets" / "files" / subdir / f"{uuid}.png"
            if f.is_file():
                return str(f)
            f = PROJECT_ROOT / "assets" / "files" / subdir / f"{uuid}.jpg"
            if f.is_file():
                return str(f)
    # 中文名模糊匹配(assets/files/role/ 有 47 个命名文件)
    for subdir in ("role", "scene", "prop"):
        d = PROJECT_ROOT / "assets" / "files" / subdir
        if not d.is_dir():
            continue
        for f in d.glob(f"*{name}*.png"):
            return str(f)
        for f in d.glob(f"*{name}*.jpg"):
            return str(f)
    return None


def build_references(row: dict) -> list[str]:
    """从 associateAssetsNames 解析参考图路径。"""
    refs: list[str] = []
    for name in row.get("associateAssetsNames") or []:
        img = resolve_asset_image(name)
        if img:
            refs.append(img)
    return refs


# Cloudflare 需要 Mozilla UA(裸 urllib 默认 UA 会被 403)
_default_opener = urllib.request.build_opener()
_default_opener.addheaders = [
    ("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"),
]
urllib.request.install_opener(_default_opener)


def generate_image(prompt: str, ref_paths: list[str], key_index: int = 1) -> bytes:
    """调 fanren API images/edits 生图,返回 PNG bytes(参考图走 multipart)。"""
    import io
    import uuid as uuid_mod
    key = FANREN_KEYS[key_index]
    boundary = uuid_mod.uuid4().hex
    parts: list[bytes] = []

    def field(name: str, value: str):
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode()
        )

    # 参考图(压缩到 512px + JPEG)
    for rp in ref_paths[:4]:
        try:
            img_data = Path(rp).read_bytes()
            if len(img_data) > 100_000:
                from PIL import Image
                with Image.open(io.BytesIO(img_data)) as im:
                    im.thumbnail((512, 512))
                    buf = io.BytesIO()
                    im.save(buf, format="JPEG", quality=80)
                    img_data = buf.getvalue()
            parts.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"ref.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".encode()
                + img_data + b"\r\n"
            )
        except Exception:
            pass

    field("model", MODEL)
    field("prompt", prompt)
    field("size", "1536x1024")
    field("n", "1")
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)

    url = f"{FANREN_BASE}/images/edits" if ref_paths else f"{FANREN_BASE}/images/generations"
    if not ref_paths:
        # 无参考图走 JSON generations
        payload = {"model": MODEL, "prompt": prompt, "size": "1536x1024", "n": 1}
        req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                     headers={"Authorization": f"Bearer {key}",
                                              "Content-Type": "application/json"})
    else:
        req = urllib.request.Request(url, data=body,
                                     headers={"Authorization": f"Bearer {key}",
                                              "Content-Type": f"multipart/form-data; boundary={boundary}"})

    with urllib.request.urlopen(req, timeout=300) as resp:
        result = json.loads(resp.read())

    if "data" in result and result["data"]:
        b64 = result["data"][0].get("b64_json")
        if b64:
            return base64.b64decode(b64)
        url_field = result["data"][0].get("url")
        if url_field:
            with urllib.request.urlopen(urllib.request.Request(url_field, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as img_resp:
                return img_resp.read()
    raise ValueError(f"意外响应: {json.dumps(result)[:200]}")


def _project_id() -> str:
    """从项目注册表按 location 反查项目 id(08-24 裁定:引用只落虚拟路径,跟注册表走)。"""
    registry = Path.home() / "Library" / "Application Support" / "漫影工作室" / "projects" / "mystudio-project-store.json"
    data = json.loads(registry.read_text())
    for project in data.get("state", data).get("projects", []):
        if Path(project.get("location", "")).resolve() == PROJECT_ROOT.resolve():
            return str(project["id"])
    raise SystemExit(f"注册表未找到 location={PROJECT_ROOT} 的项目")


def _virtual_ref(relative: Path) -> str:
    """project-file://<projectId>/<rel>——与渲染端 buildProjectFileUrl 同构的逐段编码。"""
    from urllib.parse import quote
    segments = "/".join(quote(str(part), safe="") for part in relative.parts)
    return f"project-file://{quote(_project_id(), safe='')}/{segments}"


def save_and_writeback(shot_num: int, image_bytes: bytes, row: dict) -> str:
    """保存图片到 workflow-images 并写回 store mediaRef(虚拟路径,绝不写绝对路径)。"""
    chapter_dir = WORKFLOW_IMAGES / "chapter-001"
    chapter_dir.mkdir(parents=True, exist_ok=True)
    shot_id = f"sb-chapter-001-{shot_num:03d}"
    img_path = chapter_dir / f"{shot_id}-image.png"
    img_path.write_bytes(image_bytes)
    ref = _virtual_ref(Path("workflow-images") / "chapter-001" / f"{shot_id}-image.png")

    # 写回 store(找对应的分片并更新 mediaRef)
    for shard in sorted(STORYBOARD_DIR.glob("storyboards-*.json")):
        data = json.loads(shard.read_text())
        state = data.get("state", data)
        modified = False
        for key, value in state.items():
            if isinstance(value, list):
                for b in value:
                    if isinstance(b, dict) and b.get("id") == shot_id:
                        b["mediaRef"] = {"kind": "image", "path": ref}
                        b["state"] = "image_ready"
                        modified = True
        if modified:
            shard.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
            break
    return ref


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=57)
    parser.add_argument("--end", type=int, default=82)
    parser.add_argument("--dry", action="store_true")
    parser.add_argument("--key", type=int, default=1, help="fanren key index (0=文本,1=生图)")
    args = parser.parse_args()

    rows = load_storyboards()
    print(f"加载 {len(rows)} 镜")

    done = skip = fail = 0
    for n in range(args.start, args.end + 1):
        row = rows.get(n)
        if not row:
            print(f"镜 {n}: 无数据,跳过")
            continue
        if (row.get("mediaRef") or {}).get("path"):
            print(f"镜 {n}: 已有图,跳过")
            skip += 1
            continue

        prompt = row.get("videoDesc") or row.get("prompt") or ""
        if not prompt.strip():
            print(f"镜 {n}: 无 prompt,跳过")
            continue

        refs = build_references(row)
        print(f"镜 {n}: 生图({len(refs)} 参考图)... ", end="", flush=True)

        if args.dry:
            print(f"[dry] prompt={prompt[:40]}... refs={refs}")
            continue

        try:
            t0 = time.time()
            img_bytes = generate_image(prompt, refs, key_index=args.key)
            path = save_and_writeback(n, img_bytes, row)
            elapsed = time.time() - t0
            print(f"OK ({elapsed:.0f}s) → {path}")
            done += 1
        except Exception as e:
            print(f"FAIL: {e}")
            fail += 1
            # key 轮转:失败时试另一个 key
            if "403" in str(e) or "503" in str(e):
                args.key = 1 - args.key
                print(f"  切换到 key{args.key}")

    print(f"\n完成: {done} 成功, {skip} 跳过, {fail} 失败")
    return fail


if __name__ == "__main__":
    sys.exit(main())
