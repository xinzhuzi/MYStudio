#!/usr/bin/env python3
# qi21 PE教材环境低频轮(1008):expand_instruction.system_prompt_zh 第六步增补透明关环境书写纪律
# SOP=docs/prompts/Qwen-Image-2.1/08-AI扩写提示词优化规范.md §8 八步(本脚本=第1步脚本手术+第3步双刷+第5步json部署腿+第8步落账;
#     第2步整文重审=脚本内撞词/域隔离自检+人工过十律;第4步蓝图同步、第6步全套测试、第7步实弹由驱动序列另行执行)
# 教义来源=背景脏感报告:环境低频大色面/远景剪影+透视/线描语言限定人物/光限定人物与近景
# 机检对齐(08 §7):「透视」负向token已有豁免白名单(_CLASH_EXEMPT={"透视":("大气透视",)})——
#     教义之「空气透视」会造撞词假红,转译沿用在场合法词「大气透视」(教材既有×2)
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path("/Users/zhengbingjin/Project/Github/MYStudio")
JSON_P = ROOT / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
CARD_4030 = [
    ROOT / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
    ROOT / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json",
]
API_PE = ROOT / "apps/backend/engines/comfyui/my_nodes/nodes/my_qi21_api_pe.py"
DOC08_P = ROOT / "docs/prompts/Qwen-Image-2.1/08-AI扩写提示词优化规范.md"
BK = ROOT / "apps/build/scripts/backups/qi21_sysprompt_envlow_1008"
MIRRORS = [
    ROOT / "apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json",
    Path("/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"),
    Path.home() / "Library/Application Support/漫影工作室/comfyui/daojie-data/qi21_bases.json",
    Path.home() / "Project/IP/MA/skills/art_skills/daojie_ink_guofeng/json/qi21_bases.json",
]

# ── 教材旧串(工作树现文逐字,恰1处) ──
OLD_BLOCK = ("### 第六步：光线与氛围\n"
             "光源方向、强度、色温；阴影方向；大气透视；整体情绪基调。（透明开时按透明豁免裁剪,只写落在主体身上的光。）")
NEW_BLOCK = (OLD_BLOCK + "\n"
             "透明关写环境与背景时笔墨放低频：空间与气氛交给连续平滑的大色面与概括形体，"
             "远景只留山脊轮廓剪影与大气透视；工笔、铁线描、罩染只落人物与关键配件；光的落点在人物与近景。")
# 语义自检标记
NEW_MARKS = ["笔墨放低频", "大色面与概括形体", "山脊轮廓剪影与大气透视", "工笔、铁线描、罩染只落人物与关键配件", "光的落点在人物与近景"]
FORBIDDEN = ["空气透视"]  # 撞词假红源,禁入(机检对齐)
LEDGER_ANCHOR = "| v10.1 | 2833 |"
LEDGER_ROW_TMPL = ("\n| **v11** | **{n}** | **1008 PE教材环境低频轮(背景脏感报告教义翻译,用户令)**:"
                   "第六步加透明关环境书写纪律一句——环境/背景笔墨低频(连续平滑大色面+概括形体承担空间与气氛)/"
                   "远景只留山脊轮廓剪影与大气透视(沿用机检撞词豁免白名单词,「空气透视」会造假红=按08§7机检对齐转译)/"
                   "工笔、铁线描、罩染只落人物与关键配件/光落点在人物与近景;措辞域隔离=透明关限定(律5,透明开仍走豁免只写主体光);"
                   "[4030]双刷(t2i工作流+提示词类型优化子图)同批逐字;真源热读即时生效** |")
MERMAID_OLD = "(纯逻辑 2830 字,v10)"
API_PE_NOTE_ANCHOR = ('    if not textbook:\n'
                      '        textbook = ("你是图像提示词扩写专家。把用户的画面需求扩写为一段完整的中文"')
API_PE_NOTE_NEW = ('    if not textbook:\n'
                   '        # 注(1008 PE教材环境低频轮):本串=连线缺位且真源热读失败时的应急极简桩,非教材副本——\n'
                   '        # 教材正文(含 v11 环境低频纪律)恒热读 qi21_bases.json,桩不随教材版本走(A3 口径)。\n'
                   '        textbook = ("你是图像提示词扩写专家。把用户的画面需求扩写为一段完整的中文"')


def must(cond: bool, msg: str) -> None:
    if not cond:
        print(f"ABORT: {msg}")
        sys.exit(1)


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def esc(s: str) -> str:
    """json 文件内串的转义内形(ensure_ascii=False,首尾引号剥除)。"""
    return json.dumps(s, ensure_ascii=False)[1:-1]


def main() -> None:
    data = json.loads(JSON_P.read_text(encoding="utf-8"))
    old_tb = data["expand_instruction"]["system_prompt_zh"]

    # 0) 锚断言(旧串恰1;卡文[4030]现态==json教材逐字)
    must(old_tb.count(OLD_BLOCK) == 1, f"教材旧串命中 {old_tb.count(OLD_BLOCK)} 次,期望恰1")
    for f in CARD_4030:
        raw = f.read_text(encoding="utf-8")
        must(raw.count(esc(old_tb)) == 1, f"{f.name} [4030]教材旧文命中非恰1")

    # 改前副本(SOP-1)
    BK.mkdir(parents=True, exist_ok=True)
    for f in [JSON_P, *CARD_4030, API_PE, DOC08_P]:
        shutil.copy2(f, BK / (f.name + ".pre"))
    print(f"副本 → {BK}")

    # 1) 真源 splice
    new_tb = old_tb.replace(OLD_BLOCK, NEW_BLOCK)
    must(len(new_tb) == len(old_tb) + (len(NEW_BLOCK) - len(OLD_BLOCK)), "教材长度推导异常")
    for m in NEW_MARKS:
        must(m in new_tb, f"语义自检:新标记缺席 {m}")
    for bad in FORBIDDEN:
        must(bad not in new_tb, f"语义自检:禁词在场 {bad}")
    # 撞词预检(六检-6 对齐):语义=my_qi21_api_pe._pos_neg_clash——豁免词组先剥后检
    CLASH_EXEMPT = {"透视": ("大气透视",)}  # 与节点 _CLASH_EXEMPT 同步;改节点须同批改此处
    neg_toks = [t.strip() for t in data["art_style_base"]["negative_text"].split("，") if t.strip()]
    for ty in data["types"]:
        neg_toks += [t.strip() for t in ty.get("negative_text", "").split("，") if t.strip()]
    delta = NEW_BLOCK[len(OLD_BLOCK):]
    hits = []
    for t in set(neg_toks):
        probe = delta
        for ex in CLASH_EXEMPT.get(t, ()):
            probe = probe.replace(ex, "")
        if t in probe:
            hits.append(t)
    must(not hits, f"新句与负向语料直撞(豁免剥除后仍命中): {hits}(先定谳再动刀)")
    data["expand_instruction"]["system_prompt_zh"] = new_tb
    raw = JSON_P.read_text(encoding="utf-8")
    must(raw.count(esc(OLD_BLOCK)) == 1, "真源教材旧串转义形态命中非恰1")
    raw2 = raw.replace(esc(OLD_BLOCK), esc(NEW_BLOCK))
    json.loads(raw2)
    must(json.loads(raw2)["expand_instruction"]["system_prompt_zh"] == new_tb, "真源 splice 后教材≠推导新文")
    JSON_P.write_text(raw2, encoding="utf-8")
    print(f"- 真源教材 splice: {len(old_tb)} → {len(new_tb)} 字(+{len(new_tb)-len(old_tb)})")

    # 2) [4030] 双刷(SOP-3:工作流+蓝图 subgraphs 两处,转义形态逐字替换)
    for f in CARD_4030:
        raw = f.read_text(encoding="utf-8")
        raw2 = raw.replace(esc(old_tb), esc(new_tb))
        must(raw2.count(esc(new_tb)) == 1 and raw2.count(esc(old_tb)) == 0, f"{f.name} 双刷后校验异常")
        json.loads(raw2)
        f.write_text(raw2, encoding="utf-8")
        print(f"- [4030] 双刷: {f.name}")

    # 3) api_pe 指纹处置:内嵌串=热读兜底的应急极简桩(非教材全文副本,留)——加注记
    ape = API_PE.read_text(encoding="utf-8")
    must(ape.count(API_PE_NOTE_ANCHOR) == 1, "api_pe 兜底桩锚命中异常")
    ape = ape.replace(API_PE_NOTE_ANCHOR, API_PE_NOTE_NEW)
    import ast
    ast.parse(ape)  # 语法自检(注记行缩进错会在此拦)
    API_PE.write_text(ape, encoding="utf-8")
    print("- api_pe 应急桩加注记(留,非教材副本)")

    # 4) 08 篇落账(SOP-8:演化账+1行;账实相符修 mermaid 标签)
    d08 = DOC08_P.read_text(encoding="utf-8")
    must(d08.count(LEDGER_ANCHOR) == 1, "08演化账锚命中异常")
    must(d08.count(MERMAID_OLD) == 1, "08 mermaid 标签锚命中异常")
    d08 = d08.replace(LEDGER_ANCHOR, LEDGER_ANCHOR + LEDGER_ROW_TMPL.format(n=len(new_tb)))
    d08 = d08.replace(MERMAID_OLD, f"(纯逻辑 {len(new_tb)} 字,v11)")
    DOC08_P.write_text(d08, encoding="utf-8")
    print("- 08 篇落账: §11 +v11 行 + mermaid 标签账实相符")

    # 5) 五路同刷 json + md5 归一
    for m in MIRRORS:
        must(m.exists(), f"镜像路径不存在: {m}")
        shutil.copy2(JSON_P, m)
    digests = {str(p): md5(p) for p in [JSON_P, *MIRRORS]}
    must(len(set(digests.values())) == 1, f"五路 md5 未归一: {digests}")
    print(f"- 五路同刷 json md5 归一: {set(digests.values()).pop()}")

    print("\nOK:SOP 第1/3/5(json腿)/8 步落刀;第2步整文重审与第4/6/7步由驱动序列继续")


if __name__ == "__main__":
    main()
