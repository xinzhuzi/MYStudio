#!/usr/bin/env python3
"""Guarded scene-type (types[1]) prompt optimization; no Git, no generation.

场景型提示词优化(1009,用户令「提示词优化-场景」;系列第三轮=人物/高清人脸之后):
①型文补满幅令(逐字同分镜款——1009 分镜白边回归立满幅令族,场景=最纯满幅型却缺席);
②§2 例句色相锚三词(实物/光源/背景三位,色卡场景预算点亮——§2 原为九型唯一零注记条目);
负向 v0.3(1007 写实漂移防线)无新证据零改动。
编辑目标=qi21_bases.json types[1].positive_text+recipe_version 与 示例库§2(例句+轮注记)。

用法:
  python3 qi21_scene_prompt_1009.py           # 干跑:校验+报告,不写盘
  python3 qi21_scene_prompt_1009.py --apply   # 手术:备份→原子替换→差异报告
  python3 qi21_scene_prompt_1009.py --sync    # 分发:四副本备份→拷贝→逐路字节验收
"""
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/10-09-qi21-scene-prompt-optimize'
SOURCE = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
EXAMPLES = ROOT / 'docs/prompts/道劫_九型主体句示例.md'
PINNED_SHA = 'da1e901fef709dd71ca7c305e3ab8002fa5cc253cde89929749d7b452b92b226'

DESTINATIONS = [
    ROOT / 'apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json',
    Path('/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'),
    Path('/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/daojie-data/qi21_bases.json'),
    Path('/Users/zhengbingjin/Project/IP/MA/skills/art_skills/daojie_ink_guofeng/json/qi21_bases.json'),
]

# ── 手术文:满幅令(逐字同分镜 types[6] 现行款,家族一致) ─────────────────────
SEAM = '层层退远、渐淡渐虚。色彩层次承担画面呼吸'
FULLBLEED = '环境色面铺满画幅，色彩出自场景叙事，色面连续铺到画框边缘；'
NEW_SEAM = '层层退远、渐淡渐虚。' + FULLBLEED + '色彩层次承担画面呼吸'

OLD_RECIPE = 'v0.3(1007 负向补防写实漂移:补丁首弹4B判工笔过,旧图两模判写实厚涂对照在档)'
NEW_RECIPE = 'v0.4(1009 满幅令入型文+§2例句色相锚三词;负向v0.3写实漂移防线不动;实弹候验)'

# ── 手术文:示例库§2 例句色相锚(三位落色,色卡场景预算 mid=[青绿,赭石,旧金]+stable=[淡墨,青灰]) ──
OLD_SENT = '暮春时节的黄昏，废弃的上古祭坛深藏在群山环抱的谷底，九根断裂的石柱围成半圆，坛心一泓浅潭映出残阳；谷口白雾正缓缓漫入，远山三重叠影渐次淡去。'
NEW_SENT = '暮春时节的黄昏，废弃的上古祭坛深藏在群山环抱的谷底，九根断裂的赭石色石柱围成半圆，坛心一泓浅潭映出旧金色残阳；谷口白雾正缓缓漫入，远山三重青灰叠影渐次淡去。'
ANCHOR_REPLACEMENTS = (
    ('断裂的石柱', '断裂的赭石色石柱'),
    ('映出残阳', '映出旧金色残阳'),
    ('远山三重叠影', '远山三重青灰叠影'),
)
NOTE = ('> 1009 场景优化轮(用户令「提示词优化-场景」):型文补满幅令「环境色面铺满画幅，色彩出自场景叙事，'
        '色面连续铺到画框边缘」(逐字同分镜款——1009 分镜白边回归立满幅令族,场景=最纯满幅型却缺席;'
        '留白载体自此明确为着色色面铺到画框边缘,雾/天空不再是裸白,0929 概念夜空锚同则);'
        '例句色相锚三词补强(断裂的赭石色石柱/映出旧金色残阳/远山三重青灰叠影=实物/光源/背景三位,'
        '色卡场景预算 mid+stable 点亮)——§2 原为九型唯一零注记条目,违本型 purpose「底色色相由主体句按时段天候指定」'
        '自身规范;实弹证据=R3 批 borderSAT 0.153 贴线、全图零暗像素、边缘纸白 26.8%(白雾渲染成近纯白)、'
        'vl-4b 判「素净但不浓烈」。叙事主体与白雾逐字不动;负向 v0.3(1007 写实漂移防线)无新证据不动。')


def _squash(s: str) -> str:
    return re.sub(r'\s+', '', s)


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def negative_tokens(data: dict) -> list[str]:
    """场景负向 + 全局负向(装配合并口径)。"""
    toks = [t.strip() for t in data['types'][1]['negative_text'].split('，') if t.strip()]
    toks += [t.strip() for t in data['art_style_base']['negative_text'].split('，') if t.strip()]
    return toks


def build_patch(raw: bytes) -> tuple[bytes, dict]:
    data = json.loads(raw)
    t = data['types'][1]
    assert t['zh'] == '场景', 'types[1] 非场景,真源结构漂移'
    old_pos, old_neg, old_recipe = t['positive_text'], t['negative_text'], t['recipe_version']
    assert old_pos.count(SEAM) == 1, '满幅令插缝锚不唯一'
    assert old_recipe == OLD_RECIPE, 'recipe_version 锚不符,重读再改'

    new_pos = old_pos.replace(SEAM, NEW_SEAM, 1)
    # 型文三问自检:唯一 diff=满幅令插入;开头自述不动;满幅令零具体物零色名
    assert new_pos.startswith('空镜场景，前景、中景、远景三层分明；'), '型文开头漂移'
    assert new_pos == old_pos.replace(SEAM, NEW_SEAM, 1) and len(new_pos) - len(old_pos) == len(FULLBLEED)
    assert FULLBLEED in new_pos and new_pos.count(FULLBLEED) == 1
    assert not any(w in FULLBLEED for w in ('工笔', '白描', '风格', '淡墨', '青灰', '青绿', '赭石', '旧金', '朱红')), '满幅令夹带风格词/色名'

    # 撞词预检:负向 token 整词子串 ∉ 新型文/新例句(PE selfcheck 口径)
    tokens = negative_tokens(data)
    new_texts = [new_pos, NEW_SENT]
    violations = [(tok, which) for tok in tokens for which, txt in zip(('型文', '例句'), new_texts)
                  if _squash(tok) in _squash(txt)]
    assert not violations, f'正负撞词预检违例:{violations}'

    # span 手术:仅 types[1] 对象内替换(hdface 同款)
    text = raw.decode('utf-8')
    marker = '"zh": "场景"'
    assert text.count(marker) == 1, '场景 marker 不唯一'
    obj_start = text.rindex('{', 0, text.index(marker))
    depth, i = 0, obj_start
    while True:
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                break
        i += 1
    span = text[obj_start:i + 1]
    for old, new in ((old_pos, new_pos), (old_recipe, NEW_RECIPE)):
        anchor = json.dumps(old, ensure_ascii=False)
        assert span.count(anchor) == 1, f'span 内锚不唯一:{old[:20]!r}'
        span = span.replace(anchor, json.dumps(new, ensure_ascii=False), 1)
    new_raw = (text[:obj_start] + span + text[i + 1:]).encode('utf-8')

    after = json.loads(new_raw)
    t_after = after['types'][1]
    assert t_after['positive_text'] == new_pos and t_after['recipe_version'] == NEW_RECIPE
    assert t_after['negative_text'] == old_neg, '负向被误改(v0.3 防线零改动边界)'
    assert after['types'][:1] == data['types'][:1] and after['types'][2:] == data['types'][2:], '兄弟型漂移'
    whitelist = ('positive_text', 'recipe_version')
    assert {k: v for k, v in t_after.items() if k not in whitelist} == \
           {k: v for k, v in t.items() if k not in whitelist}, 'types[1] 白名单外漂移'
    for k in data:
        if k != 'types':
            assert after[k] == data[k], f'顶层漂移:{k}'

    # ── 示例库§2:例句三词替换+轮注记 ──────────────────────────────────────
    lib_raw = EXAMPLES.read_bytes()
    lib = lib_raw.decode('utf-8')
    assert lib.count(OLD_SENT) == 1, '§2 例句锚不唯一'
    for old_w, new_w in ANCHOR_REPLACEMENTS:
        assert OLD_SENT.count(old_w) == 1 and NEW_SENT.count(new_w) == 1, f'替换词锚异常:{old_w}'
    new_lib = lib.replace(OLD_SENT, NEW_SENT, 1)
    note_anchor = '```\n\n## 3. 道具'
    assert new_lib.count(note_anchor) == 1, '§3 前注记插缝锚不唯一'
    new_lib = new_lib.replace(note_anchor, '```\n\n' + NOTE + '\n\n## 3. 道具', 1)

    report = {
        'bases_before_sha256': _sha(raw),
        'bases_after_sha256': _sha(new_raw),
        'lib_before_sha256': _sha(lib_raw),
        'lib_after_sha256': _sha(new_lib.encode('utf-8')),
        'fields': [
            {'path': ['types', 1, 'positive_text'], 'delta': f'+{len(FULLBLEED)}字 满幅令', 'inserted': FULLBLEED},
            {'path': ['types', 1, 'recipe_version'], 'before': old_recipe, 'after': NEW_RECIPE},
            {'path': ['示例库§2', '例句'], 'replacements': [f'{a}→{b}' for a, b in ANCHOR_REPLACEMENTS]},
            {'path': ['示例库§2', '注记'], 'appended': True},
        ],
        'negative_unchanged': old_neg,
        'clash_check_tokens': len(tokens),
    }
    return new_raw, new_lib.encode('utf-8'), report


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    raw = SOURCE.read_bytes()
    if mode == '--sync':
        assert _sha(raw) != PINNED_SHA, '源仍是手术前态,先 --apply'
        data = json.loads(raw)
        assert data['types'][1]['recipe_version'] == NEW_RECIPE, '源非手术后态'
        entries = []
        for i, dst in enumerate(DESTINATIONS, 1):
            assert dst.is_file(), f'分发副本缺失:{dst}'
            before = dst.read_bytes()
            json.loads(before)
            entry = {'destination': str(dst), 'before_sha256': _sha(before),
                     'backup': f'backups/sync-{i}-before-qi21_bases.json'}
            if before != raw:
                backup = TASK / entry['backup']
                assert not backup.exists(), '永不覆盖备份'
                shutil.copy2(dst, backup)
                assert _sha(dst.read_bytes()) == entry['before_sha256'], '拷备份期间目的地被并发改动'
                shutil.copy2(SOURCE, dst)
                assert dst.read_bytes() == raw, f'同步后字节不一致:{dst}'
            entries.append({**entry, 'changed': before != raw})
        (TASK / 'research/sync-result.json').write_text(
            json.dumps({'entries': entries, 'source_sha256': _sha(raw)}, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'synced': sum(e['changed'] for e in entries),
                          'already_equal': sum(not e['changed'] for e in entries)}, ensure_ascii=False))
        return
    assert _sha(raw) == PINNED_SHA, f'源已漂移({_sha(raw)}),重读重锚后再动'
    new_raw, new_lib, report = build_patch(raw)
    if mode == '--apply':
        lib_orig = EXAMPLES.read_bytes()
        for path, before, payload, tag in ((SOURCE, raw, new_raw, 'qi21_bases'),
                                           (EXAMPLES, lib_orig, new_lib, '示例库')):
            backup = TASK / f'backups/{tag}-before-{path.name}'
            assert not backup.exists(), f'永不覆盖备份:{backup}'
            shutil.copy2(path, backup)
            assert path.read_bytes() == before, f'备份期间 {tag} 被并发改动'
            fd, temp = tempfile.mkstemp(prefix=f'.{path.stem}-scene-', dir=path.parent)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            shutil.copymode(path, temp)
            assert path.read_bytes() == before, f'写盘前 {tag} 被并发改动'
            os.replace(temp, path)
        assert SOURCE.read_bytes() == new_raw and EXAMPLES.read_bytes() == new_lib, '写盘后校验失败'
        (TASK / 'research/scene-surgery-diff.json').write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'mode': mode or 'dry-run',
                      'bases': f"{report['bases_before_sha256'][:12]}→{report['bases_after_sha256'][:12]}",
                      'lib': f"{report['lib_before_sha256'][:12]}→{report['lib_after_sha256'][:12]}",
                      'inserted': FULLBLEED, 'example_replacements': len(ANCHOR_REPLACEMENTS),
                      'clash_tokens_checked': report['clash_check_tokens']},
                     ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
