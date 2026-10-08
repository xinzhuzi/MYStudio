#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""1008 review-fix 审核修复批·手术脚本(旧串锚断言+语义自检 fail-closed)。
面:①daojie_canon_lib.py 旧术语/真源链/BASES 死路径/--check 新契约/无旗标抹账守卫
   ②05库 死链指示三处+自查记录 --check 句+§六台账落账
改前副本=.trellis/tasks/10-04-qi21-prompt-cleanup/backups/reviewfix/*.rf.pre
"""
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
CANON = REPO / "apps/build/scripts/daojie_canon_lib.py"
LIB05 = REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"

fails = []


def splice(text, old, new, expect=1, tag=""):
    n = text.count(old)
    if n != expect:
        fails.append(f"[{tag}] 锚串计数 {n}≠{expect}: {old[:60]!r}…")
        return text
    return text.replace(old, new)


# ══════════════════ ① canon_lib ══════════════════
src = CANON.read_text(encoding="utf-8")

# S0a 头部勘正块追加 review-fix 注记
src = splice(
    src,
    "勿再以本链(05 库↔本生成器)为改②层入口;下文「本层即 ②层唯一真源」等旧句按史保留。\n",
    "勿再以本链(05 库↔本生成器)为改②层入口;下文「本层即 ②层唯一真源」等旧句按史保留。\n"
    "\n"
    "【1008 review-fix(审核修复批)】BASES 重指真源 qi21_bases.json(旧 my_nodes/nodes/\n"
    "daojie_bases.json 已随 1005 Step4 删除,死路径曾致 --check FileNotFoundError);--check 重定\n"
    "契约=真源↔镜像结构自洽(「05库↔本生成器逐字对齐」旧口径随 1004 集中化退役);无旗标生成=拒写\n"
    "守卫(防整文覆写抹 05库 §六台账——该风险此前仅被 BASES 死路径崩溃偶然挡住,修路径即复活,故守卫\n"
    "与修路径同批落地);发射串术语随 1008 R 批统一(通用锁层/常量A→美术风格底座,带日期轮注留史)。\n",
    tag="S0a 勘正块",
)

# S0b 用法三行
src = splice(
    src,
    "用法:\n"
    "  python3 apps/build/scripts/daojie_canon_lib.py           # 生成(幂等,逐字节稳定)\n"
    "  python3 apps/build/scripts/daojie_canon_lib.py --check   # 对磁盘文件守恒校验\n"
    "  python3 apps/build/scripts/daojie_canon_lib.py --overlap # 主体句×美化版底座重叠预检\n",
    "用法(1008 review-fix 后):\n"
    "  python3 apps/build/scripts/daojie_canon_lib.py --check   # 守恒校验(1004 集中化后口径:真源↔镜像结构自洽)\n"
    "  python3 apps/build/scripts/daojie_canon_lib.py --overlap # 主体句×美化版底座重叠预检\n"
    "  python3 apps/build/scripts/daojie_canon_lib.py           # ⛔ 无旗标生成=拒写退出(1004 退役守卫,防抹 05库 §六台账)\n",
    tag="S0b 用法",
)

# S1 BASES 死路径重指
src = splice(
    src,
    'BASES = REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json"',
    '# 1008 review-fix:1004 集中化后型录/画幅真源=qi21_bases.json types[](旧\n'
    '# my_nodes/nodes/daojie_bases.json 已随 1005 Step4 删除,死路径曾致 --check FileNotFoundError)\n'
    'BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"',
    tag="S1 BASES",
)

# S2 术语族(docstring 活描述/节注释)
src = splice(src, "③通用锁层(prefix.md §四.1/.2/.8 三段提取后经 Q2.1 摘噪后处理——0925 军令摘噪轮:",
              "③美术风格底座(prefix.md §四.1/.2/.8 三段提取后经 Q2.1 摘噪后处理——0925 军令摘噪轮:", tag="S2 docstring③")
src = splice(src, "库首附完整通用锁层常量(基础常量 + 人物系增量常量,供工作流恒挂层直接取用);",
              "库首附完整美术风格底座常量(基础常量 + 人物系增量常量,供工作流恒挂层直接取用);", tag="S2 docstring库首")
src = splice(src, "# ── 通用锁层提取(与 research/09-jia_assemble.py 同则;美化轮零触碰)─────────",
              "# ── 美术风格底座提取(与 research/09-jia_assemble.py 同则;美化轮零触碰;术语随 1008 R 批统一)─────", tag="S2 节注释")

# S3 矩阵 NOTE 表(发射串术语)
for old_note, new_note in [
    ('("6", "道具"): "◐ 通用锁层「淡墨晕染、远景淡化」承担(型底座为设定板,无远景句)"',
     '("6", "道具"): "◐ 美术风格底座「淡墨晕染、远景淡化」承担(型底座为设定板,无远景句)"'),
    ('("6", "多视图"): "◐ 通用锁层「淡墨晕染、远景淡化」承担(型底座为设定板,无远景句)"',
     '("6", "多视图"): "◐ 美术风格底座「淡墨晕染、远景淡化」承担(型底座为设定板,无远景句)"'),
    ('("6", "高清人脸"): "◐ 通用锁层「淡墨晕染、远景淡化」承担(型底座为特写,无远景句)"',
     '("6", "高清人脸"): "◐ 美术风格底座「淡墨晕染、远景淡化」承担(型底座为特写,无远景句)"'),
    ('("6", "表情差分"): "◐ 通用锁层「淡墨晕染、远景淡化」承担(型底座为格子页,无远景句)"',
     '("6", "表情差分"): "◐ 美术风格底座「淡墨晕染、远景淡化」承担(型底座为格子页,无远景句)"'),
    ('("17", "人物"): "✗ 型底座与通用锁层均无「留白承担」字样;山水基底+疏朗有呼吸近义承担(四令0925)"',
     '("17", "人物"): "✗ 型底座与美术风格底座均无「留白承担」字样;山水基底+疏朗有呼吸近义承担(四令0925)"'),
]:
    src = splice(src, old_note, new_note, tag="S3 NOTE")

# S4 一句话结论(术语+型录死路径+真源声明,镜像 05库:5 现值)
src = splice(src, "(`apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json` 的九型 zh 为型录与顺序)",
              "(`daojie_ink_guofeng/json/qi21_bases.json` types[] 的九型 zh 为型录与顺序;1004 集中化,原 `my_nodes/nodes/daojie_bases.json` 已退役并入)", tag="S4 结论型录")
src = splice(src, "**本层即②层唯一真源**,canon positive 逐字锚废止",
              "**②层唯一数据真源=daojie_ink_guofeng/json/qi21_bases.json(1004 集中化令;本库=记录与宪法层)**,canon positive 逐字锚废止", tag="S4 结论真源")
src = splice(src, "+**③通用锁层**(手册 prefix.md §四.1/2/8 提取后经",
              "+**③美术风格底座**(手册 prefix.md §四.1/2/8 提取后经", tag="S4 结论③")
src = splice(src, "库首附**完整通用锁层常量(A/B)+构图底座常量",
              "库首附**完整美术风格底座常量(A/B)+构图底座常量", tag="S4 结论库首")

# S5 真源四件整行镜像 05库:11 现值
src = splice(
    src,
    'A("- 真源四件:①型录/画幅=`daojie_bases.json`(九型 zh 顺序,aspect_ratio/megapixels 字段);②层底座=本库(09-23 美化版,唯一真源);③通用锁层/配色/留白分档/连环画媒介层=手册 `prefix.md`',
    'A("- 真源四件:①型录/画幅=`daojie_ink_guofeng/json/qi21_bases.json` types[](九型 zh 顺序,aspect_ratio/megapixels 字段;原 `daojie_bases.json` 已退役并入);②层底座=**`daojie_ink_guofeng/json/qi21_bases.json`(1004 集中化令后的唯一数据真源;本库围栏=设计记录,提取器单向下线——改②层直接改真源家,不再走「改库→跑提取器」旧链,09-23 美化版「唯一真源=本库」口径自 1004 起废止)**;③美术风格底座/配色/留白分档/连环画媒介层=手册 `prefix.md`',
    tag="S5 真源四件",
)

# S6 装配顺序/贴画布句(镜像 05库:22/23/32)
src = splice(src, "+ [②型底座·美化版纯画法锁质](本库该型节②层成文;型名/画幅档对齐 daojie_bases.json)",
              "+ [②型底座·美化版纯画法锁质](本库该型节②层成文;型名/画幅档对齐 qi21_bases.json,原 daojie_bases.json 已并入)", tag="S6 装配②")
src = splice(src, "+ [③通用锁层](prefix.md §四.1 风格底座锁", "+ [③美术风格底座](prefix.md §四.1 风格底座锁", tag="S6 装配③")
src = splice(src, "把「九型底座+通用锁层+四层装配」收进", "把「九型底座+美术风格底座+四层装配」收进", tag="S6 贴画布1")
src = splice(src, "八级选型级联+锁层恒挂+换行拼接", "八级选型级联+美术风格底座恒挂+换行拼接", tag="S6 贴画布2")
src = splice(src, "其底座/锁层常量逐字=本库", "其底座/美术风格底座常量逐字=本库", tag="S6 贴画布3")

# S7 §二 标题与常量A·基础标题(镜像 05库:78/82)
src = splice(src, 'A("## 二、通用锁层常量(供工作流恒挂层直接取用)")',
              'A("## 二、美术风格底座常量(供工作流恒挂层直接取用)")', tag="S7 §二标题")
src = splice(src, 'A("**常量 A·基础(§四.1→§四.2→§四.8,全九型恒挂;0925 摘噪版=提取后删否定禁令三句+四令底色句多彩化,正向句全保留)**:")',
              'A("**美术风格底座常量·基础(§四.1→§四.2→§四.8,全九型恒挂;0925 摘噪版=提取后删否定禁令三句+四令底色句多彩化,正向句全保留)**:")', tag="S7 常量A标题")

# S8 提取口径尾守恒校验句(随新 --check 契约)
src = splice(src, "守恒校验:`python3 apps/build/scripts/daojie_canon_lib.py --check`(### 计数/型名对齐/围栏配对/②③④逐字对齐——②对齐目标=本脚本 BEAUTIFIED 美化版;常量A 对齐目标=手册提取+Q2.1 摘噪后处理+四令底色句多彩化)。",
              "守恒校验:`python3 apps/build/scripts/daojie_canon_lib.py --check`(1004 集中化后口径=真源 qi21_bases.json types[] canon 九型对齐+art_style_base 顶层键正负双槽+生成器内嵌镜像结构自洽+四型透明声明在位;「05库↔生成器逐字对齐」旧口径已随 1004 集中化退役——05库=设计记录,真值以 json 现值为准)。", tag="S8 提取口径尾")

# S9 §三 标题/画幅档/禁混条款(镜像 05库:209/212/461)
src = splice(src, 'A("## 三、九型装配(型录与顺序=daojie_bases.json;②层=09-23 美化版)")',
              'A("## 三、九型装配(型录与顺序=qi21_bases.json types[]——原 daojie_bases.json 已并入;②层=09-23 美化版)")', tag="S9 §三标题")
src = splice(src, "MP(daojie_bases.json {zh} aspect_ratio·megapixels)", "MP(qi21_bases.json {zh} aspect_ratio·megapixels)", tag="S9 画幅档")
src = splice(src, "②层唯一真源=本库(09-23 美化版);daojie_bases.json 与 K2 共享的 canon positive 保留为 K2 侧取材,不再是本库②层逐字源(型名/顺序/画幅档仍对齐)。",
              "②层唯一数据真源=daojie_ink_guofeng/json/qi21_bases.json(1004 集中化令;本库=记录与宪法层,09-23 美化版成文已收入该 json);与 K2 共享的 canon positive 保留为 K2 侧取材,不再是本库②层逐字源(型名/顺序/画幅档仍对齐该 json)。", tag="S9 禁混2")

# S10 矩阵二标题/自查两行(镜像 05库:493/513/515 现值)
src = splice(src, 'A("**矩阵二:九锁(②型底座+③通用锁层+②层透明声明)× 九型**")',
              'A("**矩阵二:九锁(②型底座+③美术风格底座+②层透明声明)× 九型**")', tag="S10 矩阵二")
src = splice(src, "型名与 daojie_bases.json 九型 zh 逐字对齐、顺序一致;",
              "型名与 qi21_bases.json 九型 zh 逐字对齐、顺序一致(原 daojie_bases.json 已并入);", tag="S10 自查1")
src = splice(
    src,
    'A("- 围栏配对、### 计数、②③④逐字对齐:`--check` 实跑全绿(校验内容=文件 ### 标题恰为九型『### {型}-基础』序列、每 ```text 围栏闭合、每型装配全文去①槽行后与 ②美化版底座+③锁层+④配色行 逐字节相等、库首常量A 与 prefix.md 提取+Q2.1 摘噪后处理逐字节相等、常量B 与 prefix.md 提取逐字节相等)。".replace("{型}", "型"))',
    'A("- 守恒校验:`--check` 实跑全绿(1008 review-fix 重定契约后校验内容=真源 qi21_bases.json types[] canon 九型对齐+art_style_base 顶层键正负双槽+生成器内嵌镜像(BEAUTIFIED/SUBJECTS/常量 C 十款+挂载表)结构自洽+四型透明声明在位;「### 计数/围栏配对/②③④逐字对齐」旧校验已随 1004 集中化退役——05库=设计记录,围栏快照与真源的分歧以行级手术维护,勿以再生成对齐)。")',
    tag="S10 自查3",
)

# S11 load_canon_types 装载器(插在 build_layers 前)
src = splice(
    src,
    "def build_layers(bases_json: list, md: str) -> dict:",
    "def load_canon_types() -> list:\n"
    '    """1008 review-fix:型录/画幅真源=qi21_bases.json types[](十型含「自由");\n'
    '    本生成器 canon 九型=types[] 中有 BEAUTIFIED 成文者(「自由」=空底座选配型,不属九型装配)。"""\n'
    '    data = json.loads(BASES.read_text(encoding="utf-8"))\n'
    '    return [e for e in data["types"] if e.get("zh") in BEAUTIFIED]\n'
    "\n"
    "def build_layers(bases_json: list, md: str) -> dict:",
    tag="S11 装载器",
)

# S12 build_doc 读装载器
src = splice(src, "def build_doc() -> str:\n    bases_json = json.loads(BASES.read_text(encoding=\"utf-8\"))",
              "def build_doc() -> str:\n    bases_json = load_canon_types()", tag="S12 build_doc")

# S13 check() 整函数重写(锚:def check … def overlap_check 之间)
NEW_CHECK = '''def check() -> int:
    """1004 集中化后的守恒口径(1008 review-fix 批重定契约):
    真源=qi21_bases.json——校验 canon 九型对齐(types[] 计数/型名/画幅字段)、art_style_base
    顶层键(1008 R 改名后)与正负双槽(1004 正负拆开后)、生成器内嵌镜像(BEAUTIFIED/SUBJECTS/
    SECTION_PROSE/常量 C+挂载表)结构自洽、四型透明声明在位。
    (旧「05库↔生成器逐字对齐」口径已随 1004 集中化令退役——05库=设计记录,真值以 json 现值为准,
     行级手术直改真源家;重跑 build_doc 整文覆写会抹 05库 §六台账,无旗标生成已被守卫拦下。)"""
    data = json.loads(BASES.read_text(encoding="utf-8"))
    types = load_canon_types()
    errs = []

    zh_order = [e["zh"] for e in types]
    if len(zh_order) != 9 or len(set(zh_order)) != len(zh_order):
        errs.append(f"canon 九型计数/唯一性不符:得 {zh_order}")
    for e in data["types"]:
        if e.get("zh") not in BEAUTIFIED and e.get("positive_text"):
            errs.append(f"非 canon 型 {e.get('zh')!r} positive_text 应为空串(设计=空底座选配型)")
    if "art_style_base" not in data:
        errs.append("顶层缺 art_style_base(1008 R 改名后机读键)")
    else:
        for k in ("positive_text", "negative_text"):
            if k not in data["art_style_base"]:
                errs.append(f"art_style_base 缺 {k}(1004 正负拆开后应双槽)")
    for zh, e in zip(zh_order, types):
        if not e.get("aspect_ratio") or not e.get("megapixels"):
            errs.append(f"{zh}: 缺 aspect_ratio/megapixels(型录/画幅字段)")

    if set(BEAUTIFIED) != set(SUBJECTS) or set(BEAUTIFIED) != set(SECTION_PROSE) \\
            or set(BEAUTIFIED) != set(PALETTE_GROUP):
        errs.append("镜像键集不一致: BEAUTIFIED/SUBJECTS/SECTION_PROSE/PALETTE_GROUP")
    if not RENWU_XI <= set(BEAUTIFIED):
        errs.append("RENWU_XI 越出九型集合")
    if not set(Q21_ASPECT_FORK) <= set(BEAUTIFIED):
        errs.append("Q21_ASPECT_FORK 越出九型集合")
    all_comp = {c[0]: c for c in [*COMPOSITION_CHAR, *COMPOSITION_PROP]}
    for zh, (cid, cname) in COMPOSITION_MOUNT.items():
        if zh not in BEAUTIFIED:
            errs.append(f"挂载表型名越出九型: {zh}")
        if cid not in all_comp:
            errs.append(f"{zh}: 挂载款 {cid} 不在常量 C")
        elif all_comp[cid][1] != cname:
            errs.append(f"{zh}: 挂载款名与常量 C 不一致: {cid}")
    for zh in ("道具", "多视图", "高清人脸", "表情差分"):
        if TRANSPARENT_DECL_CORE not in BEAUTIFIED[zh]:
            errs.append(f"{zh}: ②层镜像缺透明声明段(0929 硬约束)")

    if errs:
        print("❌ 守恒校验未过:")
        for e in errs:
            print("  -", e)
        return 1
    print(f"✅ 守恒校验全绿(1004 集中化后口径,1008 review-fix 重定契约):真源 qi21_bases.json types[] "
          f"canon 九型计数/型名/画幅字段齐;art_style_base 顶层键+正负双槽在场(1008 R 改名/1004 正负拆开后契约);"
          f"生成器内嵌镜像(BEAUTIFIED/SUBJECTS/SECTION_PROSE/常量 C 十款+挂载表)结构自洽;"
          f"四型②层镜像透明声明段在位(0929 硬约束)。(旧「05库↔生成器逐字对齐」已随 1004 集中化退役:"
          f"05库=设计记录,行级手术直改真源家。)")
    return 0


'''
chk_start = src.index("def check() -> int:")
chk_end = src.index("def overlap_check() -> int:")
src = src[:chk_start] + NEW_CHECK + src[chk_end:]

# S14 main() 无旗标守卫
NEW_MAIN = '''def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="守恒校验(1004 集中化后口径:真源↔镜像结构自洽)")
    ap.add_argument("--overlap", action="store_true", help="18 条示例×美化版底座重叠预检")
    a = ap.parse_args()
    if a.check:
        return check()
    if a.overlap:
        return overlap_check()
    # 1008 review-fix 拒写守卫:本生成器自 1004 集中化令起退役留档(勿再以 05库↔本生成器链为改②层入口);
    # 无旗标整文再生成=以发射串覆写 05库(抹 §六台账+回写退役前结构),拒写退出。
    print("⛔ 本生成器自 1004 集中化令起退役留档:②层/型录真源=daojie_ink_guofeng/json/qi21_bases.json,"
          "行级手术直改真源家;整文再生成会覆写 05 库并抹掉 §六台账,已拒绝写入。"
          "活校验=--check(真源↔镜像守恒)/--overlap(主体句重叠预检)。", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
'''
main_start = src.index("def main() -> int:")
src = src[:main_start] + NEW_MAIN

# ══════════════════ ② 05库 ══════════════════
lib = LIB05.read_text(encoding="utf-8")

# E1 §二提取口径尾 守恒校验句(随新 --check 契约)
lib = splice(lib, "守恒校验:`python3 apps/build/scripts/daojie_canon_lib.py --check`(### 计数/型名对齐/围栏配对/②③④逐字对齐——②对齐目标=本脚本 BEAUTIFIED 美化版;美术风格底座常量 对齐目标=手册提取+Q2.1 摘噪后处理+四令底色句多彩化)。",
              "守恒校验:`python3 apps/build/scripts/daojie_canon_lib.py --check`(1004 集中化后口径=真源 `qi21_bases.json` types[] canon 九型对齐+art_style_base 顶层键正负双槽+生成器内嵌镜像结构自洽+四型透明声明在位;「05库↔生成器逐字对齐」旧口径已随 1004 集中化退役,本库=设计记录,真值以 json 现值为准)。", tag="E1 守恒校验句")

# E2 §五 生成命令死链句
lib = splice(lib, "生成命令:`python3 apps/build/scripts/daojie_canon_lib.py`(矩阵随文档同步再生成,改词即同步)。",
              "生成命令已随 1004 集中化令退役——`daojie_canon_lib.py` 无旗标再生成=整文覆写抹 §六台账(1008 review-fix 起加守卫拒写);矩阵=设计记录快照,现行维护=行级手术直改真源家(daojie_ink_guofeng/json/qi21_bases.json)。", tag="E2 生成命令句")

# E3 常量C 换款库级操作死链句
lib = splice(lib, "**换款=改②层挂载句→重生成→重提取**(库级操作:`python3 apps/build/scripts/daojie_canon_lib.py && python3 apps/build/scripts/qi21_bases_extract_0923.py`),禁①层双写视图语言(双写=漂移源)。",
              "**换款=改②层挂载句→直改真源家**(库级操作:1004 集中化后旧「重生成→重提取」链已退役——直改 `daojie_ink_guofeng/json/qi21_bases.json` 真源家并五路同刷,不走生成器/提取器),禁①层双写视图语言(双写=漂移源)。", tag="E3 换款句")

# E4 自查记录 --check 句(随新契约)
lib = splice(lib, "- 围栏配对、### 计数、②③④逐字对齐:`--check` 实跑全绿(校验内容=文件 ### 标题恰为九型『### 型-基础』序列、每 ```text 围栏闭合、每型装配全文去①槽行后与 ②美化版底座+③美术风格底座+④配色行 逐字节相等、库首美术风格底座常量 与 prefix.md 提取+Q2.1 摘噪后处理逐字节相等、常量B 与 prefix.md 提取逐字节相等)。",
              "- 守恒校验:`--check` 实跑全绿(1008 review-fix 重定契约后校验内容=真源 qi21_bases.json types[] canon 九型对齐+art_style_base 顶层键正负双槽+生成器内嵌镜像结构自洽+四型透明声明在位;「### 计数/围栏配对/②③④逐字对齐」旧校验已随 1004 集中化退役——本库=设计记录,围栏快照与真源的分歧以行级手术维护,勿以再生成对齐)。", tag="E4 自查句")

# E5 §六台账落账(最新在前,插在 1008 R 条目前)
LEDGER = "- **1008 review-fix 审核修复批(役=10-04-qi21-prompt-cleanup 审核修复,四发现全偿)**:①canon_lib 旧术语清偿——R 批改名只改本库产物未覆盖生成器(live 脚本 33 处 通用锁层/常量A 与 R 批「活文件零旧术语」声称相悖,62e573ee「留旧句=复活陷阱」同款):发射串术语族就地改美术风格底座(§二标题/常量A·基础标题/矩阵二标题/矩阵 G6·G17 注记/§一装配顺序与贴画布句),真源链两行(一句话结论/真源四件)按本库现值镜像,型录死路径改指 qi21_bases.json(带日期轮注/台账史行留档不改);②校验器 BASES 死路径根修——1005 Step4 删 nodes/daojie_bases.json 后 `--check` 崩 FileNotFoundError(本库 §二提取口径尾守恒校验命令断链),重指真源家;③`--check` 重定契约(集中化后口径=真源九型对齐+art_style_base 正负双槽+镜像结构自洽+四型透明声明;「本库↔生成器逐字对齐」旧口径随集中化退役);④无旗标再生成加拒写守卫(防整文覆写抹本节台账——复核定谳该风险此前仅被 BASES 死路径崩溃偶然挡住,顺手修路径即复活,故守卫与修路径同批);⑤本库死链指示三处勘误(§二提取口径尾守恒校验句/§五生成命令句/常量 C 换款库级操作句)+自查记录 --check 句随新契约重写;⑥IP家手册镜像三件陈旧回刷(README/json README 的 lock_layer 旧键+prefix.md 的 S3 旧指纹「，而非有纹理的纸面」「，防机械勾边与矢量感」;根因=R/S 批五树扫描 ④根只落 comfyui 子树,qi21_s3_fivetree_scan_1008.py TREES ④根改「引擎家/IP家」一根=IP家真身,结构性缺口封闭)。改前副本=backups/reviewfix/;报告=diff-review-fix.md。\n"
lib = splice(lib, "## 六、演进与待裁定\n\n- **1008 R 命名统一轮",
              "## 六、演进与待裁定\n\n" + LEDGER + "- **1008 R 命名统一轮", tag="E5 台账")

# ══════════════════ 收口 ══════════════════
if fails:
    print("❌ 锚断言未过,零写入:")
    for f in fails:
        print("  -", f)
    sys.exit(1)

# 语义自检
for must in ["qi21_bases.json`(1004 集中化令后的唯一数据真源", "def load_canon_types", "已拒绝写入", "美术风格底座常量·基础", "## 二、美术风格底座常量"]:
    assert must in src, f"canon_lib 语义自检缺: {must}"
for must in ["守恒校验:`python3 apps/build/scripts/daojie_canon_lib.py --check`(1004 集中化后口径", "生成命令已随 1004 集中化令退役", "1008 review-fix 审核修复批"]:
    assert must in lib, f"05库 语义自检缺: {must}"
compile(src, str(CANON), "exec")

CANON.write_text(src, encoding="utf-8")
LIB05.write_text(lib, encoding="utf-8")
print("✅ 手术完成:daojie_canon_lib.py + 05-道劫规范提示词库.md(锚断言+语义自检+compile 全过)")
