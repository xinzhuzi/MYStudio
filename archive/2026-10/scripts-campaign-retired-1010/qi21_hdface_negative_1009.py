#!/usr/bin/env python3
"""Guarded HD-face (types[5]) negative re-targeting; no Git, no generation.

高清人脸负向从全身衣袍模板重定位为头肩特写专属防线(1009):
清退画外衣袍破损族/鞋靴族,立取景防线+脸部缺陷族,对齐表情差分脸版防线口径。
唯一编辑目标=qi21_bases.json types[5].negative_text + recipe_version;正向零改动。

用法:
  python3 qi21_hdface_negative_1009.py           # 干跑:校验+报告,不写盘
  python3 qi21_hdface_negative_1009.py --apply   # 手术:备份→原子替换→差异报告
  python3 qi21_hdface_negative_1009.py --sync    # 分发:四副本备份→拷贝→逐路字节验收
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
TASK = ROOT / '.trellis/tasks/10-09-qi21-hdface-negative'
SOURCE = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
EXAMPLES = ROOT / 'docs/prompts/道劫_九型主体句示例.md'
PINNED_SHA = 'c1c0a22962936f94e2082658dda979d4e5e32fe63d44fadcd70a2e266ec30e87'

DESTINATIONS = [
    ROOT / 'apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json',
    Path('/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'),
    Path('/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/daojie-data/qi21_bases.json'),
    Path('/Users/zhengbingjin/Project/IP/MA/skills/art_skills/daojie_ink_guofeng/json/qi21_bases.json'),
]

NEW_NEG = ('模糊，水印，多手指，文字错误，全身像，半身像，躯干入画，四肢入画，手部入画，'
           '侧面视角，仰拍，俯拍，头部歪斜，头顶裁切，下颌裁切，广角畸变，透视变形，'
           '面容身份漂移，脸型漂移，发型漂移，发际线漂移，五官错位，眼睛畸形，鼻口扭曲，'
           '牙齿畸形，多余五官，面部融化，透明头皮')
NEW_RECIPE = 'v0.3(1009 负向重定位:全身半身取景防线+五官缺陷族入场,清退画外衣袍鞋靴族;实弹候验)'

_DIRECTIVE = re.compile(r'^(禁止|不得|不要|避免|严禁|防止|没有)')


def _squash(s: str) -> str:
    return re.sub(r'\s+', '', s)


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def lint_tokens(text: str) -> list[str]:
    """负向 token 格式四硬规(与 test_negative_token_format_1008 同口径)。"""
    toks = [t.strip() for t in text.split('，') if t.strip()]
    assert toks, '负向清单不应为空'
    for t in toks:
        assert not _DIRECTIVE.search(t), f'指令词开头 token={t!r}'
        assert '/' not in t, f'斜杠复合 token={t!r}'
        assert len(t) < 12, f'超长 token={t!r}({len(t)} 字)'
    dup = sorted({t for t in toks if toks.count(t) > 1})
    assert not dup, f'重复 token={dup}'
    for w in ('模糊', '水印', '多手指', '文字错误'):
        assert w in toks, f'缺基线负面词 {w!r}(1004 基线,契约门九型在场)'
    return toks


def clash_domains(data: dict) -> dict[str, str]:
    """正向域全集(PE selfcheck 整词子串口径的预检域)。"""
    t5 = data['types'][5]
    base = data['art_style_base']
    domains = {
        'types[5].positive_text': t5['positive_text'],
        'types[5].rgba_positive': t5['rgba_positive'],
        'types[5].positive_background_text': t5.get('positive_background_text', ''),
        'types[5].color_recipe': json.dumps(t5.get('color_recipe', {}), ensure_ascii=False),
        'art_style_base.positive_text': base['positive_text'],
        'art_style_base.positive_style_text': base['positive_style_text'],
        'art_style_base.positive_ground_text': base['positive_ground_text'],
        'art_style_base.rgba_text': base['rgba_text'],
        'expand_instruction.system_prompt_zh': data['expand_instruction']['system_prompt_zh'],
    }
    md = EXAMPLES.read_text(encoding='utf-8')
    m = re.search(r'## 6\. 高清人脸.*?```(.*?)```', md, re.S)
    assert m, '示例库§6 围栏缺失'
    domains['示例§6主体句'] = m.group(1)
    return domains


def build_patch(raw: bytes) -> tuple[bytes, dict]:
    data = json.loads(raw)
    t = data['types'][5]
    assert t['zh'] == '高清人脸'
    old_neg, old_recipe = t['negative_text'], t['recipe_version']
    assert old_neg.startswith('模糊，水印，多手指，文字错误，'), '旧负向基线漂移,重读再改'
    assert '扇贝状裙摆' in old_neg and '透明头皮' in old_neg and '广角畸变' in old_neg, '旧负向指纹不符'

    new_tokens = lint_tokens(NEW_NEG)
    assert len(new_tokens) == 28, len(new_tokens)
    violations = [(name, tok) for name, txt in clash_domains(data).items()
                  for tok in new_tokens if _squash(tok) in _squash(txt)]
    assert not violations, f'正负撞词预检违例:{violations}'

    text = raw.decode('utf-8')
    marker = '"zh": "高清人脸"'
    assert text.count(marker) == 1
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
    for old, new in ((old_neg, NEW_NEG), (old_recipe, NEW_RECIPE)):
        anchor = json.dumps(old, ensure_ascii=False)
        assert span.count(anchor) == 1, f'span 内锚不唯一:{old[:20]!r}'
        span = span.replace(anchor, json.dumps(new, ensure_ascii=False), 1)
    new_raw = (text[:obj_start] + span + text[i + 1:]).encode('utf-8')

    after = json.loads(new_raw)
    t_after = after['types'][5]
    assert t_after['negative_text'] == NEW_NEG and t_after['recipe_version'] == NEW_RECIPE
    assert after['types'][:5] == data['types'][:5] and after['types'][6:] == data['types'][6:]
    whitelist = ('negative_text', 'recipe_version')
    assert {k: v for k, v in t_after.items() if k not in whitelist} == \
           {k: v for k, v in t.items() if k not in whitelist}, 'types[5] 白名单外漂移'
    for k in data:
        if k != 'types':
            assert after[k] == data[k], f'顶层漂移:{k}'

    old_tokens = [x for x in old_neg.split('，') if x]
    report = {
        'before_sha256': _sha(raw),
        'after_sha256': _sha(new_raw),
        'fields': [
            {'path': ['types', 5, 'negative_text'], 'before': old_neg, 'after': NEW_NEG},
            {'path': ['types', 5, 'recipe_version'], 'before': old_recipe, 'after': NEW_RECIPE},
        ],
        'token_count': {'before': len(old_tokens), 'after': len(new_tokens)},
        'dropped': [x for x in old_tokens if x not in new_tokens],
        'added': [x for x in new_tokens if x not in old_tokens],
    }
    return new_raw, report


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    raw = SOURCE.read_bytes()
    if mode == '--sync':
        assert _sha(raw) != PINNED_SHA, '源仍是手术前态,先 --apply'
        assert json.loads(raw)['types'][5]['negative_text'] == NEW_NEG, '源非手术后态'
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
    new_raw, report = build_patch(raw)
    if mode == '--apply':
        backup = TASK / 'backups/hdface-negative-before-qi21_bases.json'
        assert not backup.exists(), '永不覆盖备份'
        shutil.copy2(SOURCE, backup)
        assert backup.read_bytes() == raw and SOURCE.read_bytes() == raw, '备份期间源被并发改动'
        fd, temp = tempfile.mkstemp(prefix='.qi21-hdface-', dir=SOURCE.parent)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(new_raw)
            stream.flush()
            os.fsync(stream.fileno())
        shutil.copymode(SOURCE, temp)
        assert SOURCE.read_bytes() == raw, '写盘前源被并发改动'
        os.replace(temp, SOURCE)
        (TASK / 'research/hdface-negative-diff.json').write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'mode': mode or 'dry-run',
                      'before': report['before_sha256'][:12], 'after': report['after_sha256'][:12],
                      'tokens': report['token_count'],
                      'dropped': len(report['dropped']), 'added': len(report['added'])},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()
