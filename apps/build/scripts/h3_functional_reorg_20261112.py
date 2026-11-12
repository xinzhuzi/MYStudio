#!/usr/bin/env python3
"""H3视频 功能重组第二轮(1112 用户令「按功能分类,数字人样式;无具体功能的放测试夹」)。

裁定(用户逐组亲裁,零删除全留档):
  1. `6_社区模板/` 撤域,11 件分流:
     - viggle-remake 三件 → 新 `6_视频重制/`(在役能力:改内容/换主体,保运镜音轨);
     - 其余八件(Easy×2/班长×2/TTS/潜空间960P/SeedVR2超分2K/FreeVideo)→ `7_测试/`;
  2. `7_FastH3/` 撤域,三件 → `7_测试/`(用户裁「移入测试留档」;1105 退役+底模 1111 物理删);
  3. `4_官方本地模板/` PikaFlex 六件(三 UI 母本+三加速双叠 API)→ `7_测试/`
     (用户裁「全移测试」;fl2va/ref2va 底模已删=纸面参照);
     官方五件(文生视频/首尾帧运镜/I2V/T2V/R2V)原位不动(recipes 登记);
  4. 件数零变化(全树恒 143,tree-total 锚不动)、零改名零内容改动纯移位、git mv 保历史;
  5. 1_漫影自研/2_固定线/3_超分后处理/5_云端API/8_数字人 全不动(功能分类已合格)。

同步面(另笔手工):h3-workflow-recipes.ts 两处 fasth3 uiTemplateRef、
契约测试三件路径锚(test_fasth3_*)、daojie_lora_refclose.py 一处路径、清单账本行。
幂等:目标位已有同名件且源位无件 → 跳过。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
H3 = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频"

VIGGLE = [
    "viggle-remake-edit.json",
    "viggle-remake-edit-single-ref.json",
    "viggle-remake-swap.json",
]
COMMUNITY_TO_TEST = [
    "社区-Easy-一键多模式-480P.json",
    "社区-Easy-两段精修-480P.json",
    "社区-FreeVideo-All-in-One-N卡专用.json",
    "社区-H3三采6步lora完美版.json",
    "社区-H3终极三采v2版.json",
    "社区-TTS-语音生成-480P.json",
    "社区-480P生成-潜空间放大到960P.json",
    "社区-480P生成-960P精修-SolAttn加速-SeedVR2超分2K.json",
]
FASTH3 = [
    "fasth3-单镜视频-i2v.json",
    "fasth3-单镜视频-t2v.json",
    "fasth3-二采超分-2x.json",
]
PIKAFLEX = [
    "官方本地-PikaFlex-T2V.json",
    "官方本地-PikaFlex-FL2VA首尾帧.json",
    "官方本地-PikaFlex-REF2VA参考图.json",
    "官方本地-PikaFlex-T2V-加速双叠.json",
    "官方本地-PikaFlex-FL2VA首尾帧-加速双叠.json",
    "官方本地-PikaFlex-REF2VA参考图-加速双叠.json",
]

MOVES: list[tuple[str, str]] = (
    [(f"6_社区模板/{n}", f"6_视频重制/{n}") for n in VIGGLE]
    + [(f"6_社区模板/{n}", f"7_测试/{n}") for n in COMMUNITY_TO_TEST]
    + [(f"7_FastH3/{n}", f"7_测试/{n}") for n in FASTH3]
    + [(f"4_官方本地模板/{n}", f"7_测试/{n}") for n in PIKAFLEX]
)

EXPECTED_REMAKE = sorted(VIGGLE)
EXPECTED_TEST = sorted(COMMUNITY_TO_TEST + FASTH3 + PIKAFLEX)
EXPECTED_OFFICIAL = sorted([
    "H3-文生视频-480p.json",
    "H3-首尾帧运镜版.json",
    "官方本地-I2V-480P.json",
    "官方本地-T2V-480P.json",
    "官方本地-R2V-480P-需解冻ref2va.json",
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
    for d in ("6_社区模板", "7_FastH3"):
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
    assert after == before == 143, f"树计数漂移: {before} -> {after}(恒 143)"
    remake = sorted(p.name for p in (H3 / "6_视频重制").glob("*.json"))
    test = sorted(p.name for p in (H3 / "7_测试").glob("*.json"))
    official = sorted(p.name for p in (H3 / "4_官方本地模板").glob("*.json"))
    assert remake == EXPECTED_REMAKE, f"6_视频重制 件册不符: {remake}"
    assert test == EXPECTED_TEST, f"7_测试 件册不符: {test}"
    assert official == EXPECTED_OFFICIAL, f"4_官方本地模板 件册不符: {official}"
    assert not (H3 / "6_社区模板").exists(), "6_社区模板 应已撤"
    assert not (H3 / "7_FastH3").exists(), "7_FastH3 应已撤"
    print(f"OK 终态就位:6_视频重制 {len(remake)} / 7_测试 {len(test)} / "
          f"4_官方本地模板 {len(official)};全树 {after} 零漂移")
    return 0


if __name__ == "__main__":
    sys.exit(main())
