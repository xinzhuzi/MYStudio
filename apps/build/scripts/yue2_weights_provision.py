#!/usr/bin/env python3
# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""YuE2 全家权重供给脚本(09-20;装机后手动跑一次的口径)。

为什么存在:仓库内不存在「装机拉 ComfyUI 引擎权重」的清单真源(09-20 探查
定谳——engine_manager 安装流只装引擎源码+venv,模型页 list_models 只读扫描,
各 sidecar model_inventory 全是 HF 缓存布局不落引擎家;music3_gen 已于
9dd1ff0 全量退役)。引擎家其余几十件权重全走手工放置口径,本脚本只为 YuE2
三件给一条可重复执行的供给路径,口径与手工放置一致:跑一次、字节级校验、
幂等可重跑。不接运行时自动拉取(那是要单独拍板的架构议题)。

三件与来源(单一套:每件唯一下载源,ModelScope 直链;字节数与本机引擎家
实测及 ModelScope 文件列表 API 双向核对,Range 探针复核):
  checkpoints/yue2_3b_bf16.safetensors      7,799,983,228 B  Comfy-Org/YuE2
  audio_encoders/sheetsage2_bf16.safetensors 1,386,868,122 B  Comfy-Org/YuE2
  loras/ar_lora_inst_v3abc_comfyui.safetensors 212,891,736 B  Mothersuperior/YuE2-instrumental-cot-full-loras
  (LoRA 原仓=instrumental AR LoRA cot=full 配方的 ComfyUI 原生布局件)

落位:引擎家 models/ 下对应类别目录(checkpoints/audio_encoders/loras),
与工作流引用名一致(yue2-整曲-官方版 / yue2-bgm-纯音乐-lora版 两工作流)。

幂等:已存在且字节数一致=跳过;存在但字节数不符=删残件重下(断点续传优先,
服务器忽略 Range 返回 200 全量时从头重写——照 common/modelscope_hub.py 口径)。

用法:
    python3 yue2_weights_provision.py [--dry-run] [--home <comfyui家目录>]

    --dry-run  只核对现状(已就位/缺失/字节数不符),零网络零写入
    --home     显式指定引擎家(默认:MYSTUDIO_COMFYUI_HOME env →
               manifest.json modelsDir → ~/Library/Application Support/
               漫影工作室/comfyui;镜像 engines/comfyui/manifest.py 解析序)

退出码:0=三件全部就位(或 dry-run 核对完成);1=任何一件下载/校验失败。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

MODELSCOPE_BASE = "https://modelscope.cn"

# ── 权重清单(单一套:repo / 仓内路径 / 引擎家类别 / 期望字节数)─────────
WEIGHTS: tuple[tuple[str, str, str, int], ...] = (
    ("Comfy-Org/YuE2", "checkpoints/yue2_3b_bf16.safetensors", "checkpoints", 7_799_983_228),
    ("Comfy-Org/YuE2", "audio_encoders/sheetsage2_bf16.safetensors", "audio_encoders", 1_386_868_122),
    (
        "Mothersuperior/YuE2-instrumental-cot-full-loras",
        "ar_lora_inst_v3abc_comfyui.safetensors",
        "loras",
        212_891_736,
    ),
)

DOWNLOAD_CHUNK = 1024 * 1024  # 1 MiB
PROGRESS_EVERY_S = 5.0


def resolve_models_dir(home_override: str | None) -> Path:
    """引擎 models 目录解析(镜像 engines/comfyui/manifest.py 语义,零后端依赖)。

    优先级:--home 显式 → MYSTUDIO_COMFYUI_HOME env → manifest.json 的
    modelsDir(用户把模型库指到外部盘的场景)→ 平台默认家/models。
    """
    if home_override:
        home = Path(home_override).expanduser()
    elif os.environ.get("MYSTUDIO_COMFYUI_HOME"):
        home = Path(os.environ["MYSTUDIO_COMFYUI_HOME"]).expanduser()
    else:
        if sys.platform == "darwin":
            home = Path.home() / "Library" / "Application Support" / "漫影工作室" / "comfyui"
        else:
            home = Path.home() / ".manying-dev" / "comfyui"
    manifest_file = home / "manifest.json"
    if manifest_file.is_file():
        try:
            models_dir = json.loads(manifest_file.read_text(encoding="utf-8")).get("modelsDir")
            if isinstance(models_dir, str) and models_dir.strip():
                return Path(models_dir).expanduser()
        except (OSError, json.JSONDecodeError):
            pass  # 账本读不到=按默认家/models 兜底
    return home / "models"


def _fmt_bytes(size: int) -> str:
    return f"{size / 1024 ** 3:.2f} GB" if size >= 1024 ** 3 else f"{size / 1024 ** 2:.1f} MB"


def download_file(repo: str, remote_path: str, dest: Path, expected_size: int) -> None:
    """ModelScope resolve 直链下载,断点续传(206/200 口径照 modelscope_hub)。"""
    url = f"{MODELSCOPE_BASE}/models/{repo}/resolve/master/{quote(remote_path)}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    have = dest.stat().st_size if dest.exists() else 0
    if have > expected_size:
        dest.unlink()  # 残件超长(错误来源)——从头重下
        have = 0
    last_log = 0.0
    while have < expected_size:
        headers = {"Range": f"bytes={have}-"} if have else {}
        with urlopen(Request(url, headers=headers), timeout=60.0) as resp:
            if have and resp.status != 206:
                # 服务器忽略 Range(200 全量)——弃断点从头重写
                have = 0
            mode = "ab" if have else "wb"
            with open(dest, mode) as handle:
                while True:
                    chunk = resp.read(DOWNLOAD_CHUNK)
                    if not chunk:
                        break
                    handle.write(chunk)
                    have += len(chunk)
                    now = time.monotonic()
                    if now - last_log > PROGRESS_EVERY_S:
                        pct = have * 100 // expected_size
                        print(f"  [下载] {dest.name}: {pct}% ({_fmt_bytes(have)}/{_fmt_bytes(expected_size)})", flush=True)
                        last_log = now
        if have < expected_size and not dest.exists():
            raise RuntimeError("连接中断且无落盘残件,无法续传")
    if have != expected_size:
        raise RuntimeError(f"字节数不符:期望 {expected_size},实际 {have}")


def main() -> int:
    parser = argparse.ArgumentParser(description="YuE2 全家权重供给(幂等,装机后手动跑一次)")
    parser.add_argument("--dry-run", action="store_true", help="只核对现状,零网络零写入")
    parser.add_argument("--home", default=None, help="显式指定 comfyui 引擎家目录")
    args = parser.parse_args()

    models_dir = resolve_models_dir(args.home)
    print(f"引擎 models 目录: {models_dir}")
    if args.dry_run:
        print("模式: dry-run(只核对,不下载)")

    failures = 0
    for repo, remote_path, category, expected in WEIGHTS:
        dest = models_dir / category / Path(remote_path).name
        label = f"{category}/{Path(remote_path).name}"
        exists = dest.is_file()
        actual = dest.stat().st_size if exists else 0
        if exists and actual == expected:
            print(f"[就位] {label}({_fmt_bytes(expected)},来源 {repo})——跳过")
            continue
        if args.dry_run:
            state = "缺失" if not exists else f"字节数不符(实际 {actual},期望 {expected})"
            print(f"[待供给] {label}——{state},将自 {repo} 下载约 {_fmt_bytes(expected)}")
            continue
        if exists:
            print(f"[重下] {label}:字节数不符(实际 {actual},期望 {expected}),续传/重下中")
        else:
            print(f"[下载] {label} ← {repo}(约 {_fmt_bytes(expected)})")
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            download_file(repo, remote_path, dest, expected)
            actual = dest.stat().st_size
            if actual != expected:
                raise RuntimeError(f"下载后字节数不符:期望 {expected},实际 {actual}")
            print(f"[完成] {label}({_fmt_bytes(actual)})")
        except Exception as exc:  # noqa: BLE001 —— 供给脚本要逐件报告不中断
            failures += 1
            print(f"[失败] {label}: {exc}", file=sys.stderr)

    if failures:
        print(f"\n{failures} 件失败;重跑本脚本即续(幂等)。", file=sys.stderr)
        return 1
    print("\n三件全部就位。" if not args.dry_run else "\ndry-run 核对完成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
