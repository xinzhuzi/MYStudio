#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 S3 风格底座与九型词条批 splice 手术(2026-10-08;implement.md S3/design.md §3)。

一次手术五域(全部旧串锚断言 fail-closed+语义自检):
  A. art_style_base 正向否定式三分法(1008 用户转入令;预审表=research/
     lock-negative-transfer-candidates-1008.md):A「，而非有纹理的纸面」删+负槽
     +「纸面纹理」;B「，防机械勾边与矢量感」删+负槽+「机械勾边，矢量感」;
     C「除非…」豁免句/D「不抢戏」=留(在案裁定,理由进 diff-s3.md)。
  B. 三型差异化恢复(4fa15e9 素材+㉗三层铁律重写禁照搬):美宣=焦点构图+淡墨退后;
     分镜剧情图=单格叙事帧+前中远三层(去单人立绘锁与头身比锚=1002 ㉒「分镜不锚」)。
  C. 跨视图反例句四条入人物型负向(夸克Skill5.4对拍④;候 S5 实弹,红则回退)。
  D. 人物比例统一六至七头身(手册 01_人物美术.md §二「六至七头身,水墨古典比例」;
     qi21_bases 人物系五型改词+分镜随差异化去锚+prompt_layering+canon+05库)。
  E. 九型审计有证据项:场景负向补人物约束(purpose 明载「人物一律交给负向」而负向
     缺位=current-audit 高置信冲突;bare「人物」与底座「中国传统人物画审美 DNA」
     正负撞词,改用「人影，人脸」零撞词对)。
  同批:prompt_layering(比例行+型级增补行+跨视图缺口行)·canon_lib BEAUTIFIED/
  注释/§四例句·05库(A/B 句身×10+②层五行+两围栏+禁混条款例+§六台账)·prefix.md·
  t2i/i2i/两蓝图内嵌底座快照·装配测试 sha 锚随源重锚。recipe_version 不动。

用法:python3 qi21_s3_surgery_1008.py [--precheck|--apply]
  --precheck=否定式普查+撞词干跑(型级负向改动前硬门),零写入,零撞才 exit 0
  --apply  =备份(若缺)→手术→语义自检,任一锚断言失败即 die 零部分落盘风险最小化
"""
from __future__ import annotations
import hashlib, importlib.util, json, re, shutil, sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
J = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
PL = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/prompt_layering.json"
PREFIX = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/prefix.md"
DOC05 = REPO / "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md"
CANON = REPO / "apps/build/scripts/daojie_canon_lib.py"
T2I = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
I2I = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
SG_T = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json"
SG_I = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json"
TEST_ASM = REPO / "apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_prompt_assembly.py"
BACKUP_DIR = REPO / ".trellis/tasks/10-04-qi21-prompt-cleanup/backups/s3"

# ── 手术规格(唯一真源;precheck 与 apply 共用)─────────────────────────
RATIO_OLD, RATIO_NEW = "头身比约七头半", "头身比约六至七头身"
A_CUT = "，而非有纹理的纸面"
B_CUT = "，防机械勾边与矢量感"
BASE_NEG_APPEND = "，纸面纹理，机械勾边，矢量感"
RENWU_NEG_APPEND = "，视图间发型变化，视图间五官变化，武器尺寸视图间变形，侧视图构图跑成正面"
SCENE_NEG_APPEND = "，人影，人脸"
OLD_LEAD = ("主体的单人立绘，全身入画，头身比约七头半，解剖比例写实。"
            "运笔有提按顿挫的细墨线勾勒全身轮廓，线随结构时粗时细，转折衔接处轻重分明；"
            "墨色浓淡分明，干湿五阶层次清楚，近处轮廓清楚、墨线饱满，远景以淡墨晕染层层退开。")
MEIXUAN_LEAD_NEW = ("主体的单人立绘，全身入画，头身比约六至七头身，解剖比例写实。"
                    "主体落在视觉焦点，背景以淡墨整体退后、笔墨退居其次：焦点处墨线饱满、"
                    "分染层次完整，远景收入一片淡墨虚实。运笔有提按顿挫的细墨线勾勒全身轮廓，"
                    "线随结构时粗时细，转折衔接处轻重分明；墨色浓淡分明，干湿五阶层次清楚。")
FENJING_LEAD_NEW = ("一幅单格叙事画面，笔意连贯如连环画单格：前景、中景、远景层层分开。"
                    "近处以运笔有提按顿挫的细墨线勾勒，线随结构时粗时细，转折衔接处轻重分明；"
                    "中景轮廓清楚、墨线饱满，远景用淡墨退去，墨色浓淡分明，渐远渐虚。")
MX_OLD_TAIL, MX_NEW_TAIL = "均匀柔光，浅净平涂的底，画面疏朗有呼吸。", "均匀柔光，浅净平涂的底，画面饱满有焦点张力。"
PL_RATIO_OLD, PL_RATIO_NEW = "七头半写实比例", "六至七头身写实比例"
PL_NEGADD_OLD = '"负面·型级增补": "人物型:密集褶网/破烂下摆/鞋靴性别错位;其余型无增补"'
PL_NEGADD_NEW = ('"负面·型级增补": "人物型:密集褶网/破烂下摆/鞋靴性别错位+跨视图四条'
                 '(1008 S3 候实弹);场景型:人影/人脸(空镜人物约束);其余型无增补"')
PL_GAP_OLD = ("跨视图一致性负面条目缺口(夸克Skill5.4对拍④,1005 挂账):多视图/表情差分型级负面"
              "(types[].negative_text)现零跨视图条目——候选=视图间发型变化/武器跨张变形/表情格不同人/"
              "侧视图构图跑成正面;归 cleanup 役精选落库(3-5 条社区口径),实弹对拍定去留")
PL_GAP_NEW = ("跨视图一致性负面条目(夸克Skill5.4对拍④;1005 挂账,1008 S3 首步落库):四条候实弹 token "
              "已入人物型负面(视图间发型变化/视图间五官变化/武器尺寸视图间变形/侧视图构图跑成正面),"
              "候 S5 实弹裁决、红则回退;多视图/表情差分型级仍零跨视图条目,候实弹结论再定扩布")
RULE3_OLD = ("手册反向规避行的纪律在 Q2.1 由③层正向画法语言承担(禁项→正向转写,"
             "如禁纸纹→「画面保持干净平滑:墨与色落在平涂色场上,而非有纹理的纸面」)。")
RULE3_NEW = ("手册反向规避行的纪律在 Q2.1 由③层正向画法语言+美术风格底座负槽双承担"
             "(1008 S3 起:纸面纹理/机械勾边/矢量感已入 art_style_base.negative_text,"
             "正向只留纯肯定式「画面保持干净平滑:墨与色落在平涂色场上」)。")
CANON_MX_OLD = ('"美宣": (\n        "主体落在视觉焦点，背景用淡墨退去，笔墨比主体更简；'
                '头身比约七头半，解剖比例写实，"\n        "运笔有提按顿挫的细墨线勾勒主体轮廓，"\n'
                '        "线随结构时粗时细；墨色浓淡分明，焦点处墨线饱满，远景淡化为一片淡墨的虚实。"\n'
                '        "背景是多色相铺陈的山水基底：淡墨远山、青灰近石、青绿草木、赭黄土色各安其位，'
                '宣纸白只作局部透气位；传统色中等强度，石青、青绿、赭石、旧金、朱红各安其位，"\n'
                '        "受控饱和而非一律低饱和；一块鲜明的点题色收束视线；均匀柔光，平涂的底。"\n    ),')
CANON_MX_NEW = ('"美宣": (\n        "主体的单人立绘，全身入画，头身比约六至七头身，解剖比例写实。'
                '主体落在视觉焦点，背景以淡墨整体退后、笔墨退居其次：焦点处墨线饱满、分染层次完整，'
                '远景收入一片淡墨虚实。运笔有提按顿挫的细墨线勾勒全身轮廓，"\n'
                '        "线随结构时粗时细，转折衔接处轻重分明；墨色浓淡分明，干湿五阶层次清楚。'
                '背景是多色相铺陈的山水基底：淡墨远山、青灰近石、青绿草木、赭黄土色各安其位，'
                '宣纸白只作局部透气位；传统色中等强度，"\n'
                '        "石青、青绿、赭石、旧金、朱红各安其位，受控饱和而非一律低饱和；'
                '一块鲜明的点题色收束视线；均匀柔光，浅净平涂的底，画面饱满有焦点张力。"\n    ),')
CANON_FJ_OLD = ('"分镜剧情图": (\n        "一幅叙事画面，笔意连贯如连环画。前景、中景、远景层层分开：'
                '近处以运笔有提按顿挫的细墨线勾勒，"\n        "线随结构时粗时细；远景用淡墨退去，'
                '墨色浓淡分明，渐远渐虚。大面积素净的暖白底色上，"\n'
                '        "传统色中等强度多色相铺陈，石青、青绿、赭石、旧金、朱红各安其位，'
                '受控饱和而非一律低饱和；"\n        "一块点题色点亮叙事；均匀柔光，平涂的底。"\n    ),')
CANON_FJ_NEW = ('"分镜剧情图": (\n        "一幅单格叙事画面，笔意连贯如连环画单格：前景、中景、远景层层分开。'
                '近处以运笔有提按顿挫的细墨线勾勒，"\n        "线随结构时粗时细，转折衔接处轻重分明；'
                '中景轮廓清楚、墨线饱满，远景用淡墨退去，墨色浓淡分明，渐远渐虚。"\n'
                '        "背景是多色相铺陈的山水基底：淡墨远山、青灰近石、青绿草木、赭黄土色各安其位，'
                '宣纸白只作局部透气位；传统色中等强度，"\n'
                '        "石青、青绿、赭石、旧金、朱红各安其位，受控饱和而非一律低饱和；'
                '一块鲜明的点题色收束视线；均匀柔光，浅净平涂的底，画面疏朗有呼吸。"\n    ),')
D05_MX_OLD = ("主体落在视觉焦点，背景用淡墨退去，笔墨比主体更简；头身比约七头半，解剖比例写实。"
              "运笔有提按顿挫的细墨线勾勒主体轮廓，线随结构时粗时细；墨色浓淡分明，焦点处墨线饱满，"
              "远景淡化为一片淡墨的虚实。背景是多色相铺陈的山水基底：淡墨远山、青灰近石、青绿草木、"
              "赭黄土色各安其位，宣纸白只作局部透气位；传统色中等强度，石青、青绿、赭石、旧金、朱红各安其位，"
              "受控饱和而非一律低饱和；一块鲜明的点题色收束视线；均匀柔光，平涂的底。")
D05_MX_NEW = (MEIXUAN_LEAD_NEW +
              "背景是多色相铺陈的山水基底：淡墨远山、青灰近石、青绿草木、赭黄土色各安其位，"
              "宣纸白只作局部透气位；传统色中等强度，石青、青绿、赭石、旧金、朱红各安其位，"
              "受控饱和而非一律低饱和；一块鲜明的点题色收束视线；" + MX_NEW_TAIL)
D05_FJ_OLD = ("一幅叙事画面，笔意连贯如连环画。前景、中景、远景层层分开：近处以运笔有提按顿挫的细墨线勾勒，"
              "线随结构时粗时细；远景用淡墨退去，墨色浓淡分明，渐远渐虚。大面积素净的暖白底色上，"
              "传统色中等强度多色相铺陈，石青、青绿、赭石、旧金、朱红各安其位，受控饱和而非一律低饱和；"
              "一块点题色点亮叙事；均匀柔光，平涂的底。")
D05_FJ_NEW = (FENJING_LEAD_NEW +
              "背景是多色相铺陈的山水基底：淡墨远山、青灰近石、青绿草木、赭黄土色各安其位，"
              "宣纸白只作局部透气位；传统色中等强度，石青、青绿、赭石、旧金、朱红各安其位，"
              "受控饱和而非一律低饱和；一块鲜明的点题色收束视线；均匀柔光，浅净平涂的底，画面疏朗有呼吸。")
D05_FENCE_NEG_OLDTAIL = "软 3D 体积，油亮高光，油黑渐变"
D05_FENCE_NEG_NEWTAIL = "软 3D 体积，油亮高光，油黑渐变，纸面纹理，机械勾边，矢量感"
D05_BNEG_NOTE_ANCHOR = ("密集褶网，密集皱褶网格，混乱多褶堆叠，风驱褶喷，扇贝状裙摆，分叉袍摆，分离飘带，"
                        "下摆缺角，风碎流苏，撕裂下摆，碎边，破洞，磨损补丁，虫蛀布面，垂挂碎条，绳捆破布，"
                        "乞丐破衣，透明头皮，女性高跟鞋，细高跟，尖头女鞋，玛丽珍鞋，男性超大号工靴，异装鞋靴\n```")
D05_BNEG_NOTE_NEW = (D05_BNEG_NOTE_ANCHOR +
                     "\n\n**注(1008 S3)**:人物型 negative_text 另追加跨视图一致性四条候实弹 token"
                     "(视图间发型变化/视图间五官变化/武器尺寸视图间变形/侧视图构图跑成正面),"
                     "候 S5 实弹裁决、红则回退;美宣/分镜/多视图/高清人脸/表情差分型未挂;"
                     "真文以 qi21_bases.json 现值为准。")
LEDGER_ANCHOR = "- **1007 否定式清退第二轮(用户令「为什么总要留尾巴不解决」——同类病除根,不留候令)**:"
LEDGER_NEW = ("- **1008 S3 风格底座与九型词条批(1008 用户令:底座负向转入+三型差异化+跨视图反例句+比例统一)**:"
              "①底座正向否定式三分法定稿——A「，而非有纹理的纸面」/B「，防机械勾边与矢量感」两处负向点名转负槽"
              "(art_style_base.negative_text +「纸面纹理，机械勾边，矢量感」,正向删尾改纯肯定式,b4107de1 同款配方,"
              "边界注=负向仅 cfg4 档真吃劲、FunAcc 档由「画面保持干净平滑」肯定句承担);C「除非…」豁免句/D「不抢戏」留"
              "(在案裁定:豁免句缺失致正负打架/「抢戏」入负槽误伤叙事主体);②人物/美宣/分镜剧情图三型差异化恢复"
              "(4fa15e9 素材+㉗三层铁律重写禁照搬:美宣=主体落视觉焦点+背景淡墨整体退后+画面饱满有焦点张力;"
              "分镜=单格叙事画面+连环画单格+前中远三层,去单人立绘锁,头身比锚随 1002 ㉒「分镜不锚」退役);"
              "③跨视图反例句四条入人物型负向(候 S5 实弹,红则回退);④人物比例统一六至七头身(手册§二口径,"
              "人物系五型 qi21_bases+prompt_layering+canon_lib+本库②层五行同笔);⑤场景负向补「人影，人脸」"
              "(purpose 明载人物约束交负向而负向缺位;bare「人物」与底座「中国传统人物画」正负撞词弃用);"
              "⑥型正向否定式普查零新增命中(受控饱和而非一律低饱和=校准对句/头顶无发=条件解剖描述/仅允许=限额许可,"
              "均留存);落点=qi21_bases/prompt_layering/canon_lib/本库句身×10+②层五行+两围栏+禁混条款例句/prefix.md/"
              "t2i+i2i+两蓝图内嵌底座快照/装配测试 sha 锚;recipe_version 标签不动(未终审);多视图机器规格冲突"
              "(3:4+4.2MP vs purpose 21:9/1536×512 vs override 3072×1024)只记录不改。\n" + LEDGER_ANCHOR)


def die(msg: str):
    print(f"FAIL-CLOSED: {msg}")
    sys.exit(1)


def splice(text: str, old: str, new: str, expect: int, label: str) -> str:
    n = text.count(old)
    if n != expect:
        die(f"锚断言失败 [{label}] 期望 {expect} 处,实得 {n} 处: {old[:40]!r}...")
    return text.replace(old, new)


def build_new_state():
    """从真源现值+规格试算新值(锚不命中即 die);precheck/apply 共用。"""
    data = json.loads(J.read_text(encoding="utf-8"))
    base = data["art_style_base"]
    base_pos_new = splice(splice(base["positive_text"], A_CUT, "", 1, "base.A"),
                          B_CUT, "", 1, "base.B")
    base_neg_new = base["negative_text"] + BASE_NEG_APPEND
    zh_map = {t["zh"]: t for t in data["types"]}
    pos_new, neg_new = {}, {}
    for zh in ("人物", "多视图", "高清人脸", "表情差分"):
        pos_new[zh] = splice(zh_map[zh]["positive_text"], RATIO_OLD, RATIO_NEW, 1, f"{zh}.ratio")
    mx = splice(zh_map["美宣"]["positive_text"], OLD_LEAD, MEIXUAN_LEAD_NEW, 1, "美宣.lead")
    pos_new["美宣"] = splice(mx, MX_OLD_TAIL, MX_NEW_TAIL, 1, "美宣.tail")
    pos_new["分镜剧情图"] = splice(zh_map["分镜剧情图"]["positive_text"], OLD_LEAD, FENJING_LEAD_NEW, 1, "分镜.lead")
    for zh, t in zh_map.items():
        pos_new.setdefault(zh, t.get("positive_text", ""))
        neg_new[zh] = t.get("negative_text", "")
    neg_new["人物"] = splice(neg_new["人物"], "异装鞋靴", "异装鞋靴" + RENWU_NEG_APPEND, 1, "人物.neg")
    neg_new["场景"] = splice(neg_new["场景"], "写实油画，厚涂，照片质感，3D渲染",
                             "写实油画，厚涂，照片质感，3D渲染" + SCENE_NEG_APPEND, 1, "场景.neg")
    return data, base_pos_new, base_neg_new, pos_new, neg_new


def precheck() -> bool:
    data, base_pos_new, base_neg_new, pos_new, neg_new = build_new_state()
    print("=" * 28, "① 否定式普查(改前正向;标记=不/非/禁/避免/防止/除外/排除/不得/严禁/防/无)")
    pat = re.compile(r"(不|非|禁|避免|防止|除外|排除|不得|严禁|防|无)")
    base_old = data["art_style_base"]["positive_text"]
    census = [("美术风格底座", base_old)] + [(t["zh"], t.get("positive_text", "")) for t in data["types"]]
    for zh, p in census:
        for sent in re.split(r"(?<=[。；;\n])", p):
            if sent.strip() and pat.search(sent):
                print(f"  [{zh}] :: {sent.strip()[:64]}")
    print("=" * 28, "② 撞词干跑(真 _pos_neg_clash+豁免表 × 十型新装配正向直写文 × 新三源负向)")
    spec = importlib.util.spec_from_file_location(
        "api_pe_clash", REPO / "apps/backend/engines/comfyui/my_nodes/nodes/my_qi21_api_pe.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    cspec = importlib.util.spec_from_file_location("canon_s3", CANON)
    cm = importlib.util.module_from_spec(cspec)
    cspec.loader.exec_module(cm)
    ok = True
    for zh in pos_new:
        subj = cm.SUBJECTS.get(zh, ("",))[0]
        draft = "\n".join([subj, pos_new[zh], base_pos_new])
        neg_tokens = [x.strip() for x in re.split(r"[,，\n]", base_neg_new + "，" + neg_new[zh]) if x.strip()]
        v = m._pos_neg_clash(draft, neg_tokens)
        print(f"  [{zh}] {'零撞' if not v else '撞词 ' + str(v)}")
        ok = ok and not v
    print("=" * 28, "precheck 结论:", "PASS 零撞词" if ok else "FAIL 有撞词禁开刀")
    return ok


def apply_ratio_05(t: str) -> str:
    """05库 ②层四行比例(人物/多视图/高清人脸/表情差分);台账史行(- ** 开头)保护不动。"""
    out, done = [], []
    for ln in t.split("\n"):
        if RATIO_OLD in ln and not ln.lstrip().startswith("- **"):
            if "各视图正交平视" in ln:
                zh = "多视图"
            elif "主体的单人立绘，全身入画" in ln:
                zh = "人物"
            elif "头像特写" in ln or "头部居于画面中心" in ln:
                zh = "高清人脸"
            elif "九宫格" in ln:
                zh = "表情差分"
            else:
                zh = None
            if zh:
                assert ln.count(RATIO_OLD) == 1, f"05库 {zh} 行比例锚数异常"
                out.append(ln.replace(RATIO_OLD, RATIO_NEW))
                done.append(zh)
                continue
        out.append(ln)
    if set(done) != {"人物", "多视图", "高清人脸", "表情差分"} or len(done) != 4:
        die(f"05库 ②层比例行期望四行,实改 {done}")
    return "\n".join(out)


def surgery():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    targets = [J, PL, PREFIX, DOC05, CANON, T2I, I2I, SG_T, SG_I, TEST_ASM]
    for f in targets:
        dst = BACKUP_DIR / (f.name + ".pre")
        if not dst.exists():
            shutil.copy2(f, dst)

    # 1. qi21_bases.json
    data, base_pos_new, base_neg_new, pos_new, neg_new = build_new_state()
    data["art_style_base"]["positive_text"] = base_pos_new
    data["art_style_base"]["negative_text"] = base_neg_new
    for t in data["types"]:
        t["positive_text"] = pos_new[t["zh"]]
        t["negative_text"] = neg_new[t["zh"]]
    # 语义自检
    anchors = [t["zh"] for t in data["types"] if "六至七头身" in t.get("positive_text", "")]
    assert anchors == ["人物", "美宣", "多视图", "高清人脸", "表情差分"], anchors
    assert all("七头半" not in json.dumps(t, ensure_ascii=False) for t in data["types"])
    assert data["art_style_base"]["positive_text"].endswith("。")
    assert "纸面纹理，机械勾边，矢量感" in base_neg_new and base_neg_new.count("纸面纹理") == 1
    zm = {t["zh"]: t for t in data["types"]}
    assert zm["自由"]["positive_text"] == "" and zm["自由"]["negative_text"] == "模糊，水印，多手指，文字错误"
    assert zm["人物"]["negative_text"].endswith("侧视图构图跑成正面")
    assert zm["场景"]["negative_text"].endswith("人影，人脸") and zm["概念气氛图"]["negative_text"].endswith("3D渲染")
    J.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    old_base_pos = json.loads((BACKUP_DIR / "qi21_bases.json.pre").read_text(encoding="utf-8")
                              )["art_style_base"]["positive_text"]

    # 2. prompt_layering.json
    t = PL.read_text(encoding="utf-8")
    t = splice(t, PL_RATIO_OLD, PL_RATIO_NEW, 1, "pl.ratio")
    t = splice(t, PL_NEGADD_OLD, PL_NEGADD_NEW, 1, "pl.negadd")
    t = splice(t, PL_GAP_OLD, PL_GAP_NEW, 1, "pl.gap")
    json.loads(t)
    PL.write_text(t, encoding="utf-8")

    # 3. prefix.md
    t = PREFIX.read_text(encoding="utf-8")
    t = splice(t, A_CUT, "", 1, "prefix.A")
    t = splice(t, B_CUT, "", 1, "prefix.B")
    PREFIX.write_text(t, encoding="utf-8")

    # 4. 05库
    t = DOC05.read_text(encoding="utf-8")
    t = splice(t, A_CUT, "", 10, "05.A×10")
    t = splice(t, B_CUT, "", 10, "05.B×10")
    t = splice(t, D05_MX_OLD, D05_MX_NEW, 1, "05.美宣②层")
    t = splice(t, D05_FJ_OLD, D05_FJ_NEW, 1, "05.分镜②层")
    t = apply_ratio_05(t)
    t = splice(t, D05_FENCE_NEG_OLDTAIL, D05_FENCE_NEG_NEWTAIL, 1, "05.通用负面围栏")
    t = splice(t, D05_BNEG_NOTE_ANCHOR, D05_BNEG_NOTE_NEW, 1, "05.B-Neg注")
    t = splice(t, RULE3_OLD, RULE3_NEW, 1, "05.禁混条款例")
    t = splice(t, LEDGER_ANCHOR, LEDGER_NEW, 1, "05.台账")
    DOC05.write_text(t, encoding="utf-8")

    # 5. canon_lib(美宣/分镜整段先换,余比例 6 处=BEAUTIFIED 四型+注释块两处)
    t = CANON.read_text(encoding="utf-8")
    t = splice(t, CANON_MX_OLD, CANON_MX_NEW, 1, "canon.美宣")
    t = splice(t, CANON_FJ_OLD, CANON_FJ_NEW, 1, "canon.分镜")
    n = t.count(RATIO_OLD)
    if n != 6:
        die(f"canon 比例锚期望 6 处(BEAUTIFIED 人物/多视图/高清人脸/表情差分+注释×2),实得 {n}")
    t = t.replace(RATIO_OLD, RATIO_NEW)
    t = splice(t, RULE3_OLD, RULE3_NEW, 1, "canon.禁混条款例")
    compile(t, str(CANON), "exec")
    CANON.write_text(t, encoding="utf-8")

    # 6. 工作流+蓝图内嵌底座快照
    for f, label in [(T2I, "t2i"), (I2I, "i2i"), (SG_T, "蓝图t2i"), (SG_I, "蓝图i2i")]:
        t = f.read_text(encoding="utf-8")
        t = splice(t, old_base_pos, base_pos_new, 1, f"embed.{label}")
        json.loads(t)
        f.write_text(t, encoding="utf-8")

    # 7. 装配测试 sha 锚随源重锚
    new_sha = hashlib.sha256(base_pos_new.encode()).hexdigest()[:16]
    t = TEST_ASM.read_text(encoding="utf-8")
    t = splice(t, '"锁层A全文": "c74fffcb5c4a9b0f",    # qi21_bases.json art_style_base.positive_text(1007 否定式清退两轮后)',
                f'"锁层A全文": "{new_sha}",    # qi21_bases.json art_style_base.positive_text(1008 S3 底座负向式转入后重锚)',
                1, "test.sha")
    TEST_ASM.write_text(t, encoding="utf-8")
    print(f"OK S3 手术完成;新底座正向 sha16={new_sha}")


if __name__ == "__main__":
    if "--precheck" in sys.argv:
        sys.exit(0 if precheck() else 1)
    elif "--apply" in sys.argv:
        surgery()
    else:
        print(__doc__)
        sys.exit(2)
