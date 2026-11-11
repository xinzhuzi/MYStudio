#!/usr/bin/env python3
"""H3视频 分类重组(1112 用户令)——数字人升顶层域 + 吸收归档撤域按类型归位。

裁定(1112 用户令):
  1. `1_漫影自研/2_数字人/` 两件 → `8_数字人/`(数字人单独做一个顶层分类);
  2. `8_吸收归档/` 撤域(「不要叫吸收归档」),六件按类型归位:
     - `340-H3数字人V6/340-H3无限时长V6-萝卜原件` 两件 → `8_数字人/`(账属数字人);
     - `pika-单镜视频-{fl2v,ref2v}` + `三采-单镜-RelayVSR-1110` +
       `单镜视频 · chapter-001 · S01`(首跑历史样本)四件 →
       `1_漫影自研/0_单镜视频/`(账属单镜视频);
  3. 件数零变化(全树恒 143,tree-total 锚不动);退役/归档语义此后由文件名
     后缀承载(-RelayVSR-1110 / -萝卜原件),不再由「吸收归档」文件夹承载。

零改名零内容改动纯移位,git mv 保历史。幂等:目标位已有同名件且源位无件 → 跳过。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
H3 = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频"

MOVES: list[tuple[str, str]] = [
    # 数字人升顶层域 8_数字人(1112 用户令「单独做一个分类」)
    ("1_漫影自研/2_数字人/数字人-音频驱动.json", "8_数字人/数字人-音频驱动.json"),
    ("1_漫影自研/2_数字人/无限时长-循环拼接.json", "8_数字人/无限时长-循环拼接.json"),
    ("8_吸收归档/340-H3数字人V6-萝卜原件.json", "8_数字人/340-H3数字人V6-萝卜原件.json"),
    ("8_吸收归档/340-H3无限时长V6-萝卜原件.json", "8_数字人/340-H3无限时长V6-萝卜原件.json"),
    # 吸收归档撤域 → 单镜血统归位 0_单镜视频
    ("8_吸收归档/pika-单镜视频-fl2v.json", "1_漫影自研/0_单镜视频/pika-单镜视频-fl2v.json"),
    ("8_吸收归档/pika-单镜视频-ref2v.json", "1_漫影自研/0_单镜视频/pika-单镜视频-ref2v.json"),
    ("8_吸收归档/三采-单镜-RelayVSR-1110.json", "1_漫影自研/0_单镜视频/三采-单镜-RelayVSR-1110.json"),
    ("8_吸收归档/单镜视频 · chapter-001 · S01.json", "1_漫影自研/0_单镜视频/单镜视频 · chapter-001 · S01.json"),
]

EXPECTED_DIGITALHUMAN = sorted([
    "340-H3数字人V6-萝卜原件.json",
    "340-H3无限时长V6-萝卜原件.json",
    "数字人-音频驱动.json",
    "无限时长-循环拼接.json",
])
EXPECTED_SINGLE_SHOT = sorted([
    "pika-单镜视频-fl2v.json",
    "pika-单镜视频-ref2v.json",
    "三采-单镜-RelayVSR-1110.json",
    "三采-单镜.json",
    "单镜视频 · chapter-001 · S01.json",
])


def tree_count() -> int:
    return len([p for p in (REPO / "apps/backend/comfyui/workflows").rglob("*.json")])


def main() -> int:
    before = tree_count()
    for src_rel, dst_rel in MOVES:
        src, dst = H3 / src_rel, H3 / dst_rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists() and not src.exists():
            print(f"skip(已迁): {dst_rel}")
            continue
        if not src.exists():
            print(f"FAIL 源缺件: {src_rel}", file=sys.stderr)
            return 1
        if dst.exists():
            print(f"FAIL 目标已占位: {dst_rel}", file=sys.stderr)
            return 1
        subprocess.run(["git", "mv", str(src), str(dst)], cwd=REPO, check=True)
        print(f"moved: {src_rel} -> {dst_rel}")

    # 撤空目录(git 不跟踪目录,空了即撤)
    for d in ("1_漫影自研/2_数字人", "8_吸收归档"):
        p = H3 / d
        if p.exists():
            if any(p.iterdir()):
                print(f"FAIL 目录未清空: {d} 仍有 {sorted(x.name for x in p.iterdir())}",
                      file=sys.stderr)
                return 1
            p.rmdir()
            print(f"rmdir: {d}")

    # 终态断言
    after = tree_count()
    assert after == before, f"树计数漂移: {before} -> {after}"
    dh = sorted(p.name for p in (H3 / "8_数字人").glob("*.json"))
    ss = sorted(p.name for p in (H3 / "1_漫影自研/0_单镜视频").glob("*.json"))
    assert dh == EXPECTED_DIGITALHUMAN, f"8_数字人 件册不符: {dh}"
    assert ss == EXPECTED_SINGLE_SHOT, f"0_单镜视频 件册不符: {ss}"
    assert not (H3 / "8_吸收归档").exists(), "8_吸收归档 应已撤"
    assert not (H3 / "1_漫影自研/2_数字人").exists(), "1_漫影自研/2_数字人 应已撤"
    print(f"OK 终态就位:8_数字人 {len(dh)} 件 / 0_单镜视频 {len(ss)} 件;全树 {after} 零漂移")
    return 0


if __name__ == "__main__":
    sys.exit(main())
