#!/usr/bin/env python3
# qi21 第三轮删词刀手术(1008):成片质量句人物限定 + 远景句「晕染」退役为低对比淡墨色面
# 前例配方: qi21_bgscope_surgery_1008.py(改前副本;每处旧串命中恰 N 次才动刀,零/多命中 abort;字段级报告落盘)
# 本刀落点: 真源 json 2 编辑(①恰1 ②恰4)+ 07宪法§八 +1 行 + 卡文四件正向槽同步
#           + canon_lib/测试 五树活面扫描(实测零命中,不动)+ 05库 §六台账 +1 行(正文不动)
#           + 五路同刷 md5 归一
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/zhengbingjin/Project/Github/MYStudio")
JSON_P = ROOT / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
CARD_FILES = [
    ROOT / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
    ROOT / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json",
    ROOT / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json",
    ROOT / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json",
]
LIB_P = ROOT / "apps/build/scripts/daojie_canon_lib.py"
DOC07_P = ROOT / "docs/prompts/Qwen-Image-2.1/07-主体句写作宪法.md"
DOC05_P = ROOT / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"
TESTS_DIR = ROOT / "apps/backend/engines/comfyui/my_nodes/tests"
WF_DIR = ROOT / "apps/backend/engines/comfyui/workflows"
SUBG_DIR = ROOT / "apps/backend/engines/comfyui/my_nodes/subgraphs"
BK = ROOT / "apps/build/scripts/backups/qi21_r3_1008"
REPORT = ROOT / "apps/build/scripts/qi21_r3_surgery_1008.report.md"

# ── 本刀两处旧串(工作树现文逐字)/新串 ──
E1_OLD = "颜料层纯净均匀，罩染通透细腻。"           # 底座成片质量段,恰1处
E1_NEW = "人物及关键配件的颜料层纯净均匀，罩染通透细腻。"  # 工艺词作用域限定人物侧
# 注意: E1_NEW 含 E1_OLD 作子串(前例 A2B 同款陷阱)——绝迹断言用上下文判别串
E1_OLD_CTX = "。颜料层纯净均匀"  # 旧串原上文(细节密度句号后);新串以「的颜料层」起,此形改后必绝迹
E2_OLD = "远景以淡墨晕染退开，仅保留山脊轮廓与剪影。"   # 人物/多视图/高清人脸/表情差分,恰4处
E2_NEW = "远景以低对比淡墨色面退开，仅保留山脊轮廓与剪影。"  # 「晕染」退役为低对比色面措辞
# 美宣「远景收入一片淡墨虚实」/分镜「远景用淡墨退去」无「晕染」词——不动(命中0断言在案)

# ── 07宪法 §八补行(逐字=任务令) ──
DOC07_HEADING = "## 八、光参数四要素(光型禁写)"
DOC07_NEWLINE = "- 光色落点限定人物与近景边缘(如“光晕只落在发际与肩线”),光不负责给背景主色面上色;背景冷暖由主体句按场景事实分区(§七A)。"

# ── 05库 §六台账新行(引旧串用半角逗号,不复活全角旧串字面) ──
DOC05_HEADING = "## 六、演进与待裁定"
DOC05_LEDGER = ("- **1008 删词刀第三轮(作用域再收·用户令;前刀=1008 作用域切分轮)**:"
                "①底座成片质量段「颜料层纯净均匀,罩染通透细腻。」→「人物及关键配件的颜料层纯净均匀,罩染通透细腻。」"
                "(颜料/罩染工艺词限定人物与关键配件,背景大色面不受诱导;恰1处)"
                "②四型远景句「远景以淡墨晕染退开,仅保留山脊轮廓与剪影。」→「远景以低对比淡墨色面退开,仅保留山脊轮廓与剪影。」"
                "(人物/多视图/高清人脸/表情差分恰4处;「晕染」笔墨诱导词退役,美宣「远景收入一片淡墨虚实」/分镜「远景用淡墨退去」"
                "无晕染词不动)③07宪法§八补一行纪律:光色落点限定人物与近景边缘,光不负责给背景主色面上色,"
                "背景冷暖由主体句按场景事实分区(§七A);防复活=五树活面扫描(json/canon_lib/工作流卡文/测试/docs)"
                "canon_lib 与测试零命中,卡文四件正向槽随底座同步(按旧串==json底座文识别,不按槽号);"
                "手术=qi21_r3_surgery_1008.py(恰N命中断言+副本+报告+五路md5归一);"
                "本库=记录层正文不动,真值以 json 现值为准。")

# ── 五路同刷(json) ──
MIRRORS = [
    ROOT / "apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json",
    Path("/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"),
    Path.home() / "Library/Application Support/漫影工作室/comfyui/daojie-data/qi21_bases.json",
    Path.home() / "Project/IP/MA/skills/art_skills/daojie_ink_guofeng/json/qi21_bases.json",
]


def must(cond: bool, msg: str) -> None:
    if not cond:
        print(f"ABORT: {msg}")
        sys.exit(1)


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def scan_tree(tag: str, old: str) -> list[str]:
    """五树活面扫描:返回命中文件相对路径清单。"""
    hits: list[str] = []
    roots = {
        "json": [JSON_P],
        "canon_lib": [LIB_P],
        "工作流卡文": [*CARD_FILES],
        "测试": sorted(TESTS_DIR.rglob("*.py")),
        "docs": sorted((ROOT / "docs/prompts/Qwen-Image-2.1").glob("*.md")),
    }[tag]
    for f in roots:
        try:
            n = f.read_text(encoding="utf-8").count(old)
        except Exception:
            continue
        if n:
            hits.append(f"{f.relative_to(ROOT)} ×{n}")
    return hits


def main() -> None:
    # 0) 现值读取
    json_text = JSON_P.read_text(encoding="utf-8")
    data = json.loads(json_text)
    old_pos = data["art_style_base"]["positive_text"]
    must(E1_OLD in old_pos and E2_OLD not in old_pos, "底座正向不含①旧串或误含②旧串,现态异常")

    # 五树活面扫描前置态(报告用;canon_lib/测试 应零命中——1007"留旧句=复活陷阱"防复活令)
    pre_scan = {tag: scan_tree(tag, old) for tag in ("canon_lib", "测试") for old in (E1_OLD, E2_OLD)}
    for tag, hits in pre_scan.items():
        must(not hits, f"防复活扫描意外命中 {tag}: {hits}(须先人工定谳再动刀)")

    # 1) 改前副本
    BK.mkdir(parents=True, exist_ok=True)
    for f in [JSON_P, *CARD_FILES, LIB_P, DOC07_P, DOC05_P]:
        shutil.copy2(f, BK / (f.name + ".pre"))
    print(f"副本 → {BK}")

    log: list[str] = []

    # 2) 真源 2 编辑(恰N命中)
    n1 = json_text.count(E1_OLD)
    must(n1 == 1, f"[json ①] 旧串命中 {n1} 次,期望恰 1")
    json_text = json_text.replace(E1_OLD, E1_NEW)
    n2 = json_text.count(E2_OLD)
    must(n2 == 4, f"[json ②] 旧串命中 {n2} 次,期望恰 4")
    json_text = json_text.replace(E2_OLD, E2_NEW)
    json.loads(json_text)  # 合法性
    must(json_text.count(E1_NEW) == 1, "json ①新串计数异常")
    must(json_text.count(E2_NEW) == 4, "json ②新串计数异常")
    must(E1_OLD_CTX not in json_text, "json ①旧串(上下文形)残留")
    JSON_P.write_text(json_text, encoding="utf-8")
    log.append(f"- json ①: 成片质量句人物限定 ×1")
    log.append(f"- json ②: 远景句低对比淡墨色面 ×4(人物/多视图/高清人脸/表情差分)")

    # 3) 07宪法 §八末尾 +1 行
    doc07 = DOC07_P.read_text(encoding="utf-8")
    must(doc07.count(DOC07_HEADING) == 1, "07宪法 §八标题锚命中异常")
    must(DOC07_NEWLINE not in doc07, "07宪法新行已在场,重复插入")
    lines = doc07.split("\n")
    hidx = next(i for i, x in enumerate(lines) if x == DOC07_HEADING)
    must(lines[hidx + 1] == "", "07宪法 §八标题后非空行,结构异常")
    must("光位" in lines[hidx + 2], "07宪法 §八正文行不在标题+2,结构异常")
    lines.insert(hidx + 3, DOC07_NEWLINE)  # 任务令=§八末尾:标题+空行+正文行之后
    DOC07_P.write_text("\n".join(lines), encoding="utf-8")
    log.append("- 07宪法 §八 +1 行(光色落点纪律)")

    # 4) 卡文同步(按旧串==现json底座文识别,不按槽号;i2i族装配器无负向槽教训在案,本刀零负向改动)
    new_pos = old_pos.replace(E1_OLD, E1_NEW)
    must(new_pos != old_pos and E1_NEW in new_pos and E2_NEW not in new_pos, "新底座正向推导异常")
    for f in CARD_FILES:
        t = f.read_text(encoding="utf-8")
        must(t.count(old_pos) == 1, f"{f.name} 正向旧底座文命中 {t.count(old_pos)} 次,期望恰 1")
        t = t.replace(old_pos, new_pos)
        json.loads(t)
        f.write_text(t, encoding="utf-8")
        log.append(f"- 卡文 `{f.name}`: 正向底座槽 ×1")

    # 5) 05库 §六台账 +1 行(正文不动;台账行引旧串用半角逗号,不复活全角字面)
    doc05 = DOC05_P.read_text(encoding="utf-8")
    must(doc05.count(DOC05_HEADING) == 1, "05库 §六标题锚命中异常")
    must(DOC05_LEDGER not in doc05, "05库台账行已在场,重复插入")
    o1_pre = doc05.count(E1_OLD)
    lines = doc05.split("\n")
    gidx = next(i for i, x in enumerate(lines) if x == DOC05_HEADING)
    must(lines[gidx + 1] == "", "05库 §六标题后非空行,结构异常")
    lines.insert(gidx + 2, DOC05_LEDGER)
    doc05_new = "\n".join(lines)
    must(doc05_new.count(E1_OLD) == o1_pre and doc05_new.count(E2_OLD) == 0,
         "05库台账行复活了旧串全角字面,异常")
    DOC05_P.write_text(doc05_new, encoding="utf-8")
    log.append("- 05库 §六台账 +1 行(正文不动)")

    # 6) 后验:五树活面复扫。E1_NEW 含 E1_OLD 作子串(前例 A2B 同款陷阱)——
    #    活文件旧串仅允许全数落在新串内:判据=count(旧)==count(新) 且上下文形「。颜料层纯净均匀」绝迹;
    #    E2 两串互不为子串,直接绝迹判;canon_lib/测试 零命中硬判(防复活令)
    for f in [JSON_P, *CARD_FILES]:
        t = f.read_text(encoding="utf-8")
        must(t.count(E1_OLD) == t.count(E1_NEW) == 1, f"E1 子串判别异常(旧串越出新串域): {f.name}")
        must(E1_OLD_CTX not in t, f"旧串①(上下文形)残留: {f.name}")
        must(E2_OLD not in t, f"旧串②残留: {f.name}")
    must(JSON_P.read_text(encoding="utf-8").count(E2_NEW) == 4, "json ②新串计数异常")
    for f in CARD_FILES:
        must(E2_NEW not in f.read_text(encoding="utf-8"), f"E2 新串误入卡文(型级句不入卡): {f.name}")
    for tag in ("canon_lib", "测试"):
        for old in (E1_OLD, E2_OLD):
            hits = scan_tree(tag, old)
            must(not hits, f"防复活复扫 {tag} 命中: {hits}")
    # docs 树:05库记录层白名单(O1×10 正文不动;O2 恒0;新台账行用半角逗号不复活字面)
    d5 = DOC05_P.read_text(encoding="utf-8")
    must(d5.count(E1_OLD) == 10 and d5.count(E2_OLD) == 0, "05库旧串计数漂移,异常")

    # 7) 五路同刷 json + md5 归一
    for m in MIRRORS:
        must(m.exists(), f"镜像路径不存在: {m}")
        shutil.copy2(JSON_P, m)
    digests = {str(p): md5(p) for p in [JSON_P, *MIRRORS]}
    uniq = set(digests.values())
    must(len(uniq) == 1, f"五路 md5 未归一: {digests}")
    log.append(f"- 五路同刷 json md5 归一: {uniq.pop()}")

    REPORT.write_text(
        "# qi21_r3_surgery_1008 执行报告(第三轮删词刀)\n\n"
        f"- 副本: `{BK.relative_to(ROOT)}`\n\n"
        "## 替换明细\n" + "\n".join(f"{x}" for x in log) + "\n\n"
        "## 字段级对照\n"
        f"| 面 | 旧串 | 新串 | 处数 |\n|---|---|---|---|\n"
        f"| json 底座成片质量段 | `{E1_OLD}` | `{E1_NEW}` | 1 |\n"
        f"| json 四型远景句 | `{E2_OLD}` | `{E2_NEW}` | 4 |\n"
        f"| 07宪法 §八 | (无) | `{DOC07_NEWLINE}` | +1行 |\n"
        f"| 05库 §六台账 | (无) | (见脚本 DOC05_LEDGER) | +1行 |\n"
        f"| canon_lib/测试 | 五树活面扫描零命中 | 不动 | 0 |\n\n"
        "## 不动面(明示)\n"
        "- 美宣「远景收入一片淡墨虚实」/分镜「远景用淡墨退去」:无「晕染」词,不动\n"
        "- 手册 prefix.md(手册原文不动政策;含 O1×1 记账为既有偏差)\n"
        "- 历史手术脚本/报告(qi21_bgscope_*)/.zcode 运行档:留史不动\n\n"
        "## 底座正向(新,全文)\n```\n" + new_pos + "\n```\n",
        encoding="utf-8",
    )
    print("\n".join(log))
    print(f"\nOK 全部落刀,报告 → {REPORT}")


if __name__ == "__main__":
    main()
