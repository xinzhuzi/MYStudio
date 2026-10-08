#!/usr/bin/env python3
# qi21 第三轮删词刀·全量断言门(1008)。退出码 0=全绿 / 1=有红。
# 口径:新串在场恰N/两旧串活面绝迹(E1 子串判别)/宪法新行在场/负向token全格式/
#       正向撞词零命中/卡文正向槽==json底座正向逐字/05库仅台账+1行(位移感知)/
#       lib新串计数/git工作树除白名单外净/五路md5归一
import hashlib
import json
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
DOC08_P = ROOT / "docs/prompts/Qwen-Image-2.1/08-AI扩写提示词优化规范.md"
API_PE_P = ROOT / "apps/backend/engines/comfyui/my_nodes/nodes/my_qi21_api_pe.py"
CARDS_4030 = [CARD_FILES[0], CARD_FILES[2]]  # t2i + 提示词类型优化子图(唯二含 MyQi21系统提示词 节点)
TESTS_DIR = ROOT / "apps/backend/engines/comfyui/my_nodes/tests"
BK = ROOT / "apps/build/scripts/backups/qi21_r3_1008"
MIRRORS = [
    ROOT / "apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json",
    Path("/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"),
    Path.home() / "Library/Application Support/漫影工作室/comfyui/daojie-data/qi21_bases.json",
    Path.home() / "Project/IP/MA/skills/art_skills/daojie_ink_guofeng/json/qi21_bases.json",
]

E1_OLD = "颜料层纯净均匀，罩染通透细腻。"
E1_NEW = "人物及关键配件的颜料层纯净均匀，罩染通透细腻。"
E1_OLD_CTX = "。颜料层纯净均匀"  # E1_NEW 含 E1_OLD 作子串——上下文形判别旧串独立在场
E2_OLD = "远景以淡墨晕染退开，仅保留山脊轮廓与剪影。"
E2_NEW = "远景以低对比淡墨色面退开，仅保留山脊轮廓与剪影。"
DOC07_NEWLINE = "- 光色落点限定人物与近景边缘(如“光晕只落在发际与肩线”),光不负责给背景主色面上色;背景冷暖由主体句按场景事实分区(§七A)。"

FAILS: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    tag = "PASS" if cond else "FAIL"
    print(f"[{tag}] {name}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def displaced_insert(old_lines: list[str], new_lines: list[str]) -> int:
    """位移感知:恰 +1 行插入则返回插入下标,否则 -1。"""
    if len(new_lines) != len(old_lines) + 1:
        return -1
    i = 0
    while i < len(old_lines) and old_lines[i] == new_lines[i]:
        i += 1
    if new_lines[:i] == old_lines[:i] and new_lines[i + 1:] == old_lines[i:]:
        return i
    return -1


def main() -> None:
    json_text = JSON_P.read_text(encoding="utf-8")
    data = json.loads(json_text)
    base_pos = data["art_style_base"]["positive_text"]
    base_neg = data["art_style_base"]["negative_text"]

    # 1) 新串在场恰N / 2) 旧串活面绝迹(E1 子串判别)
    check("json 新串①恰1处", json_text.count(E1_NEW) == 1, f"count={json_text.count(E1_NEW)}")
    check("json 新串②恰4处在场", json_text.count(E2_NEW) == 4, f"count={json_text.count(E2_NEW)}")
    check("json 底座正向含新串①/型层不含",
          base_pos.count(E1_NEW) == 1 and sum(ty["positive_text"].count(E1_NEW) for ty in data["types"]) == 0)
    e2_types = [ty.get("zh") for ty in data["types"] if E2_NEW in ty.get("positive_text", "")]
    check("json 新串②落点=人物/多视图/高清人脸/表情差分",
          e2_types == ["人物", "多视图", "高清人脸", "表情差分"], f"落点={e2_types}")
    check("美宣/分镜远景句不动(无晕染词两串各恰1)",
          json_text.count("远景收入一片淡墨虚实") == 1 and json_text.count("远景用淡墨退去") == 1)
    for name, f in [("json", JSON_P), *[(c.name, c) for c in CARD_FILES]]:
        t = f.read_text(encoding="utf-8")
        check(f"旧串②绝迹[{name}]", E2_OLD not in t)
        check(f"旧串①绝迹[{name}](子串判别+上下文形)",
              t.count(E1_OLD) == t.count(E1_NEW) and E1_OLD_CTX not in t)
    lib = LIB_P.read_text(encoding="utf-8")
    tests_txt = "\n".join(p.read_text(encoding="utf-8") for p in sorted(TESTS_DIR.rglob("*.py")))
    for old in (E1_OLD, E2_OLD):
        check(f"canon_lib 旧串零命中[{old[:10]}…]", old not in lib)
        check(f"测试树 旧串零命中[{old[:10]}…]", old not in tests_txt)

    # 3) 宪法新行在场(且 07 全文仅 +1 行,位移感知)
    d07 = DOC07_P.read_text(encoding="utf-8")
    check("宪法新行在场恰1", d07.count(DOC07_NEWLINE) == 1, f"count={d07.count(DOC07_NEWLINE)}")
    d07_pre = (BK / "07-主体句写作宪法.md.pre").read_text(encoding="utf-8").split("\n")
    d07_lines = d07.split("\n")
    idx07 = displaced_insert(d07_pre, d07_lines)
    check("宪法仅+1行(位移感知,余行不动)", idx07 >= 0 and "光色落点" in d07_lines[idx07])
    check("宪法新行在 §八末尾(前一行=光参数正文行)",
          idx07 >= 1 and "人脸特写加落点" in d07_lines[idx07 - 1],
          f"前一行={d07_lines[idx07 - 1][:40] if idx07 >= 1 else '无'}")

    # 4) 负向 token 全格式(四规:零指令词头/零斜杠/<12字/零重复;锁层+十型)
    import re
    directive = re.compile(r"^(禁止|不得|不要|避免|严禁|防止|没有)")

    def toks(text: str) -> list[str]:
        return [t.strip() for t in text.split("，") if t.strip()]

    neg_groups = [("art_style_base", base_neg)] + [
        (f"types[{ty.get('zh')}]", ty.get("negative_text", "")) for ty in data["types"]]
    fmt_ok, all_toks = True, []
    for gname, gtext in neg_groups:
        ts = toks(gtext)
        all_toks += ts
        for t in ts:
            if directive.search(t) or "/" in t or len(t) >= 12:
                fmt_ok = False
                print(f"    违规 {gname}: {t!r}")
        dup = sorted({t for t in ts if ts.count(t) > 1})
        if dup:
            fmt_ok = False
            print(f"    重复 {gname}: {dup}")
    check("负向token全格式(四规×锁层+十型)", fmt_ok and len(neg_groups) == 11)

    # 5) 正向撞词零命中(负向 token 全集 × 锁层+十型正向发射语料)
    pos_corpus = [base_pos] + [ty.get("positive_text", "") for ty in data["types"]]
    hits = sorted({t for t in set(all_toks) for c in pos_corpus if t in c})
    check("正向撞词零命中", not hits, f"撞词={hits}")

    # 6) 卡文正向槽==json底座正向逐字(按串不按槽号)
    for f in CARD_FILES:
        t = f.read_text(encoding="utf-8")
        try:
            json.loads(t)
            valid = True
        except Exception:
            valid = False
        check(f"卡文正向槽==json底座正向逐字[{f.name}]",
              valid and t.count(base_pos) == 1,
              f"count(base_pos)={t.count(base_pos)}")
    # 负向槽按族判数(前例在案:t2i/子图=widgets_values[1]负向槽恰1;i2i 族装配器无负向槽恰0;
    # 本刀零负向改动,负向快照应与改前副本逐字同一)
    for f in CARD_FILES:
        t = f.read_text(encoding="utf-8")
        expect = 0 if "i2i" in f.name else 1
        check(f"卡文负向槽数[{f.name}](t2i族=1/i2i族=0,本刀零负向改动)",
              t.count(base_neg) == expect, f"count={t.count(base_neg)} expect={expect}")
        t_pre = (BK / (f.name + ".pre")).read_text(encoding="utf-8")
        check(f"卡文负向快照与改前同一[{f.name}]",
              t.count(base_neg) == t_pre.count(base_neg))

    # 7) 05库仅台账+1行(位移感知对比 vs 改前副本;正文不动)
    d05 = DOC05_P.read_text(encoding="utf-8")
    d05_pre = (BK / "05-道劫规范提示词库.md.pre").read_text(encoding="utf-8").split("\n")
    idx05 = displaced_insert(d05_pre, d05.split("\n"))
    check("05库仅台账+1行(位移感知)", idx05 >= 0, f"插入点={idx05}")
    check("05库台账行含本刀标记", idx05 >= 0 and "删词刀第三轮" in d05.split("\n")[idx05])
    check("05库正文旧串①计数不漂移(记录层×10留史)", d05.count(E1_OLD) == 10, f"count={d05.count(E1_OLD)}")
    check("05库旧串②恒零", d05.count(E2_OLD) == 0)

    # 7b) PE教材环境低频轮(1008 同役):教材新纪律在场+[4030]卡文==json教材逐字
    textbook = data["expand_instruction"]["system_prompt_zh"]
    for m in ("笔墨放低频", "山脊轮廓剪影与大气透视", "工笔、铁线描、罩染只落人物与关键配件", "光的落点在人物与近景"):
        check(f"教材含新纪律关键词[{m[:12]}…]", m in textbook)
    check("教材零「空气透视」(撞词假红源,机检对齐转译为大气透视)", "空气透视" not in textbook)
    check("教材 v11 落账(08篇演化账+v11行)", "v11" in DOC08_P.read_text(encoding="utf-8")
          and "**v11**" in DOC08_P.read_text(encoding="utf-8"))
    check("api_pe 应急桩注记在场(留+注记处置)", "非教材副本" in API_PE_P.read_text(encoding="utf-8"))
    esc_tb = json.dumps(textbook, ensure_ascii=False)[1:-1]
    old_tb_pre = json.loads((ROOT / "apps/build/scripts/backups/qi21_sysprompt_envlow_1008/qi21_bases.json.pre")
                            .read_text(encoding="utf-8"))["expand_instruction"]["system_prompt_zh"]
    esc_old_tb = json.dumps(old_tb_pre, ensure_ascii=False)[1:-1]
    for f in CARDS_4030:
        raw = f.read_text(encoding="utf-8")
        check(f"[4030]卡文==json教材逐字[{f.name}]", raw.count(esc_tb) == 1,
              f"count={raw.count(esc_tb)}")
        check(f"[4030]旧教材绝迹[{f.name}]", esc_old_tb not in raw)

    # 7c) 九型实弹第1轮修复:概念气氛图禁人词(库级负面对齐场景型)
    con = next(ty for ty in data["types"] if ty["zh"] == "概念气氛图")
    scn = next(ty for ty in data["types"] if ty["zh"] == "场景")
    check("概念气氛图负向含禁人词(人影/人脸,对齐场景型)",
          "人影" in con.get("negative_text", "") and "人脸" in con.get("negative_text", ""))
    check("场景型负向未被误动(对齐基准)", scn.get("negative_text", "").endswith("人影，人脸"))

    # 8) lib 新串计数(本刀 canon_lib 零命中零改动;md5 与改前副本同一=留史不动验证)
    check("canon_lib 新串计数=0(本刀零发射串)", E1_NEW not in lib and E2_NEW not in lib)
    check("canon_lib 本刀零改动(md5==改前副本)", md5(LIB_P) == md5(BK / "daojie_canon_lib.py.pre"))

    # 9) git 工作树除白名单外净
    ALLOW = {
        "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json",
        *(str(c.relative_to(ROOT)) for c in CARD_FILES),
        "docs/prompts/Qwen-Image-2.1/07-主体句写作宪法.md",
        "docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md",
        "apps/backend/engines/comfyui/my_nodes/tests/test_my_qi21_prompt_assembly.py",  # 锚随源重锚(底座正向 sha16)
        "apps/backend/engines/comfyui/tests/test_qwen21_workflow_contract.py",  # 锚随源重锚(人物型存世锚词 淡墨晕染→低对比淡墨色面)
        "apps/backend/engines/comfyui/my_nodes/nodes/my_qi21_api_pe.py",  # PE教材环境低频轮:应急桩注记(留+注记)
        "docs/prompts/Qwen-Image-2.1/08-AI扩写提示词优化规范.md",  # PE教材环境低频轮:SOP⑧落账 v11 行+mermaid 账实相符
        "apps/build/scripts/qi21_sysprompt_envlow_1008.py",  # PE教材环境低频轮:SOP①脚本手术驱动
        "apps/build/scripts/backups/qi21_sysprompt_envlow_1008",  # PE教材环境低频轮:改前副本
        "apps/build/scripts/backups/qi21_sysprompt_envlow_1008/",
        "apps/build/scripts/qi21_r3fix1_1008.py",  # 九型实弹第1轮修复:概念气氛图禁人词手术驱动
        "apps/build/scripts/qi21_r3_9types_1008.py",  # 九型实弹发弹驱动(bgscope-r3-9types 产物源,同役工件)
        "apps/build/scripts/backups/qi21_r3fix1_1008",  # 九型实弹第1轮修复:改前副本
        "apps/build/scripts/backups/qi21_r3fix1_1008/",
        "apps/build/scripts/qi21_r3_surgery_1008.py",
        "apps/build/scripts/qi21_r3_surgery_1008.report.md",
        "apps/build/scripts/qi21_r3_check_1008.py",
        "apps/build/scripts/r3_package_1008.sh",
        "apps/build/scripts/backups/qi21_r3_1008",
        "apps/build/scripts/backups/qi21_r3_1008/",
        "engine-ui-1008.png",  # 手术前已存在的未跟踪件,本役不收
    }
    st = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True)
    entries = []
    for line in st.stdout.splitlines():
        if not line.strip():
            continue
        path = line[3:] if line[3:] else line
        entries.append(path)
    strays = [p for p in entries if p not in ALLOW]
    check("git工作树除白名单外净", not strays, f"白名单外={strays}")

    # 10) 五路 md5 归一
    digests = {str(p.relative_to(ROOT) if p.is_relative_to(ROOT) else p): md5(p)
               for p in [JSON_P, *MIRRORS] if p.exists()}
    missing = [str(p) for p in [JSON_P, *MIRRORS] if not p.exists()]
    check("五路json全在位", not missing and len(digests) == 5, f"missing={missing}")
    check("五路md5归一", len(digests) == 5 and len(set(digests.values())) == 1,
          f"digests={digests}")

    print()
    if FAILS:
        print(f"RED: {len(FAILS)} 项未过 → {FAILS}")
        sys.exit(1)
    print("ALL GREEN — 第三轮删词刀断言门全过")
    sys.exit(0)


if __name__ == "__main__":
    main()
