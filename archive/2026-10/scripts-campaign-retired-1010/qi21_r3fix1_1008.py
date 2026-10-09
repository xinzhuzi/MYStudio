#!/usr/bin/env python3
# qi21 九型实弹第1轮修复·概念气氛图禁人词(1008)
# 依据:九型实弹判图——概念气氛图人物闯入(主体句§9零人物/②层197字零人物词,纯模型自由发挥),
#       库级负面不对齐=场景型负面有「人影，人脸」而概念气氛图缺(8条 vs 10条)。
# 最小手术:概念气氛图 negative_text 尾追「人影，人脸」对齐场景型。唯一词侧修复点;
#       四型透明 alpha fail=直写装配路结构性(0927d 定谳),表情九格=09-20裁定13 生产路在案——均不动真源。
# 纪律:改前副本;引号锚定恰1命中(概念负向全文是场景负向前缀,裸串命中2,须闭合引号区分);五路同刷 md5 归一。
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path("/Users/zhengbingjin/Project/Github/MYStudio")
JSON_P = ROOT / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
MIRRORS = [
    ROOT / "apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json",
    Path("/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"),
    Path.home() / "Library/Application Support/漫影工作室/comfyui/daojie-data/qi21_bases.json",
    Path.home() / "Project/IP/MA/skills/art_skills/daojie_ink_guofeng/json/qi21_bases.json",
]
BK = ROOT / "apps/build/scripts/backups/qi21_r3fix1_1008"
REPORT = ROOT / "apps/build/scripts/qi21_r3_surgery_1008.report.md"

OLD_NEG = "模糊，水印，多手指，文字错误，写实油画，厚涂，照片质感，3D渲染"
NEW_NEG = OLD_NEG + "，人影，人脸"


def must(cond: bool, msg: str) -> None:
    if not cond:
        print(f"ABORT: {msg}")
        sys.exit(1)


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def esc(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)[1:-1]


def main() -> None:
    raw = JSON_P.read_text(encoding="utf-8")
    data = json.loads(raw)
    con = next(ty for ty in data["types"] if ty["zh"] == "概念气氛图")
    scn = next(ty for ty in data["types"] if ty["zh"] == "场景")
    must(con["negative_text"] == OLD_NEG, "概念气氛图负向现值≠锚串,现态异常")
    must(scn["negative_text"] == NEW_NEG, "场景型负向现值异常(对齐基准漂移)")
    # 撞词预检:人影/人脸 已在场景负向在册且全库正向撞词扫描现行绿(r3 check 56项),
    # 本刀不引入新 token 面;仍对发射语料(底座+本型正向)复检
    for face in (data["art_style_base"]["positive_text"], con["positive_text"]):
        for t in ("人影", "人脸"):
            must(t not in face, f"正向撞词: {t}")

    # 引号锚定恰1(裸串命中2=场景前缀,闭合引号区分)
    esc_old = esc(OLD_NEG) + '"'
    esc_new = esc(NEW_NEG) + '"'
    n = raw.count(esc_old)
    must(n == 1, f"引号锚定旧串命中 {n} 次,期望恰1")

    BK.mkdir(parents=True, exist_ok=True)
    shutil.copy2(JSON_P, BK / "qi21_bases.json.pre")

    raw2 = raw.replace(esc_old, esc_new)
    d2 = json.loads(raw2)
    con2 = next(ty for ty in d2["types"] if ty["zh"] == "概念气氛图")
    must(con2["negative_text"] == NEW_NEG, "术后概念负向≠新串")
    must(next(ty for ty in d2["types"] if ty["zh"] == "场景")["negative_text"] == NEW_NEG, "场景负向被误动")
    toks = [t.strip() for t in NEW_NEG.split("，") if t.strip()]
    must(len(toks) == len(set(toks)) == 10 and all(len(t) < 12 and "/" not in t for t in toks),
         "新负向清单格式门不过")
    JSON_P.write_text(raw2, encoding="utf-8")
    print(f"- 概念气氛图 negative_text: {len(OLD_NEG.split('，'))}条 → 10条(+人影,人脸)")

    for m in MIRRORS:
        must(m.exists(), f"镜像路径不存在: {m}")
        shutil.copy2(JSON_P, m)
    digests = {str(p): md5(p) for p in [JSON_P, *MIRRORS]}
    must(len(set(digests.values())) == 1, f"五路 md5 未归一: {digests}")
    print(f"- 五路同刷 json md5 归一: {set(digests.values()).pop()}")

    with open(REPORT, "a", encoding="utf-8") as f:
        f.write(
            "\n\n## 九型实弹第1轮修复·概念气氛图禁人词(1008,追加记)\n\n"
            f"| 面 | 旧 | 新 | 处数 |\n|---|---|---|---|\n"
            f"| 概念气氛图 negative_text | `{OLD_NEG}`(8条) | `{NEW_NEG}`(10条,对齐场景型) | 1 |\n\n"
            "- 判读定谳:①四型透明 alpha fail(道具/多视图/高清人脸/表情差分)=实弹驱动 qi21_bgscope_abfire_1008.py "
            "走直写装配路(MyQi21PromptAssembly.assemble 直塞 TextEncodeQwenImage21,无剥离链),多视图编码文 B句整句在场"
            "(0927d 臂「叠中文装配 0%」同构)——产线透明路=PE剥离+W1官方头尾包裹/多视图英文公式直塞,属产线路复刻缺口非词侧回归,真源不动;"
            "②表情差分九格崩=09-20裁定13 在案(每表情独立生成再拼=生产路,单发九宫格=快览),模型能力域;③道具装配文零「纸白/图纸」词"
            "(纸白底=直写路模型自由渲染,非提示词诱导);④高清人脸取景滑档=0926裁定6(程序裁切承担),证据已不计红。\n")
    print(f"- 报告追加 → {REPORT}")


if __name__ == "__main__":
    main()
