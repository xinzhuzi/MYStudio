# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""风格画廊服务端(09-16 用户令:节点内瀑布流展示风格图,点击单选)。

两条路由,纯只读、全 try/except,失败绝不炸引擎不挡出图:
  GET /my_styles/list  → {"styles":[{"name":展示名,"dir":目录名,
                            "thumb":"/my_styles/thumb?dir=…"},…],"count":N}
  GET /my_styles/thumb?dir=<目录名> → JPEG 缩略图

图源=art_skills/<dir>/images/ 排序首张图片(60 目录 57 家单图);dir 必须命中
节点同源目录册(catalog),天然防路径穿越。缩略图 PIL 惰性生成(320px 宽),
磁盘缓存 <comfy-home>/my-styles-thumbs/<目录名>.jpg,源图 mtime 变化即重生成
(原子写:临时文件+rename,绝无半张图被服务)。
"""

from __future__ import annotations

import re
from pathlib import Path

_THUMB_MAX_W = 320
_THUMB_QUALITY = 82
_IMG_EXTS = (".png", ".jpg", ".jpeg", ".webp")
# 目录名白名单形态(art_skills 全表实测:字母数字+下划线/连字符)
_SAFE_DIR = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]*$")

_installed = False


def _thumb_cache_dir() -> Path:
    """<comfy-home>/my-styles-thumbs(与 logs 同层,prompt_log_server 同款定位)。"""
    from folder_paths import base_path
    return Path(base_path).resolve().parent / "my-styles-thumbs"


def cover_image(style_dir: Path) -> Path | None:
    """风格目录 images/ 下排序首张图片;无图返回 None。"""
    images_dir = style_dir / "images"
    try:
        candidates = sorted(
            p for p in images_dir.iterdir()
            if p.is_file() and p.suffix.lower() in _IMG_EXTS
        )
    except OSError:
        return None
    return candidates[0] if candidates else None


def build_thumb(src: Path, cache_dir: Path, key: str) -> Path:
    """生成/复用缩略图:key=风格目录名(显式传入——src.parent.name 恒为
    'images',曾致 57 风格全撞一缓存文件、画廊满屏同图 09-16 实弹事故);
    缓存缺失或早于源图 mtime 即重生成(原子写)。"""
    cache_dir.mkdir(parents=True, exist_ok=True)
    out = cache_dir / f"{key}.jpg"
    src_mtime = src.stat().st_mtime
    if out.is_file() and out.stat().st_mtime >= src_mtime:
        return out
    from PIL import Image  # 引擎 venv 必有(ComfyUI 核心依赖);惰性 import 保测试环境可载

    tmp = out.with_suffix(".tmp")
    with Image.open(src) as image:
        rgb = image.convert("RGB")
        rgb.thumbnail((_THUMB_MAX_W, _THUMB_MAX_W * 4))
        rgb.save(tmp, "JPEG", quality=_THUMB_QUALITY)
    tmp.replace(out)  # 同目录 rename=原子,服务侧绝无半张图
    return out


def list_payload() -> dict | None:
    """画廊数据:与节点 combo 完全同源(同一 root/catalog);根缺失返回 None。

    thumb URL 带 v=<封面图 mtime>:缩略图响应 max-age=86400,若 URL 恒定,
    修复/换图后浏览器 24h 内仍吐旧缓存(09-16 深审抓出:撞名 bug 期间
    用户端已缓存 57 张同图,无版本号=重启后看着还是没修好)。"""
    from .nodes import my_styles

    root = my_styles._resolve_art_skills_root()
    if root is None:
        return None
    catalog = my_styles._get_catalog(root)
    styles = []
    for name, entry in sorted(catalog.items()):
        src = cover_image(root / entry["dir"])
        try:
            version = int(src.stat().st_mtime) if src else 0
        except OSError:
            version = 0
        thumb = f"/my_styles/thumb?dir={entry['dir']}"
        if version:
            thumb += f"&v={version}"
        styles.append({"name": name, "dir": entry["dir"], "level": entry.get("level"), "thumb": thumb})
    return {"styles": styles, "count": len(styles)}


def resolve_thumb(dir_name: str) -> Path | None:
    """dir → 缩略图缓存路径(校验+惰性生成);非法/无图返回 None。"""
    from .nodes import my_styles

    if not _SAFE_DIR.match(dir_name or ""):
        return None
    root = my_styles._resolve_art_skills_root()
    if root is None:
        return None
    catalog = my_styles._get_catalog(root)
    if dir_name not in {entry["dir"] for entry in catalog.values()}:
        return None
    src = cover_image(root / dir_name)
    if src is None:
        return None
    try:
        return build_thumb(src, _thumb_cache_dir(), dir_name)
    except Exception:
        return None


def install() -> None:
    """挂两条只读路由(幂等守卫;失败静默打印,不影响节点与出图)。"""
    global _installed
    if _installed:
        return
    try:
        from aiohttp import web
        from server import PromptServer

        @PromptServer.instance.routes.get("/my_styles/list")
        async def _list(_request):
            try:
                payload = list_payload()
                if payload is None:
                    return web.json_response(
                        {"styles": [], "count": 0, "error": "风格库(art_skills)未找到"},
                        status=503,
                    )
                return web.json_response(payload)
            except Exception as error:  # noqa: BLE001 - 只读路由,失败给出可读错误
                return web.json_response(
                    {"styles": [], "count": 0, "error": str(error)}, status=500)

        @PromptServer.instance.routes.get("/my_styles/thumb")
        async def _thumb(request):
            try:
                path = resolve_thumb(request.rel_url.query.get("dir", ""))
                if path is None:
                    return web.Response(status=404, text="no thumbnail")
                return web.FileResponse(
                    path, headers={"Cache-Control": "public, max-age=86400"})
            except Exception as error:  # noqa: BLE001
                return web.Response(status=500, text=str(error))

        _installed = True
        print("[MY风格画廊] 路由已挂载:/my_styles/list、/my_styles/thumb", flush=True)
    except Exception as error:  # noqa: BLE001 - 引擎侧任何失败不挡装载
        print(f"[MY风格画廊] 路由挂载失败(不影响节点与出图): {error}", flush=True)
