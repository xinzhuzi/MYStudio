#!/usr/bin/env python3
# qi21_shekaping_rgba_fix_1016.py —— 设定卡实弹终审四问题修复(1016 用户反馈)
# 四指控:背景不透明/第二三人姿势重复/武器弯曲/像素模糊。
# 本刀治前三(词法面):①rgba_default 翻真(挂透明链=rgba_text+App 透明分支)
# ②三视图逐位点名+恰好三锁+全身人物排他(治姿势重复与第五人)
# ③透明底句(对齐道具型先例句式) ④武器形状锁(v5.4 §164 吸收补账:直刃直杆恒直)
# ⑤负面+4token(实体背景/背景景物/姿势重复/刀身弯曲;满血档 cfg>1 生效,viggle 哑属已知)
# 模糊=档位问题另腿治(重发开 SeedVR2 尾档),非本刀面。
# 对象:qi21_bases.json(运行时真源,叠并行 7 行版上)+daojie_canon_lib.py BEAUTIFIED(美化版镜像)。
# 范式:fail-closed——预态断言不满足 exit 2 零写入;已术后 exit 3 幂等拦停。

import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[3]
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
CANON = REPO / "apps/build/scripts/daojie_canon_lib.py"

# ── 锚串(术前态·工作区并行 7 行版) ─────────────────────────────
A_OLD = "视图区为正面、侧面、背面三个全身视图横排并列，"
B_OLD = "三个全身视图均为标准站姿，机位分别为正面平视、正九十度侧面平视与背面平视，各视图取景范围与人物占比一致。"
C_OLD = "各分区边界清晰，排版疏朗有呼吸。"
D_OLD = "来源明确要求的伤痕、破损与身体缺失逐格保留。"
NEG_TAIL = "面部特写取景漂移"

# ── 新文 ─────────────────────────────────────────────────────
A_NEW = "视图区横排并列恰好三个全身视图，自左至右依次为正面平视、正九十度纯侧面平视与背面平视的全身像，三个机位互不重复，"
B_NEW = "三个全身视图均为标准站姿，取景范围与人物占比一致，除主视觉区与视图区外，卡面不再出现其他全身人物。"
C_NEW = "各分区边界清晰，排版疏朗有呼吸，卡面为带透明通道的透明底，各分区外无背景景物与底色。"
D_NEW = "来源明确要求的伤痕、破损与身体缺失逐格保留。同一配器的形状、长度与比例在各视图与局部特写中逐格一致，直刃与直杆类配器保持笔直。"
NEG_ADD = "，实体背景，背景景物，姿势重复，刀身弯曲"

# BEAUTIFIED 专属锚(美化版措辞与 bases 微差)
BB_OLD = "三个全身视图机位分别为正面平视、正九十度侧面平视与背面平视，取景与占比逐格一致。"
BC_OLD = "背景为浅净平涂底，色面连续铺到卡面边缘，宣纸白仅作分区透气净空。"


def die(code: int, msg: str) -> None:
    print(f"[fail] {msg}")
    sys.exit(code)


def main() -> None:
    # ── 预态:bases ──
    raw = BASES.read_text(encoding="utf-8")
    if not raw.endswith("\n"):
        die(2, "bases 应 indent2+尾换行格式")
    data = json.loads(raw)
    e = next((t for t in data["types"] if t["zh"] == "设定卡"), None)
    if e is None:
        die(2, "types 无「设定卡」(前置:1015 十型役)")
    pos, neg = e["positive_text"], e["negative_text"]

    if e["rgba_default"] is True and A_OLD not in pos and "刀身弯曲" in neg:
        print("[idem] bases 已术后,跳过")
    else:
        checks = [
            (e["rgba_default"] is False, "rgba_default 术前应为 False"),
            (pos.count(A_OLD) == 1, f"A 锚计数={pos.count(A_OLD)} 应=1"),
            (pos.count(B_OLD) == 1, f"B 锚计数={pos.count(B_OLD)} 应=1"),
            (pos.count(C_OLD) == 1, f"C 锚计数={pos.count(C_OLD)} 应=1"),
            (pos.count(D_OLD) == 1, f"D 锚计数={pos.count(D_OLD)} 应=1"),
            (len(pos.split("\n")) == 7, f"行数={len(pos.split(chr(10)))} 应=7(并行版)"),
            (neg.count("实体背景") == 0, "负面术前应无「实体背景」"),
            (neg.endswith(NEG_TAIL), "负面尾部锚失配(并行改了负面?)"),
        ]
        for ok, msg in checks:
            if not ok:
                die(2, msg)

        e["rgba_default"] = True
        e["positive_text"] = (
            pos.replace(A_OLD, A_NEW).replace(B_OLD, B_NEW).replace(C_OLD, C_NEW).replace(D_OLD, D_NEW)
        )
        e["negative_text"] = neg + NEG_ADD
        assert len(e["positive_text"].split("\n")) == 7, "术后行数应恒 7"

        out = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        assert json.loads(out) == data, "JSON 往返失配"
        BASES.write_text(out, encoding="utf-8")
        print("[ok] bases:rgba=True+四刀+负面24token 落盘")

    # ── 预态+手术:canon_lib BEAUTIFIED ──
    craw = CANON.read_text(encoding="utf-8")
    if A_NEW in craw and "刀身弯曲" not in craw:
        # bases 锚串已入(A_NEW 同串),BEAUTIFIED 尚未含武器锁尾=半态,继续补
        pass
    if "直刃与直杆类配器保持笔直" in craw:
        print("[idem] BEAUTIFIED 已术后,跳过")
    else:
        cchecks = [
            (craw.count(A_OLD) == 1, f"BEAUTIFIED A 锚计数={craw.count(A_OLD)} 应=1"),
            (craw.count(BB_OLD) == 1, f"BEAUTIFIED B 锚计数={craw.count(BB_OLD)} 应=1"),
            (craw.count(BC_OLD) == 1, f"BEAUTIFIED 背景句锚计数={craw.count(BC_OLD)} 应=1"),
        ]
        for ok, msg in cchecks:
            if not ok:
                die(2, f"canon_lib: {msg}")
        BC_NEW = "卡面为带透明通道的透明底，各分区外无背景景物与底色。"
        D_TAIL = "同一配器的形状、长度与比例在各视图与局部特写中逐格一致，直刃与直杆类配器保持笔直。"
        craw2 = craw.replace(A_OLD, A_NEW).replace(BB_OLD, B_NEW).replace(BC_OLD, BC_NEW)
        craw2 = craw2.replace(BC_NEW, BC_NEW + D_TAIL, 1)
        # BEAUTIFIED 尾接后校验:四处新文各恰好一次
        for s, tag in [(A_NEW, "A"), (B_NEW, "B"), (BC_NEW, "C"), (D_TAIL, "D")]:
            if craw2.count(s) != 1:
                die(4, f"canon_lib 术后 {tag} 锚计数={craw2.count(s)} 应=1")
        CANON.write_text(craw2, encoding="utf-8")
        print("[ok] canon_lib BEAUTIFIED:逐点名+排他+透明句+武器锁 落盘")

    print("[done] 双对象手术毕")


if __name__ == "__main__":
    main()
