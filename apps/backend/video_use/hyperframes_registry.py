"""HyperFrames GitHub Registry 模板池(08-21 全量接入,动态构建).

从 catalog.json 单源动态加载(不硬编码);373 个模板(154 blocks + 219 components)。
"""
from __future__ import annotations

import json
from pathlib import Path

_CATALOG_PATH = Path(__file__).parent.parent.parent / "frontend" / "assets" / "hyperframes-registry" / "catalog.json"

def _load() -> list[dict]:
    if not _CATALOG_PATH.exists():
        return []
    return json.loads(_CATALOG_PATH.read_text()).get("items", [])

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
