#!/usr/bin/env python3
"""qi21_bases.json 新增「人脸基准」型(10-22 用户令)。

手术口径:types[] 自由之前插入人脸基准(1021 3D剖面「新型插自由之前」先例);
positive_text=用户钦定文本(与 晏燎.json 类型词逐字节互锁断言);
rgba_positive=极简透明路(构图/漫射光,循高清人脸族形,零画法词);
negative=高清人脸型负面+光头专项追加;其余字段克隆高清人脸族形。
fail-closed:任何前置断言失败即退出,真源不动。
"""
import json, shutil, sys
from pathlib import Path

ROOT = Path('/Users/zhengbingjin/Project/Github/MYStudio')
BASES = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
YANLIAO = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/晏燎.json'
BAK_DIR = ROOT / 'apps/output/晏燎/bak'
BAK = BAK_DIR / 'qi21_bases.pre-人脸基准-1022.json'

USER_TEXT = "单一角色的正面头颈特写素材：正面平视机位，视线直视镜头，取景为头部与颈部；头顶、头颅外轮廓与下颌完整，面部是画面焦点，五官按角色年龄与身份作动漫式概括，面部以线条与简洁色块造型。画面仅含该角色的头部与颈部，独占画面。面部细节密度最高，五官与眉眼轮廓清晰锐利。面部肤色与角色设定一致；图为带透明通道的RGBA透明底图，背景透明；设定图采用便于辨认结构的均匀漫射光。"

def main() -> int:
    raw = BASES.read_text(encoding='utf-8')
    data = json.loads(raw)
    types = data['types']

    # ── 前置断言(fail-closed) ──
    assert len(types) == 12, f"型数={len(types)} 预期12(1021 口径)"
    assert types[-1]['zh'] == '自由', "自由须为末位"
    assert not any(t['zh'] == '人脸基准' for t in types), "人脸基准已存在,拒绝重插"
    face = next(t for t in types if t['zh'] == '高清人脸')
    # 用户钦定文本 ↔ 晏燎.json 类型词 逐字节互锁
    yl = json.loads(YANLIAO.read_text(encoding='utf-8'))['hd_face_base']['类型词']
    assert USER_TEXT == yl, "钦定文本与晏燎.json 类型词不一致(手术版漂移)"
    # 逐行成句断言(test_my_qi21_base schema 同款)
    assert all(ln.strip() and ln.endswith('。') for ln in USER_TEXT.split('\n'))

    addon_neg = "，头发，发型，发丝，鬓角，胡须，衣物，衣领，服装，配饰"
    entry = {
        "zh": "人脸基准",
        "aspect_ratio": "1:1 (Square)",
        "megapixels": 1.0,
        "rgba_default": True,
        "negative_text": face['negative_text'] + addon_neg,
        "positive_text": USER_TEXT,
        "purpose": "文生图直出角色统一人脸基准底版。主体句写角色气质五官并带「光洁的头颅」光头正向措辞；取景止颈根，零发型零衣领零衣物，RGBA 透明底。一角色一基准脸，作该角色全部生图的人脸参考。",
        "recipe_version": "v0.1(1022 入列:晏燎基准脸役型文手术版转正;实弹候验)",
        "lora_recipe": json.loads(json.dumps(face['lora_recipe'])),
        "steps_hint": {"fast": 4, "quality": 12},
        "i2i_routes": json.loads(json.dumps(face['i2i_routes'])),
        "postprocess": "作角色统一人脸参考供各期生图 i2i 锚脸;头像用途按 UI 圆/方裁切",
        "color_recipe": json.loads(json.dumps(face['color_recipe'])),
        "rgba_positive": "单一角色的正面头颈特写，正面平视机位，视线直视镜头，取景为头部与颈部；头顶、头颅外轮廓与下颌完整，面部是画面焦点，五官比例自然。四周留出空边，保持指定头颈取景。图为带透明通道的RGBA透明底图，背景透明。头颈设定图采用便于辨认结构的均匀漫射光。",
    }

    # ── 备份 + 插入(自由之前) ──
    BAK_DIR.mkdir(parents=True, exist_ok=True)
    if not BAK.exists():
        shutil.copy2(BASES, BAK)
    old_other = [t for t in types if t['zh'] != '自由']
    idx = next(i for i, t in enumerate(types) if t['zh'] == '自由')
    types.insert(idx, entry)

    # ── 后置断言 ──
    assert len(types) == 13
    assert [t['zh'] for t in types][11] == '人脸基准' and types[12]['zh'] == '自由'
    new_other = [t for t in types if t['zh'] not in ('自由', '人脸基准')]
    assert new_other == old_other, "既有型被误改"
    assert types[11]['positive_text'] == USER_TEXT

    # ── 格式保持:探测原文件缩进与尾换行 ──
    second_line = raw.split('\n', 2)[1]
    indent = len(second_line) - len(second_line.lstrip())
    tail = '\n' if raw.endswith('\n') else ''
    BASES.write_text(json.dumps(data, ensure_ascii=False, indent=indent) + tail, encoding='utf-8')

    # ── 节点实测(repo 真源层):新型可选可跑 ──
    sys.path.insert(0, str(ROOT / 'apps/backend'))
    from comfyui.my_nodes.nodes.my_qi21_base import MyQi21DaojieBase
    pos, w, h, neg, tm, tn = MyQi21DaojieBase().run('人脸基准')
    assert pos == USER_TEXT and (w, h) == (1024, 1024) and tm is True and tn == '人脸基准'
    assert '头发' in neg and '模糊' in neg
    print(f"[ok] 人脸基准入列:13 型(自由末位);positive=钦定文 {len(USER_TEXT)}字;"
          f"1024×1024/rgba默认开/负面含光头专项;备份={BAK.name}")
    return 0

if __name__ == '__main__':
    sys.exit(main())
