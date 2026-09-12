# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影工作流库重整 v3(09-10 用户裁定×2:漫影/ 分组内按域分类再嵌套)。

终态树(数字前缀=ComfyUI 浏览器内的稳定排序;域→产线→功能三层):

    漫影/
    ├── 1_图片/
    │   ├── K2图像/   1_文生图 2_图生图 3_改图 4_上色 5_风格扩展 6_修复超分
    │   └── 分镜/     1_总览(章节总览·应用保鲜写入位) 2_单镜图(每镜图片工作流·迁移器写入位)
    ├── 2_视频/
    │   └── H3视频/   1_漫影自研(自研工作流家) 2_固定线 … 6_社区模板
    ├── 3_声音/
    │   └── 音乐/
    └── 4_参考_提示词工程/

规则:
- 幂等可重跑:源不在=跳过;根层散件(装机旧代码会再落的总览/迁移)按前缀回收。
- 零删除:撞名(内容不同)不覆盖只报告;内容相同才去重删源。
- 未匹配映射的根层 json 一律不动并报告(人工裁定)。

用法:
    python3 manying_workflow_library_reorg.py <workflows目录> [--legacy-dir <旧库路径>] [--dry-run]
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
import time
from pathlib import Path

ROOT = "漫影"

# 根层整夹平移(首轮收拢;重跑时源已不在=跳过)
ROOT_FOLDER_MOVES = ("K2图像", "H3视频", "参考_提示词工程")

# 域内夹改名/搬迁:先 v2 规整(旧命名→功能命名),再 v3 域嵌套(图片/视频/声音);
# 字典序=执行序,前步产物(漫影/分镜 等)正好作为后步源
FOLDER_MOVES = {
    # ── v2 规整(幂等:已规整的源不在=跳过)──
    "漫影/分镜总览": "漫影/分镜/1_总览",
    "漫影/分镜图": "漫影/分镜/2_单镜图",
    "漫影/K2图像/改图": "漫影/K2图像/3_改图",
    "漫影/K2图像/上色": "漫影/K2图像/4_上色",
    "漫影/H3视频/1_固定线": "漫影/H3视频/2_固定线",
    "漫影/H3视频/2_超分后处理": "漫影/H3视频/3_超分后处理",
    "漫影/H3视频/3_官方本地模板": "漫影/H3视频/4_官方本地模板",
    "漫影/H3视频/4_云端API": "漫影/H3视频/5_云端API",
    "漫影/H3视频/5_社区模板": "漫影/H3视频/6_社区模板",
    # ── v3 域嵌套(09-10 用户裁定:漫影库按图片/视频/声音分域)──
    "漫影/K2图像": "漫影/1_图片/K2图像",
    "漫影/分镜": "漫影/1_图片/分镜",
    "漫影/H3视频": "漫影/2_视频/H3视频",
    "漫影/音乐": "漫影/3_声音/音乐",
    "漫影/参考_提示词工程": "漫影/4_参考_提示词工程",
}

# 需确保存在的空夹(自研家的落点;.keep.json 占位让空夹在工作流树内可见)
ENSURE_DIRS = ("漫影/2_视频/H3视频/1_漫影自研",)

# K2图像/ 夹根散件 → 功能子夹(名字必须与库内完全一致,注意全/半角括号与大小写)
K2_ROOT_FILE_MAP = {
    "K2-SeedVR2修复.json": "6_修复超分",
    "K2-SeedVR2降噪后4K.json": "6_修复超分",
    "K2-去噪精修.json": "6_修复超分",
    "K2-文生图-简版.json": "1_文生图",
    "Krea2-NSFW专业流.json": "1_文生图",
    "Krea2-NSFW专业流-旧版0901.json": "1_文生图",
    "Krea2-文生图-简版.json": "1_文生图",
    "Krea2-NSFW专业流-图生图.json": "2_图生图",
    "Krea2-无审查全家桶(4K放大+提示词增强).json": "2_图生图",
    "Krea2-无审查全家桶(4K放大+提示词增强).laid_out.json": "2_图生图",
    "krea2-图像编辑-整合流.json": "3_改图",
    "Krea2-风格扩展流（3946种）.json": "5_风格扩展",
    "krea2-风格扩展流（图生图版）.json": "5_风格扩展",
}
K2_DIR = "漫影/1_图片/K2图像"

# 非工作流参考件归参考家
K2_DOC_MOVES = {"K2-图生图提示词模板.md": "漫影/4_参考_提示词工程"}

# 根层散件前缀回收(装机旧代码在打包前仍会落根层;重跑即清)
ROOT_PREFIX_MOVES = {
    "分镜总览 · ": "漫影/1_图片/分镜/1_总览",
    "迁移 · ": "漫影/1_图片/分镜/2_单镜图",
    "music3-": "漫影/3_声音/音乐",
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def drain_legacy_library(base: Path, legacy: Path | None, actions: list[str], dry_run: bool) -> None:
    """旧默认库 <comfy-home>/workflows 是回种源:merge_legacy_workflows_dir 每逢库操作
    就把根层缺失的种子拷回,形成「归位→回种」死循环。当旧库全部文件都能在
    新库找到逐字节相同副本时,把旧库目录整体改名封存(零删除,可手动找回);
    有任何独有文件则不动并报告。legacy 由调用方按 manifest.legacy_workflows_dir()
    解析后显式传入(层级不可猜,2026-09-10 dry-run 实证猜错会封存现库)。"""
    if legacy is None:
        return
    legacy = legacy.resolve()
    if legacy == base.resolve() or base.resolve() in legacy.parents or legacy in base.resolve().parents:
        actions.append(f"[旧库路径异常不动] legacy={legacy}(与现库同径或嵌套)")
        return
    if not legacy.is_dir():
        return
    orphans: list[str] = []
    for src in sorted(legacy.rglob("*.json")):
        rel = src.relative_to(legacy)
        candidates = [base / rel] + [p for p in base.rglob(src.name)]
        if not any(p.is_file() and digest(p) == digest(src) for p in candidates):
            orphans.append(rel.as_posix())
    if orphans:
        actions.append(f"[旧库有独有文件不动] {legacy}:{orphans}")
        return
    stamp = time.strftime("%Y%m%d-%H%M%S")
    sealed = legacy.with_name(f"workflows.已并入-{stamp}")
    actions.append(f"[封存旧库] {legacy} → {sealed}(全量副本已在新库,终止回种)")
    if not dry_run:
        legacy.rename(sealed)


def main() -> int:
    parser = argparse.ArgumentParser(description="漫影工作流库功能分类重整")
    parser.add_argument("workflows_dir", type=Path)
    parser.add_argument("--legacy-dir", type=Path, default=None,
                        help="旧默认库路径(= comfy 家/workflows,按 manifest.legacy_workflows_dir 解析;不传则跳过封存)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    base: Path = args.workflows_dir
    if not base.is_dir():
        print(f"目录不存在:{base}")
        return 1
    actions: list[str] = []
    leftovers: list[str] = []

    def move_into(src: Path, dst: Path, note: str) -> None:
        if dst.exists():
            if src.is_file() and dst.is_file() and digest(src) == digest(dst):
                actions.append(f"[去重] {src.name}(内容同,删源)")
                if not args.dry_run:
                    src.unlink()
            else:
                actions.append(f"[撞名不动] {src} → {dst}(目标已存在)")
            return
        actions.append(f"[移动] {src.relative_to(base)} → {dst.relative_to(base)}({note})")
        if not args.dry_run:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))

    def move_folder(src: Path, dst: Path) -> None:
        if not src.is_dir():
            return
        if dst.exists():
            actions.append(f"[夹撞名不动] {src} → {dst}")
            return
        actions.append(f"[整夹] {src.relative_to(base)} → {dst.relative_to(base)}")
        if not args.dry_run:
            dst.parent.mkdir(parents=True, exist_ok=True)
            src.rename(dst)

    # ── 1. 根层整夹平移(v1 首轮;幂等)──
    for name in ROOT_FOLDER_MOVES:
        move_folder(base / name, base / ROOT / name)

    # ── 2. 域内整夹改名/搬迁(固定映射;先搬后建——预建会占位挡搬迁)──
    for src_rel, dst_rel in FOLDER_MOVES.items():
        move_folder(base / src_rel, base / dst_rel)
    for sub in ENSURE_DIRS:
        target = base / sub
        marker = target / ".keep.json"
        if not marker.exists():
            actions.append(f"[建夹] {sub}(.keep.json 占位:树内可见)")
            if not args.dry_run:
                target.mkdir(parents=True, exist_ok=True)
                marker.write_text("{}", encoding="utf-8")

    # ── 3. K2 夹根散件按功能归位 ──
    k2 = base / K2_DIR
    if k2.is_dir():
        for item in sorted(k2.iterdir()):
            if not item.is_file():
                continue
            if item.name in K2_DOC_MOVES:
                move_into(item, base / K2_DOC_MOVES[item.name], "参考件归参考家")
            elif item.name in K2_ROOT_FILE_MAP:
                move_into(item, k2 / K2_ROOT_FILE_MAP[item.name] / item.name, "功能归类")

    # ── 4. 根层散件回收(重跑清装机旧代码残留+旧库回种件)──
    for item in sorted(base.iterdir()):
        if not item.is_file() or item.name.startswith("."):
            continue
        target_dir = next((d for p, d in ROOT_PREFIX_MOVES.items() if item.name.startswith(p)), None)
        if target_dir:
            move_into(item, base / target_dir / item.name, "根层回收")
        elif item.name in K2_ROOT_FILE_MAP:
            move_into(item, base / K2_DIR / K2_ROOT_FILE_MAP[item.name] / item.name, "根层回种件归位")
        elif item.name.endswith(".json"):
            leftovers.append(f"[根层未分类不动] {item.name}")
        else:
            leftovers.append(f"[根层非json不动] {item.name}")

    # ── 5. 封存回种源(旧默认库;全量同内容才动)──
    drain_legacy_library(base, args.legacy_dir, actions, args.dry_run)

    print("\n".join(actions) if actions else "(无动作:库已是终态)")
    if leftovers:
        print("\n".join(leftovers))
    total = len([a for a in actions if a.startswith(("[移动]", "[整夹]", "[去重]", "[建夹]"))])
    print(f"\n{'(dry-run) ' if args.dry_run else ''}共 {total} 项动作;目录={base}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
