"""HyperFrames GitHub Registry 模板池(08-21 全量接入,动态构建).

从 catalog.json 单源动态加载(不硬编码);370 个模板(151 blocks + 219 components;3D 设备 3 个已剔除)。
"""
from __future__ import annotations

import json
from pathlib import Path


def _resolve_catalog_path() -> Path | None:
    """catalog.json 双路径解析——dev 源码树与打包布局都要能找到。

    打包时 builder 把 frontend/assets/hyperframes-registry 打平到
    Resources/hyperframes-registry(extraResources to: hyperframes-registry);
    只认 dev 路径会让装机包 catalog 空载,adapter.py 的策展 fail-fast 断言
    随之误报「模板不在 catalog.json」(08-22 起装机版 video-use worker 即炸,
    dev 路径恰好可解析故门禁全绿)。镜像 TS 侧 hyperframes-worker.ts 的双路径。
    """
    backend_root = Path(__file__).parent.parent.parent
    candidates = (
        # dev: apps/frontend/assets/hyperframes-registry/catalog.json
        backend_root / "frontend" / "assets" / "hyperframes-registry" / "catalog.json",
        # 打包: Resources/hyperframes-registry/catalog.json
        backend_root / "hyperframes-registry" / "catalog.json",
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def catalog_path() -> Path | None:
    """当前生效的 catalog.json 路径(测试与诊断用);两处都不存在返回 None。"""
    return _resolve_catalog_path()


def _load() -> list[dict]:
    resolved = _resolve_catalog_path()
    if resolved is None:
        return []
    return json.loads(resolved.read_text()).get("items", [])

_ITEMS = _load()
HYPERFRAMES_REGISTRY_TEMPLATES: tuple[str, ...] = tuple("hy:" + i["name"] for i in _ITEMS)

_TAG_TO_TEMPLATES: dict[str, list[str]] = {}
for _item in _ITEMS:
    for _tag in _item.get("tags", []):
        _tag = _tag.lower()
        _TAG_TO_TEMPLATES.setdefault(_tag, []).append("hy:" + _item["name"])

def registry_templates_by_tag(tag: str) -> list[str]:
    return _TAG_TO_TEMPLATES.get(tag, [])

def is_hyperframes_registry_template(template_id: str) -> bool:
    return template_id in HYPERFRAMES_REGISTRY_TEMPLATES
