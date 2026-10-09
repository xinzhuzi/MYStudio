#!/usr/bin/env python3
"""色卡双修(1009 用户抓「blue.02 这些词出图模型认吗/四角还有白色,太奇怪了」):

A. ID 禁令入卡:color_lexicon.usage 补「词典编号(ma_id)与 hex 同规禁入正文,
   正文只写色词中文名」——出图模型不识内部编号,是噪音(收据实证 9B 把
   「赭石(red.04)」「宣纸白系(paper.01)」抄进终稿)。
B. 满幅型纸白基底清退:roles.base 从「浅净平涂底(宣纸白系 paper.01)」改
   「立绘/设定图衬底专用;满幅场景与概念气氛型不落宣纸白大面积基底,
   底色=主体句时段天色」——fire 首测四角 58% 近纸白的直接根因
   (PE 按五职责把宣纸白写成场景大面积基底)。
伴:示例库§2 留白载体色锚(谷口白雾→谷口青灰暮雾,青灰=在用词)。

json 两字段=mtime 热读,下一发即生效(无需引擎重启);
py 侧渲染剥 ID+ApiPE 硬滤已另落代码(重启生效),三重防线。

用法:python3 qi21_colorcard_fix_1009.py [--apply] [--sync]
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/10-09-qi21-scene-prompt-optimize'
SOURCE = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
EXAMPLES = ROOT / 'docs/prompts/道劫_九型主体句示例.md'

OLD_USAGE = ("hex仅供人工审稿与像素/GLM验收对表,禁止写入任何positive/negative prompt正文"
             "(文本编码器不读hex);新增色彩描述使用本词典色词，主体句原有色词逐字保留;"
             "冲突按conflict_order裁决,在最内层(主体句)解决")
NEW_USAGE = ("色词正文只写中文名;词典编号(paper.01/blue.02等ma_id)与hex仅供人工审稿与像素/GLM验收对表,"
             "禁止写入任何prompt正文与终稿——文本编码器不识内部编号与色值,是噪音;"
             "新增色彩描述使用本词典色词，主体句原有色词逐字保留;冲突按conflict_order裁决,在最内层(主体句)解决")
OLD_BASE = '浅净平涂底(宣纸白系 paper.01)'
NEW_BASE = ('浅净平涂底(宣纸白系)——立绘/设定图衬底专用;满幅场景与概念气氛型不落宣纸白大面积基底,'
            '底色=主体句时段天色,留白载体同为着色色面')

OLD_FOG = '谷口白雾正缓缓漫入'
NEW_FOG = '谷口青灰暮雾正缓缓漫入'
NOTE_APPEND = ('1009 二轮补:色卡立「编号与hex禁入正文」(fire 首测收据实证 9B 把 red.04/paper.01 抄进终稿,'
               '编码器不识=噪音);base 职责限定立绘衬底、满幅型底色=主体句时段天色(治四角纸白 58%);'
               '例句雾锚 白雾→青灰暮雾(留白载体着色,青灰=在用词)。')

DESTINATIONS = [
    ROOT / 'apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json',
    Path('/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'),
    Path('/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/daojie-data/qi21_bases.json'),
    Path('/Users/zhengbingjin/Project/IP/MA/skills/art_skills/daojie_ink_guofeng/json/qi21_bases.json',
         ),
]


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    if mode == '--sync':
        raw = SOURCE.read_bytes()
        data = json.loads(raw)
        assert data['color_lexicon']['usage'] == NEW_USAGE, '源非手术后态'
        n = 0
        for i, dst in enumerate(DESTINATIONS, 1):
            assert dst.is_file(), f'分发副本缺失:{dst}'
            before = dst.read_bytes()
            if before != raw:
                bak = TASK / f'backups/sync-card-{i}-before.json'
                assert not bak.exists(), '永不覆盖备份'
                shutil.copy2(dst, bak)
                shutil.copy2(SOURCE, dst)
                assert dst.read_bytes() == raw
                n += 1
        print(json.dumps({'synced': n, 'already_equal': len(DESTINATIONS) - n}))
        return

    raw = SOURCE.read_bytes()
    text = raw.decode('utf-8')
    for old, new in ((OLD_USAGE, NEW_USAGE), (OLD_BASE, NEW_BASE)):
        assert text.count(json.dumps(old, ensure_ascii=False)) == 1, f'锚不唯一:{old[:20]}'
    lib_raw = EXAMPLES.read_bytes()
    lib = lib_raw.decode('utf-8')
    assert lib.count(OLD_FOG) == 1, '§2 雾锚不唯一'
    # 白名单自检:改后仅 color_lexicon.usage/roles.base 两字段漂移
    before = json.loads(raw)
    new_text = text
    for old, new in ((OLD_USAGE, NEW_USAGE), (OLD_BASE, NEW_BASE)):
        new_text = new_text.replace(json.dumps(old, ensure_ascii=False),
                                    json.dumps(new, ensure_ascii=False), 1)
    after = json.loads(new_text)
    cl_b, cl_a = before['color_lexicon'], after['color_lexicon']
    assert cl_a['usage'] == NEW_USAGE and cl_a['roles']['base'] == NEW_BASE
    assert {k: v for k, v in cl_b.items() if k not in ('usage',)} == \
           {k: v for k, v in cl_a.items() if k not in ('usage',)} or True
    assert cl_b['roles'].keys() == cl_a['roles'].keys()
    diff_roles = {k for k in cl_b['roles'] if cl_b['roles'][k] != cl_a['roles'][k]}
    assert diff_roles == {'base'}, f'roles 白名单外漂移:{diff_roles}'
    assert {k: v for k, v in cl_b.items() if k not in ('usage', 'roles')} == \
           {k: v for k, v in cl_a.items() if k not in ('usage', 'roles')}
    assert before['types'] == after['types'] and before['art_style_base'] == after['art_style_base']
    # §2 雾锚+注记
    new_lib = lib.replace(OLD_FOG, NEW_FOG, 1)
    tail = '负向 v0.3(1007 写实漂移防线)无新证据不动。'
    assert new_lib.count(tail) == 1, '§2 注记尾锚不唯一'
    new_lib = new_lib.replace(tail, tail[:-1] + ';' + NOTE_APPEND + '。', 1)

    if mode == '--apply':
        for path, before_b, payload in ((SOURCE, raw, new_text.encode('utf-8')),
                                        (EXAMPLES, lib_raw, new_lib.encode('utf-8'))):
            bak = TASK / f'backups/cardfix-before-{path.name}'
            assert not bak.exists(), '永不覆盖备份'
            shutil.copy2(path, bak)
        import os
        fd, tmp = tempfile.mkstemp(prefix='.cardfix-', dir=SOURCE.parent)
        with os.fdopen(fd, 'wb') as f:
            f.write(new_text.encode('utf-8'))
        os.replace(tmp, SOURCE)
        fd, tmp = tempfile.mkstemp(prefix='.cardfix-', dir=EXAMPLES.parent)
        with os.fdopen(fd, 'wb') as f:
            f.write(new_lib.encode('utf-8'))
        os.replace(tmp, EXAMPLES)
    print(json.dumps({'mode': mode or 'dry-run',
                      'bases': f'{_sha(raw)[:12]}→{_sha(new_text.encode())[:12]}',
                      'lib': f'{_sha(lib_raw)[:12]}→{_sha(new_lib.encode())[:12]}',
                      'fields': ['color_lexicon.usage(+ID禁令)', 'color_lexicon.roles.base(满幅清退)',
                                 f'§2 {OLD_FOG[:4]}→{NEW_FOG[:6]}', '§2 注记+二轮']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
