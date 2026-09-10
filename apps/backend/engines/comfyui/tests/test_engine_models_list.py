# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""list_models(模型库清单)单测(09-10 用户裁定:模型页展示 comfyui/models)。

monkeypatch cm 的目录解析,验证:类别分组/递归文件/隐藏跳过/空类别剔除/合计。
"""
from __future__ import annotations

from pathlib import Path

import pytest

from engines.comfyui import engine_manager as em


def _make_tree(root: Path) -> None:
    (root / "diffusion_models").mkdir(parents=True)
    (root / "diffusion_models" / "krea2_turbo_bf16.safetensors").write_bytes(b"x" * 2048)
    (root / "loras" / "Krea2-NSFW").mkdir(parents=True)
    (root / "loras" / "Krea2-NSFW" / "a.safetensors").write_bytes(b"y" * 1024)
    (root / "empty_group").mkdir()
    (root / ".hidden").mkdir()
    (root / ".hidden" / "secret.safetensors").write_bytes(b"z" * 10)
    # 嵌套隐藏子目录(loras/.cache/...):文件名不带点,须按路径段过滤(09-10 实弹)
    (root / "loras" / ".cache" / "huggingface").mkdir(parents=True)
    (root / "loras" / ".cache" / "huggingface" / "CACHEDIR.TAG").write_bytes(b"w" * 32)


def test_list_models_groups_files_and_skips(tmp_path, monkeypatch):
    models_dir = tmp_path / "models"
    _make_tree(models_dir)
    monkeypatch.setattr(em.cm, "load_manifest", lambda: {})
    monkeypatch.setattr(em.cm, "configured_models_dir", lambda _m: models_dir)

    reply = em.engine_manager().list_models()

    assert reply["modelsDir"] == str(models_dir)
    assert [g["category"] for g in reply["groups"]] == ["diffusion_models", "loras"]
    loras = reply["groups"][1]
    assert loras["files"] == [{"name": "Krea2-NSFW/a.safetensors", "sizeBytes": 1024}]
    assert reply["totalBytes"] == 2048 + 1024


def test_list_models_missing_dir_returns_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(em.cm, "load_manifest", lambda: {})
    monkeypatch.setattr(em.cm, "configured_models_dir", lambda _m: tmp_path / "nope")

    reply = em.engine_manager().list_models()

    assert reply["groups"] == []
    assert reply["totalBytes"] == 0
