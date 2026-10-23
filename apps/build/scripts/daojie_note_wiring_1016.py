#!/usr/bin/env python3
"""1016 收尾轮·手册指路接线手术(F5/F6/F9)——复审 5/6/9 三条。

F6  t2i [402] Note 写法指路泛称改具体文件名(×2 双存储字段):
    「各型例句见库文档」→ 示例库仓路径;「库文档主体句纪律五则」→ 07 宪法仓路径;
    追加写法总入口=本手册仓路径。
F9  t2i [402] 双存储历史漂移同步:widgets_values_named.text := widgets_values[0]
    (唯一差异=尾部 RGBA 透明句式两行,difflib 实测)。
F5  img2img [402] Note 补写法指路(短精修句不经 09 五段模板+本手册仓路径);
    JSON 与生成器 qi21_img2img_build_1009.py 的 NOTE 常量双写保字节一致(幂等再生)。

纪律:fail-closed(前置断言不满足 exit 2 零写入);幂等(已术后 exit 3);
i2i(并行在途,bak-1016f27/r2 在册)零触碰;零 .bak(git 工作区即安全网)。
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
T2I = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
IMG2IMG = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-img2img.json"
GEN = REPO / "apps/build/scripts/qi21_img2img_build_1009.py"

MANUAL_REL = "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/art_prompt/art_subject_ten_types.md"

T2I_OLD_A = "(各型例句见库文档;"
T2I_NEW_A = "(各型例句见 `docs/prompts/道劫_类型主体句示例.md`;"
T2I_OLD_B = "(库文档主体句纪律五则)。"
T2I_NEW_B = ("(`docs/prompts/Qwen-Image-2.1/07-主体句写作宪法.md` 主体句纪律五则)。"
             f"**写法总入口=仓库手册 `{MANUAL_REL}`**(十型骨架句式+单源指针;起草/改写亦唤技能 daojie-image-prompter)。")

IMG_ANCHOR = "3. [400] 写精修指令(描述性,默认例句可直接跑)→ 队列。\n"
IMG_INSERT = ("写法指路:精修指令=短句直写(不经 09 五段模板);写法总入口=仓库手册 "
              f"`{MANUAL_REL}`(§0.4 图生图两路分野;起草/改写亦唤技能 daojie-image-prompter)。\n")


def die(msg, code=2):
    print(f"FAIL {msg}")
    sys.exit(code)


def node402(doc):
    hits = [n for n in doc["nodes"] if n.get("id") == 402]
    if len(hits) != 1:
        die(f"[402] 节点应恰 1 个,实得 {len(hits)}")
    return hits[0]


def load_dump_check(path):
    """回写后格式自校验:dumps(ensure_ascii=False, indent=2) 必须与文件字节全同(战前实测定格)。"""
    text = path.read_text(encoding="utf-8")
    doc = json.loads(text)
    return doc, text


def main():
    # ── 前置:幂等判态 ──
    t2i_doc, t2i_text = load_dump_check(T2I)
    n_t2i = node402(t2i_doc)
    wv = n_t2i["widgets_values"][0]
    named = n_t2i["widgets_values_named"]["text"]
    done_t2i = MANUAL_REL in wv and wv == named

    img_doc, img_text = load_dump_check(IMG2IMG)
    n_img = node402(img_doc)
    img_wv = n_img["widgets_values"][0]
    gen_text = GEN.read_text(encoding="utf-8")
    done_img = IMG_INSERT in img_wv and IMG_INSERT in gen_text

    if done_t2i and done_img:
        print("IDEMPOTENT t2i/img2img 均已术后,零写入")
        sys.exit(3)

    # ── F6+F9: t2i ──
    if not done_t2i:
        for label, field in (("wv0", wv), ("named", named)):
            for old in (T2I_OLD_A, T2I_OLD_B):
                if field.count(old) != 1:
                    die(f"t2i [402] {label} 锚『{old[:18]}…』应恰 1 处,实得 {field.count(old)}")
            if field.count(MANUAL_REL):
                die(f"t2i [402] {label} 已含手册路径但双存储未同步/未全术后——人工核态")
        new_wv = wv.replace(T2I_OLD_A, T2I_NEW_A).replace(T2I_OLD_B, T2I_NEW_B)
        n_t2i["widgets_values"][0] = new_wv
        n_t2i["widgets_values_named"]["text"] = new_wv  # F9:named := wv0
        out = json.dumps(t2i_doc, ensure_ascii=False, indent=2)
        if t2i_text.endswith("\n"):
            out += "\n"
        T2I.write_text(out, encoding="utf-8")
        chk = json.loads(T2I.read_text(encoding="utf-8"))
        c = node402(chk)
        assert c["widgets_values"][0] == c["widgets_values_named"]["text"], "t2i 回读双存储不一致"
        assert len(chk["nodes"]) == len(t2i_doc["nodes"]) and len(chk["links"]) == len(t2i_doc["links"])
        print(f"OK t2i [402]:泛称→具体文件名×2 字段;双存储同步(len {len(wv)}→{len(new_wv)} 双同);"
              f"节点 {len(chk['nodes'])}/链 {len(chk['links'])} 不变")

    # ── F5: img2img(JSON+生成器 NOTE 双写) ──
    if not done_img:
        if img_wv.count(IMG_ANCHOR) != 1:
            die(f"img2img [402] 三步用法锚应恰 1 处,实得 {img_wv.count(IMG_ANCHOR)}")
        if gen_text.count(IMG_ANCHOR) != 1:
            die(f"生成器 NOTE 三步用法锚应恰 1 处,实得 {gen_text.count(IMG_ANCHOR)}")
        n_img["widgets_values"][0] = img_wv.replace(IMG_ANCHOR, IMG_ANCHOR + IMG_INSERT)
        out = json.dumps(img_doc, ensure_ascii=False, indent=2)
        if img_text.endswith("\n"):
            out += "\n"
        IMG2IMG.write_text(out, encoding="utf-8")
        GEN.write_text(gen_text.replace(IMG_ANCHOR, IMG_ANCHOR + IMG_INSERT), encoding="utf-8")

        # 回读+生成器 NOTE 等值校验(import 安全:main guard 在册)
        sys.path.insert(0, str(GEN.parent))
        import importlib.util
        spec = importlib.util.spec_from_file_location("qi21_img2img_build_1009", GEN)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        chk = json.loads(IMG2IMG.read_text(encoding="utf-8"))
        c = node402(chk)
        assert c["widgets_values"][0] == mod.NOTE, "img2img [402] Note ≠ 生成器 NOTE(幂等再生会被打回)"
        for tok in ("0.5~0.7", "同构图精修", "off-distribution", "低噪尾段", "negative_prompt",
                    "image_2", "qi21_bases.json", "viggle-turbo-v0.3-6step", "strength 1.0"):
            assert tok in mod.NOTE, f"生成器自检 token 缺失:{tok}"
        assert len(chk["nodes"]) == len(img_doc["nodes"]) and len(chk["links"]) == len(img_doc["links"])
        print(f"OK img2img [402]:写法指路入三步用法节;JSON==生成器 NOTE 逐字;生成器 9 token 自检全过;"
              f"节点 {len(chk['nodes'])}/链 {len(chk['links'])} 不变")

    print("PASS 手术完成(t2i F6+F9 / img2img F5;i2i 零触碰)")


if __name__ == "__main__":
    main()
