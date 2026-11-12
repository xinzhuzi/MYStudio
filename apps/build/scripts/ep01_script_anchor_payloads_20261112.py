#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""EP01 剧本镜头原文 → 19 张分镜锚图生图载荷(python3 组,不跑 GPU)。

真源:
  剧本   /Users/zhengbingjin/Project/IP/MA/novel/drama/chapter-001_漫剧.md (16 镜,四场)
  槽位   /Users/zhengbingjin/Project/IP/MA/store/studio-workflow/chapters/chapter-001/storyboards-*.json (19 槽,取 index+videoDesc)
  模板   apps/backend/comfyui/workflows/1_图片/MossImage/moss-道劫-t2i-api.json (API 平铺形,剥 _doc)
  底座   apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json (art_style_base)

落盘: apps/output/ep01-director/script-anchors/payload-01..19.json + manifest.json
"""
import json
import os
import re
import sys

ROOT = '/Users/zhengbingjin/Project/Github/MYStudio'
SCRIPT_MD = '/Users/zhengbingjin/Project/IP/MA/novel/drama/chapter-001_漫剧.md'
SB_GLOB = '/Users/zhengbingjin/Project/IP/MA/store/studio-workflow/chapters/chapter-001/storyboards-*.json'
TEMPLATE = os.path.join(ROOT, 'apps/backend/comfyui/workflows/1_图片/MossImage/moss-道劫-t2i-api.json')
BASES = os.path.join(ROOT, 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json')
OUT_DIR = os.path.join(ROOT, 'apps/output/ep01-director/script-anchors')

# ---------- 人物正典(assets.db setting 口径,任务给定) ----------
CANON = {
    '独孤剑尘': ('独孤剑尘:约40岁清瘦冷峻剑修;黑发绾顶髻、两鬓染霜(以黑发为主,严禁满头银白、严禁高马尾);'
                '颏下山羊须;灰袍右肩有一道裂痕;归元古剑腰悬、剑在鞘中不外露'),
    '赵四': '赵四:粗壮魁梧的码头监工;手中蛇皮纹长鞭(蛇皮花纹的皮鞭,绝非活蛇)',
    '铁山': '铁山:断臂散修;断臂断端以旧布条包裹,断口干净齐整,绝非锯齿状残肢',
    '钱掌柜': '钱掌柜:肥胖精明的当铺掌柜',
    '管事': '管事:清瘦精明的塾馆管事,着灰褐长衫',
    '晏燎': ('晏燎:塾馆角落的清瘦少年;腕细,小臂横着旧擦伤结痂;草鞋脚趾有冻疮破了又结;'
            '呼吸与灯焰同拍,瞳仁里映着灯焰倒影;是少年学子,绝非中年剑修独孤剑尘'),
}

# ---------- 色温指令(剧本自带,逐场注入) ----------
TEMP = {
    '1-1': '拂晓冷色温;蓝白风灯灯焰,河雾雾灰,湿冷晨雾',
    '1-2': '白日;暖灰调晨光自街东斜切',
    '1-3': '夜;暖低色温,两盏油灯昏黄',
    '1-4': '深夜冷调;一线窗缝月光斜落,河面雾呈铁灰',
}

TAIL = '完整场景构图,画面充满环境细节;古代木质门面,无金属卷帘门/玻璃/电线'
STREET_NEG_PREFIX = ('metal roller shutter, roller shutter door, electric wires, power lines, '
                     'utilities pole, utility pole, streetlights, modern metal shopfront, ')

# ---------- 槽位映射表 ----------
# (slot, scene, shot, cast, split)  shot: 剧本镜号;None=fallback videoDesc;'2+4'=两镜原文并用
# split=True: 一剧本镜拆多槽,原文整段后附【本槽动作相位】(取该槽 videoDesc)
CONFIG = [
    (1,  '1-1', 2,     ['赵四'],                  True),   # 呵斥相位
    (2,  '1-1', 2,     ['赵四'],                  True),   # 鞭落/矿奴跪倒相位
    (3,  '1-1', 3,     ['独孤剑尘'],              False),
    (4,  '1-1', 4,     ['独孤剑尘', '赵四'],       False),
    (5,  '1-2', 1,     ['铁山'],                  True),   # 拍柜陈情相位
    (6,  '1-2', 1,     ['钱掌柜', '铁山'],         True),   # 压价判词相位
    (7,  '1-2', 1,     ['钱掌柜', '铁山'],         True),   # 宣判/抓银离场相位
    (8,  '1-2', 2,     ['独孤剑尘'],              False),
    (9,  '1-3', 1,     ['管事', '独孤剑尘'],       False),
    (10, '1-3', 2,     ['独孤剑尘'],              True),   # 写「沉」字相位
    (11, '1-3', 2,     ['独孤剑尘'],              True),   # 蹲下按背相位
    (12, '1-3', 4,     ['独孤剑尘', '晏燎'],       False),  # 晏燎镜,必带晏燎正典
    (13, '1-3', 5,     ['管事'],                  True),   # 女孩白芒相位
    (14, '1-3', 5,     ['管事', '晏燎', '独孤剑尘'], True),  # 晏燎暗红相位
    (15, '1-3', 5,     ['管事', '晏燎', '独孤剑尘'], True),  # 落判/归角落相位
    (16, '1-3', 6,     ['独孤剑尘'],              False),
    (17, None,  None,  ['独孤剑尘', '赵四'],       False),  # 剧本无对应镜(监工打量已删)→退回 videoDesc
    (18, '1-4', 1,     ['独孤剑尘'],              False),
    (19, '1-4', '2+4', ['独孤剑尘'],              False),  # 横跨镜头2+镜头4,两段原文并用
]
STREET_NEG_SLOTS = {5, 6, 7, 8, 17}   # 街市场景:负向前置金属卷帘门/电线/电线杆族
SLOT17_TEMP_PROXY = '1-3'             # 槽17 时段处塾馆夜→客栈深夜之间,色温以 1-3 夜暖代理


def parse_script_shots(md_text):
    """按场头+「镜头N:」切块,返回 {('1-1',2): '镜头原文整段(含台词/SFX 行)'}。"""
    shots = {}
    cur_scene = None
    cur_shot = None
    for line in md_text.split('\n'):
        if line.startswith('## 改编追踪'):
            cur_scene, cur_shot = None, None
            continue
        m = re.match(r'^(1-\d)\s+\S+.*·', line)
        if m:
            cur_scene, cur_shot = m.group(1), None
            continue
        if line.strip() == '---':
            cur_shot = None
            continue
        ms = re.match(r'^镜头(\d+)', line)
        if ms and cur_scene:
            cur_shot = (cur_scene, int(ms.group(1)))
            shots[cur_shot] = line.strip()
            continue
        if cur_shot is not None and line.strip():
            shots[cur_shot] += '\n' + line.strip()
    return shots


def load_slots():
    import glob
    slots = {}
    for f in sorted(glob.glob(SB_GLOB)):
        if '.bak-' in f:
            continue
        with open(f, encoding='utf-8') as fh:
            d = json.load(fh)
        for sb in d.get('state', {}).get('storyboards', []):
            slots[sb['index']] = sb.get('videoDesc', '')
    return slots


def main():
    with open(SCRIPT_MD, encoding='utf-8') as fh:
        shots = parse_script_shots(fh.read())
    slots = load_slots()
    with open(TEMPLATE, encoding='utf-8') as fh:
        template = json.load(fh)
    with open(BASES, encoding='utf-8') as fh:
        bases = json.load(fh)
    base_pos = bases['art_style_base']['positive_text']
    base_neg = bases['art_style_base']['negative_text']

    # ---- 前置断言 ----
    assert len(shots) == 16, f'剧本应 16 镜,实得 {len(shots)}: {sorted(shots)}'
    assert len(slots) == 19 and sorted(slots) == list(range(1, 20)), f'槽位应 19,实得 {sorted(slots)}'
    for nid in ('5', '6', '7', '8', '11'):
        assert nid in template, f'模板缺节点 {nid}'
    assert '_doc' in template

    os.makedirs(OUT_DIR, exist_ok=True)
    manifest_slots = []
    for slot, scene, shot, cast, split in CONFIG:
        seed = 1108 + slot
        prefix = f'ep01-scriptregen/sb-{slot:03d}'
        temp_key = scene or SLOT17_TEMP_PROXY
        color_temp = TEMP[temp_key]

        # 本镜画面
        fallback = shot is None
        if fallback:
            shot_text = slots[slot]
        elif isinstance(shot, str) and '+' in shot:
            parts = [(scene, int(x)) for x in shot.split('+')]
            shot_text = '\n'.join(shots[p] for p in parts)
        else:
            shot_text = shots[(scene, shot)]
        if split:
            shot_text += '\n【本槽动作相位】' + slots[slot]

        # 人物设定
        cast_text = ';'.join(CANON[c] for c in cast)

        pos = (base_pos
               + '\n【人物设定(严格遵循)】' + cast_text
               + '\n【色温基调】' + color_temp
               + '\n【本镜画面】' + shot_text
               + '\n' + TAIL)
        neg = (STREET_NEG_PREFIX + base_neg) if slot in STREET_NEG_SLOTS else base_neg

        payload = {k: v for k, v in template.items() if k != '_doc'}
        payload['5'] = dict(template['5']); payload['5']['inputs']['text'] = pos
        payload['6'] = dict(template['6']); payload['6']['inputs']['text'] = neg
        payload['7'] = dict(template['7'])
        payload['7']['inputs']['width'] = 1920
        payload['7']['inputs']['height'] = 1088
        payload['8'] = dict(template['8']); payload['8']['inputs']['seed'] = seed
        payload['11'] = dict(template['11']); payload['11']['inputs']['filename_prefix'] = prefix

        fname = f'payload-{slot:02d}.json'
        with open(os.path.join(OUT_DIR, fname), 'w', encoding='utf-8') as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)

        shot_label = ('退回videoDesc(剧本无对应镜)' if fallback
                      else (f"{scene}镜头{shot}" if not isinstance(shot, str)
                            else f"{scene}镜头{shot.replace('+', '+镜头')}"))
        manifest_slots.append({
            'slot': slot, 'file': fname, 'prefix': prefix, 'seed': seed,
            'scriptShot': shot_label, 'scene': scene or '(过渡·塾馆夜→客栈深夜)',
            'colorTemp': color_temp + ('(1-3夜暖代理,剧本无此场)' if fallback else ''),
            'cast': cast, 'fallbackToVideoDesc': fallback, 'phaseNoteAttached': split,
        })

    manifest = {
        'episode': 'EP01 断剑初醒', 'generated': '2026-11-12',
        'sources': {
            'script': SCRIPT_MD, 'slots': SB_GLOB + ' (3 件,槽1-8/9-16/17-19)',
            'template': TEMPLATE, 'bases': BASES + ' (art_style_base)',
        },
        'rules': {
            'structure': '19 槽结构不变(W5 结构裁定未下,禁增删镜)',
            'shotText': '【本镜画面】=剧本该镜头原文整段(对位失败才用 videoDesc);一剧本镜拆多槽=原文整段后附【本槽动作相位】(取该槽videoDesc)',
            'seed': '1108+槽index', 'size': '1920x1088', 'prefix': 'ep01-scriptregen/sb-XXX',
            'streetNegative': '槽5-8/17(街市)负向前置 metal roller shutter/electric wires/utilities pole 族',
        },
        'slots': manifest_slots,
    }
    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)

    print(f'OK: {len(manifest_slots)} payloads + manifest -> {OUT_DIR}')
    for m in manifest_slots:
        print(f"  sb-{m['slot']:03d} seed={m['seed']} | {m['scriptShot']} | {','.join(m['cast'])}"
              f" | fallback={m['fallbackToVideoDesc']} phase={m['phaseNoteAttached']}")


if __name__ == '__main__':
    sys.exit(main())
