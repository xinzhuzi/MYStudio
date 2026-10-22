#!/usr/bin/env python3
"""daojie_lora_stack.json + daojie_loras.json 补「人脸基准」档(10-22 人脸基准入列随迁)。

口径:逐槽克隆「高清人脸」preset 列(配方=克隆的 lora_recipe:detail1.0/asianmix0.4/
liujin0.3/goldenmist0.8,identity 恒关,全局件恒开),插入位=设定板之前(型序末位新丁);
loras 台账同克隆追加。fail-closed:前置断言不过即退,文件不动。
"""
import json, shutil, sys
from pathlib import Path

ROOT = Path('/Users/zhengbingjin/Project/Github/MYStudio')
JDIR = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json'
STACK = JDIR / 'daojie_lora_stack.json'
LORAS = JDIR / 'daojie_loras.json'
BAK = ROOT / 'apps/output/晏燎/bak'

def main() -> int:
    bases = json.loads((JDIR / 'qi21_bases.json').read_text(encoding='utf-8'))
    zh_seq = [e['zh'] for e in bases['types'] if e['zh'] != '自由']
    assert zh_seq[-1] == '人脸基准', f"bases 末位新型应为 人脸基准,得 {zh_seq[-1]}"
    face_recipe = {i['file']: i['weight'] for i in
                   next(e for e in bases['types'] if e['zh'] == '高清人脸')['lora_recipe']}
    fb_recipe = {i['file']: i['weight'] for i in
                 next(e for e in bases['types'] if e['zh'] == '人脸基准')['lora_recipe']}
    assert fb_recipe == face_recipe, "人脸基准 lora_recipe 须=高清人脸克隆(与预设列互锁前提)"

    # ── stack:逐槽克隆高清人脸列,插设定板之前 ──
    stack = json.loads(STACK.read_text(encoding='utf-8'))
    assert isinstance(stack, list) and len(stack) == 14
    for slot in stack:
        pres = slot['presets']
        assert '人脸基准' not in pres, f"{slot['key']} 已有人脸基准,拒绝重插"
        assert '设定板' in pres and '高清人脸' in pres, slot['key']
        new = {}
        for k, v in pres.items():
            if k == '设定板':
                new['人脸基准'] = dict(pres['高清人脸'])  # 克隆列(on/weight 全同)
            new[k] = v
        slot['presets'] = new
        assert list(slot['presets']) == zh_seq + ['设定板'], slot['key']

    # 互锁复验:配方件点亮=克隆配方
    want = fb_recipe
    for slot in stack:
        p = slot['presets']['人脸基准']
        if slot['key'] in ('turbo', 'projector'):
            assert p['on'] is True
        elif slot['file'] in want:
            assert p['on'] is True and abs(p['weight'] - want[slot['file']]) < 1e-9, slot['key']
        else:
            assert p['on'] is False, slot['key']

    # ── loras 台账:克隆高清人脸条目追加末位 ──
    loras = json.loads(LORAS.read_text(encoding='utf-8'))
    assert isinstance(loras, list) and not any(e.get('zh') == '人脸基准' for e in loras)
    face_entry = next(e for e in loras if e['zh'] == '高清人脸')
    fb_entry = json.loads(json.dumps(face_entry))
    fb_entry['zh'] = fb_entry['key'] = '人脸基准'
    fb_entry['note'] = '人脸基准(1022 入列):高清人脸同源克隆(统一人脸底版供 i2i 锚脸);金雾×0.8=09-20 人物同源终审沿用。'
    loras.append(fb_entry)
    assert [e['zh'] for e in loras] == zh_seq

    # ── 备份+落盘(格式保持:缩进探测) ──
    BAK.mkdir(parents=True, exist_ok=True)
    for f in (STACK, LORAS):
        b = BAK / (f.name + '.pre-人脸基准-1022.json')
        if not b.exists():
            shutil.copy2(f, b)
    def dump(path, data):
        raw = path.read_text(encoding='utf-8')
        indent = len(raw.split('\n', 2)[1]) - len(raw.split('\n', 2)[1].lstrip())
        path.write_text(json.dumps(data, ensure_ascii=False, indent=indent)
                        + ('\n' if raw.endswith('\n') else ''), encoding='utf-8')
    dump(STACK, stack)
    dump(LORAS, loras)
    print(f"[ok] lora 两件随迁:stack 14槽全带人脸基准列(克隆高清人脸);loras 台账 12 条(型序对齐 bases)")
    return 0

if __name__ == '__main__':
    sys.exit(main())
