#!/usr/bin/env python3
"""1008 快出档画幅缩编:九型 megapixels 4.2 档 → 1-2MP 档(用户令:类型出图
size 太大无法满足快速出图,缩到 1-2 百万像素之间,后续走放大)。

手术面(唯一数据真源,引擎热读 mtime 失效即改即生效):
  apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json
    六型 megapixels 4.2 → 1.5(人物3:4/场景16:9/美宣21:9/分镜16:9/表情差分1:1/概念气氛图16:9)
    多视图 megapixels 4.2 → 1.8 + resolution_override [3072,1024] → [2448,816]
      (Q2.1 侧公式路 1192×1584=1.80MP / K2 侧合板 override 2448×816=1.91MP,三联格多顶格近2)
    道具/高清人脸/自由 1.0 不动(已在区间)
  装机固定位 /Applications/.../json/qi21_bases.json 同步热修
    (前置=改前与仓库真源 sha256 一致才覆盖,防用户手改被冲;
     test_prompt_source_single_truth 本就强制两路逐字节一致)

零 py 改动:native_px 公式/回退常量/历史注释(4.2MP 清退记载)全不动;
宽高由 my_daojie_base.native_px 按新 MP 现算,8 倍数天然保证。

幂等:重跑时目标型已是新值=双态跳过绿;备份=改前副本入 backups/。
"""
import hashlib
import json
import math
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
JSON_P = (REPO / "apps/frontend/assets/studio-manuals/art_skills"
          / "daojie_ink_guofeng/json/qi21_bases.json")
INSTALL_P = Path("/Applications/漫影工作室.app/Contents/Resources/studio-manuals"
                 "/art_skills/daojie_ink_guofeng/json/qi21_bases.json")
BK = REPO / "apps/build/scripts/backups/qi21_mp_downscale_1008"

ASPECTS = {
    "3:4 (Portrait Standard)": (3, 4),
    "16:9 (Widescreen)": (16, 9),
    "21:9 (Ultrawide)": (21, 9),
    "1:1 (Square)": (1, 1),
}


def native_px(label: str, mp: float, multiple: int = 8):
    wr, hr = ASPECTS[label]
    scale = math.sqrt(mp * 1024 * 1024 / (wr * hr))
    return (round(wr * scale / multiple) * multiple,
            round(hr * scale / multiple) * multiple)


# 旧档 → 新档(六型 1.5 + 多视图 1.8;1.0 三型不在表=不动)
PLAN = {
    "人物": (4.2, 1.5),
    "场景": (4.2, 1.5),
    "美宣": (4.2, 1.5),
    "分镜剧情图": (4.2, 1.5),
    "表情差分": (4.2, 1.5),
    "概念气氛图": (4.2, 1.5),
    "多视图": (4.2, 1.8),
}
OLD_MV_OVERRIDE = [3072, 1024]
NEW_MV_OVERRIDE = [2448, 816]  # 3:1 精确,8 倍数,1.905MP


def must(cond, msg):
    if not cond:
        print(f"✗ {msg}")
        sys.exit(1)


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> int:
    must(JSON_P.is_file(), f"真源缺失: {JSON_P}")
    pre_sha = sha(JSON_P)
    data = json.loads(JSON_P.read_text(encoding="utf-8"))
    entries = {e.get("zh"): e for e in data["types"]}

    already = all(entries[zh]["megapixels"] == new for zh, (_o, new) in PLAN.items())
    if already:
        print("✓ 双态跳过:七型已是新档,零写入(幂等)")
    else:
        # 改前逐型恰值断言
        for zh, (old, _new) in PLAN.items():
            e = entries.get(zh)
            must(e is not None, f"型缺失: {zh}")
            must(e["megapixels"] == old,
                 f"「{zh}」megapixels={e['megapixels']} 非旧档 {old}(现值被他人动过,拒改)")
        mv = entries["多视图"]
        must(mv.get("resolution_override") == OLD_MV_OVERRIDE,
             f"多视图 override={mv.get('resolution_override')} 非旧值 {OLD_MV_OVERRIDE}")

        BK.mkdir(parents=True, exist_ok=True)
        shutil.copy2(JSON_P, BK / "qi21_bases.json.pre")
        print(f"✓ 改前副本: {BK / 'qi21_bases.json.pre'}")

        for zh, (_old, new) in PLAN.items():
            entries[zh]["megapixels"] = new
        mv["resolution_override"] = NEW_MV_OVERRIDE

        JSON_P.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8")
        # 术后回读全量断言
        d2 = json.loads(JSON_P.read_text(encoding="utf-8"))
        e2 = {e["zh"]: e for e in d2["types"]}
        for zh, (_o, new) in PLAN.items():
            must(e2[zh]["megapixels"] == new, f"术后「{zh}」mp≠{new}")
        must(e2["多视图"]["resolution_override"] == NEW_MV_OVERRIDE,
             "术后多视图 override≠新对")
        for zh in ("道具", "高清人脸", "自由"):
            must(e2[zh]["megapixels"] == 1.0, f"「{zh}」1.0 档被误动")
        # 其余字段零波及:型数/顺序/positive_text 长度
        must(len(d2["types"]) == len(data["types"]) == 10, "型数≠10")
        print("✓ 真源家手术完成(七型新档+术后断言全过)")

    # 装机固定位热修(合法态=改前备份(纯打包产物)或当前仓库版,二者之外
    # =疑用户手改拒覆盖;若不存在自然跳过)
    if INSTALL_P.is_file():
        legal = {pre_sha, sha(JSON_P)}
        bk = BK / "qi21_bases.json.pre"
        if bk.is_file():
            legal.add(sha(bk))
        inst = sha(INSTALL_P)
        if inst == sha(JSON_P):
            print("✓ 装机固定位已一致(免刷)")
        elif inst in legal:
            shutil.copy2(JSON_P, INSTALL_P)
            must(sha(INSTALL_P) == sha(JSON_P), "装机热修后 sha 不一致")
            print("✓ 装机固定位已热修(/Applications Resources,sha 对齐)")
        else:
            print("✗ 装机固定位非合法态(疑用户手改),拒覆盖,人工排查")
            return 1
    else:
        print("· 装机固定位不存在,跳过(引擎家 daojie-data 自播种随包)")

    print("\n== 新档位表(引擎热读即生效,宽高=native_px 现算 8 倍数) ==")
    d3 = json.loads(JSON_P.read_text(encoding="utf-8"))
    for e in d3["types"]:
        ov = e.get("resolution_override")
        if ov:
            w, h = ov
        else:
            w, h = native_px(e["aspect_ratio"], e["megapixels"])
        print(f"  {e['zh']}: {e['aspect_ratio'].split(' ')[0]} @{e['megapixels']}MP → {w}×{h} = {w*h/1048576:.2f}MP")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
