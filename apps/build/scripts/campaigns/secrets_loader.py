#!/usr/bin/env python3
"""凭据装载器(09-24 秘密出库改造:仓库公开,真实凭据一律不入库)。

供 direct_storyboard_images.py / campaigns/civitai_parallel_dl_0919.py /
campaigns/daojie_tancai_lora_install_0919.py 统一取凭据:

- get_fanren_keys():fanren 生图双 key。环境变量 FANREN_KEYS_JSON(JSON 数组
  文本)优先,否则读 SECRETS_DIR/fanren_keys.json 的 "keys" 数组。
- get_civitai_token():civitai 下载 token。环境变量 CIVITAI_TOKEN 优先,
  否则读 SECRETS_DIR/civitai_token.json 的 "token" 字段。
- get_proxy():下载代理。环境变量 CIVITAI_PROXY 优先,否则读
  civitai_token.json 的 "proxy" 字段;都未配置返回 ""(纯直连,不报错)。

凭据缺失或仍是占位串时打印指引并以非零码退出;文件格式与轮换方法见
SECRETS_DIR/README.md。本文件自身不得出现任何真实凭据。
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

SECRETS_DIR = Path.home() / ".zcode" / "mystudio-secrets"
PLACEHOLDER = "REPLACE_AFTER_ROTATION"
_GUIDE = (
    "凭据未配置:泄漏旧值作废后,把轮换出的新值写入本地凭据目录(不入仓库):\n"
    f'  {SECRETS_DIR}/fanren_keys.json   → {{"keys": ["<新key1>", "<新key2>"]}}\n'
    f'  {SECRETS_DIR}/civitai_token.json → {{"token": "<新token>", "proxy": "<代理或空串>"}}\n'
    "或用环境变量 FANREN_KEYS_JSON(JSON 数组文本)/ CIVITAI_TOKEN / CIVITAI_PROXY 覆盖;\n"
    f"轮换方法详见 {SECRETS_DIR}/README.md(占位串 {PLACEHOLDER} = 尚未轮换,拒绝使用)"
)


def _fail(what: str) -> None:
    print(f"[secrets_loader] {what}", file=sys.stderr)
    print(_GUIDE, file=sys.stderr)
    sys.exit(2)


def _read_json(name: str) -> dict:
    path = SECRETS_DIR / name
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        _fail(f"读取 {path} 失败: {exc}")
    return data if isinstance(data, dict) else {}


def get_fanren_keys() -> list[str]:
    """fanren 生图双 key(环境变量优先;缺失/占位即打印指引并退出非零)。"""
    raw = os.environ.get("FANREN_KEYS_JSON", "").strip()
    if raw:
        try:
            keys = json.loads(raw)
        except json.JSONDecodeError as exc:
            _fail(f"FANREN_KEYS_JSON 不是合法 JSON: {exc}")
    else:
        keys = _read_json("fanren_keys.json").get("keys")
    if not isinstance(keys, list) or not keys:
        _fail("fanren keys 缺失(环境变量 FANREN_KEYS_JSON 与本地 fanren_keys.json 均无)")
    bad = [k for k in keys
           if not isinstance(k, str) or not k.strip() or k.strip() == PLACEHOLDER]
    if bad:
        _fail(f"fanren keys 含空值/占位串({len(bad)} 个),请先轮换再填入")
    return [k.strip() for k in keys]


def get_civitai_token() -> str:
    """civitai 下载 token(环境变量优先;缺失/占位即打印指引并退出非零)。"""
    token = os.environ.get("CIVITAI_TOKEN", "").strip()
    if not token:
        token = str(_read_json("civitai_token.json").get("token", "")).strip()
    if not token or token == PLACEHOLDER:
        _fail("civitai token 缺失或未轮换(环境变量 CIVITAI_TOKEN 与本地 "
              "civitai_token.json 均无有效值)")
    return token


def get_proxy() -> str:
    """下载代理(环境变量 CIVITAI_PROXY 优先;未配置返回空串=纯直连,不报错)。"""
    proxy = os.environ.get("CIVITAI_PROXY", "").strip()
    if not proxy:
        proxy = str(_read_json("civitai_token.json").get("proxy", "")).strip()
    return "" if proxy == PLACEHOLDER else proxy
