#!/usr/bin/env python3
"""qi21 九型→十型手术(1015):设定卡型入列真源 + 栈预设 14 槽同步。

用户令:角色设定卡Skill-5.4(外部技能,备份=docs/comfyui-kb/参考_提示词工程/
角色设定卡Skill-5.4.md,md5 同 Downloads 原件)吸收为十型新丁「设定卡」——
排版/统计卡语言入型文(通用语言铁律:零风格词/零具体物名,武器归主体句),
美术风格沿用已定 art_style_base(型文层契约锁不动),LoRA 配方=人物系多视图
同款三件(细节×1+亚洲面孔×0.4+鎏金×0.3,画风槽不开=卡面干净口径)。

fail-closed:预态断言不满足 exit 2 零写入;已术后幂等跳过(exit 0+拦停消息,不拦另一腿);
json 序列化格式往返不一致 exit 4(防重排 diff 污染)。
"""

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
STACK = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/daojie_lora_stack.json"

CANON_NINE = ["人物", "场景", "道具", "美宣", "人物多视图",
              "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"]
SHEET_PRESET = "设定板"

POS = (
    "同一角色的角色设定卡，一图多区排版：主视觉区为全身立绘，视图区为正面、侧面、背面三个全身视图横排并列，"
    "特写区为面部特写与数格细节特写，底部为服饰与配器局部横排，卡面另留窄条档案区与色样区，"
    "各分区边界清晰，排版疏朗有呼吸。同一角色身份贯穿全卡，脸型五官、发型发饰、服装配饰在各视图与各特写中逐格一致；"
    "三个全身视图均为标准站姿，机位分别为正面平视、正九十度侧面平视与背面平视，各视图取景范围与人物占比一致。"
    "细线勾勒人物轮廓与服饰结构，线随结构时粗时细；全身立绘与面部特写是细节焦点，细节特写均取自该角色服饰与配器的实际部位。\n"
    "衣褶/裙摆：使用宽幅平静布面，正面长结构褶疏落两到四条。\n"
    "衣料质感真实可穿，布面平整，袖口与下摆为连续闭合的完整布面。\n"
    "头发以细线分组勾勒，发量与发际线自然。\n"
    "持握物件的方式自然符合物件用途，手部衔接几何明确：握位、指态与物件表面的接触关系具体可辨；"
    "佩挂物件的挂载几何明确：连接件与身体相连、挂点与倾角清晰，物件重量由挂载连接件承担，手部至多轻搭。\n"
    "主体设色配比：主体明文服装与配器主色为第一主色，以大面积稳定基底承托，中等强度色作主体层次，少量高识别色仅作点睛。"
)

NEG = ("模糊，水印，多手指，文字错误，英文字母，英文标签，乱码文字，无意义文字段落，"
       "视图数量错误，格间重叠，分区错乱，发型漂移，服装漂移，配饰漂移，身份漂移，"
       "多格比例失调，三视图机位漂移，细节特写与角色不符，多余角色，面部特写取景漂移")

ENTRY = {
    "zh": "设定卡",
    "aspect_ratio": "16:9 (Widescreen)",
    "megapixels": 1.5,
    "rgba_default": False,
    "purpose": ("16:9 单图角色档案设定卡(1015 入十型):主视觉全身立绘+正/侧/背三视图+面部与细节特写"
                "+服饰配器局部+档案区,一卡集齐角色资产概览。主体句=身份段(七段公式四件套+配器部件清单,"
                "同人物型纪律),视图与分区语言归型层;灵兽/武器一致性/表情差分等专项写法见技能"
                " daojie-charsheet-prompter 与参考备份 docs/comfyui-kb/参考_提示词工程/角色设定卡Skill-5.4.md;"
                "档案区字段文字建议后期贴字(生成期负向已压乱码与英文)。"),
    "positive_text": POS,
    "negative_text": NEG,
    "color_recipe": {
        "base": "宣纸白",
        "ink": "随主体配色与材质从色卡选取的协调彩线色",
        "stable": ["淡墨"],
        "mid": ["石青", "青绿", "赭石"],
        "accent": ["旧金", "朱红"],
    },
    "lora_recipe": [
        {"file": "Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors",
         "weight": 1.0, "slot": "detail"},
        {"file": "Krea2-画风/Krea2-AsianMix_v4_TQD.safetensors",
         "weight": 0.4, "slot": "asianmix"},
        {"file": "Krea2-画风/Krea2-水墨武侠漆艺鎏金_v1.safetensors",
         "weight": 0.3, "slot": "liujin"},
    ],
    "steps_hint": {"fast": 4, "quality": 12},
    "i2i_routes": [],
    "postprocess": "档案区字段与格名文字后期贴字;特写格放大走 K2-SeedVR2修复.json",
    "recipe_version": "v0.1(1015 设定卡入十型首档,待实弹对拍终审)",
}

DOC_TYPES_SUFFIX = (" | 1015 设定卡入列九型→十型(十一档=十型+自由;外部角色设定卡技能 v5.4 吸收:"
                     "排版与统计卡语言入型文,生成逻辑全文备份=docs/comfyui-kb/参考_提示词工程/"
                     "角色设定卡Skill-5.4.md,排版/DNA/灵兽专项=技能 daojie-charsheet-prompter)")


def dump(data) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def dump_bare(data) -> str:
    # daojie_lora_stack.json 现口径=indent2 无尾换行(实读定谳,两件各自独立幂等)
    return json.dumps(data, ensure_ascii=False, indent=2)


def main() -> int:
    bases_raw = BASES.read_text(encoding="utf-8")
    bases = json.loads(bases_raw)
    zh_list = [t["zh"] for t in bases["types"]]

    if "设定卡" in zh_list:
        print("[幂等拦停] bases 腿:设定卡已在 types[],跳过(exit 3 口径,不拦栈腿)")
    else:
        if zh_list != CANON_NINE + ["自由"]:
            print(f"[预态断言失败] types 应=九型+自由,得 {zh_list}(exit 2)")
            return 2
        # 序列化格式往返校验(防 diff 污染:确认现有文件即本脚本同款 dump 格式)
        if dump(bases) != bases_raw:
            print("[格式断言失败] qi21_bases.json 现格式≠indent2+尾换行口径,拒写(exit 4)")
            return 4

        # 插入:概念气氛图后、自由前(canon 十型末位=新丁,自由恒末位)
        idx = zh_list.index("自由")
        bases["types"].insert(idx, ENTRY)
        bases["_doc_types"] = bases["_doc_types"] + DOC_TYPES_SUFFIX
        BASES.write_text(dump(bases), encoding="utf-8")
        print(f"[qi21_bases.json] 设定卡入列 idx={idx},types {len(zh_list)}→{len(bases['types'])} 档")

    # ── 栈预设:14 槽逐槽「人物多视图组复制」插在 概念气氛图 后、设定板 前 ──
    stack_raw = STACK.read_text(encoding="utf-8")
    stack = json.loads(stack_raw)
    stack_keys = list(stack[0]["presets"]) if stack else []
    if stack_keys and "设定卡" in stack_keys:
        print("[幂等拦停] 栈腿:设定卡已在预设,跳过")
    else:
        if dump_bare(stack) != stack_raw:
            print("[格式断言失败] daojie_lora_stack.json 现格式≠indent2 无尾换行口径,拒写(exit 4)")
            return 4
        changed = 0
        for slot in stack:
            keys = list(slot["presets"])
            if keys != CANON_NINE + [SHEET_PRESET]:
                print(f"[预态断言失败] 槽 {slot['key']} 预设键序异常: {keys}(exit 2)")
                return 2
            new_presets = {}
            for k in keys:
                new_presets[k] = slot["presets"][k]
                if k == "概念气氛图":
                    new_presets["设定卡"] = dict(slot["presets"]["人物多视图"])
            slot["presets"] = new_presets
            changed += 1
        STACK.write_text(dump_bare(stack), encoding="utf-8")
        print(f"[daojie_lora_stack.json] {changed} 槽同步:设定卡=人物多视图组逐槽复制,位序=概念气氛图后/设定板前")

    # 后态断言
    recheck = json.loads(BASES.read_text(encoding="utf-8"))
    assert [t["zh"] for t in recheck["types"]] == CANON_NINE + ["设定卡", "自由"]
    restack = json.loads(STACK.read_text(encoding="utf-8"))
    for slot in restack:
        assert list(slot["presets"]) == CANON_NINE + ["设定卡", SHEET_PRESET], slot["key"]
        assert slot["presets"]["设定卡"] == slot["presets"]["人物多视图"], slot["key"]
    print("[后态断言] 两件全绿:十一档(十型+自由)/14 槽预设键序含设定卡且=人物多视图组")
    return 0


if __name__ == "__main__":
    sys.exit(main())
